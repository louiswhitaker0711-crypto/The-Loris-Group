"""COD tests a Coach sets: "test me on this".

From the quick sign-off list a Coach picks COD items for a BA to test on.
The BA gets a push and the items sit at the top of "Learn today" on their
Home until they pass that item's quiz (a pass after the request clears it).

Collection `cod_test_requests`:
    {id, office_id, user_id, module_id, module_title, stage, by_id, by_name,
     at, cleared_at}

  POST   /api/cod/test-requests            {user_id, module_ids:[…]}  Coach/Admin who can grade them
  GET    /api/cod/test-requests/mine       the caller's open ones (with pass status worked out)
  GET    /api/cod/test-requests?user_id=   a Coach's view of one BA's
  DELETE /api/cod/test-requests/{id}       the Coach takes one back
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from auth import get_current_user
from database import db

logger = logging.getLogger(__name__)
router = APIRouter()


async def _progress(user_id: str, module_ids: list[str]) -> dict:
    out: dict = {}
    async for p in db.module_progress.find({"module_id": {"$in": module_ids}, "$or": [
            {"target_user_id": user_id}, {"target_user_id": {"$exists": False}, "user_id": user_id}]},
            {"_id": 0, "module_id": 1, "quiz_passed_at": 1, "ladder": 1}):
        out[p["module_id"]] = p
    return out


async def _open_for(user_id: str) -> list[dict]:
    """A user's requests that are still open: not cleared, and no quiz pass
    since the request."""
    reqs = [r async for r in db.cod_test_requests.find({"user_id": user_id, "cleared_at": None}, {"_id": 0}).sort("at", -1)]
    if not reqs:
        return []
    prog = await _progress(user_id, [r["module_id"] for r in reqs])
    out = []
    for r in reqs:
        passed = (prog.get(r["module_id"]) or {}).get("quiz_passed_at")
        if passed and str(passed) >= str(r["at"]):
            await db.cod_test_requests.update_one({"id": r["id"]}, {"$set": {"cleared_at": str(passed)}})
            continue
        out.append(r)
    return out


@router.post("/cod/test-requests")
async def create_test_requests(request: Request):
    from routes.modules import _user_can_grade_target
    user = await get_current_user(request)
    if (user.get("role") or "").lower() not in ("leader", "admin"):
        raise HTTPException(status_code=403, detail="Coaches set the tests")
    body = await request.json()
    target = str(body.get("user_id") or "")
    ids = [str(i) for i in (body.get("module_ids") or [])][:20]
    if not target or not ids:
        raise HTTPException(status_code=400, detail="Pick at least one item")
    mods = [m async for m in db.training_modules.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "title": 1, "topic": 1, "stage": 1})]
    if not mods:
        raise HTTPException(status_code=404, detail="Those items weren't found")
    for m in mods:
        if not await _user_can_grade_target(user, target, int(m.get("stage") or 0)):
            raise HTTPException(status_code=403, detail="You can only set tests for people you coach")
    now = datetime.now(timezone.utc).isoformat()
    made = 0
    for m in mods:
        if await db.cod_test_requests.find_one({"user_id": target, "module_id": m["id"], "cleared_at": None}, {"_id": 1}):
            continue
        await db.cod_test_requests.insert_one({
            "id": str(uuid.uuid4()), "office_id": user.get("office_id"), "user_id": target,
            "module_id": m["id"], "module_title": m.get("title") or m.get("topic") or "", "stage": m.get("stage"),
            "by_id": str(user["id"]), "by_name": user.get("name") or "", "at": now, "cleared_at": None})
        made += 1
    if made:
        try:
            from core.push import send_push_to_user
            first = (user.get("name") or "Your coach").split(" ")[0]
            title = mods[0].get("title") or mods[0].get("topic") or "your COD"
            await send_push_to_user(target, "📝 Test yourself",
                                    f"{first} wants you to test on {title}" + (f" and {made - 1} more" if made > 1 else ""),
                                    {"type": "coaching", "url": "/"})
        except Exception as ex:
            logger.warning("test request push failed: %s", ex)
    return {"created": made}


@router.get("/cod/test-requests/mine")
async def my_test_requests(request: Request):
    user = await get_current_user(request)
    return {"requests": await _open_for(str(user["id"]))}


@router.get("/cod/test-requests")
async def test_requests_for(request: Request, user_id: str):
    from routes.modules import _user_can_grade_target
    user = await get_current_user(request)
    if not await _user_can_grade_target(user, user_id, 1) and not await _user_can_grade_target(user, user_id, 2):
        raise HTTPException(status_code=403, detail="Not your BA")
    return {"requests": await _open_for(user_id)}


@router.delete("/cod/test-requests/{req_id}")
async def delete_test_request(req_id: str, request: Request):
    user = await get_current_user(request)
    r = await db.cod_test_requests.find_one({"id": req_id}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Not found")
    if r.get("by_id") != str(user["id"]) and (user.get("role") or "").lower() != "admin":
        raise HTTPException(status_code=403, detail="Only the Coach who set it can take it back")
    await db.cod_test_requests.update_one({"id": req_id}, {"$set": {"cleared_at": datetime.now(timezone.utc).isoformat()}})
    return {"ok": True}
