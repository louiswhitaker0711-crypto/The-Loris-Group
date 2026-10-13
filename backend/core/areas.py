"""Area history: where the office has knocked, and how it went.

Built from OwnerIQ's door logs. Every door carries its street and postcode;
`core/field_days.summarise_ba_day` rolls a BA's day up by street into
`areas` on each `owneriq_field_days` record:

    {"pc": "LS6 1AB", "street": "Example Road", "city": "Leeds",
     "doors": 42, "spoken": 25, "pitched": 9, "sales": 2}

Here those are added up three ways, UK-style:

  district   the outward code, "LS6"            (an area to plan a week around)
  sector     district + first inward digit, "LS6 1"   (an evening for a sector)
  street     a street within a postcode sector

For each: when it was last worked, on how many days, doors, spoken to,
sign-ups, and sign-ups per 100 doors (the fair way to compare areas that
got different amounts of work). No database here, so it can be tested.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Iterable, Optional

_ROOM = re.compile(r"[^A-Z0-9 ]")


def clean_pc(pc) -> str:
    """'ls61ab' → 'LS6 1AB'. Anything that doesn't look like a postcode is
    returned tidied but otherwise as it came."""
    s = " ".join(_ROOM.sub("", str(pc or "").upper()).split())
    if not s:
        return ""
    if " " not in s and 5 <= len(s) <= 7 and s[-3].isdigit():
        s = f"{s[:-3]} {s[-3:]}"
    return s


def district(pc) -> str:
    """The outward code: 'LS6 1AB' → 'LS6'; a bare district stays as it is."""
    s = clean_pc(pc)
    return s.split(" ")[0] if s else ""


def postcode_sector(pc) -> str:
    """'LS6 1AB' → 'LS6 1'. A bare district has no sector."""
    s = clean_pc(pc)
    parts = s.split(" ")
    return f"{parts[0]} {parts[1][0]}" if len(parts) == 2 and parts[1][:1].isdigit() else ""


def _blank() -> dict:
    return {"doors": 0, "spoken": 0, "pitched": 0, "sales": 0, "dates": set(), "ba_days": set()}


def _add(cell: dict, a: dict, day: dict) -> None:
    for k in ("doors", "spoken", "pitched", "sales"):
        cell[k] += int(a.get(k) or 0)
    cell["dates"].add(day["date"])
    cell["ba_days"].add((day.get("oid"), day["date"]))


def _finish(key: str, cell: dict, today: Optional[str]) -> dict:
    last = max(cell["dates"]) if cell["dates"] else None
    return {
        "key": key,
        "doors": cell["doors"], "spoken": cell["spoken"], "pitched": cell["pitched"], "sales": cell["sales"],
        "days": len(cell["dates"]), "ba_days": len(cell["ba_days"]),
        "last_worked": last,
        "days_since": (date.fromisoformat(today) - date.fromisoformat(last)).days if last and today else None,
        # Sign-ups per 100 doors: compares areas fairly whatever the effort.
        "per_100": round(100 * cell["sales"] / cell["doors"], 1) if cell["doors"] else None,
        # Sign-ups per BA-day there (a PA for the area).
        "pa": round(cell["sales"] / len(cell["ba_days"]), 1) if cell["ba_days"] else None,
    }


def districts(days: Iterable[dict], today: Optional[str] = None) -> list[dict]:
    """Every district worked, newest first."""
    cells: dict[str, dict] = {}
    for d in days:
        for a in d.get("areas") or []:
            k = district(a.get("pc"))
            if k:
                _add(cells.setdefault(k, _blank()), a, d)
    out = [_finish(k, c, today) for k, c in cells.items()]
    out.sort(key=lambda r: (r["last_worked"] or "", r["doors"]), reverse=True)
    return out


def district_detail(days: Iterable[dict], wanted: str, today: Optional[str] = None) -> dict:
    """One district: its postcode sectors, its streets, and each day it was
    worked (date, doors, sign-ups, who)."""
    wanted = district(wanted)
    total, sectors, streets, visits = _blank(), {}, {}, {}
    for d in days:
        for a in d.get("areas") or []:
            pc = a.get("pc")
            if district(pc) != wanted:
                continue
            _add(total, a, d)
            sec = postcode_sector(pc) or wanted
            _add(sectors.setdefault(sec, _blank()), a, d)
            st = (a.get("street") or "Street").strip()
            cell = streets.setdefault((st, sec), {**_blank(), "city": a.get("city") or ""})
            _add(cell, a, d)
            v = visits.setdefault(d["date"], {"date": d["date"], "doors": 0, "sales": 0, "people": set()})
            v["doors"] += int(a.get("doors") or 0)
            v["sales"] += int(a.get("sales") or 0)
            if d.get("name"):
                v["people"].add(d["name"])
    st_rows = []
    for (st, sec), c in streets.items():
        row = _finish(st, c, today)
        row.update({"street": st, "sector": sec, "city": c.get("city") or ""})
        st_rows.append(row)
    st_rows.sort(key=lambda r: (-(r["per_100"] or 0), -r["doors"]))
    sec_rows = sorted((_finish(k, c, today) for k, c in sectors.items()), key=lambda r: r["key"])
    visit_rows = [{"date": v["date"], "doors": v["doors"], "sales": v["sales"], "people": sorted(v["people"])}
                  for v in sorted(visits.values(), key=lambda v: v["date"], reverse=True)]
    return {"district": wanted, "total": _finish(wanted, total, today) if total["dates"] else None,
            "sectors": sec_rows, "streets": st_rows, "visits": visit_rows}


def lookup(days: Iterable[dict], pc: str, today: Optional[str] = None) -> dict:
    """What the app knows about a postcode a sector leader has typed: its
    district and (if given) postcode sector, with the last few visits."""
    days = list(days)
    det = district_detail(days, pc, today)
    sec = postcode_sector(pc)
    return {
        "postcode": clean_pc(pc), "district": det["district"],
        "district_total": det["total"],
        "sector": next((s for s in det["sectors"] if s["key"] == sec), None) if sec else None,
        "visits": det["visits"][:5],
    }
