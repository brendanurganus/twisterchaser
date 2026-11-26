# Data cleaning report, 2026

Source data fetched 2026-11-26T19:40:49Z.

## What went in and what came out

- DAT track records pulled: **1320**
- Rated tornadoes kept: **1119** EF0 463, EF1 569, EF2 70, EF3 16, EF4 1
- Deaths in kept records: 15, injuries: 194

## Removed

- 155 x EFU (unrated, removed by decision)
- 38 x TSTM/Wind (not a tornado)
- 1 x N/A (no usable rating or geometry)
- 1 x EF0 (no usable rating or geometry)
- 6 x exact duplicate record

## Flagged but kept

- Width missing or zero: 61 (shown as not recorded)
- Peak wind missing or zero: 17
- No usable name (label generated from nearest town): 241
- Straight 2-point tracks: 232
- Property damage: withheld: no documented units, ~98% missing/zero
- **Playback disabled for unreliable timing: 48**
  - 5: implied speed over 120 mph
  - 20: start and end time are identical
  - 18: duration over 3 hours
  - 4: end time is before start time
  - 1: implied speed under 5 mph

## Damage outlines

- Tornado-rated outline polygons: 595, matched to a track: 568
- Tracks with a real outline: **235 of 1119** (21%); 231 cover at least 80% of the track
- Ambiguous polygons resolved by overlap: 23
- Joined by geometry and date because DAT's `path_guid` key is mostly empty.

## Warnings

- Tornado warnings in the archive: 2884
- Tornadoes matched to a warning: **944**; none: 175
- Warned after the tornado began (negative lead): 142
- Median lead when warned first: 17.0 min (max 59.0)
- Warnings covering more than one tornado: 181 (most: 6)
