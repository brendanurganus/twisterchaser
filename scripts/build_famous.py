#!/usr/bin/env python3
"""Build the famous-tornado dataset from the raw files fetch_famous.py cached.

Writes data/famous.json            one record per tornado, same shape as tornadoes-2026.json
       data/outlines-famous.geojson  NWS damage outlines (zoned by rating, or a single envelope)
       data/warnings-famous.json     every tornado warning that covered each track
       data/swaths/famous-*.json     cross-track slices for playback (where an outline exists)
       data/famous-report.json       what was derived and how, for the methodology page

Track geometry is one of three kinds (see famous_config.py): a NWS survey line, a centerline
derived from the NWS damage outline, or a hand-traced path through named landmarks. The kind
is stored on each record and shown to the user.
"""
import collections
import csv
import datetime as dt
import json
import math
import sys
import zipfile
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import shapefile  # pyshp
from shapely import STRtree
from shapely.geometry import LineString, MultiPolygon, Point, mapping, shape
from shapely.ops import transform as shp_transform
from shapely.ops import substring, unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_data as B  # noqa: E402
from famous_config import FAMOUS  # noqa: E402

ROOT = B.ROOT
RAW = ROOT / "data" / "raw" / "famous"
OUT = ROOT / "data"
CDT = dt.timezone(dt.timedelta(hours=-5))
MI = 1609.344


def cdt_to_utc(s):
    return dt.datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=CDT).astimezone(dt.timezone.utc)


def iso(d):
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def proj(coords):
    return [B.TO_5070(x, y) for x, y in coords]


def unproj(coords):
    return [B.FROM_5070(x, y) for x, y in coords]


def flat_line(geom):
    c = geom["coordinates"]
    if geom["type"] == "MultiLineString":
        c = [p for part in c for p in part]
    return [p[:2] for p in c]


def dat(slug, layer):
    p = RAW / f"{slug}.dat{layer}.json"
    return json.loads(p.read_text())["features"] if p.exists() else []


# ------------------------------------------------------------- track kinds

def track_from_line(f, spc):
    rule = f["dat_pick"]["layer1"]
    hits = []
    for ft in dat(f["id"], 1):
        p = ft["properties"]
        if "efscale" in rule and p["efscale"] != rule["efscale"]:
            continue
        if "wfo" in rule and rule["wfo"] not in (p["wfo"] or ""):
            continue
        if "event_id" in rule and rule["event_id"].lower() not in (p["event_id"] or "").lower():
            continue
        if "length" in rule and abs((p["length"] or 0) - rule["length"]) > 0.05:
            continue
        hits.append(ft)
    if len(hits) != 1:
        raise SystemExit(f"{f['id']}: expected one DAT line, found {len(hits)}")
    ft = hits[0]
    return flat_line(ft["geometry"]), {"dat_line": ft["properties"]}


def pick_polys(f):
    feats = [x for x in dat(f["id"], 2) if x.get("geometry")]
    slug = f["id"]
    out = []
    for x in feats:
        p = x["properties"]
        ef = str(p["efscale"])
        if not ef.startswith("EF"):
            continue
        n = int(ef[2])
        if slug == "famous-hackleburg-2011" and abs((p["length"] or 0) - 132) < 0.01:
            out.append((n, x))
        elif slug == "famous-moore-2013" and (p.get("event_id") or "").strip() == "Newcastle-OKC-Moore":
            out.append((n, x))
        elif slug == "famous-elreno-2013" and (p.get("event_id") or "").strip() == "ElReno_Poly":
            out.append((n, x))
        elif slug == "famous-elreno-2011" and n == 5:
            out.append((n, x))
        elif slug == "famous-tuscaloosa-2011" and abs((p["length"] or 0) - 80.68) < 0.01:
            out.append((n, x))
    return out


