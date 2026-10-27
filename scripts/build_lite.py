#!/usr/bin/env python3
"""Build the single-file lite edition (lite/dist/twisterchaser-lite.html) for the Claude artifact.

An artifact cannot fetch files or load map tiles, so everything is embedded: a flat map drawn on a canvas,
compact tracks, state outlines and warning lead times. Run after build_data.py and build_famous.py.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "data"
OUT = ROOT / "lite" / "dist"


def thin(path, keep=60):
    if len(path) <= keep:
        pts = path
    else:
        step = (len(path) - 1) / (keep - 1)
        pts = [path[round(i * step)] for i in range(keep)]
    return [[round(x, 4), round(y, 4)] for x, y in pts]


def compact(t, wdata, famous=False):
    w = wdata.get(t["warning"]["key"]) if t.get("warning") else None
    rec = {
        "id": t["id"], "n": t["label"], "st": t.get("state"), "ef": t["efnum"],
        "s": t["start_utc"], "e": t["end_utc"], "tz": t["tz"], "dur": t["duration_min"],
        "ok": bool(t["playable"]), "why": t.get("timing_issue"),
        "mi": t["length_mi"], "wd": t.get("width_yd"), "de": t["deaths"], "inj": t["injuries"],
        "mph": t.get("max_wind_mph"), "p": thin(t["path"]),
    }
    near = t.get("near")
    if near and not famous:
        rec["nr"] = f'{near["dist_mi"]:.0f} mi {near["dir"]} of {near["place"]}, {near["state"]}'
    if w:
        rec["w"] = [w["wfo"], w["etn"], w["issued_utc"], t["warning"]["lead_min"], bool(t["warning"]["lead_reliable"])]
    if famous:
        rec.update({
            "fam": 1, "yr": t["year"], "rt": t["rating"], "kind": t["track_kind"], "ok_outline": t["outline_kind"],
            "story": t["story"], "cav": t["caveats"], "src": t["time_sources"],
            "wind": t.get("max_wind_text"), "drawn": t.get("drawn_mi"), "nw": (t.get("warning") or {}).get("warnings_on_path"),
        })
    else:
        notes = (t.get("notes") or "").strip()
        if notes:
            rec["note"] = notes[:420]
    return rec


def main():
    t26 = json.loads((D / "tornadoes-2026.json").read_text())
    w26 = json.loads((D / "warnings-2026.json").read_text())
    fam = json.loads((D / "famous.json").read_text())
    wf = json.loads((D / "warnings-famous.json").read_text())
    states = json.loads((D / "states.geojson").read_text())

    rings = []
    for f in states["features"]:
        polys = f["geometry"]["coordinates"] if f["geometry"]["type"] == "MultiPolygon" else [f["geometry"]["coordinates"]]
        for poly in polys:
            for ring in poly:
                if not (-128 < ring[0][0] < -64 and 23 < ring[0][1] < 50):
                    continue
                step = max(1, len(ring) // 220)
                rings.append([[round(x, 2), round(y, 2)] for x, y in ring[::step]])

    data = {
        "year": t26["meta"]["year"],
        "updated": t26["meta"]["source_fetched_utc"],
        "t": [compact(t, w26) for t in t26["tornadoes"]],
        "f": [compact(t, wf, True) for t in sorted(fam["tornadoes"], key=lambda x: x["start_utc"])],
        "states": rings,
    }
    blob = json.dumps(data, separators=(",", ":")).replace("</", "<\\/")
    html = (ROOT / "lite" / "template.html").read_text().replace("/*__DATA__*/null", blob)
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / "twisterchaser-lite.html"
    out.write_text(html)
    print(f"{out} {len(html) / 1e6:.2f} MB, {len(data['t'])} tornadoes, {len(data['f'])} famous")


if __name__ == "__main__":
    main()
