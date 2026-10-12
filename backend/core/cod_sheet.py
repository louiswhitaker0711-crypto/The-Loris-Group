"""The office's COD sheet: the Owner's "Stage 1-5 New COD" (stages 1, 2, 3,
3+, 4 and 5), item names word for word from the printed sheet.

Each item is graded on the proof ladder (Know → Do → Deliver → Teach →
Systemize) exactly as before; only the list changed.

Stored stage numbers (``(stage, topic)`` is module identity, so these are
fixed):
    1 → Stage 1   6 Day Evaluation
    2 → Stage 2   Becoming a Leader
    3 → Stage 3   Being a Leader
    5 → Stage 3+  Being a Core Leader / Coach   (the slot Sector/Site Leader
                  used, which already sat between 3 and 4)
    4 → Stage 4   Advanced Team Building
    6 → Stage 5   Becoming a Business Owner
Display order is core/cod_stages.py: 1, 2, 3, 5, 4, 6.

Items from the earlier COD that the sheet doesn't have (Field IQ and the
numbers, emotional control, hard conversations…) are kept and slotted into
the section where they fit best, as the Owner asked; each stage also keeps a
short overview at the top.

An entry is one of:
    "Title"                              a new item from the sheet (no notes yet)
    ("Title", (old_stage, "Old topic"))  the sheet's item, carrying over the
                                         earlier item's notes and everyone's
                                         progress (renamed in place)
    (None, (old_stage, "Old topic"))     an earlier item kept under its own
                                         name, moved into this section
"""
from __future__ import annotations

STAGE_TITLES = {
    1: "6 Day Evaluation",
    2: "Becoming a Leader",
    3: "Being a Leader",
    5: "Being a Core Leader / Coach",
    4: "Advanced Team Building",
    6: "Becoming a Business Owner",
}
STAGE_LABELS = {5: "3+", 6: "5"}


def stage_label(stage: int) -> str:
    return STAGE_LABELS.get(int(stage), str(stage))


OVERVIEW = "Overview"
FIELD_IQ = "Field IQ & Numbers"

# New overview pages (stages with no earlier "Standard" page to carry over).
NEW_OVERVIEWS = {
    5: {
        "trainee_content": (
            "Stage 3+ is being a Core Leader and Coach. You develop leaders, not just new BAs: "
            "you lead people through Stage 3, build the team's identity and confidence, and look "
            "after your territory and its sales performance.\n\n"
            "The sheet covers: Personal Development, Developing your leaders, Team development, "
            "Building confidence & expectations, and Territory management.\n\n"
            "You move up on evidence, never on time served."
        ),
    },
    6: {
        "trainee_content": (
            "Stage 5 is becoming a Business Owner: knowing your business and your responsibilities "
            "to your supplier, administration, recruiting, finance, the daily rhythm of the office, "
            "customer service, preparing for change and your first 2 weeks.\n\n"
            "“You don’t learn to walk by following rules. You learn by doing, and by falling over.” "
            "— Richard Branson\n\n"
            "“Leadership is doing what is right when no one is watching.” — George Van Valkenburg"
        ),
    },
}

