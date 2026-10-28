# Data cleaning report, 2026

Source data fetched 2026-10-28T10:59:36Z.

## What went in and what came out

- DAT track records pulled: **1299**
- Rated tornadoes kept: **1097** EF0 451, EF1 559, EF2 70, EF3 16, EF4 1
- Deaths in kept records: 15, injuries: 194

## Removed

- 153 x EFU (unrated, removed by decision)
- 39 x TSTM/Wind (not a tornado)
- 1 x N/A (no usable rating or geometry)
- 9 x exact duplicate record

## Flagged but kept

- Width missing or zero: 66 (shown as not recorded)
- Peak wind missing or zero: 17
- No usable name (label generated from nearest town): 239
- Straight 2-point tracks: 227
- Property damage: withheld: no documented units, ~98% missing/zero
- **Playback disabled for unreliable timing: 44**
  - 18: start and end time are identical
  - 4: implied speed over 120 mph
  - 18: duration over 3 hours
  - 4: end time is before start time

## Damage outlines

- Tornado-rated outline polygons: 583, matched to a track: 555
- Tracks with a real outline: **225 of 1097** (20%); 221 cover at least 80% of the track
- Ambiguous polygons resolved by overlap: 22
- Joined by geometry and date because DAT's `path_guid` key is mostly empty.

## Warnings

- Tornado warnings in the archive: 2840
- Tornadoes matched to a warning: **932**; none: 165
- Warned after the tornado began (negative lead): 136
- Median lead when warned first: 16.0 min (max 59.0)
- Warnings covering more than one tornado: 181 (most: 6)
