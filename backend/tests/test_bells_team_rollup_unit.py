"""A team's totals include the teams under it (routes/bells.py)."""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes.bells import _aggregate_teams_from_enriched  # noqa: E402

PARENT = {"leader_id": "p", "leader_name": "Example Parent", "team_name": "Parent Team"}
CHILD = {"leader_id": "c", "leader_name": "Example Child", "team_name": "Child Team"}


def _entry(uid, sales, teams):
    return {"user_id": uid, "total_sales": sales, "days": [{"status": "in", "over30": sales}],
            "teams": teams, "primary_team": teams[0] if teams else None}


def test_sub_team_counts_in_the_parent_team():
    entries = [
        _entry("p", 5, [PARENT]),
        _entry("c", 4, [CHILD, PARENT]),
        _entry("x", 3, [CHILD, PARENT]),
        _entry("m", 9, []),                      # no team: in neither
    ]
    by = {t["team_name"]: t for t in _aggregate_teams_from_enriched(entries, {}, -1)}
    assert by["Parent Team"]["total_sales"] == 12 and by["Parent Team"]["member_count"] == 3
    assert by["Child Team"]["total_sales"] == 7 and by["Child Team"]["member_count"] == 2
