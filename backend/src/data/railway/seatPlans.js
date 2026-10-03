/**
 * Seat plans for real Bangladesh Railway trains, transcribed from published
 * coach diagrams, station boards and photographs of cabin doors.
 *
 * Rows use the compact notation of `seeders/seatPlanSource.js`:
 *
 *   "12 11 | 10 9 8"   seats, with `|` or `_` for a blank cell (corridor, table, toilet)
 *   "91w 90 89c"       w = window, h = half window, c = explicitly not a window
 *
 * Every row is written cell by cell, blanks included. A row is drawn
 * left-aligned, so "1 | 2 3" puts seat 2 in the corridor column; the diagram's
 * empty places have to be spelled out ("1 _ | 2 3"). Unless marked, the seat at
 * either outer edge of a row is the window seat.
 *
 * `seats` is the count the source shows; building a layout fails if the rows
 * do not produce exactly that many, which is what catches a mis-read number.
 *
 * `trains` lists the train numbers a source names. Each of those trains gets
 * its own approved copy of the plan. A source that names no train — only a
 * route, or nothing — has an empty list: its plan is saved once as a draft
 * with no train, for a person to assign. Coach type and class are filled in
 * only where the source states them (or, for a gauge, where the route leaves
 * no doubt); anything else is left empty on the draft.
 */

/** Seat notes for a run of seats: `notes([1, 8], "…")`. */
function notes(...ranges) {
  const out = {};
  for (const [[from, to], text] of ranges) {
    for (let n = from; n <= to; n++) out[n] = text;
  }
  return out;
}

const ROUTE_ONLY = "Names routes, not trains, so it is kept as a draft for a person to assign.";