SHEET: list[tuple[int, str, list]] = [
    # ── Stage 1 · 6 Day Evaluation ────────────────────────────────────────
    (1, OVERVIEW, [("Stage 1 — 6 Day Evaluation", (1, "Stage 1 — The Foundation Standard"))]),
    (1, "Intro to the Business", [
        "Business introduction", "Product Coaching", "Commission structure",
        "Code of practice", "Quality Payments", "Sign up process",
    ]),
    (1, "Expectations", [
        "Having a positive attitude", "Customer service", "Comfort Zones", "Listen and learn",
        "Time Management", "100% effort",
        ("S.E.E", (1, "SEE Principle")), "Image", ("Body Language", (1, "Accurate Body Positioning")),
        "Tone of voice", "Building rapport/trust",
        (None, (1, "Professional Reliability")), (None, (1, "Resilience After Rejection")),
        (None, (1, "Emotional Regulation in the Field")), (None, (1, "Seeks Support Early & Proactively")),
        (None, (1, "Follows Standards")), (None, (1, "Communicates Clearly")),
    ]),
    (1, "Collateral", ["Callback tracker", "Presenter card", "Leave behind booklet", "KPI tracker"]),
    (1, "5 Steps", ["Introduction", "Presentation", "Short story", ("Close", (1, "Clear Close")), "Rehash"]),
    (1, "Impulsing", [
        "Greed / Generosity", "Indifference", "Fear of loss / Feel good",
        "The Jones Theory / TOV", "Sense of urgency",
    ]),
    (1, "Handling Questions", [
        ("Question handling", (1, "Question Handling")), "Pre-empting questions", "Blocks", "Customer questions",
    ]),
    (1, FIELD_IQ, [(None, (1, "Field IQ")), (None, (1, "Law of Averages")), (None, (1, "Quality KPIs"))]),

    # ── Stage 2 · Becoming a Leader ───────────────────────────────────────
    (2, OVERVIEW, [("Stage 2 — Becoming a Leader", (2, "Stage 2 — The Self Management Standard"))]),
    (2, "Company", [
        "Understanding direct sales", "Company history", "Industry capacity",
        "Advancement criteria", "Finances", "Personal growth opportunities",
    ]),
    (2, "Sales", [
        (None, (2, "Close Variations")), (None, (2, "Improved Question Handling")),
        (None, (2, "Rehash & Consolidation")),
    ]),
    (2, "Goals", ["SMART Goals", "How to set", "How to reward", (None, (2, "Personal Planning"))]),
    (2, "Selling independently", [
        "Taking initiative", "The ‘One’ principle",
        ("Adapting to different territories", (2, "Territory Awareness & Adaptability")),
        ("Solving problems", (2, "Problem-Solving Mindset")),
        (None, (2, "Student Mentality")),
    ]),
    (2, "The 8 Steps", [
        "Having a positive attitude", "Be prepared", "Reliability", "100% effort",
        "Working territory", "Safeguard your attitude", "Goals and why", "Taking control",
    ]),
    (2, "Leadership", [("GRASP", (2, "GRASP")), "Have fun & promote positives"]),
    (2, "Profitability", [("Importance of profitability", (2, "Profitability")), "Personal breakeven"]),
    (2, "Example Setting", ["How?", "Why?", ("Assuming the role", (2, "Assuming the Role"))]),
    (2, FIELD_IQ, [
        (None, (2, "Using Numbers to Self-Coach")), (None, (2, "Daily Inputs & Weekly Outputs")),
        (None, (2, "Clean Data You Can Trust")),
    ]),

    # ── Stage 3 · Being a Leader ──────────────────────────────────────────
    (3, OVERVIEW, [("Stage 3 — Being a Leader", (3, "Stage 3 — The Leader Standard"))]),
    (3, "A. Personal Development", [
        "Sourcing Stage 3 information", "Self Motivation (Turning it on)",
        ("Accountability - for self and others", (3, "Setting & Enforcing Standards")),
        "Comfort zones", "Image", ("Planning", (3, "Weekly Planning Rhythm")),
        ("Developing business relationships", (3, "Networking")),
    ]),
    (3, "B. Recruiting", [
        "Understanding the process", "Explanation of the direct sales industry",
        ("Personal recruiting", (3, "Personal Recruitment")), "Understanding your KPI’s",
    ]),
    (3, "C. Week 1 Coaching", [
        "Expectations for a new recruit", "Hosting", "Shadow Day", "1st day on badge",
        "How to teach COD", "Breaking days down", "40/20 rule", "Building confidence",
        "Pre testing stage 1",
        (None, (3, "Teaching the Sign-Up Process")), (None, (3, "Diagnosing Sign-Up Problems")),
    ]),
    (3, "D. Working with a stage 2", [
        "Expectations for stage 2", "Stage 2 daily plan",
        ("Creating independence", (3, "Building Independence")),
        "Pre testing stage 2", "Coaching 8 steps",
        (None, (3, "Performance Conversations")),
    ]),
    (3, "E. Running Sectors", [
        ("Map management", (5, "Territory Allocation & Protection")),
        ("Sector meetings", (5, "Start-of-Day Sector Meetings")),
        ("Sector breakdown", (5, "End-of-Day Sector Breakdown")),
        ("Managing the atmosphere", (5, "Leading the Situation")),
        (None, (3, "Protecting Quality")),
    ]),
    (3, "F. EQ", [
        "Hard VS soft skills", "Self awareness",
        ("Self management", (3, "Emotional Control Under Pressure")),
        "Social awareness", "Relationship management",
        (None, (3, "Emotional Regulation")),
    ]),
    (3, "G. " + FIELD_IQ, [
        (None, (3, "Data-Driven New Starter Development")), (None, (3, "Tracking Team Progression")),
        (None, (3, "Tracking the Recruitment Pipeline")),
    ]),

    # ── Stage 3+ · Being a Core Leader / Coach (stored as 5) ──────────────
    (5, OVERVIEW, ["Stage 3+ — Being a Core Leader / Coach"]),
    (5, "A. Personal Development", [
        "Assuming the role of stage 4", "Maximising your sales potential",
        ("Being the ultimate example", (5, "Setting the Pace Personally")),
        "Showtime",
        ("Finances", (4, "Profitability vs. Spending")),
        ("Understanding business cycles", (4, "Mentoring Through Business Cycles")),
        "Travel, trip & networking", "Maintaining enthusiasm",
    ]),
    (5, "B. Developing your leaders", [
        ("Setting expectations", (4, "Clear Expectations Meetings")),
        "Leading someone through stage 3",
        ("Triangle training", (4, "Coach the Coach")),
        "Supporting your stage 3 people",
    ]),
    (5, "C. Team development", [
        ("Team meetings", (3, "High-Clarity Team Meetings")),
        ("Team identity and activities", (4, "Environment & Culture")),
        "Creating a vision", "Crew challenges",
    ]),
    (5, "D. Building confidence & expectations", [
        "Using positive examples", "Using company literature", "How to promote improvements",
        "Recognise achievements", "Promoting setting and hitting goals",
        (None, (5, "Building Belief, Energy & Belonging")),
    ]),
    (5, "E. Territory management", [
        ("Researching your territory", (5, "Understanding Territory Differences")),
        "Managing sales performance", "Run a profitable road trip", "Sector / site meetings",
        (None, (5, "Setting Sector Targets")), (None, (5, "Full Ownership of Sector Results")),
        (None, (5, "Diagnosing Where BAs Lose Sign-Ups")), (None, (5, "Raising the Sector's Average")),
    ]),
    (5, "F. " + FIELD_IQ, [
        (None, (5, "Sector KPIs on Field IQ")), (None, (5, "Spotting Trends Early")),
        (None, (5, "Accurate Sector Reporting")),
    ]),

    # ── Stage 4 · Advanced Team Building ──────────────────────────────────
    (4, OVERVIEW, [("Stage 4 — Advanced Team Building", (4, "Stage 4 — The Team Builder Standard"))]),
    (4, "Expectations for Stage 4", [
        "Pushing on", ("Advancing 1st generation", (4, "Advancing First-Generation Leaders")),
        "Recruiting for your business", "Prime time", "Being the visionary",
        (None, (4, "Scaling Beyond Personal Production")),
    ]),
    (4, "Using the network", ["Countries", "Highrollers / Owners", "Different styles", "Networking Plan"]),
    (4, "Public speaking", ["Audience consideration", "Research", "Relevance", "Timing", "Delivery", "Terminology"]),
    (4, "Managing KPI’s", [
        "Scoring ratio", "Piece average",
        ("Fails & Quality", (5, "Identifying & Correcting Quality")),
        ("Quality management", (4, "Coaching to Protect Long-Term Quality")),
        "Leader advancements", "Recruiting", "Field feedback & complaints", "Average earnings",
        (None, (4, "Using KPIs to Coach")), (None, (4, "Predicting Issues Early")),
        (None, (4, "Tracking Progression & Retention")),
    ]),
    (4, "Developing people", [
        "Who to project", "Developing the relationship",
        ("Encouraging initiative", (4, "Preventing Dependency")),
        "Delegating", "Planning their business", "Trust but verify", "When to push or praise", "Pairings",
        (None, (4, "Teaching Advanced Sign-Up Psychology")),
        (None, (4, "Handling Conflict & Underperformance")),
        (None, (4, "Emotional Regulation While Coaching")),
    ]),
    (4, "Going to the next level", ["Assuming the role of stage 5", "Initial appointments", "Signing off stage 1"]),

    # ── Stage 5 · Becoming a Business Owner (stored as 6) ─────────────────
    (6, OVERVIEW, ["Stage 5 — Becoming a Business Owner"]),
    (6, "Knowing your business", [
        "Responsibilities to your supplier", "Your support network",
        "Working with bookkeepers and accountants", "Understanding legal implications and responsibilities",
    ]),
    (6, "Administration", [
        "Employer-Employee relationship", "Working & setting goals with your administrator",
        "Understanding the ‘Weekendings’ processes", "Daily paperwork responsibilities",
        "Understanding reports & quality management", "Quality tracking", "Processing earnings",
        "Vetting new starters", "Expenses", "Reconciling bills & invoices",
    ]),
    (6, "Recruiting", [
        "Relationship with suppliers", "Writing & placing advertisements", "Receiving appointment calls",
        "Initial appointments", "Final evaluations", "Expectations Meetings", "Retention", "Tracking",
        "Innovation in recruitment",
    ]),
    (6, "Finance", [
        "Stage 5 Growth Incentive Payment", "Profit & Loss Accounts", "Budgeting and expenses",
        "Personal profits and savings", "Understanding commission tiers",
    ]),
    (6, "Daily considerations", [
        "Leaders’ meetings", "Daily sales impacts", "Morning meetings", "Business advancement meetings",
        "Territory management", "One-on-one’s", "Merchandise consideration", "Being the host",
        "Public speaking", "Customer service meetings", "Quality one on ones",
    ]),
    (6, "Customer service", ["Key meetings to address issues", "Use of resources", "Complaints & responding"]),
    (6, "Preparing for change", [
        "Your savings", "Team savings", "Selecting the right people",
        "Preparing for a different client", "Preparing your territory",
    ]),
    (6, "First 2 weeks", [
        "Recruitment plan", "Recruitment materials", "Coaching materials", "Sales materials",
        "Field / recruitment schedule", "Goals & targets",
    ]),
]


def sheet_items() -> list[dict]:
    """Every item, flattened: {stage, category, topic, sequence, source}
    where source is the earlier (stage, topic) it carries over, or None."""
    out: list[dict] = []
    seq: dict[int, int] = {}
    for stage, section, items in SHEET:
        for it in items:
            if isinstance(it, str):
                title, src = it, None
            else:
                title, src = it
                if title is None:
                    title = src[1]
            seq[stage] = seq.get(stage, 0) + 1
            out.append({"stage": stage, "category": section, "topic": title,
                        "sequence": seq[stage], "source": src})
    return out
