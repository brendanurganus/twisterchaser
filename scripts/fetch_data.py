#!/usr/bin/env python3
"""Fetch raw source data for Twister Chaser into data/raw/.

Sources (all free, no keys):
  * NWS Damage Assessment Toolkit (DAT) ArcGIS feature service
      layer 1 = damage lines (tornado tracks), layer 2 = damage polygons
  * Iowa Environmental Mesonet (IEM) NWS tornado warning archive (shapefile)

Usage:  python3 scripts/fetch_data.py [--year 2026]
"""
import argparse
import datetime as dt
import io
import json
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"

DAT = ("https://services.dat.noaa.gov/arcgis/rest/services/"
       "nws_damageassessmenttoolkit/DamageViewer/FeatureServer")
IEM = "https://mesonet.agron.iastate.edu/cgi-bin/request/gis/watchwarn.py"
UA = {"User-Agent": "twisterchaser-data-fetch/1.0 (github.com/twisterchaser)"}


def http_get(url, tries=4, timeout=180):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"GET failed after {tries} tries: {url}\n{last}")


def fetch_layer(layer, year, page=1000):
    """Page through a DAT layer for stormdate >= Jan 1 of `year` (UTC)."""
    where = f"stormdate >= timestamp '{year}-01-01 00:00:00'"
    feats, offset = [], 0
    while True:
        q = {
            "where": where, "outFields": "*", "outSR": 4326, "f": "geojson",
            "orderByFields": "objectid", "resultOffset": offset,
            "resultRecordCount": page,
        }
        url = f"{DAT}/{layer}/query?" + urllib.parse.urlencode(q)
        d = json.loads(http_get(url))
        if "error" in d:
            raise RuntimeError(f"DAT layer {layer} error: {d['error']}")
        got = d.get("features", [])
        feats += got
        if len(got) < page:
            break
        offset += len(got)
    return {"type": "FeatureCollection", "features": feats}


def fetch_warnings(year):
    """All tornado warnings (TO.W) from Jan 1 of `year` through tomorrow (UTC)."""
    end = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)).strftime("%Y-%m-%d")
    q = {
        "accept": "shapefile", "sts": f"{year}-01-01T00:00Z", "ets": f"{end}T00:00Z",
        # limitps=1 is REQUIRED: without it IEM ignores phenomena/significance
        # and returns every warning/watch type.
        "limitps": 1, "phenomena": "TO", "significance": "W",
    }
    return http_get(f"{IEM}?" + urllib.parse.urlencode(q), timeout=300)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=dt.datetime.now(dt.timezone.utc).year)
    a = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)

    print(f"DAT lines {a.year} ...", flush=True)
    lines = fetch_layer(1, a.year)
    (RAW / "lines.geojson").write_text(json.dumps(lines))
    print(f"  {len(lines['features'])} line features")

    print(f"DAT polygons {a.year} ...", flush=True)
    polys = fetch_layer(2, a.year)
    (RAW / "polys.geojson").write_text(json.dumps(polys))
    print(f"  {len(polys['features'])} polygon features")

    print("IEM tornado warnings ...", flush=True)
    blob = fetch_warnings(a.year)
    wdir = RAW / "iem"
    wdir.mkdir(exist_ok=True)
    for old in wdir.glob("*"):
        old.unlink()
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        z.extractall(wdir)
    print(f"  extracted {len(list(wdir.glob('*.shp')))} shapefile")

    (RAW / "fetch-meta.json").write_text(json.dumps({
        "year": a.year,
        "fetched_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dat_lines": len(lines["features"]),
        "dat_polygons": len(polys["features"]),
    }, indent=2))
    print("done")


if __name__ == "__main__":
    sys.exit(main())
