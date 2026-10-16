"""Import the office's roll call spreadsheet into Bells — gaps only.

The office kept its weekly Bells in a Google Sheet ("Roll Call"), one tab per
week named by its week-ending Sunday ("WE 2792026" = w/e 27/09/2026). Each tab
has a NAME column, a team label in column A, and two columns per day under the
day's name: the first is Gold sign-ups (gold background), the second Silver
(silver background). A day with no number is coloured:

  black  → No show        (Bells `ns`)
  grey   → Not scheduled  (Bells `ab`)
  yellow → In office      (Bells `pc`)
  red    → not a current BA that week (left alone)

A typed number, including 0, is a day in the field with that many sign-ups.

The app wins: a sheet day is only written onto a Bells day nobody has filled
in (off, no numbers). Rows are matched to people in the office by first name
(plus the surname initial when the sheet gives one, "Louis W", or the letters
of a short name in capitals, "AB").

Someone the sheet has but the app doesn't (they've left, or never had an
account) still comes in, as a VIEW-ONLY row for that week (`archived`, no
user_id): their name and days exactly as the sheet has them. Nobody can edit
it and it never reaches alerts or badges; it's there to look back.

Each imported row also keeps the sheet's team for that week (`sheet_team`, the
team's first row as `sheet_team_leader`) and its place (`sheet_order`), so an
imported week shows in Bells grouped and ordered the way the sheet had it —
who was where at the time (`apply_sheet_teams`). Weeks that weren't imported
group by the app's teams as usual.

Reading is read-only and tab-by-tab (openpyxl read_only): the office's sheet
has hundreds of tabs and opening it whole takes minutes and gigabytes.
"""
from __future__ import annotations

import io
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

DAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
STOP_NAMES = {"total", "scoring bas", "ba's in field", "bas in field", "scoring ratio", "piece average"}
_TAB = re.compile(r"^\s*WE\s*(\d{6,8})\s*$", re.IGNORECASE)
CREATED_BY = "rollcall-import"


# ── Tabs → week-ending dates ────────────────────────────────────────────────
def week_ending_of(tab: str) -> Optional[date]:
    """'WE 2792026' → 2026-09-27. The digits are day, month, year with no
    padding, so '1102026' could be 1/10 or 11/0: the week ending is always a
    Sunday, which settles it. Anything else (other campaigns' tabs, copies)
    is None."""
    m = _TAB.match(tab or "")
    if not m:
        return None
    digits = m.group(1)
    year, dm = int(digits[-4:]), digits[:-4]
    splits = {2: [(1, 1)], 3: [(1, 2), (2, 1)], 4: [(2, 2)]}.get(len(dm), [])
    found = []
    for dl, ml in splits:
        try:
            d = date(year, int(dm[dl: dl + ml]), int(dm[:dl]))
        except ValueError:
            continue
        if d.weekday() == 6:
            found.append(d)
    return found[0] if len(found) == 1 else None


# ── Colours ────────────────────────────────────────────────────────────────
def _rgb(cell) -> Optional[tuple]:
    try:
        fill = cell.fill
        if not fill or not fill.fill_type:
            return None
        v = fill.fgColor.rgb
    except Exception:
        return None
    if not isinstance(v, str) or len(v) < 6:
        return None
    v = v[-6:]
    try:
        return int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16)
    except ValueError:
        return None


def status_from_colour(rgb: Optional[tuple]) -> Optional[str]:
    """The empty-day colours: 'ns' black, 'ab' grey, 'pc' yellow, 'skip' red,
    None for anything else (white, the gold/silver cell backgrounds)."""
    if not rgb:
        return None
    r, g, b = rgb
    if max(r, g, b) <= 0x30:
        return "ns"
    if r >= 0xE0 and g >= 0xE0 and b <= 0x60:
        return "pc"
    if r >= 0xC0 and g <= 0x90 and b <= 0x90:
        return "skip"
    if abs(r - g) <= 0x10 and abs(g - b) <= 0x10 and 0x40 <= r <= 0xB0:
        return "ab"
    return None


