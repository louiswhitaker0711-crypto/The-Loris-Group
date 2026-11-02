# Claude connector

Lets Claude (claude.ai, any chat) read the team's numbers to help plan the week, run leaders meetings and spot who needs what, and fill in plans in the app when you say yes. Read-only from 25 Oct 2026; writes and personal links from 2 Nov 2026.

It runs on the person's own Claude account, so it costs the app nothing (the in-app AI is separate and uses `ANTHROPIC_API_KEY`).

## Two kinds of link

| Link | Made where | Sees | Writes as |
| --- | --- | --- | --- |
| **Personal link** | In the app: **Profile → Connect Claude** | What that person can see in the app (an Admin or Coach+ the whole office; a Coach their team; a BA themselves), plus office totals | That person, with their own permissions |
| **The Owner's original link** | Railway variable `CLAUDE_CONNECTOR_TOKEN` | The whole office, as the Owner | The Owner |

Admins can always make a personal link. Anyone else can once an Admin switches it on for them (Connect Claude → Who can connect Claude). A personal link is shown once and stored only as a hash; making a new one stops the old one working, and Disconnect turns it off.

## What Claude can read

| Tool | What it reads |
| --- | --- |
| `get_me` | Everything about the link's person in one go: their weeks, the office's weeks, their page, recent set-ups and breakdowns, this week's planner, their team's weeks, latest quality |
| `get_team` | People in the office: role, team, Coach, stage, start date, new-start day |
| `get_bells_week` | One week's Bells: each day's status and Gold / Silver / The Round, goal, last week, traffic light, piece average, scoring, reliability, office totals |
| `get_recent_weeks` | Each person's and the office's weekly totals over the last N weeks |
| `get_person` | One person's page: recent weeks, law of averages, COD position, Days 1–8, weekly COD focus |
| `get_field_numbers` | Doors → spoken to → pitched → closed → sign-ups from the breakdowns, per BA and office |
| `get_sectors` | Sectors for a day or week: leader, goal, bunny hops, shadows, set-ups and breakdowns |
| `get_quality` | Acwyre's weekly quality report per BA, against the targets |

On a personal link, people outside what that person can see are left out (office totals still count everyone).

## What Claude can fill in

Each is marked as changing the app, so Claude shows what it will write and asks first.

| Tool | What it writes |
| --- | --- |
| `set_weekly_goal` | Their own weekly goal on Bells, this week |
| `save_setup` | A sector set-up: goal, focus, KPI and target, a positive. Their own, or someone they lead or coach. Keeps the COD pick |
| `write_planner` | One box of a day in their own weekly planner (adds to it unless told to replace) |
| `add_planner_note` | A note in a day's Notes box in their own planner |
| `set_bunny_hops` | Bunny hops for a sector they lead (an Admin: any sector) |

Never sent: emails, phone numbers, photos, badge numbers, passwords, the office's MC fees.

## Connect a personal link

1. In the app: **Profile → Connect Claude → Make my link**, then **Copy link**.
2. In Claude, add a custom connector, name it "The Loris Hub" and paste the link as its address. No sign-in details needed.
3. In a chat, switch the connector on and ask, for example, "How did my week go?" or "Fill in tomorrow's set-up".

## The Owner's original link (optional)

1. Make a long random secret (32+ characters): Mac `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`.
2. Railway → your service → **Variables** → add `CLAUDE_CONNECTOR_TOKEN` with that secret. Railway redeploys.
3. Add it in Claude as above, with the address `https://<your app address>/mcp/<the secret>`.

The secret in the address is the only lock, so treat any link like a password. To cut the original link off, change or delete `CLAUDE_CONNECTOR_TOKEN` on Railway.

Optional: `CLAUDE_CONNECTOR_OFFICE_ID` picks the office for the original link when the app has more than one (default: the Owner's).
