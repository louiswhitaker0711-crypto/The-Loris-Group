"""Area history: postcodes are tidied the UK way, a BA's day is rolled up by
street and postcode, and districts compare fairly (sign-ups per 100 doors).
Placeholder streets and names only."""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.areas import clean_pc, district, district_detail, districts, lookup, postcode_sector  # noqa: E402
from core.field_days import FIELD_DAY_VERSION, summarise_ba_day  # noqa: E402


def test_postcodes_are_tidied_into_district_and_sector():
    assert clean_pc(" ls61ab ") == "LS6 1AB"
    assert clean_pc("sw1a 2aa") == "SW1A 2AA"
    assert district("LS6 1AB") == "LS6" and district("ls6") == "LS6"
    assert postcode_sector("LS6 1AB") == "LS6 1" and postcode_sector("LS6") == ""


def _door(ts, state="lost", how=None):
    return {"created_at": ts, "state": state, "lost_state": how}


def test_a_day_is_rolled_up_by_street_and_postcode():
    payload = {
        "ba": {"id": 7, "full_name": "Ayo Example"}, "sector": {"id": 1},
        "hero": {"doors_knocked": 4, "sales": 1, "first_knock_at": "2026-10-05T13:30:00Z", "last_knock_at": "2026-10-05T15:00:00Z"},
        "laps": [{"number": 1, "interactions_by_address": [
            {"street_name": "Example Road", "postal_code": "ls6 1ab", "city": "Leeds",
             "interactions": [_door("2026-10-05T13:30:00Z", "won"), _door("2026-10-05T13:40:00Z", "lost", "spoken"), _door(None, None)]},
            {"street_name": "Sample Street", "postal_code": "LS6 2CD", "city": "Leeds",
             "interactions": [_door("2026-10-05T14:30:00Z", "lost", "pitched"), _door("2026-10-05T15:00:00Z", "lost")]},
        ]}],
    }
    d = summarise_ba_day(payload, "2026-10-05")
    assert d["v"] == FIELD_DAY_VERSION
    assert d["areas"] == [
        {"pc": "LS6 1AB", "street": "Example Road", "city": "Leeds", "doors": 2, "spoken": 2, "pitched": 1, "sales": 1},
        {"pc": "LS6 2CD", "street": "Sample Street", "city": "Leeds", "doors": 2, "spoken": 1, "pitched": 1, "sales": 0},
    ]


def _day(date, oid, name, *areas):
    return {"date": date, "oid": oid, "name": name, "areas": [
        {"pc": pc, "street": st, "city": "Leeds", "doors": doors, "spoken": 0, "pitched": 0, "sales": sales}
        for pc, st, doors, sales in areas]}


DAYS = [
    _day("2026-10-01", "a", "Ayo Example", ("LS6 1AB", "Example Road", 100, 3), ("LS6 2CD", "Sample Street", 50, 0)),
    _day("2026-10-01", "b", "Bo Example", ("LS6 1AB", "Example Road", 80, 1)),
    _day("2026-10-08", "a", "Ayo Example", ("LS7 3EF", "Test Lane", 120, 6)),
]


def test_districts_are_listed_newest_first_with_a_fair_comparison():
    rows = districts(DAYS, "2026-10-13")
    assert [r["key"] for r in rows] == ["LS7", "LS6"]
    ls6 = rows[1]
    assert (ls6["doors"], ls6["sales"], ls6["days"], ls6["ba_days"]) == (230, 4, 1, 2)
    assert ls6["per_100"] == 1.7 and ls6["pa"] == 2.0
    assert (ls6["last_worked"], ls6["days_since"]) == ("2026-10-01", 12)


def test_a_district_breaks_down_into_sectors_streets_and_visits():
    d = district_detail(DAYS, "ls6", "2026-10-13")
    assert [s["key"] for s in d["sectors"]] == ["LS6 1", "LS6 2"]
    assert d["streets"][0]["street"] == "Example Road" and d["streets"][0]["sales"] == 4
    assert d["visits"] == [{"date": "2026-10-01", "doors": 230, "sales": 4, "people": ["Ayo Example", "Bo Example"]}]


def test_a_typed_postcode_finds_its_district_and_sector():
    r = lookup(DAYS, "ls61zz", "2026-10-13")
    assert (r["postcode"], r["district"]) == ("LS6 1ZZ", "LS6")
    assert r["sector"]["key"] == "LS6 1" and r["sector"]["doors"] == 180
    assert lookup(DAYS, "LS9 9ZZ", "2026-10-13")["district_total"] is None
