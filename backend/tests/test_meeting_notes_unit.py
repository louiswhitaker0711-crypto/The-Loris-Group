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


def test_pdf_storage_id_never_leaves_the_server():
    note = {**_note(["s1"]), "pdf": {"gridfs_id": "abc123", "file_name": "plan.pdf", "file_size": 10}}
    out = mn._public(note, _ba("stage_1"))
    assert out["pdf"] == {"file_name": "plan.pdf", "file_size": 10}
    assert out["title"] == "Meeting" and out["cod_topics"] == []


def test_only_real_pdfs_are_accepted():
    import base64
    import pytest
    from fastapi import HTTPException
    ok = base64.b64encode(b"%PDF-1.4 hello").decode()
    assert mn._decode_pdf("data:application/pdf;base64," + ok).startswith(b"%PDF-")
    with pytest.raises(HTTPException):
        mn._decode_pdf(base64.b64encode(b"<html><script>").decode())


def test_cod_topics_are_checked_against_the_cod():
    import asyncio
    from mongomock_motor import AsyncMongoMockClient
    fake = AsyncMongoMockClient()["t"]
    asyncio.run(fake.coaching_impacts.insert_many([
        {"id": "t1", "title": "Example topic one", "stage": 1},
        {"id": "t3", "title": "Example topic three", "stage": 3},
    ]))
    real_db = mn.db
    mn.db = fake
    try:
        out = asyncio.run(mn.clean_topics(["t3", "nope", "t1", "t3"]))
    finally:
        mn.db = real_db
    assert out == [{"id": "t3", "title": "Example topic three", "stage": 3},
                   {"id": "t1", "title": "Example topic one", "stage": 1}]


def test_recap_prompt_mentions_topics_and_pdf():
    note = {"title": "Goals", "block_title": "Morning meeting", "date": "2026-10-12",
            "cod_topics": [{"id": "t1", "title": "Example topic", "stage": 1}]}
    p = mn.recap_prompt(note, "", True)
    assert "Example topic" in p and "PDF" in p and "Notes:" not in p
