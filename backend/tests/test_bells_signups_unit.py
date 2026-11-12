"""Bells is the record of sign-ups: KPIs read each day's sign-ups from Bells
when Bells has them (the Owner, 12 Nov 2026)."""
import asyncio
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import core.bells_signups as bs  # noqa: E402
from core.bells_signups import bells_total  # noqa: E402


def _entry(day, ours=None, idx=3):
    days = [{"under30": None, "over30": None, "status": "off"} for _ in range(7)]
    days[idx] = day
    return {"user_id": "u1", "week_ending": "2026-11-15", "days": days,
            "breakdown_days": {str(idx): ours} if ours else {}}


def test_bells_total():
    thu = "2026-11-12"
    assert bells_total(_entry({"under30": 1, "over30": 2}), thu) == 3
    assert bells_total(_entry({"under30": None, "over30": None}), thu) is None          # nothing typed
    # Still just what the breakdown wrote (a plain hit writes 0/0): the breakdown's hit stays.
    assert bells_total(_entry({"under30": 0, "over30": 0}, {"under30": 0, "over30": 0}), thu) is None
    # Fixed on Bells after the breakdown: Bells wins.
    assert bells_total(_entry({"under30": 1, "over30": 2}, {"under30": 0, "over30": 0}), thu) == 3


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def __aiter__(self):
        self._it = iter(self.docs)
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


class _Coll:
    def __init__(self, docs):
        self.docs = docs

    def find(self, q, proj=None):
        return _Cursor([d for d in self.docs if d["user_id"] in q["user_id"]["$in"]
                        and d["week_ending"] in q["week_ending"]["$in"]])


class _Db:
    def __init__(self, docs):
        self.bells_entries = _Coll(docs)


def test_bells_wins_sets_sales_once(monkeypatch):
    monkeypatch.setattr(bs, "db", _Db([_entry({"under30": 1, "over30": 2}, {"under30": 0, "over30": 0})]))
    rows = [
        {"cg1_user_id": "u1", "date": "2026-11-12", "source": "owneriq", "sales": 0},
        {"cg1_user_id": "u1", "date": "2026-11-12", "source": "breakdown", "sales": 0, "doors_knocked": 134},
        {"cg1_user_id": "u1", "date": "2026-11-11", "source": "breakdown", "sales": 2},   # Bells empty that day
    ]
    out = asyncio.run(bs.bells_wins(rows))
    assert [r["sales"] for r in out] == [0, 3, 2]
    assert rows[1]["sales"] == 0          # the rows passed in aren't changed