def centerline(union, start_xy, step=250.0):
    """Centerline of a long thin polygon: slice it across at even steps and take the middle of each
    slice. Two passes: first across a straight axis, then across the smoothed line itself."""
    parts = list(getattr(union, "geoms", [union]))
    pts = np.array([c for g in parts for c in g.exterior.coords])
    c0 = pts.mean(axis=0)
    axis = np.linalg.svd(pts - c0)[2][0]
    if np.dot(axis, np.array(start_xy) - c0) > 0:
        axis = -axis                      # make the axis run from the start end towards the far end
    s = (pts - c0) @ axis
    H = 30000.0

    def slices(centers, normals):
        out, prev = [], None
        for c, n in zip(centers, normals):
            cut = LineString([c - n * H, c + n * H])
            inter = union.intersection(cut)
            segs = [g for g in getattr(inter, "geoms", [inter]) if g.geom_type == "LineString" and g.length > 1]
            if not segs:
                continue
            if prev is not None:
                seg = min(segs, key=lambda g: g.interpolate(0.5, normalized=True).distance(Point(prev)))
            else:
                seg = max(segs, key=lambda g: g.length)
            m = seg.interpolate(0.5, normalized=True)
            prev = (m.x, m.y)
            out.append(prev)
        return np.array(out)

    nrm = np.array([-axis[1], axis[0]])
    ss = np.arange(s.min() + step, s.max() - step, step)
    first = slices([c0 + axis * v for v in ss], [nrm] * len(ss))

    def smooth(a, w=4):
        o = a.copy()
        for i in range(len(a)):
            o[i] = a[max(0, i - w): i + w + 1].mean(axis=0)
        return o

    sm = smooth(first)
    tang = np.gradient(sm, axis=0)
    tang /= np.linalg.norm(tang, axis=1)[:, None]
    nrms = np.stack([-tang[:, 1], tang[:, 0]], axis=1)
    second = smooth(slices(list(sm), list(nrms)), 3)

    def extend(a, b):
        """Push the end point a (coming from b) along its heading to the edge of the polygon."""
        d = a - b
        d /= np.linalg.norm(d)
        far = LineString([tuple(a), tuple(a + d * 8000.0)])
        inter = union.intersection(far)
        segs = [g for g in getattr(inter, "geoms", [inter]) if g.geom_type == "LineString"]
        if not segs:
            return a
        seg = min(segs, key=lambda g: Point(a).distance(g))
        pts = list(seg.coords)
        return np.array(max(pts, key=lambda q: (q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1]))

    second[0] = extend(second[0], second[3])
    second[-1] = extend(second[-1], second[-4])
    return second