def _num(v) -> Optional[int]:
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return int(round(v))
    try:
        return int(round(float(str(v).strip())))
    except ValueError:
        return None


def day_from_cells(gold_cell, silver_cell) -> Optional[dict]:
    """One sheet day → a Bells day, or None when the sheet says nothing."""
    g, s = _num(gold_cell.value), _num(silver_cell.value)
    if g is not None or s is not None:
        return {"over30": g or 0, "under30": s or 0, "memberships": None, "status": "in"}
    st = status_from_colour(_rgb(gold_cell)) or status_from_colour(_rgb(silver_cell))
    if st in ("ns", "ab", "pc"):
        return {"over30": None, "under30": None, "memberships": None, "status": st}
    return None


# ── One tab ────────────────────────────────────────────────────────────────
def read_tab(ws, max_rows: int = 80) -> list[dict]:
    """[{name, team, days: [7 × day|None]}] from one week's tab."""
    rows = list(ws.iter_rows(min_row=1, max_row=max_rows, max_col=40))
    if not rows:
        return []
    header_idx = name_col = None
    day_cols: dict[int, int] = {}
    for ri, row in enumerate(rows[:5]):
        labels = [str(c.value).strip().lower() if c.value is not None else "" for c in row]
        if "name" in labels and "monday" in labels:
            header_idx, name_col = ri, labels.index("name")
            for di, dn in enumerate(DAY_NAMES):
                if dn in labels:
                    day_cols[di] = labels.index(dn)
            break
    if header_idx is None:
        return []
    out = []
    team = ""
    leader = ""
    order = 0
    for row in rows[header_idx + 1:]:
        cells = list(row)
        if len(cells) <= name_col:
            continue
        label = cells[0].value if name_col > 0 else None
        new_team = isinstance(label, str) and label.strip()
        if new_team:
            team = label.strip()
        name = cells[name_col].value
        if not isinstance(name, str) or not name.strip():
            continue
        if name.strip().lower() in STOP_NAMES:
            break
        days = []
        for di in range(7):
            col = day_cols.get(di)
            if col is None or col + 1 >= len(cells):
                days.append(None)
                continue
            day = day_from_cells(cells[col], cells[col + 1])
            # Sunday is grey on every row of the sheet: only a number counts.
            if di == 6 and day and day["status"] != "in":
                day = None
            days.append(day)
        clean = " ".join(name.split())
        if new_team or not leader:
            leader = clean          # a team's first row is the person leading it
        order += 1
        out.append({"name": clean, "team": team, "team_leader": leader, "order": order, "days": days})
    return out


def read_workbook(data: bytes, week_from: date, week_to: date) -> dict[str, list[dict]]:
    """{week_ending ISO: rows} for every weekly tab between the two Sundays.
    A week with two tabs keeps the first (copies come later in the sheet)."""
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    try:
        weeks: dict[str, list[dict]] = {}
        for name in wb.sheetnames:
            we = week_ending_of(name)
            if not we or not (week_from <= we <= week_to) or we.isoformat() in weeks:
                continue
            weeks[we.isoformat()] = read_tab(wb[name])
        return weeks
    finally:
        wb.close()


# ── Names → people ─────────────────────────────────────────────────────────
def _norm(s: str) -> str:
    return " ".join(str(s or "").lower().replace(".", " ").split())


