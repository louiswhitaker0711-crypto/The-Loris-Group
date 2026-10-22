"""Coaching today: who a Coach is with (routes/coaching_today.py).

Their bunny hop if they're in one, else everyone in their sector; never
themselves, never anyone outside it.
"""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes.coaching_today import people_with, day_label  # noqa: E402

SEC = {"leader_id": "lead", "member_ids": ["coach", "new1", "new2", "ba"],
       "hops": [{"colour": "blue", "member_ids": ["coach", "new1"]},
                {"colour": "red", "member_ids": ["new2", "ba"]}]}


def test_in_a_hop_means_only_the_hop():
    assert people_with(SEC, "coach") == ["new1"]


def test_not_in_a_hop_means_the_whole_sector():
    assert sorted(people_with(SEC, "lead")) == ["ba", "coach", "new1", "new2"]


def test_no_hops_set_means_the_whole_sector():
    sec = {**SEC, "hops": []}
    assert sorted(people_with(sec, "coach")) == ["ba", "lead", "new1", "new2"]


def test_no_sector_means_nobody():
    assert people_with(None, "coach") == []


def test_day_labels():
    assert day_label(1) == "BA Academy Day 1"
    assert day_label(3) == "Field day 1"
    assert day_label(8) == "Field day 6"
