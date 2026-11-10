# Data cleaning report, 2026

Source data fetched 2026-11-10T11:04:29Z.

## What went in and what came out

- DAT track records pulled: **1308**
- Rated tornadoes kept: **1106** EF0 458, EF1 562, EF2 69, EF3 16, EF4 1
- Deaths in kept records: 15, injuries: 194

## Removed

- 153 x EFU (unrated, removed by decision)
- 39 x TSTM/Wind (not a tornado)
- 1 x N/A (no usable rating or geometry)
- 9 x exact duplicate record

## Flagged but kept

- Width missing or zero: 66 (shown as not recorded)
- Peak wind missing or zero: 17
- No usable name (label generated from nearest town): 238
- Straight 2-point tracks: 230
- Property damage: withheld: no documented units, ~98% missing/zero
- **Playback disabled for unreliable timing: 43**
  - 18: start and end time are identical
  - 4: implied speed over 120 mph
  - 18: duration over 3 hours
  - 3: end time is before start time

## Damage outlines

- Tornado-rated outline polygons: 590, matched to a track: 562
- Tracks with a real outline: **231 of 1106** (21%); 227 cover at least 80% of the track
- Ambiguous polygons resolved by overlap: 22
- Joined by geometry and date because DAT's `path_guid` key is mostly empty.

## Warnings

- Tornado warnings in the archive: 2866
- Tornadoes matched to a warning: **935**; none: 171
- Warned after the tornado began (negative lead): 140
- Median lead when warned first: 17.0 min (max 59.0)
- Warnings covering more than one tornado: 180 (most: 6)
