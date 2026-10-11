"""The owner's "What Good Looks Like" weekly bands and the earned-title
display names — the numbers and words every weekly green count and every
Stage 4/5 report read.

    Super Green 20+ · Green 15–19 · Amber 8–14 · Red under 8
    (a Green Week is Green or better)
"""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core import week_bands as wb  # noqa: E402


def test_bands_follow_the_traffic_light_system():
    assert [wb.week_band(n) for n in (0, 7, 8, 14, 15, 19, 20, 35)] == [
        "red", "red", "amber", "amber", "green", "green", "super_green", "super_green",
    ]
    assert wb.week_band(None) == "red"
    assert wb.is_green_week(15) and wb.is_green_week(20)
    assert not wb.is_green_week(14)
    assert wb.RED_EXIT_WEEK_SALES == 8  # 8 sign-ups in a week takes you out of the red zone


def test_every_green_week_reads_the_one_threshold():
    from core import achievements, sales_path
    assert sales_path.GREEN_WEEK_SALES == wb.GREEN_WEEK_SALES == 15
    assert achievements.PERSONAL_WEEK_TIERS[0] == (15, "personal_12")
    # Ramp: Amber, out of the red zone, Green, Super Green.
    assert sales_path.DEFAULT_RAMP_TARGETS == [8, 8, 15, 20]
    bells_src = (BACKEND_DIR / "routes" / "bells.py").read_text(encoding="utf-8")
    assert ">= 12:" not in bells_src
    assert bells_src.count(">= GREEN_WEEK_SALES") == 3


def test_earned_titles_show_the_owners_stage_names_but_keep_stored_values():
    from core import team_leader as tl
    assert tl.display_title("Team Leader") == "Stage 4 · Crew Leadership"
    assert tl.display_title("Assistant Owner") == "Stage 5 · Assistant Ownership"
    assert tl.display_title("Owner") == "Stage 6 · Owner"
    assert tl.display_title("Something Custom") == "Something Custom"
    assert tl.display_title(None) is None
    # Stored values (users.title) are unchanged, so existing data still matches.
    assert [t["title"] for t in tl.TITLE_TIERS] == ["Assistant Owner", "Team Leader"]
    assert tl.UNEARNED_TITLES == ("Owner",)
    # The owner's first-gen shape: 4 for Stage 5, 2 for Stage 4.
    assert [t["leaders"] for t in tl.TITLE_TIERS] == [4, 2]
    assert [t["sales"] for t in tl.TITLE_TIERS] == [
        tl.STAGE_5_TEAM_WEEK_SIGN_UPS, tl.STAGE_4_TEAM_WEEK_SIGN_UPS,
    ]
    assert tl.earned_title(4, tl.STAGE_5_TEAM_WEEK_SIGN_UPS) == "Assistant Owner"
    assert tl.earned_title(3, tl.STAGE_5_TEAM_WEEK_SIGN_UPS) == "Team Leader"
    assert tl.earned_title(1, 1000) is None
