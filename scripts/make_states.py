"""Write data/states.geojson (state outlines for the map) from the Census cartographic boundary file."""
import json, shapefile
from shapely.geometry import shape, mapping

r = shapefile.Reader('data/ref/states/cb_2023_us_state_20m')
fields = [f[0] for f in r.fields[1:]]
feats = []
for sr in r.iterShapeRecords():
    rec = dict(zip(fields, sr.record))
    if rec['STUSPS'] in ('PR', 'VI', 'GU', 'AS', 'MP'):
        continue
    g = shape(sr.shape.__geo_interface__).simplify(0.01, preserve_topology=True)
    feats.append({'type': 'Feature', 'properties': {'st': rec['STUSPS'], 'name': rec['NAME']}, 'geometry': mapping(g)})
out = {'type': 'FeatureCollection', 'features': feats}
json.dump(out, open('data/states.geojson', 'w'), separators=(',', ':'))
print(len(feats), 'states')
