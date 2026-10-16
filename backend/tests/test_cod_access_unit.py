"""COD stages open by OwnerIQ stage (core/cod_access.py): up to your own
stage; 3+ also opens with a Stage 3 on your team; the next stage shows as a
locked teaser. Stored stages: 1, 2, 3, 5 (= 3+), 4, 6 (= Stage 5)."""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.cod_access import unlocked_stages, visible_stages  # noqa: E402
from core.schedule_template import stage_num  # noqa: E402


def test_a_stage_3_opens_1_to_3():
    assert unlocked_stages(stage_num("stage_3"), False) == {1, 2, 3}


def test_a_stage_3_with_a_stage_3_on_the_team_opens_3_plus():
    assert unlocked_stages(stage_num("stage_3"), True) == {1, 2, 3, 5}
    assert unlocked_stages(stage_num("stage_3_plus"), False) == {1, 2, 3, 5}


def test_a_stage_4_opens_up_to_4_and_a_stage_5_opens_everything():
    assert unlocked_stages(stage_num("stage_4"), False) == {1, 2, 3, 5, 4}
    assert unlocked_stages(stage_num("stage_5"), False) == {1, 2, 3, 5, 4}   # the original COD: no Stage 5 items


def test_a_new_ba_opens_stage_1_and_sees_stage_2_as_a_teaser():
    opened = unlocked_stages(stage_num("stage_1"), False)
    assert opened == {1}
    assert visible_stages(opened) == {1, 2}
    assert visible_stages({1, 2, 3}) == {1, 2, 3, 5}
