# Waiting to build

Agreed changes that aren't built yet. Add a line when something is agreed; remove it when it ships (note the PR). Check this file and the git log before saying what's outstanding.

## Agreed, not built

- BA Academy Day 2 workbook (`frontend/src/academy/`): waiting on the Owner's Day 2 running order. Add three sections the final quiz tests but the slides don't cover: Code of Practice / compliance (where hidden slide 39 sits, after practising the introduction), avoiding fails, and The Round + 2.5+ drops in Sales quality; red-flag customers in Who we can't sign up; "it's a subscription, be honest about cancelling" in the sign-up process and Rehash. The final quiz (Microsoft Form) ends Day 2.

## Needs a decision

- Final quiz (Microsoft Form) fixes to suggest to the Owner: AOV target reads £12+ (the Owner's figure is £13+); a fail option reads "under £4" (rule is under £5); "going away for three weeks" best answer B makes the start date over 8 days (a fail). Also whether to keep the Form as a link or rebuild it in the app.

## Recently shipped

- 26 Oct: Set up today's new starts (`/new-starts`, `routes/new_starts.py`): a big button on the Owner's Home Mon/Tue 13:30–16:00 (also Home quick actions). The app's QR code; add a new start by name + email (no Coach until Wednesday); shows a starter password to read out and a personal QR (`/public/join?t=`) that signs them straight in once they choose their own password; a live list of who's in, with Show login again.
- 26 Oct: BA Academy Day 1 workbook (`/academy/1`, `routes/academy.py`): new starts fill in gaps, notes and 3 quizzes on their phone in the Owner's running order; saves to their account as they type; a card on their Home on Days 1–2; the Owner's Home shows the class's progress, quiz scores and questions, and opens anyone's workbook read-only. Pay figures come from Rates.
- 25 Oct: read-only Claude connector (`/mcp/<token>`, docs/CLAUDE_CONNECTOR.md): Claude can read the team, Bells, recent weeks, person pages, field numbers, sectors and quality; no contact details. Off until `CLAUDE_CONNECTOR_TOKEN` is set on Railway.
- 24 Oct: Quality: The Round, 4th week and Fails read as percentages whatever the file (0.3 → 30%, 1 → 100%), Excel and screenshots alike; weeks already saved corrected once on the next start, and Power BI's "Applied filters" note no longer saved as a BA (removed from saved weeks too); saved rows nobody was linked to link themselves to the BA once their badge or name is in the app.
- 24 Oct: G.I.F.T.S now the Modern Milkman booklet's (Greed, Indifference, Fear of loss, The Jones theory, Sense of urgency) on the CoD Impulses item, its quiz and the Day 5 checklist; live content updated on the next start.

- 22 Oct: Daily Assessment "Below Average" reads "Needs Work" (stored value unchanged); Intro/Presentation/Short Story/Close/Rehash graded once in the 5 Steps and no longer asked again in Skills; KPIs prefilled from that day's breakdown and editable; OwnerIQ's Stage 3+ reads "SL".
- 21–22 Oct: shadows/solos/Academy days (#141), Coaching today (#140), set-ups at 12:15, KPIs from Bells (#139), photo scans, Bells Excel export (#138), public Bells (#135), Quality upload (#134), sector hops (#137), Home sector first (#136).
