"""The bundled campaign-knowledge playbook (seed/product_knowledge_topics.json):
shape the Product Knowledge routes read, the category order, the Modern
Milkman scripts and rules kept as agreed with the Owner, no personal data,
and a fresh database actually receiving it through seed_loader.
Pure in-memory: mongomock, no network.
"""
import asyncio
import json
import re
import sys
from pathlib import Path

from mongomock_motor import AsyncMongoMockClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import seed_loader  # noqa: E402
from routes.product_knowledge import _ser_topic  # noqa: E402

SEED = BACKEND_DIR / "seed" / "product_knowledge_topics.json"
CATEGORY_ORDER = [
    "The Beginning", "The Modern Milkman", "Week One Impact", "Quality",
    "Cycle of Development", "Coaching", "Pay & progression", "Other",
]


def _topics():
    return json.loads(SEED.read_text(encoding="utf-8"))


def test_every_topic_has_the_fields_the_routes_read():
    topics = _topics()
    assert len(topics) >= 30
    for t in topics:
        for key in ("id", "slug", "title", "category", "summary", "body", "key_facts",
                    "source_url", "order", "created_at", "updated_at"):
            assert key in t, (t.get("slug"), key)
        assert t["title"].strip() and t["body"].strip()
        assert isinstance(t["key_facts"], list)
        ser = _ser_topic(t)
        assert ser["regions"] == ["all"]
    assert len({t["id"] for t in topics}) == len(topics)
    assert len({t["slug"] for t in topics}) == len(topics)


def test_categories_follow_the_set_order_and_order_is_contiguous():
    topics = sorted(_topics(), key=lambda t: t["order"])
    assert [t["order"] for t in topics] == list(range(1, len(topics) + 1))
    seen = []
    for t in topics:
        assert t["category"] in CATEGORY_ORDER, t["category"]
        if not seen or seen[-1] != t["category"]:
            assert t["category"] not in seen, f"{t['category']} is split up"
            seen.append(t["category"])
    assert seen == [c for c in CATEGORY_ORDER if c in seen]
    assert seen == CATEGORY_ORDER


def test_scripts_and_rules_are_word_for_word():
    by = {t["slug"]: t["body"] for t in _topics()}
    # The pitch, as coached.
    assert "My name is" in by["the-pitch"] and "from The Modern Milkman." in by["the-pitch"]
    assert "We deliver fresh milk and produce to neighbours in your area." in by["the-pitch"]
    assert ("The only thing that we'd like you to do is rinse the bottles after you use them, leave them "
            "out on the doorstep, and we'll collect and reuse them. Is that ok?") in by["the-pitch"]
    assert "Do you use iPhone or Android?" in by["the-pitch"]
    # The rules that protect the customer and the brand.
    assert "A local milkman's customer must not be converted to Modern Milkman." \
        in by["competitors-and-the-local-milkman"]
    assert "Use **independent suppliers**, NOT local." in by["the-forbidden-local"]
    assert "Under no circumstances can a Modern Milkman subscription be mis-sold." in by["mis-selling-and-fraud"]
    assert "If you aren't sure, don't engage in a customer transaction." in by["who-not-to-sign-up"]
    assert "We must not sign up any customers that show any signs of vulnerability" in by["common-issues"]
    assert "What's the latest you can make changes to your order by?" in by["step-5-rehash"]


def test_the_owners_figures_are_the_ones_in_the_playbook():
    """Where the Owner's numbers differ from the coaching booklet, the Owner's
    are used: the offer, the fail rules, the age rule and the quality targets."""
    topics = _topics()
    by = {t["slug"]: t["body"] for t in topics}
    blob = " ".join(t["body"] + " ".join(t["key_facts"]) for t in topics)
    # The offer is 20% off for 2 weeks (the booklet's older 25% for 4 weeks is gone).
    assert "20% off their first 2 weeks" in by["the-pitch"] and "20% off their first 2 weeks" in by["need-to-know"]
    assert "25%" not in blob.replace("Average population: 25%", "")
    assert "your discount will only last for the next 2 weeks" in by["step-5-rehash"]
    # A fail: cancelled, first delivery over 8 days away, under £5, no repeat items.
    fails = by["fails-and-missing-sales"]
    for line in ("the customer cancels before their first delivery", "more than 8 days away",
                 "the repeat weekly order is under £5.00", "there are no repeat items on the order"):
        assert line in fails, line
    assert "over 7 days" not in blob and "£4.00" not in blob
    # 18 or over, no upper age limit, comfortable with the app.
    assert "There is no upper age limit" in by["who-not-to-sign-up"]
    assert "18-70" not in blob and "Over 75" not in blob and "Under 75" not in blob
    # Tiers, fees and targets.
    pay = by["ba-earnings-calculator-rules"]
    assert "| **Silver** | £5.00 to £9.99 | £12 | £5 |" in pay
    assert "| **Gold** | £10.00 or more | £20 | £8 |" in pay
    assert "**+£8** for each sign-up that also takes The Round" in pay
    kpis = by["quality-and-kpis"]
    for line in ("**£13 or more**", "**2.5 or more**", "**Under 10%**", "**75% or more** of sign-ups",
                 "**75% or more** of customers still ordering"):
        assert line in kpis, line
    assert "Wednesday 11 days after the week ends" in by["pay-dates"]
    assert "14-day cooling-off period" in by["pay-dates"] and "14-day cooling-off period" in by["the-round"]


def test_no_charity_campaign_wording_is_left():
    blob = SEED.read_text(encoding="utf-8")
    for word in ("donor", "charity", "NDCS", "Deaf", "Gift Aid", "direct debit", "Welcome Call",
                 "supporter", "Vertex", "HelloFresh"):
        assert word.lower() not in blob.lower(), word


def test_no_extractor_notes_or_personal_data():
    blob = SEED.read_text(encoding="utf-8")
    assert "<!--" not in blob
    assert not re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", blob), "an email address slipped in"
    assert "wa.me" not in blob
    # No phone numbers at all: customers are pointed to the app and the website.
    assert not re.findall(r"\b0\d{2,4} ?\d{3,4} ?\d{3,4}\b", blob)


def test_threshold_only_seeds_an_empty_collection():
    thresholds = dict(seed_loader.COLLECTIONS)
    assert thresholds["product_knowledge_topics"] == 1


def test_fresh_database_receives_the_playbook(monkeypatch):
    monkeypatch.delenv("DISABLE_SEED_LOADER", raising=False)
    db = AsyncMongoMockClient()["pk_seed_test"]

    async def go():
        await seed_loader.load_bundled_seeds(db)
        n = await db.product_knowledge_topics.count_documents({})
        first = await db.product_knowledge_topics.find_one({"order": 1})
        # A second boot must not wipe or duplicate anything.
        await db.product_knowledge_topics.update_one({"id": first["id"]}, {"$set": {"title": "Edited"}})
        await seed_loader.load_bundled_seeds(db)
        again = await db.product_knowledge_topics.count_documents({})
        edited = await db.product_knowledge_topics.find_one({"id": first["id"]})
        return n, again, edited["title"]

    n, again, title = asyncio.run(go())
    assert n == len(_topics())
    assert again == n
    assert title == "Edited"
