"""Coverage marks: lines are tidied and checked, a mark-off is found by the
map view it overlaps, and only its author or an Admin can remove it."""
import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes import coverage as cov  # noqa: E402


def test_lines_are_rounded_and_short_or_foreign_lines_dropped():
    out = cov.clean_lines([[[53.8123456, -1.5612345], [53.8130001, -1.5600009]], [[53.8, -1.5]], [[40.7, -74.0], [40.8, -74.1]]])
    assert out == [[[53.81235, -1.56123], [53.813, -1.56]]]
    with pytest.raises(HTTPException):
        cov.clean_lines([[[53.8, -1.5]]])


class _Req:
    def __init__(self, body=None):
        self._b = body or {}

    async def json(self):
        return self._b


def test_a_mark_off_is_found_in_view_and_only_its_author_or_an_admin_removes_it(monkeypatch):
    from mongomock_motor import AsyncMongoMockClient
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(cov, "db", db)
    who = {"u": {"id": "lead1", "name": "Alex Example", "role": "leader", "office_id": "o1"}}

    async def _user(_r):
        return dict(who["u"])

    monkeypatch.setattr(cov, "require_admin_or_leader", _user)
    run = asyncio.run
    doc = run(cov.save_coverage(_Req({"postcode": "ls6 1ab", "lines": [[[53.81, -1.56], [53.82, -1.55]]]})))
    assert doc["district"] == "LS6" and doc["bbox"] == {"s": 53.81, "w": -1.56, "n": 53.82, "e": -1.55}
    seen = run(cov.coverage_in_view(_Req(), south=53.80, west=-1.57, north=53.815, east=-1.50))["marks"]
    assert [m["id"] for m in seen] == [doc["id"]] and seen[0]["mine"] is True
    assert run(cov.coverage_in_view(_Req(), south=52.0, west=-2.0, north=52.1, east=-1.9))["marks"] == []
    who["u"] = {"id": "lead2", "role": "leader", "office_id": "o1"}
    with pytest.raises(HTTPException):
        run(cov.delete_coverage(doc["id"], _Req()))
    who["u"] = {"id": "boss", "role": "admin", "office_id": "o1"}
    assert run(cov.delete_coverage(doc["id"], _Req()))["deleted"] is True
