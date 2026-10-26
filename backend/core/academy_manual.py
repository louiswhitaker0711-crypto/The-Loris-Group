"""BA Academy Day 1 checklist in the Owner's running order (26 Oct 2026).

The Owner's Day 1 (product coaching, slides + the Day 1 workbook): first
week, what we look for and the core values, indirect vs direct marketing,
our model, expectations both ways, opportunity & progression, self-employed,
payments & incentives, your worth to Modern Milkman, FAQs. The 'A' Customer,
What Good Looks Like and Retention Standards are taught on Day 2, so they
move there. The seven behaviour rows stay as they are.

`apply_to_seed()` reshapes the seed list for new offices; `migrate()` makes
the same change once in a live database (marker in `content_migrations`), so
later edits in Manual are never overwritten. Pending Day 1 and Day 2
checklists that nobody has started marking are rebuilt from the new manual.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

MARKER = "academy_day1_running_order_v1"
MOVE_TO_DAY2 = ("The 'A' Customer", "What Good Looks Like", "Retention Standards")
_LEARNT = ["Learnt", "Not Learnt"]


def _row(category: str, topic: str, good: str, outcome: str) -> dict:
    return {"day_number": 1, "category": category, "topic": topic, "what_good_looks_like": good,
            "expected_outcome": outcome, "confidence_expected": "Understand", "required": True,
            "grade_options": list(_LEARNT)}


NEW_ROWS = [
    _row("First Week", "Your First Week",
         "Walk through the 8 days: BA Academy Days 1 and 2 in the office, then the shadow day watching a bunny "
         "hop, first day on badge, and field days 3 to 6, ending with the 6–9 day evaluation. Say what they "
         "should know by the end of each day.",
         "You know what each of your first 8 days is for and what's expected of you by the end of it."),
    _row("Values", "What We Look For & Our Core Values",
         "The three things we look for in people: work ethic, willingness to learn and a good attitude. Then "
         "Ginger Promotions' six core values and what each means: be reliable, be positive, be accountable, "
         "be supportive, have respect, be fearless.",
         "You can name the three things we look for and the six core values, and say what each one means."),
    _row("Business", "Indirect vs Direct Marketing",
         "Indirect (TV, radio, billboards, social media): a huge audience and brand trust, but costly, hard to "
         "measure and lost among the thousands of adverts we see each day. Direct (face to face): a guaranteed, "
         "measurable return, personal, a longer-lasting message, no competition on the doorstep, and the "
         "customer does nothing because we set it up. The brand doesn't control the message, so every customer, "
         "yes or no, is left with a positive impression.",
         "You can explain why Modern Milkman uses face-to-face marketing and why how you treat a 'no' matters."),
    _row("Business", "Expectations, Both Ways",
         "What they can expect from us: product and sales coaching, an environment to grow in, a mentor for "
         "their first two months, progression and international networking. What we expect from them: 100% "
         "effort, being proactive about their development, reliability, being a team player, setting goals, "
         "being positive and pushing their comfort zones.",
         "You know what we'll give you and what we expect back."),
    _row("Opportunity", "Opportunity & Progression",
         "Most businesses move people up on seniority (age and time served): it's slow, the people at the top "
         "stay put, and roles get filled from outside or by moving someone across from another branch. We run "
         "like sport: performance-based, hit the criteria and you move forward. Show the steps from the 6–9 "
         "day evaluation upwards.",
         "You can explain why advancement here is about performance, not time served, and name your first step."),
    _row("Pay", "Self-Employed & Tax",
         "They run their own business: register as self-employed with HMRC and get a UTR, keep every receipt "
         "for things bought for work, put money aside for tax, and file a self assessment once a year (online "
         "or through an accountant). Show the worked example of income minus expenses minus the tax-free "
         "allowance.",
         "You know how to register as self-employed, why to keep receipts, and that you sort your own tax."),
    _row("Pay", "Your Worth to Modern Milkman",
         "Average customer spend £11 a week for 20 weeks is £220; minus the £49 marketing fee is £171 per "
         "customer. Five sign-ups a day, five days a week, fifty weeks a year is about £213k per Brand "
         "Ambassador, and around £8.5m a year from one office of 40. Knowing your worth gives you confidence "
         "on the doorstep.",
         "You can explain what one Brand Ambassador is worth to Modern Milkman and why it matters."),
    _row("FAQs", "Frequently Asked Questions",
         "No sign-ups means no pay, and why that rarely happens; first earnings 11 days after the first "
         "Saturday, then weekly; what happens if they don't pass the evaluation; they sort their own tax; tell "
         "their Coach early if they're ill or going on holiday; day-to-day travel is theirs to pay.",
         "Your questions about earnings, tax, time off and travel are answered."),
]

# The order Day 1's taught rows take after the seven behaviour rows.
DAY1_ORDER = ["Your First Week", "What We Look For & Our Core Values", "Indirect vs Direct Marketing",
              "Business Model", "Expectations, Both Ways", "Opportunity & Progression", "Self-Employed & Tax",
              "Commission Structure", "When You Are Paid", "Your Worth to Modern Milkman",
              "Frequently Asked Questions"]


def _reshape(rows: list[dict]) -> list[dict]:
    """The manual for one office, Day 1 rebuilt and the three Quality rows on Day 2."""
    day1 = [r for r in rows if r.get("day_number") == 1]
    rest = [r for r in rows if r.get("day_number") != 1]
    behaviour = sorted([r for r in day1 if r.get("category") == "Behaviour"], key=lambda r: r.get("sequence") or 0)
    moved = [r for r in day1 if r.get("topic") in MOVE_TO_DAY2]
    taught = {r.get("topic"): r for r in day1 if r.get("category") != "Behaviour" and r.get("topic") not in MOVE_TO_DAY2}
    for n in NEW_ROWS:
        taught.setdefault(n["topic"], dict(n))
    ordered = [taught.pop(t) for t in DAY1_ORDER if t in taught] + sorted(taught.values(), key=lambda r: r.get("sequence") or 0)
    out = []
    for i, r in enumerate(behaviour + ordered, start=1):
        out.append({**r, "day_number": 1, "sequence": i})
    day2_max = max([r.get("sequence") or 0 for r in rest if r.get("day_number") == 2] or [0])
    for j, r in enumerate(moved, start=1):
        out.append({**r, "day_number": 2, "sequence": day2_max + j})
    return out + rest


def apply_to_seed(rows: list[dict]) -> list[dict]:
    """Seed rows (no office) reshaped for a new office."""
    if any(r.get("topic") == "Your First Week" for r in rows):
        return rows
    return _reshape(rows)


async def migrate(db) -> dict:
    """Once per database: rebuild each office's Day 1 manual in the Owner's
    order, move the three Quality rows to Day 2, and rebuild Day 1/Day 2
    checklists that nobody has started marking."""
    if await db.content_migrations.find_one({"id": MARKER}):
        return {"skipped": True}
    offices = await db.training_manual.distinct("office_id", {"day_number": 1})
    changed = 0
    for office_id in offices:
        rows = await db.training_manual.find({"office_id": office_id, "day_number": {"$in": [1, 2]}}).to_list(500)
        if any(r.get("topic") == "Your First Week" for r in rows):
            continue
        new = _reshape([{k: v for k, v in r.items()} for r in rows])
        for r in new:
            if r.get("_id"):
                await db.training_manual.update_one(
                    {"_id": r["_id"]}, {"$set": {"day_number": r["day_number"], "sequence": r["sequence"]}})
            else:
                await db.training_manual.insert_one({**r, "office_id": office_id})
        changed += 1
    rebuilt = await _rebuild_unstarted_checklists(db)
    await db.content_migrations.insert_one({"id": MARKER, "at": datetime.now(timezone.utc).isoformat(),
                                            "offices": changed, "checklists_rebuilt": rebuilt})
    logger.info(f"academy_manual: Day 1 rebuilt for {changed} office(s), {rebuilt} checklist(s) rebuilt")
    return {"offices": changed, "checklists_rebuilt": rebuilt}


async def _rebuild_unstarted_checklists(db) -> int:
    """Day 1 / Day 2 assessments not completed, where no row has been taught
    or graded yet, get their checklist rows rebuilt from the new manual."""
    rebuilt = 0
    async for a in db.daily_assessments.find({"day_number": {"$in": [1, 2]}, "completed": {"$ne": True}},
                                             {"_id": 0, "id": 1, "new_hire_id": 1, "day_number": 1}):
        rows = await db.delivery_checklist.find({"assessment_id": a["id"]}).to_list(200)
        if any(r.get("taught") or r.get("grade") for r in rows):
            continue
        hire = await db.new_hires.find_one({"id": a.get("new_hire_id")}, {"_id": 0, "office_id": 1, "active": 1})
        if not hire or hire.get("active") is False:
            continue
        office_id = hire.get("office_id")
        manual = await db.training_manual.find({"day_number": a["day_number"], "office_id": office_id}).sort("sequence", 1).to_list(500)
        if not manual:
            continue
        await db.delivery_checklist.delete_many({"assessment_id": a["id"]})
        for item in manual:
            await db.delivery_checklist.insert_one({
                "id": str(uuid.uuid4()), "assessment_id": a["id"], "office_id": office_id,
                "manual_item_id": f"D{a['day_number']}-{int(item.get('sequence') or 0):02d}",
                "topic": item.get("topic"), "category": item.get("category"),
                "confidence_expected": item.get("confidence_expected", "Understand"),
                "taught": False, "outcome_achieved": False, "confidence_level": "Not yet", "grade": None,
                "grade_options": item.get("grade_options", list(_LEARNT)), "notes": None,
            })
        rebuilt += 1
    return rebuilt
