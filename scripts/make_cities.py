"""Write data/cities.geojson: US places with 15,000+ people, for the map's city labels.

Population: Census Bureau city/town estimates for 2024 (sub-est2024.csv).
Coordinates: Census Gazetteer place file (already in data/ref).
Run: python3 scripts/make_cities.py
"""
import csv, json, re, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
RAW.mkdir(parents=True, exist_ok=True)
POP_URL = "https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/cities/totals/sub-est2024.csv"
POP_FILE = RAW / "sub-est2024.csv"
MIN_POP = 15000

if not POP_FILE.exists():
    print("downloading", POP_URL)
    urllib.request.urlretrieve(POP_URL, POP_FILE)

gaz = {}
with open(next((ROOT / "data" / "ref").glob("*Gaz_place_national.txt")), encoding="utf-8") as f:
    rdr = csv.reader(f, delimiter="\t")
    head = [h.strip() for h in next(rdr)]
    ix = {h: i for i, h in enumerate(head)}
    for row in rdr:
        gaz[row[ix["GEOID"]].strip()] = (row[ix["USPS"]].strip(), float(row[ix["INTPTLAT"]]), float(row[ix["INTPTLONG"]]))

SUFFIX = re.compile(r"\s+(city|town|village|borough|municipality|CDP|city and borough|urban county|consolidated government|metropolitan government|metro government|unified government)\b.*$", re.I)

def clean(name):
    n = re.sub(r"\s*\(balance\)", "", name)
    n = n.replace("/Jefferson County metro government", "").replace("-Davidson metropolitan government", "")
    n = SUFFIX.sub("", n)
    return n.strip()

feats = []
with open(POP_FILE, encoding="latin-1") as f:
    for r in csv.DictReader(f):
        if r["SUMLEV"] != "162":
            continue
        pop = int(r["POPESTIMATE2024"] or 0)
        if pop < MIN_POP:
            continue
        g = gaz.get(r["STATE"] + r["PLACE"])
        if not g:
            continue
        st, lat, lon = g
        feats.append({"type": "Feature",
                      "properties": {"name": clean(r["NAME"]), "st": st, "pop": pop},
                      "geometry": {"type": "Point", "coordinates": [round(lon, 4), round(lat, 4)]}})
feats.sort(key=lambda x: -x["properties"]["pop"])
json.dump({"type": "FeatureCollection", "features": feats}, open(ROOT / "data" / "cities.geojson", "w"), separators=(",", ":"))
print(len(feats), "places;", [f"{x['properties']['name']} {x['properties']['pop']}" for x in feats[:6]])
