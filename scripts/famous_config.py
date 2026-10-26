"""The ten famous tornadoes: what we know about each and where it came from.

Headline numbers (rating, deaths, injuries, width) come from the NOAA Storm
Prediction Center tornado database (SPC "actual tornadoes" CSV). Where another
source disagrees, the difference is written into `caveats` and shown on the card.

Start and end times are from NWS surveys as summarised on Wikipedia, checked
against the NWS event pages where those state a time (see `time_sources`).
All times below are US Central DAYLIGHT time (UTC-5), so they are converted to
UTC by adding five hours. (The SPC CSV stores central STANDARD time all year.)

Track geometry, in order of preference:
  line     the NWS survey line from the Damage Assessment Toolkit (DAT)
  outline  a centerline derived from the NWS damage-outline polygons in DAT
  traced   hand-traced through landmarks the NWS names along the path
"""

FAMOUS = [
    {
        "id": "famous-joplin-2011", "label": "Joplin", "state": "MO",
        "tz": "America/Chicago", "scale": "EF", "efnum": 5,
        "spc": {"yr": 2011, "om": 296616},
        "start_cdt": "2011-05-22 17:34", "end_cdt": "2011-05-22 18:12",
        "time_sources": "NWS Springfield survey (touchdown 5:34 p.m., lift 6:12 p.m. CDT), via Wikipedia",
        "wfos": ["SGF"],
        "track": "traced",
        "anchors": [  # [name, Nominatim query]; None means use the SPC start or end point
            ["start", None],
            ["Twin Hills Country Club", "Twin Hills Country Club, Joplin MO"],
            ["Main Street, 24th Street block", "2400 S Main St, Joplin, MO"],
            ["Joplin High School", "2104 Indiana Ave, Joplin, MO"],
            ["Range Line Road, 23rd Street block", "2300 S Range Line Rd, Joplin, MO"],
            ["end", None],
        ],
        "story": ("Touched down southwest of Joplin and moved east-northeast into the south side of the city. "
                  "It crossed Schifferdecker Avenue about four minutes after touchdown, struck the St. John's "
                  "Regional Medical Center area, crossed Main Street south of downtown and passed Joplin High "
                  "School. It was widest along Range Line Road, then continued east-southeast past Duquesne and "
                  "the I-44 and I-49 interchange before lifting east of Diamond, Missouri."),
        "caveats": [
            "The NWS and most summaries give the maximum width as 1 mile (1,760 yd). The SPC database lists 1,600 yd.",
            "158 deaths are direct. Another 8 to 9 indirect deaths are not counted here.",
        ],
    },
    {
        "id": "famous-tuscaloosa-2011", "label": "Tuscaloosa-Birmingham", "state": "AL",
        "tz": "America/Chicago", "scale": "EF", "efnum": 4,
        "spc": {"yr": 2011, "om": 314625},
        "start_cdt": "2011-04-27 16:43", "end_cdt": "2011-04-27 18:14",
        "time_sources": "NWS Birmingham survey table (4:43 p.m. to 6:14 p.m.) and DAT line times",
        "wfos": ["BMX"],
        "track": "line", "dat_pick": {"layer1": {"wfo": "BMX", "length": 80.68, "efscale": "EF4"}},
        "story": ("Touched down in Greene County, crossed into Tuscaloosa County and hit the south side of Tuscaloosa, "
                  "including the 35th Street industrial area, Rosedale, Forest Lake and the area near University Mall. "
                  "It continued through Holt and rural Searles, crossed into Jefferson County and struck Concord, "
                  "Pleasant Grove and Pratt City in Birmingham, then Fultondale, before lifting north of Tarrant."),
        "caveats": [
            "NWS Birmingham lists 65 deaths for this tornado. The SPC database lists 64. Another 8 deaths were indirect.",
        ],
    },
    {
        "id": "famous-hackleburg-2011", "label": "Hackleburg-Phil Campbell", "state": "AL",
        "tz": "America/Chicago", "scale": "EF", "efnum": 5,
        "spc": {"yr": 2011, "om": 309488},
        "start_cdt": "2011-04-27 15:05", "end_cdt": "2011-04-27 16:50",
        "time_sources": "NWS Birmingham/Huntsville survey (touchdown 3:05 p.m.), lift 4:50 p.m. CDT per Wikipedia",
        "wfos": ["BMX", "HUN"],
        "track": "outline", "outline_len": 132, "outline_wfo_hint": "Hackleburg",
        "story": ("Touched down in Marion County near Hamilton, then struck Hackleburg and Phil Campbell. It continued "
                  "through Oak Grove, Mount Hope and Lawrence County, crossed Wheeler Lake, passed Tanner and "
                  "Harvest and ended in Madison County. It was one of the longest and strongest tornadoes of the "
                  "April 27, 2011 outbreak."),
        "length_override": 102.0,
        "caveats": [
            "The NWS outline drawn here ends in Madison County after about 100 miles, which matches the 2022 NOAA "
            "re-analysis (about 102 miles). The SPC database and the original survey list 132 miles, running on into "
            "Tennessee. The 2022 re-analysis treats the Tennessee end as a separate EF3 tornado.",
            "NWS Birmingham lists 72 deaths and some summaries list 71. The SPC database lists 72.",
        ],
    },
    {
        "id": "famous-elreno-2011", "label": "El Reno-Piedmont", "state": "OK",
        "tz": "America/Chicago", "scale": "EF", "efnum": 5,
        "spc": {"yr": 2011, "om": 315837},
        "start_cdt": "2011-05-24 15:51", "end_cdt": "2011-05-24 17:35",
        "time_sources": "NWS Norman survey (3:51 p.m. to 5:35 p.m. CDT), via Wikipedia",
        "wfos": ["OUN"],
        "track": "outline",
        "story": ("Touched down southwest of Calumet, reached peak intensity near Interstate 40 west of El Reno, passed "
                  "Fort Reno and crossed US 81 north of El Reno. It moved between El Reno and Piedmont, passed north "
                  "of Cashion and weakened on the north side of Guthrie."),
        "caveats": [],
    },
    {
        "id": "famous-moore-2013", "label": "Moore", "state": "OK",
        "tz": "America/Chicago", "scale": "EF", "efnum": 5,
        "spc": {"yr": 2013, "om": 451537},
        "start_cdt": "2013-05-20 14:56", "end_cdt": "2013-05-20 15:35",
        "time_sources": "NWS Norman survey (2:56 p.m. to 3:35 p.m. CDT), via Wikipedia",
        "wfos": ["OUN"],
        "track": "outline",
        "story": ("Touched down northwest of Newcastle, crossed the Canadian River into Oklahoma City, and moved through "
                  "the Westmoore area into Moore. It struck Briarwood and Plaza Towers elementary schools and the Moore "
                  "Medical Center area, crossed I-35 and lifted just east of Moore."),
        "caveats": [
            "Later NWS counts list 25 deaths including one indirect death. The SPC database and the initial survey list 24.",
        ],
    },
    {
        "id": "famous-elreno-2013", "label": "El Reno", "state": "OK",
        "tz": "America/Chicago", "scale": "EF", "efnum": 3,
        "spc": {"yr": 2013, "om": 453682},
        "start_cdt": "2013-05-31 18:03", "end_cdt": "2013-05-31 18:43",
        "time_sources": "NWS Norman (about 6:03 p.m. CDT) and Wikipedia (6:03 to 6:43 p.m. CDT)",
        "wfos": ["OUN"],
        "track": "outline",
        "story": ("Formed about 8 miles west-southwest of El Reno, grew to a record 2.6 miles wide as it crossed US 81 "
                  "south of El Reno, then moved east-northeast across Interstate 40 and lifted near Banner Road. "
                  "Eight people died, including storm chasers."),
        "caveats": [
            "Mobile radar briefly supported an EF5 rating, but on August 30, 2013 the NWS set the official rating at EF3 "
            "because the damage survey did not support a higher one.",
            "The SPC database lists 26 injuries. Other sources list 151.",
            "At 4,576 yd (2.6 mi) it is the widest tornado on record.",
        ],
    },
    {
        "id": "famous-greenfield-2024", "label": "Greenfield", "state": "IA",
        "tz": "America/Chicago", "scale": "EF", "efnum": 4,
        "spc": {"yr": 2024, "om": 624208},
        "start_cdt": "2024-05-21 14:57", "end_cdt": "2024-05-21 15:45",
        "time_sources": "NWS Des Moines/Omaha survey and DAT line times (2:57 p.m. to 3:45 p.m. CDT)",
        "wfos": ["DMX", "OAX"],
        "track": "line", "dat_pick": {"layer1": {"event_id": "Greenfield", "efscale": "EF4"}},
        "story": ("Touched down in Page County, crossed a corner of Taylor County and moved through Adams County near "
                  "Nodaway and Brooks. In Adair County it hit Greenfield from the southwest and east before lifting "
                  "northeast of town."),
        "caveats": [
            "The SPC database lists the path as 40.65 miles. The NWS survey line drawn here is 43.1 miles.",
        ],
    },
    {
        "id": "famous-fairdale-2015", "label": "Rochelle-Fairdale", "state": "IL",
        "tz": "America/Chicago", "scale": "EF", "efnum": 4,
        "spc": {"yr": 2015, "om": 574336},
        "start_cdt": "2015-04-09 18:39", "end_cdt": "2015-04-09 19:20",
        "time_sources": "NWS Chicago event page (6:39 p.m. to 7:20 p.m. CDT) and DAT line times",
        "wfos": ["LOT"],
        "track": "line", "dat_pick": {"layer1": {"event_id": "Rochelle-Fairdale", "efscale": "EF4"}},
        "story": ("Touched down northeast of Franklin Grove and crossed Lee and Ogle counties, passing the northwest "
                  "side of Rochelle, I-39 and US 51. It then entered DeKalb County and destroyed much of Fairdale "
                  "along IL 72 before lifting near Cherry Valley Road."),
        "caveats": [
            "The NWS lists 22 injuries across the whole path. The SPC database lists 11.",
        ],
    },
    {
        "id": "famous-moore-1999", "label": "Bridge Creek-Moore", "state": "OK",
        "tz": "America/Chicago", "scale": "F", "efnum": 5,
        "spc": {"yr": 1999, "om": 1147},
        "start_cdt": "1999-05-03 18:26", "end_cdt": "1999-05-03 19:48",
        "time_sources": "NWS Norman event table (17:26 to 18:48 CST, which is 6:26 to 7:48 p.m. CDT)",
        "wfos": ["OUN"],
        "track": "traced",
        "anchors": [
            ["start", None],
            ["Bridge Creek", "Bridge Creek, Oklahoma"],
            ["Moore", "Moore, Oklahoma"],
            ["Del City", "Del City, Oklahoma"],
            ["Midwest City", "Midwest City, Oklahoma"],
        ],
        "story": ("Rated F5 on the original Fujita scale. Touched down in southern Grady County near Amber, grew into a "
                  "wedge near Oklahoma 92, reached F5 intensity at Bridge Creek and crossed the South Canadian River "
                  "into south Oklahoma City. It then crossed I-44, moved through Moore, southeast Oklahoma City and "
                  "Del City, past Tinker Air Force Base, and dissipated in Midwest City."),
        "caveats": [
            "Wikipedia gives a 6:23 p.m. touchdown. The NWS Norman table and SPC give 6:26 p.m.",
            "Width: SPC lists 1,430 yd. The NWS table and other sources list 1,760 yd (1 mile). Path length: SPC 37 miles, NWS 38 miles.",
            "Rated on the original Fujita scale. The Enhanced Fujita scale did not exist until 2007.",
        ],
    },
    {
        "id": "famous-greensburg-2007", "label": "Greensburg", "state": "KS",
        "tz": "America/Chicago", "scale": "EF", "efnum": 5,
        "spc": {"yr": 2007, "om": 455},
        "start_cdt": "2007-05-04 21:03", "end_cdt": "2007-05-04 22:05",
        "time_sources": "NWS Dodge City survey (9:03 p.m. to 10:05 p.m. CDT), via Wikipedia",
        "wfos": ["DDC"],
        "track": "traced",
        "anchors": [
            ["start", None],
            ["Greensburg", "Greensburg, Kansas"],
            ["end", None],
        ],
        "story": ("Touched down south of Greensburg, crossed US 183 in Kiowa County and reached its widest point south "
                  "of town. It entered Greensburg after turning northwest, struck Delmer Day Elementary School in the "
                  "south of town and then downtown, weakened and dissipated in a field northwest of the city."),
        "caveats": [
            "Death counts range from 10 to 13 depending on the source. The SPC database lists 11.",
        ],
    },
]
