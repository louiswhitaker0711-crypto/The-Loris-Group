"""End-of-Day Daily-Breakdown prompt builder.

Returns the full instruction string for the LLM. The route handler is
responsible for shaping `summary_context` (today's data) and
`tomorrow_block_text` (pre-formatted schedule) — this module only owns the
*tone, structure and rules* of the message.
"""
from __future__ import annotations

from core.brand import BRITISH_ENGLISH, SELF_EMPLOYED_TERMS

# ─────────────────────────────────────────────────────────────────────────────
# The team's motto and the vision (the Owner, 24 Nov 2026): the old mantra and
# the fixed goal block came out, as they read the same every day.
# ─────────────────────────────────────────────────────────────────────────────
MOTTO = "Tomorrow is a new day 🌱"
VISION = "200LW: 200 sales a week. The Loris Group's emoji is 🐒."

# ─────────────────────────────────────────────────────────────────────────────
# Tone references. The LLM matches the tone but never copies the names, the
# wording or the order: they show the shape, not lines to reuse.
# ─────────────────────────────────────────────────────────────────────────────
TONE_EXAMPLES = """\
EXAMPLE A:
Monday done 💪 11 sign-ups on the board, 39 to go with 5 days left.

On average we spoke to 64 and pitched 21 each. The pitches are there, now it's turning them into closes 🎯

🔔 *Owen: 5* 🔥
New PB. 80 spoken to and 4 of the 5 Gold. Already Amber for the week on day one.

⭐ *Maya: 1* 🌱
First ever sign-up, and 85 spoken to on her second field day. That's the work that brings the bells.

Every bell is a step to 200LW 🐒

Tomorrow is a new day 🌱

EXAMPLE B:
Big Wednesday 🔔 14 today, our best day of the week. 22 for the week, 28 to go.

Closes averaged 15 a person, right on the Law of Averages. That's the standard 📈

🔔 *Liam F: 4* 🔥
Hit his weekly goal of 15 today and into Green. Consistent all week.

⭐ *Tess: 3* 💫
15 pitched and 10 closed. Her averages are up because of today, the bells are coming.

🐒 200LW is built on days like this.

Tomorrow is a new day 🌱
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
        "You are writing an END-OF-DAY WhatsApp breakdown for a door-to-door "
        "sales office. It goes to the whole group (Coaches, Brand Ambassadors "
        "and new BAs). Its purpose: a light recap of the day and where we are "
        "against the goals, but mainly to PROMOTE POSITIVES and THE VISION. "
        "Energetic, growth-mindset, motivational without being cringey. Short "
        "and scannable.\n\n"
        f"{custom_block}"
        "═════════ TONE REFERENCES (shape and tone only) ═════════\n"
        f"{TONE_EXAMPLES}"
        "═══════════════════════════════════\n\n"
        "THE RULE: we don't mention every person, but we do mention every "
        "positive. The people in `rep_callouts` have already been picked for "
        "you from their numbers: each one has `why_they_are_in`. Write a "
        "callout for every one of them, and nobody else. Never mention anyone "
        "not in `rep_callouts`.\n\n"
        "STRUCTURE, in this order:\n"
        "1) OPENER: one line with the day, today's total and where the week "
        "stands (`week_to_date`, `weekly_goal`, `goal_remaining`, "
        "`days_left_in_week`). Today's way in: `opener_style_today`.\n"
        "2) OFFICE KPIs: one or two lines with the office's average per person "
        "today (`office_today.average_kpis_per_person`: `per_person` against "
        "`law_of_averages`), naming either the positive (`strongest`, or "
        "anything in `at_or_above_target`) or the focus for tomorrow (`focus`), "
        "said as what's there to take, never as a telling-off. Always include "
        "this when it's there; if it's empty, leave this part out.\n"
        "3) ROUND OF RESULTS: one callout per person in `rep_callouts`, in "
        "order, a blank line between each. Two lines each:\n"
        "     line 1: '<emoji> *<name>: <sign-ups today>* <vibe emoji>'\n"
        "     line 2: one or two short sentences: well done, what they did and "
        "why it matters, from `why_they_are_in` and their facts.\n"
        "   Emojis: 🔔 = rang the bell (4+ sign-ups; the bell is 4), ⭐ = a "
        "standout under 4, 🎓 = a new BA (`is_new_start`) on line 1.\n"
        "   Lead with their best reason. A new PB (`pb_day`, `pb_week`, "
        "`pb_spoken`) or `first_ever_sign_up` is ALWAYS said. Being on track "
        "for their weekly goal (`on_track_for_weekly_goal`, `weekly_goal_hit`) "
        "is said when it's there. Their goal for the day (`goal_today`) is said "
        "only when they hit or beat it (`hit_goal_today`, `beat_goal_today`). Their traffic light colour (`week_light`, "
        "`moved_up_to`) is THEIR OWN week: Red under 8, Amber 8 to 14, Green "
        "15 to 19, Super Green 20+. Use their numbers on the doors to back it "
        "up (`numbers` against the Law of Averages, `law_of_averages_hit`, "
        "`averages_up`). Under 4 sign-ups, the callout is about the standout "
        "number, never an apology for the sign-ups. Different words for each "
        "person: never the same line twice. Positives only.\n"
        "   Use the name EXACTLY as given (first name, or first name and "
        "initial). Never add a surname.\n"
        "4) VISION: one short line about 200LW (200 sales a week) with 🐒. Vary "
        "it every day: tie it to today (how today's bells move us towards it, "
        "or what a week of days like today would add up to). Never claim we're "
        "at or near it unless the numbers say so.\n"
        f"5) Last line, on its own: {MOTTO}\n\n"
        "RULES:\n"
        "• If `rep_callouts` is empty, skip step 3 and write one honest, upbeat "
        "line instead (the work compounds, tomorrow's the day).\n"
        "• DON'T REPEAT YOURSELF: `recent_messages_do_not_repeat` holds the last "
        "few days' messages. Don't reuse their opener, their sentences, their "
        "vision line or their vibe emojis in the same places. Today should read "
        "fresh.\n"
        "• Never give the office a traffic light colour.\n"
        "• Never compare with the same day last week.\n"
        "• NO DASHES. Never use – or — anywhere in the message. Use a colon "
        "after a name, and full stops or commas in sentences.\n"
        "• Plain text + emojis only. NO markdown headers (no #, no **). Single "
        "asterisks *like this* are OK for WhatsApp bold.\n"
        "• ONLY use names in `rep_callouts`. NEVER use names from the examples "
        "(Owen / Tess / Maya / Liam F) unless they're in `rep_callouts`.\n"
        "• Numbers must match the data exactly. Don't invent sign-ups, goals, "
        "PBs or door numbers; leave out anything the data doesn't have.\n"
        "• No 'champions' / 'rockstars' / 'crushed it'.\n"
        "• Return ONLY the message text: no preamble, no JSON, no quotes.\n"
        f"• {BRITISH_ENGLISH}\n"
        f"• {SELF_EMPLOYED_TERMS}\n\n"
        f"═════════ TODAY'S DATA ═════════\n{summary_context}\n"
    )
