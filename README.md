# Twister Chaser

A 3D explorer of every tornado the National Weather Service surveyed in 2026, plus ten famous ones from 1999 to 2024. Pan and tilt across real terrain, click a track for the numbers, then press play to follow the tornado along its path as its damage swath grows.

Not an official NWS or NOAA product. Not a forecast and not safety guidance. See `web/about.html` for sources, limits and where the data disagrees.

## What is in it

- **Main map** (`web/index.html`): 3D terrain or a flat overview, all rated 2026 tornadoes colored by EF rating, filters, timeline, search, top lists, stats.
- **Famous ten**: Joplin, Tuscaloosa-Birmingham, Hackleburg-Phil Campbell, El Reno (2011 and 2013), Moore (1999 and 2013), Greensburg, Fairdale, Greenfield. Always on the map, kept apart from the 2026 statistics.
- **Playback** (`web/playback.html`): real-time, 10x or 60x. The position is interpolated from the survey's start and end times, the swath grows at its true width where an outline exists, and the funnel is a depiction. Chase, drone and side cameras.
- **Warning areas**: NWS tornado warning polygons, with lead time on every card.
- **Intro**: "The year in tracks", about ten seconds, skippable, off for reduced motion. `?intro=0` turns it off and `?intro=1` forces it.

Everything is static files. No server, no keys, no sound.

## Data

| What | Source |
| --- | --- |
| 2026 tracks, outlines, survey notes | NWS Damage Assessment Toolkit |
| Warnings | Iowa Environmental Mesonet archive |
| Famous tornadoes' headline numbers | NOAA Storm Prediction Center database |
| Hand-traced landmarks | OpenStreetMap Nominatim (ODbL) |
| States, places | US Census Bureau |
| Terrain, imagery | Mapzen / AWS Terrain Tiles, USGS The National Map |

Build it yourself (Python 3.11+):

```
pip install -r requirements.txt
python3 scripts/fetch_data.py --year 2026   # raw 2026 data into data/raw (not committed)
python3 scripts/build_data.py --year 2026   # data/tornadoes-2026.json, outlines, swaths, warnings
python3 scripts/fetch_famous.py             # only when the famous list changes
python3 scripts/build_famous.py
python3 -m http.server 8000                 # then open http://localhost:8000/
```

The cleaning rules and counts are written to `docs/data-report.md` on every build.

## Publishing and the daily refresh

`.github/workflows/pages.yml` deploys to GitHub Pages on every push to `main`. Once a day it also pulls fresh 2026 data, rebuilds, commits any change, and deploys. If the upstream data looks broken (fewer than 500 tornadoes) it stops without publishing.

One-time setup: **Settings > Pages > Build and deployment > Source: GitHub Actions**. When the year changes, update `DATA_YEAR` in the workflow and the year-named data files.

## Lite edition (Claude artifact)

`lite/template.html` plus `scripts/build_lite.py` produce one self-contained HTML file (`lite/dist/`, not committed) for use as a Claude artifact. Artifacts cannot fetch files or load map tiles, so the lite edition draws a flat map on a canvas with the data embedded: filters, search, the famous ten, warning lead times and a top-down playback. Terrain, the 3D funnel and real damage outlines are only in the full site. Run `python3 scripts/build_lite.py` after the data builds.

## Credits

MapLibre GL JS (BSD-3), three.js (MIT), VT323 by Peter Hull (SIL OFL). Full list on the about page.
