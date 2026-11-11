"""End-of-Day Daily-Breakdown prompt builder.

Returns the full instruction string for the LLM. The route handler is
responsible for shaping `summary_context` (today's data) and
`tomorrow_block_text` (pre-formatted schedule) — this module only owns the
*tone, structure and rules* of the message.
"""
from __future__ import annotations

from core.brand import BRITISH_ENGLISH, SELF_EMPLOYED_TERMS

# ─────────────────────────────────────────────────────────────────────────────
# House mantra + goal lines (kept here so they can be tweaked in one place)
# ─────────────────────────────────────────────────────────────────────────────
HOUSE_MANTRA = (
    "High standards\n"
    "High intensity\n"
    "Tomorrow is a new day 🌱"
)
HOUSE_GOALS = (
    "📈 Hit the weekly target\n"
    "📈 Fails under 10%\n"
    "📈 75%+ in The Round and reaching their 4th week"
)

# ─────────────────────────────────────────────────────────────────────────────
# Tone references — verbatim sample messages the user shared. The LLM is
# instructed to match this tone but NOT to copy these BAs' names. Kept as
# raw strings so future edits stay readable.
# ─────────────────────────────────────────────────────────────────────────────
TONE_EXAMPLES = """\
EXAMPLE A:
Monday smashed 💪 11 sign-ups today, up from 6 this time last week.

🔔 *Owen: 5* 🔥
Goal of 4 and beat it. 80 spoken to and 4 of the 5 were quality sign-ups, setting the pace.

🛎️ *Tess: 3* 🌟
Hit her goal of 3 with 2 taking The Round. Her closes are landing.

🎓 *Maya: 1* 🙂
First sign-up on the board on her second field day. Foundation laid.

Shoutout to everyone who kept knocking late. That's where the standard gets set 🫡

We're on 11 for the week with 39 to go and 5 days left. Stay locked in ⚡

High standards
High intensity
Tomorrow is a new day 🌱

📈 Hit the weekly target
📈 Fails under 10%
📈 75%+ in The Round and reaching their 4th week

Who's stepping up to make tomorrow the biggest day of the week?! 💥

EXAMPLE B:
Wednesday done 💪 14 sign-ups today, up from 5 this time last week.

🔔 *Liam F: 4* 🔥
Up from 0 last Wednesday and 1 above his goal. All 4 were quality sign-ups.

🛎️ *Liam B: 2* 💫
Hit his goal of 2 and spoke to 72 people. Volume is there, the closes will follow.

Coaches are stepping up and the pace is rising 📈 We're on 22 for the week with 28 to go and 4 days left.

High standards
High intensity
Tomorrow is a new day 🌱

📈 Hit the weekly target
📈 Fails under 10%
📈 75%+ in The Round and reaching their 4th week

Who's ready to finish the week the right way? 🫡
"""

SYSTEM_MESSAGE = (
    "You write punchy, emoji-rich WhatsApp messages for the coaches and Owner "
    "of a door-to-door sales office. "
    "Keep it tight and scannable. " + BRITISH_ENGLISH + " " + SELF_EMPLOYED_TERMS
)