const LAYOUTS = [
  /* ---------------- Plans whose trains the source names ---------------- */

  {
    key: "vacuum-shovon-104",
    coachNo: "SHOVON-104",
    coachType: "Vacuum Coach",
    coachClass: "Shovon",
    seats: 104,
    splitRow: 11,
    source:
      "Vacuum Coaches Seat Alignments — Shovon class only. Intercity rake: Madhumati, Tungipara, Titumir, " +
      "Barendra, Dhalarchar, Ishwardi/Rohanpur Commuter, Sirajganj.",
    // The image's local-rake trains (Mohananda, Rocket, Uttara, Rajbari,
    // Nakshikantha) are not in the timetable, and its "Shuttle" does not say
    // which shuttle, so none of those is linked.
    trains: [755, 756, 783, 784, 733, 734, 731, 732, 779, 780, 775, 776, 57, 58, 77, 78],
    rows: [
      "2 1 | _ _ _",
      "3 4 | 5 6 7",
      "12 11 | 10 9 8",
      "13 14 | 15 16 17",
      "22 21 | 20 19 18",
      "23 24 | 25 26 27",
      "32 31 | 30 29 28",
      "33 34 | 35 36 37",
      "42 41 | 40 39 38",
      "43 44 | 45 46 47",
      "52 51 | 50 49 48",
      "53 54 | 55 56 57",
      "62 61 | 60 59 58",
      "63 64 | 65 66 67",
      "72 71 | 70 69 68",
      "73 74 | 75 76 77",
      "82 81 | 80 79 78",
      "83 84 | 85 86 87",
      "92 91 | 90 89 88",
      "93 94 | 95 96 97",
      "102 101 | 100 99 98",
      "103 104 | _ _ _",
    ],
  },

  {
    key: "madhumati-chair-41",
    coachNo: "S_CHAIR-41",
    coachType: "Vacuum Coach",
    coachClass: "Shovon Chair",
    seats: 41,
    splitRow: 5,
    source:
      "755/756 Madhumati Express — chair section of the cabin-fitted Shovon Chair coach. Seats 01–21 face " +
      "one way and 22–41 the other, either side of the tables.",
    trains: [755, 756],
    rows: [
      "1 _ | _ _ _",
      "2 3 | 4 5 6",
      "11 10 | 9 8 7",
      "12 13 | 14 15 16",
      "21 20 | 19 18 17",
      "_ _ | _ _ _",
      "22 23 | 24 25 26",
      "31 30 | 29 28 27",
      "32 33 | 34 35 36",
      "41 40 | 39 38 37",
    ],
  },

  {
    key: "madhumati-cabin-24",
    coachNo: "CABIN-24",
    coachType: "Vacuum Coach",
    coachClass: "Non-AC Cabin",
    seats: 24,
    source: "755/756 Madhumati Express — cabin section of the cabin-fitted Shovon Chair coach, three cabins.",
    trains: [755, 756],
    rows: [
      "_ 1 2 3 4",
      "_ 8 7 6 5",
      "_",
      "_ 9 10 11 12",
      "_ 16 15 14 13",
      "_",
      "_ 17 18 19 20",
      "_ 24 23 22 21",
    ],
    seatNotes: notes([[1, 8], "Cabin 1"], [[9, 16], "Cabin 2"], [[17, 24], "Cabin 3"]),
  },

  {
    key: "titumir-cabin-24",
    coachNo: "CABIN-24",
    coachType: "Vacuum Coach",
    coachClass: "Non-AC Cabin",
    seats: 24,
    source:
      "Titumir Express (Rajshahi–Chilahati) cabin door plates — seats by day, berths by night: berths 1–2 " +
      "over seats 1–4, 3–6 over 5–12, 7–10 over 13–20, 11–12 over 21–24.",
    trains: [733, 734],
    rows: [
      "_ 1 2 3 4",
      "_",
      "_ 5 6 7 8",
      "_ 9 10 11 12",
      "_",
      "_ 13 14 15 16",
      "_ 17 18 19 20",
      "_",
      "_ 21 22 23 24",
    ],
    seatNotes: notes(
      [[1, 4], "Single cabin · berths 1–2 at night"],
      [[5, 12], "Double cabin · berths 3–6 at night"],
      [[13, 20], "Double cabin · berths 7–10 at night"],
      [[21, 24], "Single cabin · berths 11–12 at night"]
    ),
  },

  {
    key: "mg-ac-chair-55",
    coachNo: "AC_CHAIR-55",
    coachType: "Meter Gauge (MG)",
    coachClass: "AC Chair",
    from: "Dhaka",
    seats: 55,
    splitRow: 8,
    source:
      "AC Chair Coach seat plan — Parabat, Subarna, Sonar Bangla, Mohanagar Provati, Godhuli and Turna. " +
      "Window and corridor seats are marked on the diagram.",
    trains: [709, 710, 701, 702, 787, 788, 704, 703, 741, 742],
    rows: [
      "55w _ | _ _",
      "52w _ | 53c 54w",
      "48w 49c | 50c 51w",
      "44w 45c | 46c 47w",
      "40w 41c | 42c 43w",
      "36w 37c | 38c 39w",
      "32w 33c | 34c 35w",
      "28w 29c | 30c 31w",
      "_ _ | _ _",
      "24w 25c | 26c 27w",
      "20w 21c | 22c 23w",
      "16w 17c | 18c 19w",
      "12w 13c | 14c 15w",
      "8w 9c | 10c 11w",
      "4w 5c | 6c 7w",
      "1w 2c | _ _",
      "_ _ | _ 3w",
    ],
  },

  {
    key: "lhb-board-ac-cabin-48",
    coachNo: "AC_CABIN-48",
    coachType: "Broad Gauge (BG)",
    coachClass: "AC Cabin",
    seats: 48,
    source:
      "Station board for Silk City (754), Padma (760) and Dhumketu (770): coaches KA, KHA, GA — 48 AC " +
      "seats by day, 24 AC berths by night.",
    trains: [753, 754, 759, 760, 769, 770],
    rows: [
      "_ 1 2 3 4",
      "_ 5 6 7 8",
      "_",
      "_ 9 10 11 12",
      "_",
      "_ 13 14 15 16",
      "_ 17 18 19 20",
      "_",
      "_ 21 22 23 24",
      "_",
      "_ 25 26 27 28",
      "_",
      "_ 29 30 31 32",
      "_ 33 34 35 36",
      "_",
      "_ 37 38 39 40",
      "_",
      "_ 41 42 43 44",
      "_ 45 46 47 48",
    ],
    seatNotes: notes(
      [[1, 8], "Double cabin · AC berths 1 & 3 lower, 2 & 4 upper"],
      [[9, 12], "Single cabin · AC berths 5 lower, 6 upper"],
      [[13, 20], "Double cabin · AC berths 7 & 9 lower, 8 & 10 upper"],
      [[21, 24], "Single cabin · AC berths 11 lower, 12 upper"],
      [[25, 28], "Single cabin · AC berths 13 lower, 14 upper"],
      [[29, 36], "Double cabin · AC berths 15 & 17 lower, 16 & 18 upper"],
      [[37, 40], "Single cabin · AC berths 19 lower, 20 upper"],
      [[41, 48], "Double cabin · AC berths 21 & 23 lower, 22 & 24 upper"]
    ),
  },

  {
    key: "lhb-board-snigdha-78",
    coachNo: "SNIGDHA-78",
    coachType: "Broad Gauge (BG)",
    coachClass: "Snigdha",
    seats: 78,
    splitRow: 8,
    source:
      "Station board for Silk City (754), Padma (760) and Dhumketu (770): coaches GHA, UMA — AC chair / " +
      "Snigdha, two seats one side of the corridor and three the other.",
    trains: [753, 754, 759, 760, 769, 770],
    rows: [
      "1 2 | 3 _ 4",
      "9 8 | 7 6 5",
      "14 13 | 12 11 10",
      "19 18 | 17 16 15",
      "24 23 | 22 21 20",
      "29 28 | 27 26 25",
      "34 33 | 32 31 30",
      "39 38 | 37 36 35",
      "_ _ | _ _ _",
      "44 43 | 42 41 40",
      "49 48 | 47 46 45",
      "54 53 | 52 51 50",
      "59 58 | 57 56 55",
      "64 63 | 62 61 60",
      "69 68 | 67 66 65",
      "74 73 | 72 71 70",
      "78 77 | 76 _ 75",
    ],
  },

  {
    key: "lhb-board-shovon-chair-105",
    coachNo: "S_CHAIR-105",
    coachType: "Broad Gauge (BG)",
    coachClass: "Shovon Chair",
    seats: 105,
    splitRow: 11,
    source:
      "Station board for Silk City (754), Padma (760) and Dhumketu (770): coaches CHA, SCHA, JA, JHA, NEO, " +
      "TA, THA, DA — Shovon Chair.",
    trains: [753, 754, 759, 760, 769, 770],
    rows: [
      "1 2 | 3 4 5",
      "6 7 | 8 9 10",
      "11 12 | 13 14 15",
      "16 17 | 18 19 20",
      "21 22 | 23 24 25",
      "26 27 | 28 29 30",
      "31 32 | 33 34 35",
      "36 37 | 38 39 40",
      "41 42 | 43 44 45",
      "46 47 | 48 49 50",
      "51 52 | 53 54 55",
      "_ _ | _ _ _",
      "56 57 | 58 59 60",
      "61 62 | 63 64 65",
      "66 67 | 68 69 70",
      "71 72 | 73 74 75",
      "76 77 | 78 79 80",
      "81 82 | 83 84 85",
      "86 87 | 88 89 90",
      "91 92 | 93 94 95",
      "96 97 | 98 99 100",
      "101 102 | 103 104 105",
    ],
  },

  {
    key: "ekota-ac-chair-80",
    coachNo: "AC_CHAIR-80",
    coachType: "PT Inka Red-Green (BG)",
    coachClass: "AC Chair",
    from: "Dinajpur",
    to: "Dhaka",
    seats: 80,
    splitRow: 8,
    source: "PT Inka red-green (BG) AC Chair, Dinajpur–Dhaka — only Ekota and Drutojan.",
    trains: [705, 706, 757, 758],
    rows: [
      "76 77 78 | 79 80",
      "71 72 73 | 74 75",
      "66 67 68 | 69 70",
      "61 62 63 | 64 65",
      "56 57 58 | 59 60",
      "51 52 53 | 54 55",
      "46 47 48 | 49 50",
      "41 42 43 | 44 45",
      "_ _ _ | _ _",
      "36 37 38 | 39 40",
      "31 32 33 | 34 35",
      "26 27 28 | 29 30",
      "21 22 23 | 24 25",
      "16 17 18 | 19 20",
      "11 12 13 | 14 15",
      "6 7 8 | 9 10",
      "1 2 3 | 4 5",
    ],
  },

  {
    key: "ekota-cabin-48",
    coachNo: "CABIN-48",
    coachType: "PT Inka Red-Green (BG)",
    coachClass: "Non-AC Cabin",
    from: "Dhaka",
    to: "Dinajpur",
    seats: 48,
    source:
      "Non-AC cabin seat plan, red-green BG PT Inka coach — applicable for Ekota and Drutojan. Corridor " +
      "along one side; the gaps follow the diagram's spacing between compartments.",
    trains: [705, 706, 757, 758],
    rows: [
      "_ 4 3 2 1",
      "_ 8 7 6 5",
      "_",
      "_ 12 11 10 9",
      "_",
      "_ 16 15 14 13",
      "_",
      "_ 20 19 18 17",
      "_ 24 23 22 21",
      "_",
      "_ 28 27 26 25",
      "_ 32 31 30 29",
      "_",
      "_ 36 35 34 33",
      "_",
      "_ 40 39 38 37",
      "_",
      "_ 44 43 42 41",
      "_ 48 47 46 45",
    ],
  },

  {
    key: "ekota-shovon-chair-92",
    coachNo: "S_CHAIR-92",
    coachType: "PT Inka Red-Green (BG)",
    coachClass: "Shovon Chair",
    from: "Dinajpur",
    to: "Dhaka",
    seats: 92,
    splitRow: 10,
    source: "PT Inka red-green (BG) Shovon Chair, Dinajpur–Dhaka — only Ekota and Drutojan.",
    trains: [705, 706, 757, 758],
    rows: [
      "_ _ _ | _ 92",
      "87 88 89 | 90 91",
      "82 83 84 | 85 86",
      "77 78 79 | 80 81",
      "72 73 74 | 75 76",
      "67 68 69 | 70 71",
      "62 63 64 | 65 66",
      "57 58 59 | 60 61",
      "52 53 54 | 55 56",
      "47 48 49 | 50 51",
      "_ _ _ | _ _",
      "42 43 44 | 45 46",
      "37 38 39 | 40 41",
      "32 33 34 | 35 36",
      "27 28 29 | 30 31",
      "22 23 24 | 25 26",
      "17 18 19 | 20 21",
      "12 13 14 | 15 16",
      "7 8 9 | 10 11",
      "2 3 4 | 5 6",
      "_ _ _ | _ 1",
    ],
  },

  {
    key: "sundarban-shovon-chair-92",
    coachNo: "S_CHAIR-92",
    coachType: "Broad Gauge (BG)",
    coachClass: "Shovon Chair",
    from: "Khulna",
    to: "Dhaka",
    seats: 92,
    splitRow: 10,
    source: "Sundarban / Chitra / Benapole Express seat plan — Shovon Chair.",
    trains: [725, 726, 763, 764, 795, 796],
    rows: [
      "_ _ _ | _ 1",
      "2 3 4 | 5 6",
      "7 8 9 | 10 11",
      "12 13 14 | 15 16",
      "17 18 19 | 20 21",
      "22 23 24 | 25 26",
      "27 28 29 | 30 31",
      "32 33 34 | 35 36",
      "37 38 39 | 40 41",
      "42 43 44 | 45 46",
      "_ _ _ | _ _",
      "47 48 49 | 50 51",
      "52 53 54 | 55 56",
      "57 58 59 | 60 61",
      "62 63 64 | 65 66",
      "67 68 69 | 70 71",
      "72 73 74 | 75 76",
      "77 78 79 | 80 81",
      "82 83 84 | 85 86",
      "87 88 89 | 90 91",
      "_ _ _ | _ 92",
    ],
  },

  {
    key: "sundarban-snigdha-80",
    coachNo: "SNIGDHA-80",
    coachType: "Broad Gauge (BG)",
    coachClass: "Snigdha",
    from: "Khulna",
    to: "Dhaka",
    seats: 80,
    splitRow: 8,
    source: "Sundarban / Chitra / Benapole Express seat plan — Snigdha.",
    trains: [725, 726, 763, 764, 795, 796],
    rows: [
      "1 2 3 | 4 5",
      "6 7 8 | 9 10",
      "11 12 13 | 14 15",
      "16 17 18 | 19 20",
      "21 22 23 | 24 25",
      "26 27 28 | 29 30",
      "31 32 33 | 34 35",
      "36 37 38 | 39 40",
      "_ _ _ | _ _",
      "41 42 43 | 44 45",
      "46 47 48 | 49 50",
      "51 52 53 | 54 55",
      "56 57 58 | 59 60",
      "61 62 63 | 64 65",
      "66 67 68 | 69 70",
      "71 72 73 | 74 75",
      "76 77 78 | 79 80",
    ],
  },

  {
    key: "rupsha-shovon-chair-92",
    coachNo: "S_CHAIR-92",
    coachType: "Broad Gauge (BG)",
    coachClass: "Shovon Chair",
    seats: 92,
    splitRow: 10,
    source:
      "Total seat 92 — Rupsha / Simanta / Kapotaksha / Sagardari. Three seats one side, two the other; window " +
      "and corridor seats marked per seat; the second half faces the opposite way.",
    trains: [727, 728, 747, 748, 715, 716, 761, 762],
    rows: [
      "_ _ _ | _ 92w",
      "91w 90 89c | 88c 87w",
      "86w 85 84c | 83c 82w",
      "81w 80 79c | 78c 77w",
      "76w 75 74c | 73c 72w",
      "71w 70 69c | 68c 67w",
      "66w 65 64c | 63c 62w",
      "61w 60 59c | 58c 57w",
      "56w 55 54c | 53c 52w",
      "51w 50 49c | 48c 47w",
      "46w 45 44c | 43c 42w",
      "41w 40 39c | 38c 37w",
      "36w 35 34c | 33c 32w",
      "31w 30 29c | 28c 27w",
      "26w 25 24c | 23c 22w",
      "21w 20 19c | 18c 17w",
      "16w 15 14c | 13c 12w",
      "11w 10 9c | 8c 7w",
      "6w 5 4c | 3c 2w",
      "_ _ _ | _ 1w",
    ],
  },

  /* ---------------- Sources that name no train: drafts ---------------- */

  {
    key: "ptinka-mg-snigdha-55",
    coachNo: "PTINKA-MG-SNIGDHA-55",
    coachType: "Indonesian PT Inka MG",
    coachClass: "Snigdha",
    from: "Lalmonirhat / Kaunia / Chattogram / Sylhet / Mymensingh",
    to: "Dhaka / Rangpur",
    seats: 55,
    splitRow: 7,
    source:
      "Indonesian PT Inka MG coach, AC chair, and the New PT Inka Snigdha plan — the same coach. The two " +
      "diagrams disagree on seats 44 and 45; this follows the one that marks window and corridor seats. " +
      ROUTE_ONLY,
    trains: [],
    rows: [
      "1w _ | 2c 3w",
      "7w 6c | 4c 5w",
      "9w 8c | 10c 11w",
      "15w 14c | 12c 13w",
      "17w 16c | 18c 19w",
      "23w 22c | 20c 21w",
      "25w 24c | 26c 27w",
      "_ _ | _ _",
      "30w 31c | 28c 29w",
      "33w 32c | 34c 35w",
      "39w 38c | 36c 37w",
      "41w 40c | 42c 43w",
      "47w 46c | 45c 44w",
      "49w 48c | 50c 51w",
      "53w 52c | _ 54w",
      "_ _ | _ 55w",
    ],
  },

  {
    key: "ptinka-mg-shovon-chair-60",
    coachNo: "PTINKA-MG-S_CHAIR-60",
    coachType: "Indonesian PT Inka MG",
    coachClass: "Shovon Chair",
    from: "Lalmonirhat / Kaunia / Chattogram / Sylhet / Mymensingh",
    to: "Dhaka / Rangpur",
    seats: 60,
    splitRow: 9,
    source: `Indonesian PT Inka MG coach, Shovon Chair (two matching diagrams). ${ROUTE_ONLY}`,
    trains: [],
    rows: [
      "_ _ | _ 1w",
      "3w 4c | _ 2w",
      "5w 6c | 8c 7w",
      "11w 12c | 10c 9w",
      "13w 14c | 16c 15w",
      "19w 20c | 18c 17w",
      "21w 22c | 24c 23w",
      "27w 28c | 26c 25w",
      "29w 30c | 32c 31w",
      "_ _ | _ _",
      "35w 36c | 34c 33w",
      "37w 38c | 40c 39w",
      "43w 44c | 42c 41w",
      "45w 46c | 48c 47w",
      "51w 52c | 50c 49w",
      "53w 54c | 56c 55w",
      "59w _ | 58c 57w",
      "60w _ | _ _",
    ],
  },

  {
    key: "mg-white-redgreen-ac-55",
    coachNo: "MG-AC_CHAIR-55",
    coachType: "MG (White / Red-Green)",
    coachClass: "AC Chair",
    from: "Mymensingh / Sylhet / Kaunia / Chattogram",
    to: "Dhaka / Rangpur",
    seats: 55,
    splitRow: 7,
    source: `White & Red-Green MG (AC) seat plan. ${ROUTE_ONLY}`,
    trains: [],
    rows: [
      "3 _ | 2 1",
      "7 6 | 5 4",
      "11 10 | 9 8",
      "15 14 | 13 12",
      "19 18 | 17 16",
      "23 22 | 21 20",
      "27 26 | 25 24",
      "_ _ | _ _",
      "31 30 | 29 28",
      "35 34 | 33 32",
      "39 38 | 37 36",
      "43 42 | 41 40",
      "47 46 | 45 44",
      "51 50 | 49 48",
      "54 53 | _ 52",
      "_ _ | _ 55",
    ],
  },

  {
    key: "mg-ac-cabin-33",
    coachNo: "MG-AC_CABIN-33",
    coachType: "PT Inka MG (Red-Green / White)",
    coachClass: "AC Cabin",
    from: "Mymensingh / Sylhet / Kaunia / Chattogram",
    to: "Dhaka / Rangpur",
    seats: 33,
    source:
      "PT Inka MG red-green & white MG AC cabin — 33 seats by day, 18 berths by night, corridor along one " +
      "side. A passenger's post confirms the window seats (1, 4, 7 … 31) and the lower berths. " +
      ROUTE_ONLY,
    trains: [],
    rows: [
      "31 32 33 _",
      "28 29 30 _",
      "_",
      "25 26 27 _",
      "_",
      "22 23 24 _",
      "_",
      "19 20 21 _",
      "16 17 18 _",
      "_",
      "13 14 15 _",
      "10 11 12 _",
      "_",
      "7 8 9 _",
      "_",
      "4 5 6 _",
      "1 2 3 _",
    ],
    seatNotes: notes(
      [[1, 3], "Lower berth 1 · cabin with berths 1–2"],
      [[4, 6], "Lower berth 2 · cabin with berths 1–2"],
      [[7, 9], "Berths 3 lower, 4 upper · single cabin"],
      [[10, 12], "Berths 5 lower, 6 upper · double cabin with berths 5–8"],
      [[13, 15], "Berths 7 lower, 8 upper · double cabin with berths 5–8"],
      [[16, 18], "Berths 9 lower, 10 upper · double cabin with berths 9–12"],
      [[19, 21], "Berths 11 lower, 12 upper · double cabin with berths 9–12"],
      [[22, 24], "Berths 13 lower, 14 upper · single cabin"],
      [[25, 27], "Berths 15 lower, 16 upper · single cabin"],
      [[28, 30], "Lower berth 17 · cabin with berths 17–18"],
      [[31, 33], "Lower berth 18 · cabin with berths 17–18"]
    ),
  },

  {
    key: "mg-chair-60-syl-mym-ctg",
    coachNo: "MG-CHAIR-60 (SYL/MYM/CTG)",
    coachType: "Meter Gauge (MG)",
    coachClass: null,
    from: "Sylhet / Mymensingh / Chattogram",
    to: "Dhaka",
    seats: 60,
    splitRow: 9,
    source: `Chair coach with tables, Sylhet / Mymensingh / Chattogram – Dhaka. Class not stated. ${ROUTE_ONLY}`,
    trains: [],
    rows: [
      "_ _ | _ 1",
      "4 3 | _ 2",
      "8 7 | 6 5",
      "12 11 | 10 9",
      "16 15 | 14 13",
      "20 19 | 18 17",
      "24 23 | 22 21",
      "28 27 | 26 25",
      "32 31 | 30 29",
      "_ _ | _ _",
      "36 35 | 34 33",
      "40 39 | 38 37",
      "44 43 | 42 41",
      "48 47 | 46 45",
      "52 51 | 50 49",
      "56 55 | 54 53",
      "59 _ | 58 57",
      "60 _ | _ _",
    ],
  },

  {
    key: "chair-60-dhaka-chittagong",
    coachNo: "CHAIR-60 (DHAKA–CTG)",
    coachType: "Meter Gauge (MG)",
    coachClass: null,
    from: "Dhaka",
    to: "Chittagong",
    seats: 60,
    splitRow: 9,
    source: "Dhaka–Chittagong chair coach. Neither the trains nor the class are stated, so it is kept as a draft.",
    trains: [],
    rows: [
      "_ _ | _ 60",
      "_ _ | _ 59",
      "57 58 | 55 56",
      "53 54 | 51 52",
      "49 50 | 47 48",
      "45 46 | 43 44",
      "41 42 | 39 40",
      "37 38 | 35 36",
      "33 34 | 31 32",
      "29 30 | 27 28",
      "25 26 | 23 24",
      "21 22 | 19 20",
      "17 18 | 15 16",
      "13 14 | 11 12",
      "9 10 | 7 8",
      "5 6 | 3 4",
      "2 _ | _ _",
      "1 _ | _ _",
    ],
  },

  {
    key: "lhb-ac-chair-78",
    coachNo: "LHB-AC_CHAIR-78",
    coachType: "LHB",
    coachClass: "AC Chair",
    from: "Rajshahi / Khulna",
    to: "Dhaka",
    seats: 78,
    splitRow: 8,
    source:
      "L.H.B AC chair, Rajshahi / Khulna – Dhaka. Numbered differently from the Snigdha coach on the Silk " +
      `City station board, so it is not assumed to be that coach. ${ROUTE_ONLY}`,
    trains: [],
    rows: [
      "1 2 _ | 3 4",
      "5 6 7 | 8 9",
      "10 11 12 | 13 14",
      "15 16 17 | 18 19",
      "20 21 22 | 23 24",
      "25 26 27 | 28 29",
      "30 31 32 | 33 34",
      "35 36 37 | 38 39",
      "_ _ _ | _ _",
      "40 41 42 | 43 44",
      "45 46 47 | 48 49",
      "50 51 52 | 53 54",
      "55 56 57 | 58 59",
      "60 61 62 | 63 64",
      "65 66 67 | 68 69",
      "70 71 72 | 73 74",
      "75 76 _ | 77 78",
    ],
  },

  {
    key: "berth-plates-40",
    coachNo: "BERTH-PLATES-40",
    coachType: null,
    coachClass: null,
    seats: 40,
    source:
      "Photographs of cabin door plates (berth and seat numbers) from an unnamed coach. Seats 17–24 were not " +
      "photographed and are inferred from the numbering; the coach may have more than 40 seats. Train, type " +
      "and class are unknown.",
    trains: [],
    rows: [
      "_ 1 2 3 4",
      "_",
      "_ 5 6 7 8",
      "_",
      "_ 9 10 11 12",
      "_",
      "_ 13 14 15 16",
      "_",
      "_ 17 18 19 20",
      "_ 21 22 23 24",
      "_",
      "_ 25 26 27 28",
      "_ 29 30 31 32",
      "_",
      "_ 33 34 35 36",
      "_",
      "_ 37 38 39 40",
    ],
    seatNotes: notes(
      [[1, 4], "Berth 1"],
      [[5, 8], "Berths 2–3"],
      [[9, 12], "Berths 4–5"],
      [[13, 16], "Berths 6–7"],
      [[17, 24], "Not on the photographs — inferred (berths 8–11)"],
      [[25, 32], "Berths 12–15"],
      [[33, 36], "Berths 16–17"],
      [[37, 40], "Berths 18–19"]
    ),
  },
];