def catmull_rom(pts, spacing=120.0):
    """Centripetal Catmull-Rom spline through the points (projected metres)."""
    P = [np.array(p, float) for p in pts]
    P = [2 * P[0] - P[1]] + P + [2 * P[-1] - P[-2]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        t0 = 0.0
        t1 = t0 + max(np.linalg.norm(p1 - p0), 1) ** 0.5
        t2 = t1 + max(np.linalg.norm(p2 - p1), 1) ** 0.5
        t3 = t2 + max(np.linalg.norm(p3 - p2), 1) ** 0.5
        n = max(4, int(np.linalg.norm(p2 - p1) / spacing))
        for t in np.linspace(t1, t2, n, endpoint=False):
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    out.append(P[-2])
    return np.array(out)


def track_traced(f, spc, anchors):
    pts = []
    for name, q in f["anchors"]:
        if q is None:
            pts.append((float(spc["slon"]), float(spc["slat"])) if name.startswith("start")
                       else (float(spc["elon"]), float(spc["elat"])))
        else:
            a = anchors[f["id"]][name]
            if a["lat"] is None:
                raise SystemExit(f"{f['id']}: no coordinates for anchor {name}")
            pts.append((a["lon"], a["lat"]))
    xy = catmull_rom(proj(pts))
    return [list(p) for p in unproj(xy)], {"anchors": [n for n, _ in f["anchors"]]}


# ------------------------------------------------------------ warnings

def load_iem(slug):
    z = zipfile.ZipFile(RAW / f"{slug}.iem.zip")
    d = RAW / f"{slug}.iem"
    d.mkdir(exist_ok=True)
    z.extractall(d)
    sh = shapefile.Reader(str(next(d.glob("*.shp"))))
    names = [x[0] for x in sh.fields[1:]]
    rows = []
    for sr in sh.shapeRecords():
        r = dict(zip(names, sr.record))
        if r.get("NWS_UGC"):          # county copies of the same warning; the polygon rows are the real shape
            continue
        try:
            g = shape(sr.shape.__geo_interface__)
        except Exception:  # noqa: BLE001
            continue
        r["geom"] = g if g.is_valid else g.buffer(0)
        r["iss"] = B.parse_iem(r["ISSUED"]).timestamp() * 1000
        r["init"] = B.parse_iem(r["INIT_ISS"]).timestamp() * 1000
        r["exp"] = B.parse_iem(r["EXPIRED"] or r["INIT_EXP"]).timestamp() * 1000
        rows.append(r)
    return rows


def match_warnings(rec, rows, start_ms, end_ms, start_zone):
    groups = collections.defaultdict(list)
    for r in rows:
        groups[(r["WFO"], r["ETN"], r["VTEC_YR"])].append(r)
    info = {k: {"first": min(x["init"] for x in g), "last": max(x["exp"] for x in g)} for k, g in groups.items()}
    line = shape({"type": "LineString", "coordinates": rec["path"]})
    cands = {}
    for k, g in groups.items():
        if not any(x["geom"].intersects(line) for x in g):
            continue
        inf = info[k]
        if inf["first"] <= end_ms + 5 * 60000 and inf["last"] >= start_ms - 5 * 60000:
            cands[k] = inf
    if not cands:
        return None, {}, groups
    # The lead time is about the place the tornado began, so only warnings that cover the first stretch of the
    # track count for it. A long track can cross many warnings, and one issued for a town 60 miles down the
    # path says nothing about how much notice the start of the tornado got. Fall back to any touching warning.
    near_start = {k: v for k, v in cands.items() if any(x["geom"].intersects(start_zone) for x in groups[k])}
    pool = near_start or cands
    active = [(v["first"], k) for k, v in pool.items() if v["first"] <= start_ms <= v["last"]]
    if active:
        first, k = min(active)
        basis = "active_at_start" if near_start else "touching_track"
    else:
        first, k = min((v["first"], k) for k, v in pool.items())
        basis = "touching_track"
    key = lambda kk: f"{kk[0]}-TO-W-{kk[1]:04d}-{kk[2]}"  # noqa: E731
    warn_out = {}
    for kk in cands:
        g = sorted(groups[kk], key=lambda x: x["iss"])
        new = next((x for x in g if x["STATUS"] == "NEW"), g[0])
        poly = new["geom"]
        if isinstance(poly, MultiPolygon):
            poly = max(poly.geoms, key=lambda p: p.area)
        warn_out[key(kk)] = {
            "wfo": kk[0], "etn": kk[1],
            "issued_utc": B.iso_utc(info[kk]["first"]), "last_expire_utc": B.iso_utc(info[kk]["last"]),
            "torn_tag": (new["TORNTAG"] or "").title() or None,
            "damage_tag": (new["DAMAGTAG"] or "").title() or None,
            "emergency": any(bool(x["EMERGENC"]) for x in g),
            "updates": [{"t": B.iem_iso(x["ISSUED"]), "status": x["STATUS"]} for x in g],
            "tornado_ids": [rec["id"]],
            "polygon": B.rnd(list(poly.simplify(0.0003).exterior.coords), 4),
        }
    lead = (start_ms - first) / 60000
    primary = {"key": key(k), "lead_min": round(lead, 1), "basis": basis, "lead_reliable": True,
               "tornadoes_in_warning": 1, "warnings_on_path": len(cands)}
    return primary, warn_out, groups


# ---------------------------------------------------------------- build

def main():
    anchors = json.loads((ROOT / "data" / "ref" / "famous-anchors.json").read_text())
    B.ensure_places_csv()
    places = B.load_places()
    recs, outline_feats, warn_all, report = [], [], {}, {}
    (OUT / "swaths").mkdir(exist_ok=True)

    for f in FAMOUS:
        slug = f["id"]
        spc = json.loads((RAW / f"{slug}.spc.json").read_text())
        s_utc, e_utc = cdt_to_utc(f["start_cdt"]), cdt_to_utc(f["end_cdt"])
        s_ms, e_ms = int(s_utc.timestamp() * 1000), int(e_utc.timestamp() * 1000)
        qa = {}

        # --- SPC sanity: its start time is CST all year
        spc_start = dt.datetime.strptime(f"{spc['date']} {spc['time']}", "%Y-%m-%d %H:%M:%S").replace(
            tzinfo=dt.timezone(dt.timedelta(hours=-6)))
        qa["spc_start_minus_ours_min"] = round((spc_start - s_utc).total_seconds() / 60, 1)

        # --- track
        pairs = []
        for n, ft in pick_polys(f):
            g = shp_transform(B.TO_5070, shape(ft["geometry"]))
            pairs.append((n, g if g.is_valid else g.buffer(0)))
        if f["track"] == "line":
            path, extra = track_from_line(f, spc)
        elif f["track"] == "traced":
            path, extra = track_traced(f, spc, anchors)
        else:
            if not pairs:
                raise SystemExit(f"{slug}: no outline polygons selected")
            union = unary_union([g for _, g in pairs])
            s_xy = B.TO_5070(float(spc["slon"]), float(spc["slat"]))
            cl = centerline(union, s_xy)
            path = [list(p) for p in unproj(cl)]
            extra = {"polygons": len(pairs)}
        # orient from the SPC start towards the SPC end
        ds = Point(path[0]).distance(Point(float(spc["slon"]), float(spc["slat"])))
        de = Point(path[-1]).distance(Point(float(spc["slon"]), float(spc["slat"])))
        if de < ds:
            path = path[::-1]
        pl = shp_transform(B.TO_5070, LineString(path))
        pl = pl.simplify(25 if f["track"] != "line" else 8)
        path = [[round(x, 5), round(y, 5)] for x, y in unproj(list(pl.coords))]
        drawn_mi = pl.length / MI
        spc_len = float(spc["len"])
        shown_len = f.get("length_override", spc_len)
        qa["drawn_mi"] = round(drawn_mi, 2)
        qa["spc_len_mi"] = spc_len
        qa["start_offset_from_spc_km"] = round(shp_transform(B.TO_5070, Point(path[0])).distance(
            shp_transform(B.TO_5070, Point(float(spc["slon"]), float(spc["slat"])))) / 1000, 2)
        qa["end_offset_from_spc_km"] = round(shp_transform(B.TO_5070, Point(path[-1])).distance(
            shp_transform(B.TO_5070, Point(float(spc["elon"]), float(spc["elat"])))) / 1000, 2)

        dur = (e_ms - s_ms) / 60000
        speed = round(drawn_mi / (dur / 60), 1)
        qa["speed_mph"] = speed

        mid = path[len(path) // 2]
        pname, pst, pdist, pdir = B.nearest_place(mid[1], mid[0], places)
        loc = s_utc.astimezone(ZoneInfo(f["tz"]))
        scale = f["scale"]
        rating = f"{scale}{f['efnum']}"
        caveats = list(f["caveats"])
        if "length_override" not in f and abs(drawn_mi - spc_len) / spc_len > 0.08:
            caveats.append(f"The path drawn here measures {drawn_mi:.1f} miles. The SPC database lists {spc_len:g} miles.")
        track_text = {
            "line": "NWS damage survey line (NWS Damage Assessment Toolkit)",
            "outline": "Centerline derived from the NWS damage outline (NWS Damage Assessment Toolkit)",
            "traced": "Hand-traced through landmarks the NWS names along the path. Approximate.",
        }[f["track"]]
        winds = {"famous-joplin-2011": "above 200 mph", "famous-tuscaloosa-2011": "190 mph (estimate)",
                 "famous-moore-2013": "200 to 210 mph (estimate)", "famous-greensburg-2007": "205 mph (estimate)",
                 "famous-greenfield-2024": "175 to 185 mph (estimate)"}.get(slug)
        notes = None
        if "dat_line" in extra:
            notes = B.clean_notes(extra["dat_line"].get("comments"))
        rec = {
            "id": slug, "famous": True, "year": f["spc"]["yr"],
            "name": f["label"], "label": f["label"],
            "state": f["state"],
            "near": {"place": pname, "state": pst, "dist_mi": round(pdist, 1), "dir": pdir},
            "wfo": f["wfos"][0], "wfos": f["wfos"],
            "ef": f"EF{f['efnum']}", "efnum": f["efnum"], "rating": rating, "scale": scale,
            "start_utc": iso(s_utc), "end_utc": iso(e_utc),
            "start_local": loc.strftime("%Y-%m-%dT%H:%M:%S%z"), "local_date": loc.strftime("%Y-%m-%d"), "tz": f["tz"],
            "duration_min": round(dur, 1), "speed_mph": speed,
            "length_mi": round(shown_len, 2), "drawn_mi": round(drawn_mi, 2),
            "width_yd": int(float(spc["wid"])) or None,
            "max_wind_mph": None, "max_wind_text": winds,
            "injuries": int(spc["inj"]), "deaths": int(spc["fat"]),
            "notes": notes, "story": f["story"], "caveats": caveats,
            "playable": True, "timing_issue": None,
            "track_kind": f["track"], "track_text": track_text, "time_sources": f["time_sources"],
            "start": path[0], "end": path[-1], "path": path,
            "has_outline": False, "outline_kind": "none", "outline_coverage": 0.0,
            "warning": None,
        }

        # --- outline + swath
        if pairs:
            ztypes = {n for n, _ in pairs}
            outline_kind = "zoned" if len(ztypes) > 1 else "envelope"
            for n, g in pairs:
                simp = g.simplify(4, preserve_topology=True)
                gj = mapping(shp_transform(B.FROM_5070, simp))

                def rr(c):
                    return [round(c[0], 5), round(c[1], 5)] if isinstance(c[0], (int, float)) else [rr(x) for x in c]
                outline_feats.append({"type": "Feature",
                                      "properties": {"tid": slug, "ef": f"EF{n}", "zoned": outline_kind == "zoned"},
                                      "geometry": {"type": gj["type"], "coordinates": rr(gj["coordinates"])}})
            hint = (rec["width_yd"] or 0) * 0.9144
            prof = B.swath_profile(pl, pairs, hint)
            if prof:
                prof["id"] = slug
                prof["zoned"] = outline_kind == "zoned"
                (OUT / "swaths" / f"{slug}.json").write_text(json.dumps(prof, separators=(",", ":")))
                rec["has_outline"] = True
                rec["outline_kind"] = outline_kind
                u = unary_union([g for _, g in pairs]).buffer(40)
                rec["outline_coverage"] = round(min(1.0, pl.intersection(u).length / pl.length), 2)
                qa["max_swath_width_yd"] = round(max(
                    max(b - a for a, b in zip(prof["a"][0], prof["b"][0])), 0) / 0.9144)
        qa["outline_kind"] = rec["outline_kind"]

        # --- warnings
        try:
            rows = load_iem(slug)
        except Exception as e:  # noqa: BLE001
            rows = []
            print("  no warnings for", slug, e)
        zone_len = max(8000.0, 0.08 * pl.length)
        zone = shp_transform(B.FROM_5070, substring(pl, 0, min(zone_len, pl.length)))
        primary, wout, _ = match_warnings(rec, rows, s_ms, e_ms, zone) if rows else (None, {}, None)
        rec["warning"] = primary
        warn_all.update(wout)
        if primary:
            qa["warning"] = {"lead_min": primary["lead_min"], "basis": primary["basis"], "n_on_path": primary["warnings_on_path"],
                             "first": primary["key"]}
        recs.append(rec)
        report[slug] = qa

    recs.sort(key=lambda r: (r["year"], r["start_utc"]))
    meta = {
        "generated_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sources": {
            "headline_numbers": "NOAA Storm Prediction Center tornado database, 1950-2024 (spc.noaa.gov/wcm)",
            "tracks_and_outlines": "NWS Damage Assessment Toolkit (services.dat.noaa.gov), where it holds the event",
            "landmarks_for_traced_paths": "OpenStreetMap Nominatim, geocoded once and stored in data/ref/famous-anchors.json",
            "start_and_end_times": "NWS surveys, as summarised on Wikipedia and NWS event pages; see each record",
            "warnings": "Iowa Environmental Mesonet NWS warning archive (mesonet.agron.iastate.edu)",
        },
    }
    (OUT / "famous.json").write_text(json.dumps({"meta": meta, "tornadoes": recs}, separators=(",", ":")))
    (OUT / "outlines-famous.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": outline_feats}, separators=(",", ":")))
    (OUT / "warnings-famous.json").write_text(json.dumps(warn_all, separators=(",", ":")))
    (OUT / "famous-report.json").write_text(json.dumps(report, indent=1))
    for slug, q in report.items():
        print(slug, json.dumps(q))


if __name__ == "__main__":
    main()