def build_daily_breakdown_prompt(
    summary_context: dict,
    tomorrow_block_text: str,
    custom_instructions: str = "",
) -> str:
    """Compose the full user-message prompt sent to the LLM.

    Args:
        summary_context: Dict with today's office data, week-to-date, last-week,
            rep_callouts, weekly_goal, etc. The handler already shaped this.
        tomorrow_block_text: No longer used: the Owner took tomorrow's schedule
            off the end of the message (11 Nov 2026). Kept for callers.
        custom_instructions: Free-form admin-authored overrides per office
            (tone, what to include, what to avoid, etc.). Injected at the top
            of the rules block so it can override the defaults below.
    """
    # Admin-authored custom block — if present, it goes right before the
    # baseline rules so the model treats it as the source of truth. Left
    # empty, the baseline rules apply untouched.
    custom_block = ""
    if (custom_instructions or "").strip():
        custom_block = (
            "═════════ ADMIN'S OWN INSTRUCTIONS (HIGHEST PRIORITY — follow "
            "these first; they OVERRIDE anything below if they conflict) "
            "═════════\n"
            f"{custom_instructions.strip()}\n"
            "════════════════════════════════════════════════════════════\n\n"
        )

    return (
        "You are writing an END-OF-DAY WhatsApp breakdown for a high-energy "
        "door-to-door sales office. The message is posted to a group with "
        "the entire network (coaches + Brand Ambassadors + new BAs). Match this house tone "
        "EXACTLY — energetic, masculine, growth-mindset, motivational without "
        "being cringey.\n\n"
        f"{custom_block}"
        "═════════ TONE REFERENCES ═════════\n"
        f"{TONE_EXAMPLES}"
        "═══════════════════════════════════\n\n"
        "STRUCTURE — follow this order strictly:\n"
        "1) ONE punchy opener line that names the day and today's total against "
        "the same day last week (e.g. 'Wednesday done 💪 14 sign-ups today, up "
        "from 5 this time last week.').\n"
        "2) A blank line, then one callout per person, a blank line between each. "
        "Each callout is TWO lines:\n"
        "     line 1: '<emoji> *<name>: <sign-ups>* <vibe emoji>'\n"
        "     line 2: one or two short sentences: their goal and their positives.\n"
        "   Emojis: 🔔 = top performer(s) of the day (most sign-ups), 🛎️ = anyone "
        "else who rang a bell, 🎓 = new BAs (role == 'trainee').\n"
        "   Use the name EXACTLY as given in `rep_callouts` (first name, or first "
        "name and initial when two people share a first name). Never add a surname.\n"
        "   GOAL: when `goal_today` is set, say how they did against it (beat it, "
        "hit it, or how close they got, kept encouraging). If it isn't set, leave "
        "goals out for that person.\n"
        "   POSITIVES: write them yourself from their data; pick the one or two "
        "strongest: beating last week's same day (`delta`), quality sign-ups "
        "(`today_over30` = Gold, an order of £10+), sign-ups taking The Round "
        "(`today_memberships`, never a sign-up of its own), strong numbers on "
        "the doors (`today_numbers`: doors, spoken, pitched, closed against "
        "the day's Law of Averages of 120 doors, 70 spoken to, 25 pitched, 15 "
        "closed, 4+ sign-ups), or their week so far (`week_so_far`, "
        "`week_days_with_signups`). New BA with a first sign-up → getting on "
        "the board. Positives only: no criticism in a callout.\n"
        "   Skip anyone with 0 sign-ups today.\n"
        "3) ONE shoutout line to anyone who pushed late or grinded.\n"
        "4) A short 1-2 line week update: where the week stands (`week_to_date`, "
        "`goal_remaining`, `days_left_in_week`) and any other good bit of info "
        "from the data (e.g. how many quality sign-ups or how many took The "
        "Round today, beating last week's total so far).\n"
        "5) The mantra block (each on its own line):\n"
        f"{HOUSE_MANTRA}\n"
        "6) The goal block (each on its own line):\n"
        f"{HOUSE_GOALS}\n"
        "7) ONE rallying close line ending in a question (e.g. \"Who's stepping "
        "up to make tomorrow the biggest day of the week?! 💥\"). Nothing after it: "
        "no schedule.\n\n"
        "RULES:\n"
        "• NO DASHES. Never use – or — anywhere in the message. Use a colon "
        "after a name, and full stops or commas in sentences.\n"
        "• Plain text + emojis only. NO markdown headers (no #, no **). Single "
        "asterisks *like this* are OK for WhatsApp bold.\n"
        "• ⚠️ ONLY use names that appear in the `rep_callouts` array of "
        "TODAY'S DATA below. NEVER use names from the EXAMPLE messages above "
        "(Owen / Tess / Maya / Liam F / Liam B) unless they are actually present in "
        "rep_callouts.\n"
        "• If `rep_callouts` is empty (nobody rang a bell today), SKIP steps 2-3 "
        "and write a short line like 'A grinder of a day. Heads down, no bells, "
        "but the work compounds.' Then carry on from step 4.\n"
        "• Numbers must match the data exactly. Do not invent sign-ups, goals or "
        "door numbers; leave out anything the data doesn't have.\n"
        "• Keep it tight and scannable.\n"
        "• Don't be cringey. No 'champions' / 'rockstars' / 'crushed it'. Match "
        "the reference tone.\n"
        "• Return ONLY the message text: no preamble, no JSON, no quotes "
        "around the output.\n"
        f"• {BRITISH_ENGLISH}\n"
        f"• {SELF_EMPLOYED_TERMS}\n\n"
        f"═════════ TODAY'S DATA ═════════\n{summary_context}\n"
    )