/**
 * Default coach line-ups, front to back, for every train with a plan.
 *
 * The Silk City / Padma / Dhumketu rake is the one the station board shows.
 * The others reuse the train's own plans until the rake reaches 500 seats; a
 * coach is a pointer to a plan, so ten AC Chair coaches share one layout.
 */
const RAKES = [
  {
    trains: [753, 754, 759, 760, 769, 770],
    coaches: [
      ["KA", "lhb-board-ac-cabin-48"],
      ["KHA", "lhb-board-ac-cabin-48"],
      ["GA", "lhb-board-ac-cabin-48"],
      ["GHA", "lhb-board-snigdha-78"],
      ["UMA", "lhb-board-snigdha-78"],
      ...["CHA", "SCHA", "JA", "JHA", "NEO", "TA", "THA", "DA"].map((code) => [code, "lhb-board-shovon-chair-105"]),
    ],
  },
  {
    trains: [705, 706, 757, 758],
    coaches: [
      ["KA", "ekota-ac-chair-80"],
      ["KHA", "ekota-ac-chair-80"],
      ["GA", "ekota-cabin-48"],
      ...["GHA", "UMA", "CHA", "SCHA", "JA", "JHA"].map((code) => [code, "ekota-shovon-chair-92"]),
    ],
  },
  {
    trains: [725, 726, 763, 764, 795, 796],
    coaches: [
      ...["KA", "KHA", "GA"].map((code) => [code, "sundarban-snigdha-80"]),
      ...["GHA", "UMA", "CHA", "SCHA", "JA", "JHA"].map((code) => [code, "sundarban-shovon-chair-92"]),
    ],
  },
  {
    trains: [727, 728, 747, 748, 715, 716, 761, 762],
    coaches: ["KA", "KHA", "GA", "GHA", "UMA", "CHA"].map((code) => [code, "rupsha-shovon-chair-92"]),
  },
  {
    // The cabin-fitted coach is two plans — its chair and cabin sections — so
    // it appears as KA and KA-CABIN.
    trains: [755, 756],
    coaches: [
      ["KA", "madhumati-chair-41"],
      ["KA-CABIN", "madhumati-cabin-24"],
      ...["KHA", "GA", "GHA", "UMA", "CHA"].map((code) => [code, "vacuum-shovon-104"]),
    ],
  },
  {
    trains: [733, 734],
    coaches: [
      ["KA", "titumir-cabin-24"],
      ...["KHA", "GA", "GHA", "UMA", "CHA"].map((code) => [code, "vacuum-shovon-104"]),
    ],
  },
  {
    trains: [783, 784, 731, 732, 779, 780, 775, 776, 57, 58, 77, 78],
    coaches: ["KA", "KHA", "GA", "GHA", "UMA"].map((code) => [code, "vacuum-shovon-104"]),
  },
  {
    trains: [709, 710, 701, 702, 787, 788, 704, 703, 741, 742],
    coaches: ["KA", "KHA", "GA", "GHA", "UMA", "CHA", "SCHA", "JA", "JHA", "NEO"].map((code) => [code, "mg-ac-chair-55"]),
  },
];

module.exports = { LAYOUTS, RAKES };
