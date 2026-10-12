"""Meeting recaps are for the people the meeting is for, and everyone above
them: advancing to Stage 3 opens every Coaches recap; Stage 1 recaps stay
readable as people move up. Raw notes stay with Coaches and the Owner."""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes import meeting_notes as mn  # noqa: E402

OFFICE = "office-a"


def _note(groups, status="published", office=OFFICE):
    return {"office_id": office, "groups": groups, "min_rank": mn.min_rank(groups), "status": status,
            "raw_notes": "notes", "recap": "recap"}


def _ba(stage):
    return {"id": "u", "role": "trainee", "owneriq_stage": stage, "office_id": OFFICE}


def test_a_recap_is_for_its_lanes_and_everyone_above():
    coaches = _note(["ld"])
    stage1 = _note(["s1"])
    assert not mn.can_read(_ba("stage_1"), coaches)
    assert not mn.can_read(_ba("stage_2"), coaches)
    assert mn.can_read(_ba("stage_3"), coaches)          # advanced → sees Coaches recaps
    assert mn.can_read(_ba("stage_3"), stage1)           # and the earlier ones
    assert mn.can_read(_ba("stage_1"), stage1)
    assert mn.can_read(_ba("stage_1"), _note(["s4", "ld", "s2", "s1"]))   # everyone


def test_drafts_and_other_offices_stay_hidden():
    assert not mn.can_read(_ba("stage_3"), _note(["s1"], status="draft"))
    assert not mn.can_read(_ba("stage_3"), _note(["s1"], office="office-b"))
    coach = {"id": "c", "role": "leader", "office_id": OFFICE}
    assert mn.can_read(coach, _note(["s1"], status="draft"))


def test_raw_notes_only_for_writers():
    note = _note(["s1"])
    assert "raw_notes" not in mn._public(note, _ba("stage_1"))
    assert "raw_notes" in mn._public(note, {"id": "a", "role": "admin", "office_id": OFFICE})
