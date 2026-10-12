"""Written COD quizzes (seed/cod_quizzes.json): every key is a real item on
the Owner's COD sheet, every question is well formed, a written quiz is served
without any AI key, and passing needs all but one right."""
import asyncio
import json
import sys
from pathlib import Path

from mongomock_motor import AsyncMongoMockClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.cod_sheet import sheet_items  # noqa: E402
from routes import modules  # noqa: E402
from routes.modules import QuizSubmit  # noqa: E402

QUIZZES = json.loads((BACKEND_DIR / "seed" / "cod_quizzes.json").read_text(encoding="utf-8"))


def _run(coro):
    return asyncio.run(coro)


def test_every_quiz_is_for_a_real_item_and_well_formed():
    items = {f"{i['stage']}|{i['topic']}" for i in sheet_items()}
    assert len(QUIZZES) > 200
    for key, qs in QUIZZES.items():
        assert key in items, key
        assert 3 <= len(qs) <= 5, key
        for q in qs:
            assert q["question"].strip()
            assert len(q["choices"]) == 4 and len(set(q["choices"])) == 4, q["question"]
            assert 0 <= q["answer"] <= 3


def test_owners_figures_in_the_quizzes():
    loa = QUIZZES["1|Law of Averages"][0]
    assert loa["choices"][loa["answer"]].startswith("120 doors · 70 spoken to · 25 pitched · 15 closed · 4+")


def _setup(monkeypatch):
    db = AsyncMongoMockClient()["t"]
    user = {"id": "u-ba", "role": "trainee", "office_id": "office-A", "owneriq_stage": "stage_1"}

    async def _user(_request):
        return dict(user)

    async def _subtree(uid):
        return [uid]

    async def _badges(*_a, **_k):
        return None

    monkeypatch.setattr(modules, "db", db)
    monkeypatch.setattr(modules, "get_current_user", _user)
    monkeypatch.setattr(modules, "get_subtree_ids", _subtree)
    monkeypatch.setattr(modules, "award_quiz_badges", _badges)
    _run(db.training_modules.insert_one({"id": "m1", "stage": 1, "office_id": "office-A",
                                         "topic": "Law of Averages", "trainee_content": ""}))
    return db


def test_written_quiz_is_served_without_ai_and_never_leaks_answers(monkeypatch):
    _setup(monkeypatch)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    out = _run(modules.get_module_quiz("m1", request=None))
    assert len(out["questions"]) == len(QUIZZES["1|Law of Averages"])
    assert all("answer" not in q for q in out["questions"])
    again = _run(modules.get_module_quiz("m1", request=None))
    assert again["quiz_id"] == out["quiz_id"]  # cached, not re-made


def test_pass_needs_all_but_one_right_and_ticks_know(monkeypatch):
    db = _setup(monkeypatch)
    quiz_id = _run(modules.get_module_quiz("m1", request=None))["quiz_id"]
    stored = _run(db.module_quizzes.find_one({"id": quiz_id}))
    qs = stored["questions"]
    right = {q["id"]: q["answer"] for q in qs}
    two_wrong = dict(right)
    for q in qs[:2]:
        two_wrong[q["id"]] = (q["answer"] + 1) % 4
    res = _run(modules.submit_module_quiz("m1", QuizSubmit(quiz_id=quiz_id, answers=two_wrong), request=None))
    assert res["passed"] is False
    one_wrong = dict(right)
    one_wrong[qs[0]["id"]] = (qs[0]["answer"] + 1) % 4
    res = _run(modules.submit_module_quiz("m1", QuizSubmit(quiz_id=quiz_id, answers=one_wrong), request=None))
    assert res["passed"] is True
    row = _run(db.module_progress.find_one({"module_id": "m1"}))
    assert row["ladder"] == 1
