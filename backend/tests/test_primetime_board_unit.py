"""Primetime planned as a board of triangles (routes/primetime.py board_rows)."""
import os
import sys
from datetime import date
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes.primetime import board_rows  # noqa: E402
from routes.admin_routes import exit_left_on  # noqa: E402

WK = "2026-11-08"


def test_triangle_puts_watching_left_learning_right_and_the_host_on_top():
    rows = board_rows([{"host_id": "h", "topic": "Rehash", "watching": ["w1"], "learning": ["l1", "l2"]}], WK, 0)
    assert rows["h"]["mode"] == "teaching" and rows["h"]["topic"] == "Rehash"
    assert rows["h"]["with_ids"] == ["w1", "l1", "l2"]
    assert rows["w1"]["mode"] == "watching" and rows["l1"]["mode"] == "learning"
    assert {r["session_id"] for r in rows.values()} == {f"{WK}:0:h"}
    assert rows["l2"]["with_ids"] == ["h"]


def test_pitch_practice_is_a_list_with_its_own_name():
    rows = board_rows([{"host_id": "h", "layout": "list", "learning": ["a", "b"], "watching": ["ignored"]}], WK, 2)
    assert rows["h"]["topic"] == "Pitch practice" and rows["h"]["layout"] == "list"
    assert "ignored" not in rows and rows["a"]["mode"] == "learning"


def test_each_person_once_and_never_in_their_own_corner():
    rows = board_rows([
        {"host_id": "h1", "topic": "Close", "learning": ["a", "h1"]},
        {"host_id": "h2", "topic": "Intro", "watching": ["a"], "learning": ["b"]},
        {"host_id": "a", "topic": "Rehash"},
    ], WK, 1)
    assert rows["a"]["session_id"] == f"{WK}:1:h1"     # first place wins
    assert rows["h1"]["with_ids"] == ["a"]
    assert rows["h2"]["with_ids"] == ["b"]


def test_an_unknown_layout_is_a_triangle():
    assert board_rows([{"host_id": "h", "layout": "spiral"}], WK, 0)["h"]["layout"] == "triangle"


def test_exited_on_a_bells_day_dates_the_exit_that_day():
    today = date(2026, 10, 29)
    assert exit_left_on(None, today) == "2026-10-29"
    assert exit_left_on("2026-10-27", today) == "2026-10-27"
    with pytest.raises(HTTPException):
        exit_left_on("2026-10-30", today)      # not ahead
    with pytest.raises(HTTPException):
        exit_left_on("2026-08-01", today)      # not over 60 days back
