"""A read-only viewer may 'Preview as' a BA or Coach in their own office,
never an Admin, another viewer or another office (auth.viewer_may_preview)."""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from auth import viewer_may_preview  # noqa: E402

V = {"role": "admin", "is_viewer": True, "office_id": "o1"}


def test_ba_and_coach_in_the_office():
    assert viewer_may_preview(V, {"role": "trainee", "office_id": "o1"})
    assert viewer_may_preview(V, {"role": "leader", "office_id": "o1"})


def test_never_admins_viewers_or_other_offices():
    assert not viewer_may_preview(V, {"role": "admin", "office_id": "o1"})
    assert not viewer_may_preview(V, {"role": "leader", "office_id": "o1", "is_super_admin": True})
    assert not viewer_may_preview(V, {"role": "trainee", "office_id": "o1", "is_viewer": True})
    assert not viewer_may_preview(V, {"role": "trainee", "office_id": "o2"})
    assert not viewer_may_preview({**V, "office_id": None}, {"role": "trainee", "office_id": None})
