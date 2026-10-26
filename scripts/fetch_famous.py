#!/usr/bin/env python3
"""Fetch the raw data for the ten famous tornadoes into data/raw/famous/.

  * SPC tornado database CSV (all US tornadoes 1950-2024)
  * NWS Damage Assessment Toolkit lines and polygons around each track
  * IEM tornado warnings (TO.W) for the hours around each tornado
  * OpenStreetMap Nominatim lookups for the landmarks used to hand-trace
    three tornadoes (written to data/ref/famous-anchors.json, which IS committed
    so the trace can be rebuilt without asking Nominatim again)

Usage: python3 scripts/fetch_famous.py
"""
import csv
import datetime as dt
import io
import json
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from famous_config import FAMOUS  # noqa: E402
from fetch_data import DAT, IEM, http_get  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "famous"
REF = ROOT / "data" / "ref"
SPC_URL = "https://www.spc.noaa.gov/wcm/data/1950-2024_actual_tornadoes.csv"
NOMINATIM = "https://nominatim.openstreetmap.org/search"
CDT = dt.timezone(dt.timedelta(hours=-5))


def cdt_to_utc(s):
    return dt.datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=CDT).astimezone(dt.timezone.utc)


def spc_row(rows, yr, om):
    for r in rows:
        if r["yr"] == str(yr) and r["om"] == str(om):
            return r
    raise SystemExit(f"SPC row not found: {yr} {om}")


def dat_query(layer, d0, d1, bbox):
    q = {
        "where": f"stormdate >= timestamp '{d0:%Y-%m-%d} 00:00:00' AND stormdate < timestamp '{d1:%Y-%m-%d} 00:00:00'",
        "geometry": ",".join(map(str, bbox)), "geometryType": "esriGeometryEnvelope", "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "outSR": 4326, "f": "geojson",
        "resultRecordCount": 2000,
    }
    return json.loads(http_get(f"{DAT}/{layer}/query?" + urllib.parse.urlencode(q)))


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    spc_path = RAW.parent / "spc-tornadoes.csv"
    if not spc_path.exists():
        print("SPC CSV ...", flush=True)
        spc_path.write_bytes(http_get(SPC_URL))
    rows = list(csv.DictReader(open(spc_path, newline="", encoding="utf-8")))

    anchors_path = REF / "famous-anchors.json"
    anchors = json.loads(anchors_path.read_text()) if anchors_path.exists() else {}

    for f in FAMOUS:
        slug = f["id"]
        r = spc_row(rows, f["spc"]["yr"], f["spc"]["om"])
        (RAW / f"{slug}.spc.json").write_text(json.dumps(r))
        s_utc, e_utc = cdt_to_utc(f["start_cdt"]), cdt_to_utc(f["end_cdt"])
        lon = [float(r["slon"]), float(r["elon"])]
        lat = [float(r["slat"]), float(r["elat"])]
        bbox = (min(lon) - 0.4, min(lat) - 0.4, max(lon) + 0.4, max(lat) + 0.4)
        d0 = (s_utc - dt.timedelta(days=1)).date()
        d1 = (e_utc + dt.timedelta(days=2)).date()
        for layer in (1, 2):
            p = RAW / f"{slug}.dat{layer}.json"
            if not p.exists():
                try:
                    p.write_text(json.dumps(dat_query(layer, d0, d1, bbox)))
                except Exception as e:  # noqa: BLE001
                    print("  DAT", slug, layer, "failed:", e)
        p = RAW / f"{slug}.iem.zip"
        if not p.exists():
            q = {"accept": "shapefile", "limitps": 1, "phenomena": "TO", "significance": "W",
                 "sts": (s_utc - dt.timedelta(hours=14)).strftime("%Y-%m-%dT%H:%MZ"),
                 "ets": (e_utc + dt.timedelta(hours=4)).strftime("%Y-%m-%dT%H:%MZ")}
            try:
                p.write_bytes(http_get(f"{IEM}?" + urllib.parse.urlencode(q), timeout=300))
            except Exception as e:  # noqa: BLE001
                print("  IEM", slug, "failed:", e)
        print("fetched", slug, flush=True)

        if f["track"] == "traced":
            got = anchors.setdefault(slug, {})
            for name, query in f["anchors"]:
                if query is None or name in got:
                    continue
                time.sleep(1.2)  # Nominatim usage policy: at most one request per second
                url = NOMINATIM + "?" + urllib.parse.urlencode({"q": query, "format": "json", "limit": 1})
                req = urllib.request.Request(url, headers={"User-Agent": "twisterchaser-data-fetch/1.0 (github.com/brendanurganus/twisterchaser)"})
                res = json.loads(urllib.request.urlopen(req, timeout=60).read())
                got[name] = ({"query": query, "lat": float(res[0]["lat"]), "lon": float(res[0]["lon"]),
                              "osm": f'{res[0]["osm_type"]}/{res[0]["osm_id"]}', "display": res[0]["display_name"]}
                             if res else {"query": query, "lat": None, "lon": None})
                print("   anchor", name, got[name].get("lat"), got[name].get("lon"), flush=True)
    anchors_path.write_text(json.dumps(anchors, indent=1))
    print("done")


if __name__ == "__main__":
    main()
