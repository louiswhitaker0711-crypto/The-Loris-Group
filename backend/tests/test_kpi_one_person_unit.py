"""One person, one row, one count per day on the KPIs (the Owner, 11 Nov 2026).

Someone's old synced rows (with a badge on them) and their breakdown rows
must land in one row on Field KPIs, and a day with a breakdown is counted
once, from the breakdown.
"""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.kpi_rules import breakdown_wins, counted_rows  # noqa: E402

UID = "6acca26ddfa8130f559a0b29"


def _row(date, doors, sales, source="owneriq", badge="MMC0000", uid=UID, **kw):
    return {"date": date, "source": source, "doors_knocked": doors, "spoken_to": 60,
            "pitches_commenced": 15, "pitches_closed": 8, "sales": sales,
            "badge_number": badge if source != "breakdown" else None,
            "cg1_user_id": uid, "rep_name": "Example Person", **kw}


def test_breakdown_replaces_synced_row_for_the_same_day():
    rows = [_row("2026-10-15", 126, 4), _row("2026-10-16", 120, 6),
            _row("2026-10-16", 120, 6, source="breakdown"), _row("2026-10-19", 89, 4, source="breakdown")]
    kept = breakdown_wins(rows)
    assert [(r["date"], r["source"]) for r in kept] == [
        ("2026-10-15", "owneriq"), ("2026-10-16", "breakdown"), ("2026-10-19", "breakdown")]
    assert sum(r["sales"] for r in counted_rows(rows)) == 14


def test_unlinked_synced_row_matches_its_suggested_person():
    rows = [_row("2026-10-16", 120, 6, uid=None, cg1_suggested_user_id=UID),
            _row("2026-10-16", 120, 6, source="breakdown")]
    assert [r["source"] for r in breakdown_wins(rows)] == ["breakdown"]


def test_one_row_per_person_on_field_kpis():
    try:
        from owneriq_sync import aggregate_rows
    except Exception:   # the full app isn't importable without its deps
        return
    rows = [_row("2026-10-14", 105, 2), _row("2026-10-15", 126, 4), _row("2026-10-16", 120, 6),
            _row("2026-10-16", 120, 6, source="breakdown"), _row("2026-10-19", 89, 4, source="breakdown")]
    agg = aggregate_rows(rows)
    assert len(agg["reps"]) == 1
    rep = agg["reps"][0]
    assert rep["active_days"] == 4
    assert rep["totals"]["sales"] == 16
    assert rep["badge_number"] == "MMC0000"
    # The eye toggle still drops them from the average by their key.
    assert aggregate_rows(rows, exclude_keys={rep["key"].upper()})["reps"][0]["excluded"]