def match_name(sheet_name: str, people: list[dict]) -> tuple[Optional[dict], str]:
    """(person, how) for a sheet name: the whole name, else the first name
    (narrowed by a surname initial if the sheet gives one). None when nobody
    or more than one person fits."""
    n = _norm(sheet_name)
    if not n:
        return None, "blank"
    whole = [p for p in people if _norm(p.get("name")) == n]
    if len(whole) == 1:
        return whole[0], "full name"
    parts = n.split()
    first = [p for p in people if (_norm(p.get("name")).split() or [""])[0] == parts[0]]
    if len(parts) > 1 and len(first) > 1:
        initial = parts[1][0]
        first = [p for p in first if len(_norm(p.get("name")).split()) > 1 and _norm(p.get("name")).split()[-1][0] == initial]
    if len(first) == 1:
        return first[0], "first name"
    # Short names written in capitals ("AB"): the one person whose initials
    # are those letters, or whose first name starts with them.
    raw = " ".join(str(sheet_name or "").split())
    if not first and re.fullmatch(r"[A-Z]{2,3}", raw):
        letters = raw.lower()

        def initials(p):
            ws = _norm(p.get("name")).split()
            return "".join(w[0] for w in ws if w)

        short = [p for p in people
                 if initials(p) == letters
                 or (_norm(p.get("name")).split() or [""])[0].startswith(letters)]
        if len(short) == 1:
            return short[0], "short name"
        if short:
            return None, "more than one person"
    return None, ("more than one person" if first else "no one by that name")


# ── Plan + apply ───────────────────────────────────────────────────────────
def _day_untouched(day: dict) -> bool:
    return (day.get("under30") in (None, 0) and day.get("over30") in (None, 0)
            and day.get("status") in (None, "off", "normal"))


def _empty_day() -> dict:
    return {"over30": None, "under30": None, "memberships": None, "status": "off"}


def merge_days(existing: Optional[list], sheet_days: list) -> tuple[list, int]:
    """The app's week with the sheet's days written into the untouched ones
    only. Returns (days, how many were filled)."""
    days = [dict(d or {}) for d in (existing or [])]
    while len(days) < 7:
        days.append(_empty_day())
    filled = 0
    for i, sd in enumerate(sheet_days[:7]):
        if sd and _day_untouched(days[i]):
            days[i] = dict(sd)
            filled += 1
    return days, filled


async def plan_import(db, office_id: str, weeks: dict[str, list[dict]]) -> dict:
    """What the import would do, writing nothing."""
    people = [{"id": str(u["_id"]), "name": u.get("name") or "", "role": u.get("role")}
              async for u in db.users.find({"office_id": office_id, "deleted": {"$ne": True}},
                                           {"name": 1, "role": 1})]
    matches: dict[str, dict] = {}
    unmatched: dict[str, str] = {}
    plan = []
    for we in sorted(weeks):
        wk = {"week_ending": we, "rows": 0, "days": 0, "new_rows": 0, "view_only_rows": 0, "people": []}
        for row in weeks[we]:
            if not any(row["days"]):
                continue
            person, how = match_name(row["name"], people)
            if not person:
                unmatched.setdefault(row["name"], how)
                existing = await db.bells_entries.find_one(
                    {"office_id": office_id, "week_ending": we, "archived": True, "user_name": row["name"]},
                    {"_id": 0, "days": 1})
                _, filled = merge_days((existing or {}).get("days"), row["days"])
                if filled:
                    wk["view_only_rows"] += 0 if existing else 1
                    wk["days"] += filled
                continue
            matches.setdefault(row["name"], {"sheet_name": row["name"], "user_id": person["id"],
                                             "app_name": person["name"], "how": how})
            existing = await db.bells_entries.find_one(
                {"office_id": office_id, "week_ending": we, "user_id": person["id"]}, {"_id": 0, "days": 1})
            _, filled = merge_days((existing or {}).get("days"), row["days"])
            if not filled:
                continue
            wk["rows"] += 1
            wk["days"] += filled
            wk["new_rows"] += 0 if existing else 1
            wk["people"].append({"name": person["name"], "days": filled})
        plan.append(wk)
    return {"weeks": plan,
            "matched": sorted(matches.values(), key=lambda m: m["sheet_name"].lower()),
            "unmatched": [{"sheet_name": k, "why": v} for k, v in sorted(unmatched.items(), key=lambda kv: kv[0].lower())],
            "view_only_rows": sum(w["view_only_rows"] for w in plan),
            "total_days": sum(w["days"] for w in plan)}


