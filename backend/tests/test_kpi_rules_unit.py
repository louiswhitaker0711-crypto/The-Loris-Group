"""The Owner's KPI rule (core/kpi_rules.py): a day under 10 doors, or with
doors / spoken / pitched / closed all the same (2/2/2/2), doesn't count."""
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.kpi_rules import counted_rows, day_counts  # noqa: E402


def _row(uid, date, d, s, p, c, sales=0):
    return {"cg1_user_id": uid, "badge_number": uid, "date": date, "doors_knocked": d, "spoken_to": s,
            "pitches_commenced": p, "pitches_closed": c, "sales": sales}


def test_which_days_count():
    assert day_counts(120, 70, 25, 15)
    assert day_counts(10, 6, 3, 1)               # 10 doors is enough
    assert not day_counts(9, 6, 3, 1)            # under 10 doors
    assert not day_counts(2, 2, 2, 2)            # filled-in numbers
    assert not day_counts(12, 12, 12, 12)        # all the same, even over 10
    assert not day_counts(None, None, None, None)


def test_a_day_is_judged_on_its_totals():
    rows = [_row("u1", "2026-10-17", 6, 4, 2, 1), _row("u1", "2026-10-17", 6, 3, 1, 0),   # 12 doors in all
            _row("u1", "2026-10-18", 2, 2, 2, 2), _row("u2", "2026-10-17", 5, 3, 1, 1)]
    kept = counted_rows(rows)
    assert len(kept) == 2 and {r["date"] for r in kept} == {"2026-10-17"} and {r["cg1_user_id"] for r in kept} == {"u1"}


def test_field_kpis_leave_those_days_out():
    from owneriq_sync import aggregate_rows
    agg = aggregate_rows([_row("u1", "2026-10-16", 120, 70, 25, 15, 4),
                          _row("u1", "2026-10-17", 2, 2, 2, 2, 1)])
    assert agg["group_totals"]["doors_knocked"] == 120 and agg["group_totals"]["sales"] == 4
    assert agg["avg_per_rep_day"]["doors_knocked"] == 120


def test_my_averages_leave_those_days_out():
    from routes.sector import averages_from
    a = averages_from([{"doors": 120, "spoken": 70, "pitched": 25, "closed": 15, "sales": 4},
                       {"doors": 8, "spoken": 5, "pitched": 2, "closed": 1, "sales": 1}])
    assert a["days"] == 1 and a["per_day"]["doors"] == 120
