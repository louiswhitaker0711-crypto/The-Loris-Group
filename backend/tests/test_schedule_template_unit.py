"""The Owner's office week: lanes, who sits in which, and reminder targeting."""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.schedule_template import VERTEX_WEEK, block_groups, stage_num, user_group  # noqa: E402
from core.schedule_reminders import _block_match, _reminder_minutes, _when  # noqa: E402


def _mins(t):
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def test_week_is_monday_to_saturday_and_well_formed():
    assert {b["day_of_week"] for b in VERTEX_WEEK} == {0, 1, 2, 3, 4, 5}
    for b in VERTEX_WEEK:
        assert _mins(b["end_time"]) > _mins(b["start_time"]), b
        assert b["groups"], b


def test_lanes_never_double_book():
    for day in range(6):
        for lane in ("s4", "ld", "s2", "s1"):
            spans = sorted((_mins(b["start_time"]), _mins(b["end_time"]))
                           for b in VERTEX_WEEK if b["day_of_week"] == day and lane in b["groups"])
            for (s1, e1), (s2, _) in zip(spans, spans[1:]):
                assert s2 >= e1, (day, lane, spans)


def test_every_day_ends_in_the_field():
    for day in range(6):
        last = max((b for b in VERTEX_WEEK if b["day_of_week"] == day), key=lambda b: _mins(b["start_time"]))
        assert last["title"] == "Field" and set(last["groups"]) == {"s4", "ld", "s2", "s1"}
        # Monday to Friday 13:30 to 20:00; Saturday is the short day.
        assert (last["start_time"], last["end_time"]) == (("10:00", "17:00") if day == 5 else ("13:30", "20:00"))


def test_the_office_morning_runs_to_the_owners_timetable():
    for day in range(5):
        blocks = {b["title"]: b for b in VERTEX_WEEK if b["day_of_week"] == day}
        # The planning meeting starts at 09:00 on Monday, 09:30 otherwise.
        assert blocks["Planning meeting"]["start_time"] == ("09:00" if day == 0 else "09:30")
        assert set(blocks["Planning meeting"]["groups"]) == {"s4", "ld"}
        assert blocks["Sector leaders meeting"]["start_time"] == "10:00"
        # 10:30 is the goals meeting on Monday and COD workshops the other days.
        slot = blocks["Goals meeting" if day == 0 else "COD workshops"]
        assert slot["start_time"] == "10:30" and len(slot["groups"]) == 4
        assert ("COD workshops" in blocks) is (day != 0)
        assert blocks["Primetime"]["start_time"] == "11:00" and len(blocks["Primetime"]["groups"]) == 4
        assert (blocks["Morning Meeting"]["start_time"], blocks["Morning Meeting"]["end_time"]) == ("11:45", "12:15")


def test_saturday_is_sectors_then_the_field():
    sat = [b for b in VERTEX_WEEK if b["day_of_week"] == 5]
    assert [(b["title"], b["start_time"], b["end_time"]) for b in sat] == [
        ("Sectors", "09:00", "09:30"), ("Field", "10:00", "17:00"),
    ]


def test_stage_and_role_place_people_in_lanes():
    assert stage_num("stage_3_plus") == 3.5
    assert user_group("admin") == "s4"
    assert user_group("leader", "stage_5") == "s4"
    assert user_group("leader", "stage_3_plus") == "ld"
    assert user_group("leader") == "ld"
    assert user_group("trainee", "stage_2") == "s2"
    assert user_group("trainee", "stage_1") == "s1"
    assert user_group("trainee") == "s1"


def test_old_blocks_get_lanes_from_audience():
    assert block_groups({"audience": "all"}) == ["s4", "ld", "s2", "s1"]
    assert block_groups({"audience": "trainees"}) == ["s2", "s1"]
    assert block_groups({"audience": "personal"}) == []


def test_reminders_follow_lanes():
    sectors = {"audience": "all", "groups": ["s4", "ld"]}
    assert _block_match(sectors, "leader", "u1", "stage_3")
    assert not _block_match(sectors, "trainee", "u2", "stage_1")
    mine = {"audience": "personal", "owner_id": "u2"}
    assert _block_match(mine, "trainee", "u2", None)
    assert not _block_match(mine, "admin", "u1", None)


def test_reminder_minutes():
    assert _reminder_minutes({}) == 5                       # older blocks
    assert _reminder_minutes({"reminder_minutes": None}) is None
    assert _reminder_minutes({"reminder_minutes": 30}) == 30
    assert _when(0) == "Starting now"
    assert _when(60) == "Starting in 1 hr"
    assert _when(1440) == "Tomorrow"
