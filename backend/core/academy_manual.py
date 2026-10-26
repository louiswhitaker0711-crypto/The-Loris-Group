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


async def _rebuild_unstarted_checklists(db, days=(1, 2)) -> int:
    """Day 1 / Day 2 assessments not completed, where no row has been taught
    or graded yet, get their checklist rows rebuilt from the new manual."""
    rebuilt = 0
    async for a in db.daily_assessments.find({"day_number": {"$in": list(days)}, "completed": {"$ne": True}},
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


# ── Day 2 (26 Oct 2026) ──────────────────────────────────────────────────────
# The Owner's Day 2 running order, the same as the Day 2 workbook: the
# sign-up process first (start, set the expectation, build the week, lock it
# in), then the introduction, body language and tone, code of practice,
# G.I.F.T.S., who we can't sign up, the short story, products, sales quality,
# the rehash and the Law of Averages. The customer pays for the first order
# on the day, there and then; the old "weekly, 3 days before the first
# delivery" line comes out of every row that said it (the Owner: don't
# mention future payment dates).

DAY2_MARKER = "academy_day2_running_order_v1"


def _row2(category: str, topic: str, good: str, outcome: str) -> dict:
    return {"day_number": 2, "category": category, "topic": topic, "what_good_looks_like": good,
            "expected_outcome": outcome, "confidence_expected": "Assisted", "required": True,
            "grade_options": list(_LEARNT)}


DAY2_NEW_ROWS = [
    _row2("Compliance", "Code of Practice",
          "How we behave on every doorstep: say who you are and that you're there on behalf of The Modern "
          "Milkman; respect a No Cold Calling sign and don't knock; details only go into the approved sign-up, "
          "never on your own phone; never exaggerate savings or leave out costs; no pushy selling; put a "
          "vulnerable person's wellbeing first; friends and family only if they genuinely want it; visible ID, "
          "smart dress, no swearing, smoking or vaping.",
          "You know the code of practice and follow it on every door."),
    _row2("5 Steps: Presentation", "G.I.F.T.S.",
          "The impulse factors that create interest: Greed (everyone likes a deal), Indifference (relaxed, no "
          "pressure), Fear of loss (the offer won't be here for ever), The Jones Theory (the neighbours already "
          "have it), Sense of urgency (today, while we're here).",
          "You can name the five G.I.F.T.S. and use them in your pitch."),
    _row2("Signup", "Rehash",
          "Remove every reason to cancel before it happens. Build control: 1 show their week (read out each "
          "day), 2 change amounts (plus/minus, skip, remove: they adjust, not cancel), 3 pause, don't cancel "
          "(going away = pause), 4 one-offs. Lock it in: 5 payments (show the receipts and the next payment: "
          "no surprises, no cancellations), 6 doorstep photo, 7 set the 4-week expectation (quality, quantity, "
          "addition, routine), 8 thank and inspire.",
          "You can run all 8 steps of the rehash so the customer feels confident to adjust instead of cancel."),
    _row2("Quality", "Law of Averages",
          "It's a numbers game: 120 doors, 70 spoken to, 25 pitched, 15 closed, 4+ sign-ups a day. More "
          "opportunities, more sign-ups.",
          "You know the daily Law of Averages and why the doors come first."),
]

# Rows whose seed text changes. A row is only rewritten in a live database
# when it still has the old seed text, so edits made in Manual are kept.
DAY2_REWRITES = {
    (2, "Signup Process Overview"): (
        "Walk the four steps once, end to end. 1 · Start: ask for their postcode and show them their delivery "
        "days; don't make it a thing, just do it. 2 · Set the expectation: 'Let's build a week of everything "
        "you already use.' 3 · Build the week. 4 · Lock it in: read back every item and every day, say the "
        "price for the week calmly, then pause. In the app: the customer scans the QR code on the back of the "
        "pitch card → customer details → drop the pin → the repeat weekly order → APPLY PROMO CODE → delivery "
        "instructions → payment, entered by the customer → the rehash. Coaching = calm, frame, control. Then "
        "have them narrate it back to you from memory.",
        "You can narrate the four steps, and every step in the app from 'yes' to the rehash, from memory."),
    (2, "Build the Order Correctly"): (
        "Build the week with three questions for every product: what do you use, how much, and when do you "
        "next need it? Then add it to the basket and repeat. They speak first, one item at a time, and you "
        "drive the pace. Build it on sticky products, the ones they reorder every week: milk, eggs, bread, "
        "juice, milkshakes, butter, yoghurt, cheese. Spread it across the week: we aim for 2.5 drop days on "
        "average and fails under 10%. Never let them start with less than they use. £5.00 to £9.99 is a "
        "Silver, £10 or more is a Gold, and we aim for an average of £13 or more. Under £5, or one-off "
        "products only, is a fail.",
        "You build the week around what the customer really uses, with sticky products spread across their "
        "delivery days, and you know the Silver and Gold lines and what makes a fail."),
    (2, "Need to Know"): (
        "Drill the facts every customer should know: 20% off their first 2 weeks; the customer pays on the "
        "day, there and then; changes until 8pm the night before; 3 deliveries a week; they can pause when "
        "they're away; one-off products only on days they already have a repeat order; all produce comes from "
        "independent UK farms and businesses. Quiz them until every answer is instant.",
        "You can answer the customer's need-to-know questions (the discount, paying today, the 8pm cut-off "
        "and the delivery days) without checking."),
    (2, "Before the Customer Pays"): (
        "Teach the checks before payment; every detail matters. What the customer should know before joining: "
        "they pay for their first order today, there and then; the card holder must be present; they will get "
        "the same order in their 2nd week unless they amend it. They need an active email address and phone "
        "number; never set up an email account for them. Then your own checks: your promo code is applied, "
        "the first delivery is within 8 days and the date suits them, and the delivery days are right. The "
        "customer enters their own card details; never handle a customer's card.",
        "You run the checks before every payment (promo code in, first delivery within 8 days, the customer "
        "knows they pay today) and you never touch the card."),
    (2, "Explain the Payments"): (
        "Teach the payments in the customer's words: you pay for your first order today, there and then, "
        "which activates your discount and secures your spot on the round; you can add or change anything "
        "until 8pm the night before a delivery, and pause or skip in the app when you're away. The discount "
        "is 20% off the first 2 weeks. Then drill the 20-second version until it's smooth.",
        "You can explain the payments in 20 seconds (paid today, there and then) and the 8pm cut-off."),
    (4, "Explaining the Payments"): (
        "The payments explanation is theirs now. Listen for the beats: the first order is paid today, there "
        "and then, and changes can be made until 8pm the night before. When a customer asks something they "
        "can't answer, note it, answer it, drill it after the door.",
        "You explain the payments confidently (paid today, the 8pm cut-off) and handle the customer's "
        "follow-up question."),
}

# Day 2 in the workbook's order. Rows not named here keep their place at the end.
DAY2_ORDER = [
    # 1 · The sign-up process
    "Signup Process Overview", "Build the Order Correctly", "Need to Know", "Before the Customer Pays",
    "Explain the Payments",
    # 2–4 · Introduction, body language and tone
    "Pitch Introduction", "First Impression", "Icebreaker", "Who We Are / Where We Are From",
    "Body Language", "Tone of Voice", "SEE Factors",
    # 5 · Code of practice
    "Code of Practice",
    # 6 · Presentation: G.I.F.T.S.
    "Presentation & Short Story", "Pitchcard", "Agreements", "G.I.F.T.S.",
    # 7 · Who we can't sign up
    "Qualifying the Customer", "Types of Customers", "Who Not to Sign Up", "The 'A' Customer",
    # 8–10 · The short story, farmers, convenience
    "The Story of The Modern Milkman", "How It Works",
    # 11 · Products
    "Products",
    # 12 · Sales quality
    "What Good Looks Like", "Retention Standards", "Mistakes to Avoid",
    # 13 · Rehash, 14 · Law of Averages
    "Rehash", "Law of Averages",
]


def _seed_text(day: int, topic: str, rows: list[dict]) -> dict:
    for r in rows:
        if r.get("day_number") == day and r.get("topic") == topic:
            return r
    return {}


def reshape_day2(rows: list[dict]) -> list[dict]:
    """Day 2 in the workbook's order, with the new rows added and the
    payment rows rewritten (only where they still have the seed text)."""
    out, day2 = [], []
    for r in rows:
        key = (r.get("day_number"), r.get("topic"))
        if key in DAY2_REWRITES and _is_old(key, r.get("what_good_looks_like")):
            good, outcome = DAY2_REWRITES[key]
            r = {**r, "what_good_looks_like": good, "expected_outcome": outcome}
        (day2 if r.get("day_number") == 2 else out).append(r)
    have = {r.get("topic") for r in day2}
    day2 += [dict(n) for n in DAY2_NEW_ROWS if n["topic"] not in have]
    rank = {t: i for i, t in enumerate(DAY2_ORDER)}
    day2.sort(key=lambda r: (rank.get(r.get("topic"), len(rank)), r.get("sequence") or 0))
    for i, r in enumerate(day2, start=1):
        r["sequence"] = i
    return out + day2


# How each row Day 2 rewrites starts in the old seed. A live row that still
# starts this way hasn't been rewritten in Manual, so it's safe to replace.
_OLD_STARTS = {
        (2, "Signup Process Overview"): "Walk the whole path once, end to end: the close",
        (2, "Build the Order Correctly"): "Teach the order: act like a waiter taking an order",
        (2, "Need to Know"): "Drill the facts every customer should know: 20% off their first 2 weeks; the first order is paid then and there",
        (2, "Before the Customer Pays"): "Teach the checks before payment",
        (2, "Explain the Payments"): "Teach the payments in the customer's words: you pay for your first order today, which activates",
        (4, "Explaining the Payments"): "The payments explanation is theirs now. Listen for the three beats",
}


def _is_old(key, text) -> bool:
    start = _OLD_STARTS.get(key)
    return bool(start) and isinstance(text, str) and text.startswith(start)


def apply_day2_to_seed(rows: list[dict]) -> list[dict]:
    """Seed rows (no office) with Day 2 in the Owner's order, for a new office."""
    if any(r.get("day_number") == 2 and r.get("topic") == "Law of Averages" for r in rows):
        return rows
    return reshape_day2(rows)


async def migrate_day2(db) -> dict:
    """Once per database: each office's Day 2 in the Owner's order (new rows
    added, the payment rows rewritten where unedited), the Day 4 payments row
    rewritten where unedited, and Day 2 checklists nobody has started
    marking rebuilt from the new manual."""
    if await db.content_migrations.find_one({"id": DAY2_MARKER}):
        return {"skipped": True}
    offices = await db.training_manual.distinct("office_id", {"day_number": 2})
    changed = 0
    for office_id in offices:
        rows = await db.training_manual.find({"office_id": office_id, "day_number": {"$in": [2, 4]}}).to_list(500)
        if any(r.get("day_number") == 2 and r.get("topic") == "Law of Averages" for r in rows):
            continue
        before = {r["_id"]: (r.get("what_good_looks_like"), r.get("sequence")) for r in rows if r.get("_id")}
        for r in reshape_day2([dict(r) for r in rows]):
            if r.get("_id"):
                if before.get(r["_id"]) != (r.get("what_good_looks_like"), r.get("sequence")):
                    await db.training_manual.update_one({"_id": r["_id"]}, {"$set": {
                        "sequence": r["sequence"], "what_good_looks_like": r.get("what_good_looks_like"),
                        "expected_outcome": r.get("expected_outcome")}})
            else:
                await db.training_manual.insert_one({**r, "office_id": office_id})
        changed += 1
    rebuilt = await _rebuild_unstarted_checklists(db, days=(2,))
    await db.content_migrations.insert_one({"id": DAY2_MARKER, "at": datetime.now(timezone.utc).isoformat(),
                                            "offices": changed, "checklists_rebuilt": rebuilt})
    logger.info(f"academy_manual: Day 2 rebuilt for {changed} office(s), {rebuilt} checklist(s) rebuilt")
    return {"offices": changed, "checklists_rebuilt": rebuilt}