async def apply_import(db, office_id: str, weeks: dict[str, list[dict]], fees: Optional[dict],
                       compute_totals, actor_id: str) -> dict:
    """Write the sheet's days into the untouched Bells days."""
    people = [{"id": str(u["_id"]), "name": u.get("name") or "", "role": u.get("role")}
              async for u in db.users.find({"office_id": office_id, "deleted": {"$ne": True}},
                                           {"name": 1, "role": 1})]
    now = datetime.now(timezone.utc).isoformat()
    filled_days = rows_written = rows_created = view_only = 0
    for we in sorted(weeks):
        for row in weeks[we]:
            if not any(row["days"]):
                continue
            sheet = {"sheet_team": row.get("team") or "", "sheet_team_leader": row.get("team_leader") or row["name"],
                     "sheet_order": row.get("order") or 0}
            person, _ = match_name(row["name"], people)
            if person:
                q = {"office_id": office_id, "week_ending": we, "user_id": person["id"]}
                base = {"user_name": person["name"], "role": person["role"]}
            else:
                # Not in the app: a view-only row under the sheet's name.
                q = {"office_id": office_id, "week_ending": we, "user_id": None,
                     "archived": True, "user_name": row["name"]}
                base = {"role": "trainee"}
            existing = await db.bells_entries.find_one(q, {"_id": 0})
            days, filled = merge_days((existing or {}).get("days"), row["days"])
            if existing:
                doc = {**existing, "days": days}
                await db.bells_entries.update_one({"id": existing["id"]}, {"$set": {
                    "days": days, "earnings": compute_totals(doc, fees).get("earnings", 0.0),
                    **sheet, "rollcall_imported_at": now, "updated_at": now}})
            else:
                doc = {"id": str(uuid.uuid4()), **q, **base,
                       "stage": None, "break_even": None, "weekly_goal": None, "last_week_total": None,
                       "last_week_total_source": None, "days": days, "created_by_id": CREATED_BY,
                       "imported_by_id": actor_id, "rollcall_imported_at": now, **sheet,
                       "created_at": now, "updated_at": now}
                doc["earnings"] = compute_totals(doc, fees).get("earnings", 0.0)
                await db.bells_entries.insert_one(dict(doc))
                rows_created += 1
                if not person:
                    view_only += 1
            rows_written += 1
            filled_days += filled
    return {"days_filled": filled_days, "rows_updated": rows_written - rows_created,
            "rows_created": rows_created, "view_only_rows": view_only}


def apply_sheet_teams(entries: list) -> list:
    """An imported week reads the way the sheet had it: each imported row under
    its sheet team (a header named for the team, led by its first row) in the
    sheet's order. Saved rows the sheet didn't have follow after; empty
    placeholder rows (people with no saved week) are dropped, since the sheet
    already says who was there. A week with no imported rows is untouched."""
    if not any(e.get("sheet_team") is not None and e.get("rollcall_imported_at") for e in entries):
        return entries
    sheet_rows, others = [], []
    for e in entries:
        if e.get("rollcall_imported_at") and e.get("sheet_team") is not None:
            team = (e.get("sheet_team") or "").strip() or "Roll call"
            t = {"leader_id": f"sheet:{team}", "leader_name": e.get("sheet_team_leader") or "", "team_name": team}
            e["primary_team"] = t
            e["teams"] = [t]
            sheet_rows.append(e)
        elif e.get("id"):
            others.append(e)
    sheet_rows.sort(key=lambda e: e.get("sheet_order") or 0)
    return sheet_rows + others


def default_range(today: date) -> tuple[date, date]:
    """Twelve weeks back to last week (the current week is live in the app)."""
    this_sunday = today + timedelta(days=6 - today.weekday())
    last = this_sunday - timedelta(days=7)
    return last - timedelta(weeks=11), last
