"""BA Academy workbook (routes/academy.py): what a save keeps, and what the
Owner's class card reads from a workbook."""
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes.academy import clean_state, summary, _day, MAX_TEXT  # noqa: E402


def test_keeps_notes_done_and_answers():
    out = clean_state({
        "fields": {"b-v1": "work ethic", "n1": "notes here"},
        "done": {"s1": True, "s2": False},
        "quiz": {"q1": {"0": 2, "1": 1}},
    })
    assert out["fields"] == {"b-v1": "work ethic", "n1": "notes here"}
    assert out["done"] == {"s1": True}
    assert out["quiz"] == {"q1": {"0": 2, "1": 1}}


def test_drops_bad_keys_and_values_without_losing_the_rest():
    out = clean_state({
        "fields": {"ok": "kept", "bad key!": "x", "num": 5, "$where": "x"},
        "done": {"s1": "yes", "s2": True},
        "quiz": {"q1": {"0": True, "x": 1, "1": 99, "2": 3}, "q2": "nope"},
    })
    assert out["fields"] == {"ok": "kept"}
    assert out["done"] == {"s2": True}
    assert out["quiz"] == {"q1": {"2": 3}}


def test_long_notes_are_trimmed_not_refused():
    out = clean_state({"fields": {"n1": "a" * (MAX_TEXT + 50)}})
    assert len(out["fields"]["n1"]) == MAX_TEXT


def test_wrong_shapes_are_refused():
    with pytest.raises(HTTPException):
        clean_state([])
    with pytest.raises(HTTPException):
        clean_state({"fields": "text"})
    with pytest.raises(HTTPException):
        clean_state({"fields": {f"k{i}": "x" for i in range(1000)}})


def test_only_day_1_and_2():
    assert _day(1) == 1 and _day(2) == 2
    with pytest.raises(HTTPException):
        _day(3)


def test_summary_reads_questions_and_progress():
    s = summary({"fields": {"questions": "  How do I get my UTR?  ", "n1": "x"},
                 "done": {"s1": True}, "quiz": {"q1": {"0": 1}}, "updated_at": "t"})
    assert s == {"done": {"s1": True}, "quiz": {"q1": {"0": 1}},
                 "questions": "How do I get my UTR?", "updated_at": "t"}
    assert summary(None)["questions"] == ""
