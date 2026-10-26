#!/usr/bin/env python3
"""Clean and join raw data into the files the Twister Chaser site uses.

Reads  data/raw/*            (from scripts/fetch_data.py)
Writes data/tornadoes-YEAR.json    one record per rated tornado (EF0-EF5)
       data/outlines-YEAR.geojson  true damage outlines, keyed to tornado id
       data/warnings-YEAR.json     the tornado warning matched to each tornado
       data/build-report.json      everything that was filtered or flagged
       docs/data-report.md         the same report in readable form

Decisions baked in (agreed with the project owner):
  * Only rated tornadoes EF0-EF5. EFU, TSTM/Wind and N/A are dropped.
  * Tracks with unreliable timing are kept on the map but get playable=false.
  * Property damage is NOT exposed: DAT gives no units and ~98% is missing.
  * Local time uses the tornado's own location (not the NWS office's zone).
"""
import argparse
import collections
import csv
import datetime as dt
import hashlib
import json
import math
import re
import statistics
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import shapefile  # pyshp
from pyproj import Geod, Transformer
from shapely import STRtree
from shapely.geometry import LineString, MultiPolygon, Point, mapping, shape
from shapely.ops import transform as shp_transform
from timezonefinder import TimezoneFinder

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data"
REF = ROOT / "data" / "ref"
DOCS = ROOT / "docs"

RATED = ("EF0", "EF1", "EF2", "EF3", "EF4", "EF5")
DAY_MS = 86_400_000
GEOD = Geod(ellps="WGS84")
TO_5070 = Transformer.from_crs(4326, 5070, always_xy=True).transform
FROM_5070 = Transformer.from_crs(5070, 4326, always_xy=True).transform

# ---------------------------------------------------------------- helpers


