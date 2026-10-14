"""OwnerIQ off: the breakdown is the day's record and fills Bells, and the
Owner's WhatsApp paste wins over it."""
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.breakdown_numbers import bells_day_writable, bells_values, kpi_row  # noqa: E402
from routes.sector import clean_breakdown  # noqa: E402


def test_signups_are_silver_plus_gold_and_round_is_capped():
    bd = clean_breakdown({"doors": "110", "silver": "2", "gold": "1", "round": "5", "hit": "9"})
    assert bd["hit"] == 3 and bd["round"] == 3
    assert clean_breakdown({"hit": "2"})["hit"] == 2          # no split typed: hit as typed


def test_bells_values():
    assert bells_values({"silver": 2, "gold": 1, "round": 2}) == {"under30": 2, "over30": 1, "memberships": 2, "status": "in"}
    assert bells_values({"doors": 90}) == {"under30": 0, "over30": 0, "memberships": 0, "status": "in"}   # out, no sign-ups
    assert bells_values({}) is None


def test_paste_wins():
    ours = {"under30": 2, "over30": 1, "memberships": 2}
    assert bells_day_writable({"status": "off"}, None, None)
    assert bells_day_writable({**ours, "status": "in"}, ours, None)                 # still what we wrote
    assert not bells_day_writable({"under30": 2, "over30": 2, "memberships": 2, "status": "in"}, ours, None)  # pasted over
    assert bells_day_writable({"under30": 3, "over30": None, "status": "in"}, None, 3)  # OwnerIQ's, untouched


def test_kpi_row_reads_like_owneriqs():
    row = kpi_row({"_id": "u1", "name": "Example Person", "badge_number": "mmc1"}, "2026-10-14",
                  {"doors": 100, "spoken": 60, "pitched": 20, "closed": 12, "hit": 3}, "39")
    assert row["owneriq_id"] == "bd:u1:2026-10-14" and row["cg1_user_id"] == "u1"
    assert (row["doors_knocked"], row["spoken_to"], row["pitches_commenced"], row["pitches_closed"], row["sales"]) == (100, 60, 20, 12, 3)
    assert row["mc_pin"] == "39" and row["badge_number"] == "MMC1" and row["cg1_matched_by"] != "name"
