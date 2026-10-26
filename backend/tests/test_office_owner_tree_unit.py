"""Viewers and the public Bells link see the spider from the Owner
(routes/training_routes.py: office_owner_doc, public tree has no contacts)."""
import asyncio
import sys
from pathlib import Path

from bson import ObjectId
from mongomock_motor import AsyncMongoMockClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes import training_routes as tr  # noqa: E402


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_owner_is_the_super_admin_never_a_viewer(monkeypatch):
    db = AsyncMongoMockClient()["owner_tree_test"]
    monkeypatch.setattr(tr, "db", db)
    viewer, owner = ObjectId(), ObjectId()
    _run(db.users.insert_many([
        {"_id": viewer, "name": "Viewer Example", "role": "admin", "office_id": "o1", "is_viewer": True, "is_demo": True},
        {"_id": owner, "name": "Owner Example", "role": "admin", "office_id": "o1", "is_super_admin": True},
    ]))
    got = _run(tr.office_owner_doc("o1"))
    assert got["_id"] == owner
    assert _run(tr.office_owner_doc(None)) is None


def test_public_tree_has_no_contact_details():
    node = {"id": "1", "email": "a@example.org", "phone": "0", "children": [
        {"id": "2", "email": "b@example.org", "phone": "1", "children": []}]}
    out = tr._strip_contacts(node)
    assert "email" not in out and "phone" not in out
    assert "email" not in out["children"][0] and "phone" not in out["children"][0]