def iso_utc(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iem(s):
    """IEM shapefile times look like 202601081330 (UTC)."""
    return dt.datetime.strptime(s, "%Y%m%d%H%M").replace(tzinfo=dt.timezone.utc)


def iem_iso(s):
    return parse_iem(s).strftime("%Y-%m-%dT%H:%M:%SZ")


def rnd(coords, n=5):
    return [[round(x, n), round(y, n)] for x, y in coords]


def clean_notes(text):
    """NWS survey text is hard-wrapped at ~70 chars. Re-flow single newlines
    into spaces and keep blank lines as paragraph breaks."""
    if not text:
        return None
    t = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    paras = re.split(r"\n\s*\n", t)
    paras = [re.sub(r"\s*\n\s*", " ", p).strip() for p in paras]
    paras = [re.sub(r"[ \t]{2,}", " ", p) for p in paras if p]
    return "\n\n".join(paras) or None


JUNK_NAME = re.compile(r"^(\d+|.*\d{4}-\d{2}-\d{2}.*|[A-Za-z]*_?\d{6,})$")


def tidy_name(raw):
    n = re.sub(r"\s+", " ", (raw or "").strip())
    if not n or JUNK_NAME.match(n):
        return None
    return n


PLACE_SUFFIX = re.compile(
    r"\s+(city|town|village|CDP|borough|municipality|"
    r"city and borough|comunidad|zona urbana|urbana|"
    r"\(balance\)|consolidated government.*|metropolitan government.*|"
    r"unified government.*)$", re.I)


def clean_place(n):
    n = re.sub(r"\s*\(balance\)$", "", n)
    prev = None
    while prev != n:
        prev, n = n, PLACE_SUFFIX.sub("", n)
    return n.strip()


COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
           "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


def compass(deg):
    return COMPASS[int((deg % 360) / 22.5 + 0.5) % 16]


# ------------------------------------------------------------- reference


def load_states():
    r = shapefile.Reader(str(REF / "states" / "cb_2023_us_state_20m.shp"))
    fields = [f[0] for f in r.fields[1:]]
    geoms, codes = [], []
    for sr in r.shapeRecords():
        rec = dict(zip(fields, sr.record))
        geoms.append(shape(sr.shape.__geo_interface__))
        codes.append(rec["STUSPS"])
    return STRtree(geoms), geoms, codes


def state_of(pt, tree, geoms, codes):
    idx = tree.query(pt, predicate="intersects")
    if len(idx):
        return codes[int(idx[0])]
    i = int(tree.nearest(pt))
    # nearest state if the point is within ~25 km (coastline generalisation)
    if geoms[i].distance(pt) < 0.25:
        return codes[i]
    return None


def load_places():
    rows = []
    with open(REF / "places.csv", newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            rows.append((r["name"], r["state"], float(r["lat"]), float(r["lon"])))
    names = [r[0] for r in rows]
    st = [r[1] for r in rows]
    lat = np.radians(np.array([r[2] for r in rows]))
    lon = np.radians(np.array([r[3] for r in rows]))
    return names, st, lat, lon


def nearest_place(lat, lon, places):
    names, st, plat, plon = places
    la, lo = np.radians(lat), np.radians(lon)
    dlat, dlon = plat - la, plon - lo
    a = np.sin(dlat / 2) ** 2 + np.cos(la) * np.cos(plat) * np.sin(dlon / 2) ** 2
    d = 2 * 3958.8 * np.arcsin(np.sqrt(a))  # miles
    i = int(np.argmin(d))
    # bearing FROM the place TO the tornado
    y = np.sin(lo - plon[i]) * np.cos(la)
    x = np.cos(plat[i]) * np.sin(la) - np.sin(plat[i]) * np.cos(la) * np.cos(lo - plon[i])
    brg = (np.degrees(np.arctan2(y, x)) + 360) % 360
    return names[i], st[i], float(d[i]), compass(brg)


def ensure_places_csv():
    """Build data/ref/places.csv from the Census Gazetteer if not present."""
    out = REF / "places.csv"
    if out.exists():
        return
    src = next(REF.glob("*Gaz_place_national.txt"), None)
    if src is None:
        sys.exit("Missing data/ref/*Gaz_place_national.txt (Census Gazetteer).")
    n = 0
    with open(src, encoding="utf-8", errors="replace") as f, \
            open(out, "w", newline="", encoding="utf-8") as g:
        w = csv.writer(g)
        w.writerow(["name", "state", "lat", "lon"])
        rd = csv.reader(f, delimiter="\t")
        hdr = [h.strip() for h in next(rd)]
        ix = {h: i for i, h in enumerate(hdr)}
        for r in rd:
            if len(r) < len(hdr):
                continue
            name = clean_place(r[ix["NAME"]].strip())
            try:
                w.writerow([name, r[ix["USPS"]].strip(),
                            float(r[ix["INTPTLAT"]]), float(r[ix["INTPTLONG"]])])
            except ValueError:
                continue
            n += 1
    print(f"  wrote places.csv ({n} places)")



def swath_profile(line, pairs, width_m_hint):
    """Resample a track's real damage outline into cross-track slices.

    The outline is a set of polygons (one per EF zone). To let the swath grow
    behind the tornado we cut the track every ~15-120 m with a line at right
    angles and measure, for each EF level k, how far the area rated >= k
    extends to the left (+) and right (-) of the track. Because zones are
    nested, level k+1 always sits inside level k.

    Returns arrays ready for the browser, or None if nothing usable.
    """
    L = line.length
    if L < 30 or not pairs:
        return None
    n = max(2, int(math.ceil(L / min(120.0, max(15.0, L / 500.0)))))
    s_arr = np.linspace(0.0, L, n + 1)
    centers = [line.interpolate(float(s)) for s in s_arr]
    cx = np.array([c.x for c in centers])
    cy = np.array([c.y for c in centers])
    H = min(5000.0, max(1500.0, 3.0 * width_m_hint))
    polys = [pg for _, pg in pairs]
    efs = [ef for ef, _ in pairs]
    tree = STRtree(polys)
    lo_ef, hi_ef = min(efs), max(efs)
    levels = list(range(lo_ef, hi_ef + 1))
    A = np.full((len(levels), n + 1), np.nan)
    B = np.full((len(levels), n + 1), np.nan)
    for i in range(n + 1):
        i0, i1 = max(0, i - 1), min(n, i + 1)
        tx, ty = cx[i1] - cx[i0], cy[i1] - cy[i0]
        nrm = math.hypot(tx, ty)
        if nrm == 0:
            continue
        nx, ny = -ty / nrm, tx / nrm          # unit normal pointing LEFT of travel
        sec = LineString([(cx[i] - nx * H, cy[i] - ny * H), (cx[i] + nx * H, cy[i] + ny * H)])
        segs = []
        for j in tree.query(sec, predicate="intersects"):
            inter = sec.intersection(polys[int(j)])
            parts = getattr(inter, "geoms", [inter])
            for part in parts:
                if part.geom_type != "LineString" or part.length < 0.5:
                    continue
                u = sorted(sec.project(Point(c)) - H for c in (part.coords[0], part.coords[-1]))
                segs.append((u[0], u[1], efs[int(j)]))
        if not segs:
            continue
        segs.sort()
        merged = [[segs[0][0], segs[0][1]]]
        for lo, hi, _ in segs[1:]:
            if lo <= merged[-1][1] + 5:
                merged[-1][1] = max(merged[-1][1], hi)
            else:
                merged.append([lo, hi])
        main = next((m for m in merged if m[0] <= 0 <= m[1]), None)
        if main is None:
            near = min(merged, key=lambda m: min(abs(m[0]), abs(m[1])))
            main = near if min(abs(near[0]), abs(near[1])) <= 400 else None
        if main is None:
            continue
        for k, lev in enumerate(levels):
            ins = [(max(lo, main[0]), min(hi, main[1])) for lo, hi, ef in segs
                   if ef >= lev and hi > main[0] and lo < main[1]]
            if ins:
                A[k, i] = min(a for a, _ in ins)
                B[k, i] = max(b for _, b in ins)
    if np.all(np.isnan(A)):
        return None

    def smooth(v, w=2):
        out = v.copy()
        for i in range(len(v)):
            win = v[max(0, i - w): i + w + 1]
            win = win[~np.isnan(win)]
            if len(win) and not np.isnan(v[i]):
                out[i] = np.median(win)
        return out

    for k in range(len(levels)):
        A[k], B[k] = smooth(A[k]), smooth(B[k])
    # nesting guarantee: a higher level never pokes outside the level below it
    for k in range(1, len(levels)):
        A[k] = np.where(np.isnan(A[k]), np.nan, np.maximum(A[k], np.where(np.isnan(A[k - 1]), A[k], A[k - 1])))
        B[k] = np.where(np.isnan(B[k]), np.nan, np.minimum(B[k], np.where(np.isnan(B[k - 1]), B[k], B[k - 1])))
    A0 = np.nan_to_num(A, nan=0.0)
    B0 = np.nan_to_num(B, nan=0.0)
    ll = [FROM_5070(float(x), float(y)) for x, y in zip(cx, cy)]
    return {
        "levels": levels,
        "length_m": round(L, 1),
        "s": [round(float(v), 1) for v in s_arr],
        "c": [[round(a, 5), round(b, 5)] for a, b in ll],
        "a": [[int(round(v)) for v in row] for row in A0],
        "b": [[int(round(v)) for v in row] for row in B0],
        "note": "Offsets in metres, positive to the left of travel. a<b is the extent of "
                "area rated at or above each level; a==b means that level is absent.",
    }


# --------------------------------------------------------------- the build


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=None)
    a = ap.parse_args()

    meta = json.loads((RAW / "fetch-meta.json").read_text())
    year = a.year or meta["year"]
    rep = {"year": year, "fetched_utc": meta["fetched_utc"], "filters": {}, "flags": {}}

    lines = json.loads((RAW / "lines.geojson").read_text())["features"]
    polys = json.loads((RAW / "polys.geojson").read_text())["features"]
    rep["dat_line_records"] = len(lines)
    rep["dat_polygon_records"] = len(polys)

    # ---- 1. keep only rated tornadoes ---------------------------------
    by_ef = collections.Counter(f["properties"]["efscale"] for f in lines)
    rep["efscale_counts_raw"] = dict(by_ef.most_common())
    kept, dropped = [], collections.Counter()
    for f in lines:
        ef = f["properties"]["efscale"]
        if ef in RATED and f.get("geometry"):
            kept.append(f)
        elif ef == "EFU":
            dropped["EFU (unrated, removed by decision)"] += 1
        elif ef == "TSTM/Wind":
            dropped["TSTM/Wind (not a tornado)"] += 1
        else:
            dropped[f"{ef} (no usable rating or geometry)"] += 1
    rep["filters"]["dropped_not_rated"] = dict(dropped)

    # ---- 2. exact duplicates -----------------------------------------
    seen, uniq, dups = {}, [], []
    for f in kept:
        p = f["properties"]
        g = json.dumps(f["geometry"]["coordinates"])
        key = (p["wfo"], p["event_id"], p["starttime"], p["endtime"], p["efscale"],
               p["length"], p["width"], hashlib.md5(g.encode()).hexdigest())
        if key in seen:
            dups.append((p["wfo"], p["event_id"], iso_utc(p["starttime"]), p["efscale"]))
            continue
        seen[key] = 1
        uniq.append(f)
    rep["filters"]["exact_duplicates_removed"] = len(dups)
    rep["filters"]["exact_duplicates_detail"] = collections.Counter(
        f"{w} {iso} {ef}" for w, e, iso, ef in dups).most_common()
    kept = uniq

    # ---- reference lookups --------------------------------------------
    ensure_places_csv()
    s_tree, s_geoms, s_codes = load_states()
    places = load_places()
    tzf = TimezoneFinder()

    # ---- 3. build tornado records ------------------------------------
    recs = []
    for f in kept:
        p = f["properties"]
        coords = f["geometry"]["coordinates"]
        if f["geometry"]["type"] == "MultiLineString":
            coords = [c for part in f["geometry"]["coordinates"] for c in part]
        coords = [c[:2] for c in coords]
        start_ms, end_ms = p["starttime"], p["endtime"]
        dur_min = (end_ms - start_ms) / 60000
        length = p["length"]
        # --- timing reliability (decision: unreliable -> playback disabled)
        reason = None
        if dur_min < 0:
            reason = "end time is before start time"
        elif dur_min == 0:
            reason = "start and end time are identical"
        elif dur_min > 180:
            reason = "duration over 3 hours"
        else:
            mph = length / (dur_min / 60)
            if length >= 0.5 and mph < 5:
                reason = "implied speed under 5 mph"
            elif length >= 0.5 and mph > 120:
                reason = "implied speed over 120 mph"
            elif length < 0.5 and dur_min > 30:
                reason = "duration implausible for track length"
        speed = round(length / (dur_min / 60), 1) if dur_min > 0 else None

        mid = coords[len(coords) // 2]
        start_pt = Point(coords[0])
        st = state_of(start_pt, s_tree, s_geoms, s_codes)
        pname, pst, pdist, pdir = nearest_place(mid[1], mid[0], places)
        tzname = tzf.timezone_at(lng=coords[0][0], lat=coords[0][1]) or "UTC"
        loc = dt.datetime.fromtimestamp(start_ms / 1000, ZoneInfo(tzname))
        tid = p["globalid"].strip("{}").lower()
        name = tidy_name(p["event_id"])
        label = name or f"Near {pname}, {pst}"

        wy = p["width"] if p["width"] and p["width"] > 0 else None
        wind = p["maxwind"] if p["maxwind"] and p["maxwind"] > 0 else None
        efnum = int(p["efscale"][2])
        recs.append({
            "id": tid,
            "name": name,
            "label": label,
            "state": st,
            "near": {"place": pname, "state": pst,
                     "dist_mi": round(pdist, 1), "dir": pdir},
            "wfo": (p["wfo"] or "").split(",")[0] or None,
            "wfos": [w for w in (p["wfo"] or "").split(",") if w],
            "ef": p["efscale"],
            "efnum": efnum,
            "start_utc": iso_utc(start_ms),
            "end_utc": iso_utc(end_ms),
            "start_local": loc.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "local_date": loc.strftime("%Y-%m-%d"),
            "tz": tzname,
            "duration_min": round(dur_min, 1),
            "speed_mph": speed,
            "length_mi": round(length, 2),
            "width_yd": wy,
            "max_wind_mph": wind,
            "injuries": int(p["injuries"] or 0),
            "deaths": int(p["fatalities"] or 0),
            "notes": clean_notes(p["comments"]),
            "playable": reason is None,
            "timing_issue": reason,
            "start": [round(coords[0][0], 5), round(coords[0][1], 5)],
            "end": [round(coords[-1][0], 5), round(coords[-1][1], 5)],
            "path": rnd(coords),
            "has_outline": False,
            "outline_coverage": 0.0,
            "warning": None,
            "_start_ms": start_ms, "_end_ms": end_ms,
            "_name_raw": (p["event_id"] or "").strip(),
        })
    recs.sort(key=lambda r: r["start_utc"])

    # ---- 4. field-quality flags for the report -----------------------
    rep["flags"] = {
        "tornadoes_kept": len(recs),
        "width_missing_or_zero": sum(1 for r in recs if r["width_yd"] is None),
        "max_wind_missing_or_zero": sum(1 for r in recs if r["max_wind_mph"] is None),
        "name_missing_or_junk": sum(1 for r in recs if r["name"] is None),
        "single_segment_straight_line": sum(1 for r in recs if len(r["path"]) <= 2),
        "state_unresolved": sum(1 for r in recs if r["state"] is None),
        "playback_disabled_timing": sum(1 for r in recs if not r["playable"]),
        "playback_disabled_reasons": dict(collections.Counter(
            r["timing_issue"] for r in recs if r["timing_issue"])),
        "property_damage": "withheld: no documented units, ~98% missing/zero",
    }

    # ---- 5. damage outlines: spatial + date join ---------------------
    # DAT's documented key (path_guid) is empty on most polygons, so join on
    # geometry and date instead.
    proj_lines = [shp_transform(TO_5070, shape({"type": "LineString", "coordinates": r["path"]}))
                  for r in recs]
    l_tree = STRtree(proj_lines)
    outline_feats = []
    assigned = collections.defaultdict(list)  # rec idx -> projected polygons
    n_poly_rated = n_matched = n_ambig = 0
    unmatched = collections.Counter()
    for pf in polys:
        pp = pf["properties"]
        if pp["efscale"] not in RATED or not pf.get("geometry"):
            continue
        n_poly_rated += 1
        pg = shp_transform(TO_5070, shape(pf["geometry"]))
        if not pg.is_valid:
            pg = pg.buffer(0)
        cands = []
        for i in l_tree.query(pg.buffer(2000)):
            r = recs[int(i)]
            if abs(r["_start_ms"] - pp["stormdate"]) > 2 * DAY_MS:
                continue
            d = pg.distance(proj_lines[int(i)])
            if d > 2000:
                continue
            ov = proj_lines[int(i)].intersection(pg).length
            nm = 1 if (pp["event_id"] and pp["event_id"].strip() == r["_name_raw"]) else 0
            cands.append((ov, nm, -d, int(i)))
        if not cands:
            unmatched[pp["efscale"]] += 1
            continue
        if len(cands) > 1:
            n_ambig += 1
        cands.sort(reverse=True)
        i = cands[0][3]
        n_matched += 1
        assigned[i].append((int(pp["efscale"][2]), pg))
        simp = pg.simplify(3, preserve_topology=True)
        gj = mapping(shp_transform(FROM_5070, simp))
        # round coordinates
        def rr(c):
            if isinstance(c[0], (int, float)):
                return [round(c[0], 5), round(c[1], 5)]
            return [rr(x) for x in c]
        gj = {"type": gj["type"], "coordinates": rr(gj["coordinates"])}
        outline_feats.append({"type": "Feature",
                              "properties": {"tid": recs[i]["id"], "ef": pp["efscale"]},
                              "geometry": gj})
    swath_dir = OUT / "swaths"
    swath_dir.mkdir(exist_ok=True)
    for old in swath_dir.glob("*.json"):
        old.unlink()
    for i, pairs in assigned.items():
        from shapely.ops import unary_union
        pgs = [pg for _, pg in pairs]
        u = unary_union(pgs).buffer(40)
        L = proj_lines[i]
        recs[i]["has_outline"] = True
        recs[i]["outline_coverage"] = round(min(1.0, L.intersection(u).length / L.length), 2) if L.length else 0.0
        prof = swath_profile(L, pairs, (recs[i]["width_yd"] or 0) * 0.9144)
        if prof:
            prof["id"] = recs[i]["id"]
            (swath_dir / f"{recs[i]['id']}.json").write_text(json.dumps(prof, separators=(",", ":")))
    rep["outlines"] = {
        "tornado_rated_polygons": n_poly_rated,
        "matched_to_a_track": n_matched,
        "unmatched": dict(unmatched),
        "ambiguous_polygons_resolved_by_overlap": n_ambig,
        "tracks_with_outline": len(assigned),
        "tracks_total": len(recs),
        "share_with_outline": round(len(assigned) / len(recs), 3),
        "tracks_with_outline_coverage_ge_0.8": sum(1 for r in recs if r["outline_coverage"] >= 0.8),
    }

    # ---- 6. warnings: match each tornado to a TO.W -------------------
    sh = shapefile.Reader(str(next((RAW / "iem").glob("*.shp"))))
    wf = [x[0] for x in sh.fields[1:]]
    rows = []
    for sr in sh.shapeRecords():
        d = dict(zip(wf, sr.record))
        try:
            d["geom"] = shape(sr.shape.__geo_interface__)
        except Exception:  # noqa: BLE001
            continue
        if not d["geom"].is_valid:
            d["geom"] = d["geom"].buffer(0)
        d["iss"] = parse_iem(d["ISSUED"]).timestamp() * 1000
        d["init"] = parse_iem(d["INIT_ISS"]).timestamp() * 1000
        d["exp"] = parse_iem(d["EXPIRED"] or d["INIT_EXP"]).timestamp() * 1000
        rows.append(d)
    groups = collections.defaultdict(list)
    for d in rows:
        groups[(d["WFO"], d["ETN"], d["VTEC_YR"])].append(d)
    info = {}
    for k, g in groups.items():
        info[k] = {"first": min(x["init"] for x in g), "last": max(x["exp"] for x in g)}
    w_tree = STRtree([d["geom"] for d in rows])
    rep["warnings"] = {"tornado_warnings_in_archive": len(groups)}

    matched_keys = collections.defaultdict(list)
    for r in recs:
        s, e = sorted((r["_start_ms"], r["_end_ms"]))
        line = shape({"type": "LineString", "coordinates": r["path"]})
        cands = {}
        for i in w_tree.query(line, predicate="intersects"):
            d = rows[int(i)]
            k = (d["WFO"], d["ETN"], d["VTEC_YR"])
            inf = info[k]
            if inf["first"] <= e + 5 * 60000 and inf["last"] >= s - 5 * 60000:
                cands[k] = inf
        if not cands:
            continue
        active = [(v["first"], k) for k, v in cands.items() if v["first"] <= r["_start_ms"] <= v["last"]]
        if active:
            first, k = min(active)
            basis = "active_at_start"
        else:
            first, k = min((v["first"], k) for k, v in cands.items())
            basis = "touching_track"
        lead = (r["_start_ms"] - first) / 60000
        r["warning"] = {"key": f"{k[0]}-TO-W-{k[1]:04d}-{k[2]}", "lead_min": round(lead, 1),
                        "basis": basis, "lead_reliable": r["playable"]}
        matched_keys[k].append(r["id"])

    warn_out = {}
    for k, tids in matched_keys.items():
        g = sorted(groups[k], key=lambda x: x["iss"])
        new = next((x for x in g if x["STATUS"] == "NEW"), g[0])
        poly = new["geom"]
        if isinstance(poly, MultiPolygon):
            poly = max(poly.geoms, key=lambda p: p.area)
        ring = rnd(list(poly.simplify(0.0003).exterior.coords), 4)
        key = f"{k[0]}-TO-W-{k[1]:04d}-{k[2]}"
        warn_out[key] = {
            "wfo": k[0], "etn": k[1],
            "issued_utc": iso_utc(info[k]["first"]),
            "last_expire_utc": iso_utc(info[k]["last"]),
            "torn_tag": (new["TORNTAG"] or "").title() or None,
            "damage_tag": (new["DAMAGTAG"] or "").title() or None,
            "emergency": any(bool(x["EMERGENC"]) for x in g),
            "updates": [{"t": iem_iso(x["ISSUED"]), "status": x["STATUS"]} for x in g],
            "tornado_ids": tids,
            "polygon": ring,
        }
    for r in recs:
        if r["warning"]:
            r["warning"]["tornadoes_in_warning"] = len(warn_out[r["warning"]["key"]]["tornado_ids"])
    leads = [r["warning"]["lead_min"] for r in recs if r["warning"]]
    pos = [x for x in leads if x >= 0]
    neg = [x for x in leads if x < 0]
    rep["warnings"].update({
        "tornadoes_with_warning": len(leads),
        "tornadoes_without_warning": len(recs) - len(leads),
        "warned_after_tornado_began": len(neg),
        "median_lead_min_when_warned_first": round(statistics.median(pos), 1) if pos else None,
        "max_lead_min": max(pos) if pos else None,
        "median_negative_lead_min": round(statistics.median(neg), 1) if neg else None,
        "warnings_covering_multiple_tornadoes": sum(1 for v in warn_out.values() if len(v["tornado_ids"]) > 1),
        "most_tornadoes_in_one_warning": max((len(v["tornado_ids"]) for v in warn_out.values()), default=0),
    })

    # ---- 7. write outputs --------------------------------------------
    for r in recs:
        for k in [k for k in r if k.startswith("_")]:
            del r[k]
    ef_counts = collections.Counter(r["ef"] for r in recs)
    rep["final"] = {
        "tornadoes": len(recs), "by_ef": dict(sorted(ef_counts.items())),
        "deaths": sum(r["deaths"] for r in recs),
        "injuries": sum(r["injuries"] for r in recs),
        "playable": sum(1 for r in recs if r["playable"]),
        "date_range_local": [min(r["local_date"] for r in recs), max(r["local_date"] for r in recs)],
    }
    generated = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    meta_out = {
        "year": year, "generated_utc": generated, "source_fetched_utc": meta["fetched_utc"],
        "sources": {
            "tracks_and_outlines": "NWS Damage Assessment Toolkit (services.dat.noaa.gov)",
            "warnings": "Iowa Environmental Mesonet NWS warning archive (mesonet.agron.iastate.edu)",
            "states_and_places": "US Census Bureau cartographic boundaries and Gazetteer (2023)",
            "timezones": "timezonefinder / timezone-boundary-builder (ODbL)",
        },
        "units": {"length": "miles", "width": "yards", "wind": "mph", "speed": "mph"},
    }
    (OUT / f"tornadoes-{year}.json").write_text(json.dumps(
        {"meta": meta_out, "tornadoes": recs}, separators=(",", ":")))
    (OUT / f"outlines-{year}.geojson").write_text(json.dumps(
        {"type": "FeatureCollection", "features": outline_feats}, separators=(",", ":")))
    (OUT / f"warnings-{year}.json").write_text(json.dumps(warn_out, separators=(",", ":")))
    (OUT / "build-report.json").write_text(json.dumps(rep, indent=2, default=list))
    write_markdown(rep, recs)
    print(json.dumps(rep["final"], indent=2))


def write_markdown(rep, recs):
    DOCS.mkdir(exist_ok=True)
    f, fl, o, w = rep["final"], rep["flags"], rep["outlines"], rep["warnings"]
    L = [f"# Data cleaning report, {rep['year']}", "",
         f"Source data fetched {rep['fetched_utc']}.", "",
         "## What went in and what came out", "",
         f"- DAT track records pulled: **{rep['dat_line_records']}**",
         f"- Rated tornadoes kept: **{f['tornadoes']}** "
         + ", ".join(f"{k} {v}" for k, v in f["by_ef"].items()),
         f"- Deaths in kept records: {f['deaths']}, injuries: {f['injuries']}", ""]
    L += ["## Removed", ""]
    for k, v in rep["filters"]["dropped_not_rated"].items():
        L.append(f"- {v} x {k}")
    L.append(f"- {rep['filters']['exact_duplicates_removed']} x exact duplicate record")
    L += ["", "## Flagged but kept", "",
          f"- Width missing or zero: {fl['width_missing_or_zero']} (shown as not recorded)",
          f"- Peak wind missing or zero: {fl['max_wind_missing_or_zero']}",
          f"- No usable name (label generated from nearest town): {fl['name_missing_or_junk']}",
          f"- Straight 2-point tracks: {fl['single_segment_straight_line']}",
          f"- Property damage: {fl['property_damage']}",
          f"- **Playback disabled for unreliable timing: {fl['playback_disabled_timing']}**"]
    for k, v in fl["playback_disabled_reasons"].items():
        L.append(f"  - {v}: {k}")
    L += ["", "## Damage outlines", "",
          f"- Tornado-rated outline polygons: {o['tornado_rated_polygons']}, "
          f"matched to a track: {o['matched_to_a_track']}",
          f"- Tracks with a real outline: **{o['tracks_with_outline']} of {o['tracks_total']}** "
          f"({o['share_with_outline']:.0%}); {o['tracks_with_outline_coverage_ge_0.8']} cover at least 80% of the track",
          f"- Ambiguous polygons resolved by overlap: {o['ambiguous_polygons_resolved_by_overlap']}",
          "- Joined by geometry and date because DAT's `path_guid` key is mostly empty.",
          "", "## Warnings", "",
          f"- Tornado warnings in the archive: {w['tornado_warnings_in_archive']}",
          f"- Tornadoes matched to a warning: **{w['tornadoes_with_warning']}**; none: {w['tornadoes_without_warning']}",
          f"- Warned after the tornado began (negative lead): {w['warned_after_tornado_began']}",
          f"- Median lead when warned first: {w['median_lead_min_when_warned_first']} min "
          f"(max {w['max_lead_min']})",
          f"- Warnings covering more than one tornado: {w['warnings_covering_multiple_tornadoes']} "
          f"(most: {w['most_tornadoes_in_one_warning']})", ""]
    (DOCS / "data-report.md").write_text("\n".join(L))


if __name__ == "__main__":
    main()
