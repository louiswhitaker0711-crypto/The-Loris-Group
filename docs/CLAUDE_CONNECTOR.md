# Claude connector (read-only)

Lets the Owner's Claude (claude.ai, any chat) read the team's numbers so it can help plan the week, run leaders meetings and spot who needs what. Agreed 25 Oct 2026.

## What Claude can see

Read only. Claude can't change anything in the app through it.

| Tool | What it reads |
| --- | --- |
| `get_team` | Everyone in the office: role, team, Coach, stage, start date, new-start day |
| `get_bells_week` | One week's Bells: each day's status and Gold / Silver / The Round, goal, last week, traffic light, piece average, scoring, reliability, office totals |
| `get_recent_weeks` | Each person's and the office's weekly totals over the last N weeks |
| `get_person` | One person's page: recent weeks, law of averages, COD position, Days 1–8, weekly COD focus |
| `get_field_numbers` | Doors → spoken to → pitched → closed → sign-ups from the breakdowns, per BA and office |
| `get_sectors` | Sectors for a day or week: leader, goal, bunny hops, shadows, set-ups and breakdowns |
| `get_quality` | Acwyre's weekly quality report per BA, against the targets |

Never sent: emails, phone numbers, photos, badge numbers, passwords, the office's MC fees.

## Turn it on

1. Make a long random secret (32+ characters): Mac `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`.
2. Railway → your service → **Variables** → add `CLAUDE_CONNECTOR_TOKEN` with that secret. Railway redeploys.
3. claude.ai → **Settings → Connectors → Add custom connector**. Name it "The Loris Hub", URL `https://<your app address>/mcp/<the secret>`. No sign-in details needed.
4. In a chat, switch the connector on and ask, for example, "Look at last week's Bells and tell me what the team needs".

The secret in the address is the only lock, so treat the address like a password. To cut access off, change or delete `CLAUDE_CONNECTOR_TOKEN` on Railway.

Optional: `CLAUDE_CONNECTOR_OFFICE_ID` picks the office when the app has more than one (default: the Owner's).
