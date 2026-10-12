"""Sector set-up and breakdown: the WhatsApp text matches the office's own
layout, inputs are checked, and the next day's KPI suggestion is the step
furthest behind the Law of Averages. Placeholder names only."""
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes import sector as sec  # noqa: E402


def test_breakdown_text_matches_the_office_layout():
    rows = [
        {"user_name": "Alex Example", "breakdown": {"doors": 82, "spoken": 57, "pitched": 20, "closed": 17,
         "note": "phone died", "goal": 3, "hit": 1, "proud": "shorten my pitch", "change": "SEE"}},
        {"user_name": "Sam Example", "breakdown": {"doors": 95, "spoken": 64, "pitched": 20, "closed": 13,
         "goal": 5, "hit": 5, "proud": "good intro", "change": "speak to 80"}},
        {"user_name": "Nobody Yet", "breakdown": None},
    ]
    assert sec.breakdown_text(rows, "2026-10-12") == (
        "*Breakdown* 12/10\n\n*Alex*\n82/57/20/17 (phone died)\nGoal: 3 hit: 1\nProud of: shorten my pitch\nChange: SEE"
        "\n\n*Sam*\n95/64/20/13\nGoal: 5 hit: 5🔥\nProud of: good intro\nChange: speak to 80")


def test_setup_text_matches_the_office_layout():
    rows = [{"user_name": "Alex Example", "setup": {"goal": 4, "kpi_metric": "closes", "kpi_target": 20, "focus": "KISS"}},
            {"user_name": "Sam Example", "setup": {"goal": 4, "kpi_metric": "spoken", "kpi_target": 70, "focus": "handling objections"}}]
    assert sec.setup_text(rows, "2026-10-13") == (
        "*SetUp* 13/10\n\n*Alex*\nGoal: 4\nKPI: 20 closes\n\nFocus: KISS"
        "\n\n*Sam*\nGoal: 4\nKPI: 70 spoken\n\nFocus: handling objections")


def test_kpi_suggestion_is_the_step_furthest_behind():
    assert sec.suggest_kpi({"doors": 101, "spoken": 56, "pitched": 24, "closed": 18}) == {"kpi_metric": "spoken", "kpi_target": 70}
    assert sec.suggest_kpi({"doors": 101, "spoken": 56, "pitched": 14, "closed": 6}) == {"kpi_metric": "closes", "kpi_target": 15}
    assert sec.suggest_kpi({"doors": 130, "spoken": 80, "pitched": 30, "closed": 20}) is None
    assert sec.suggest_kpi(None) is None


def test_inputs_are_checked():
    assert sec.clean_setup({"goal": "4", "kpi_metric": "Closes", "kpi_target": "20", "focus": "  tov "}) == {
        "goal": 4, "kpi_metric": "closes", "kpi_target": 20, "focus": "tov"}
    with pytest.raises(HTTPException):
        sec.clean_setup({"kpi_metric": "vibes"})
    with pytest.raises(HTTPException):
        sec.clean_breakdown({"doors": "lots"})
