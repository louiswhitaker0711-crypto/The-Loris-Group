"""Quality: Acwyre's weekly Modern Milkman quality report (Power BI), per BA.

The report is a page of tables, one per measure, for a week ending ("WE"):
Sales Volume, AOV, Drops, 4th Delivery % and Fail Rate (and The Round when
it's there). Each table's first column ("MC") is the row label: the office
rollup ("Ginger Leeds"), then one row per BA as "First L BADGE" (e.g.
"Example P MMC1234" or "Example P 12345"), then "Total".

It reaches the app as a screenshot (read by the AI into the shape below) or
as Excel exports of the tables. Either way it becomes:

  {"week_ending": "YYYY-MM-DD",
   "rows":  [{"label", "badge", "metrics": {key: value}}],
   "total": {key: value}}

Colours follow the Owner's quality targets (Campaign Knowledge, "Quality and
KPIs"): £13+ order value, 2.5+ drop days, fails under 10%, 75%+ taking The
Round, 75%+ reaching their 4th week. No database here, so it's tested alone.
"""
from __future__ import annotations

import io
import json
import re
import zipfile
from datetime import date, datetime
from xml.etree import ElementTree as ET

# key, label, value kind
MEASURES = [
    ("sales", "Sales", "int"),
    ("aov", "Order value", "money"),
    ("drops", "Drop days", "num"),
    ("the_round", "The Round", "pct"),
    ("fourth_week", "4th week", "pct"),
    ("fail_rate", "Fails", "pct"),
]
KINDS = {k: kind for k, _, kind in MEASURES}
LABELS = {k: label for k, label, _ in MEASURES}

# Green at or above `green`, amber at or above `amber`, red below; for fails
# (lower is better) green under `green`, amber under `amber`, red above.
TARGETS = {
    "aov": {"green": 13, "amber": 10, "text": "£13+"},
    "drops": {"green": 2.5, "amber": 2.1, "text": "2.5+"},
    "the_round": {"green": 75, "amber": 60, "text": "75%+"},
    "fourth_week": {"green": 75, "amber": 60, "text": "75%+"},
    "fail_rate": {"green": 10, "amber": 20, "lower_is_better": True, "text": "under 10%"},
}

# The report's column headers → our keys (lower-case "contains" matches).
HEADER_KEYS = [
    ("fail", "fail_rate"),
    ("4th", "fourth_week"),
    ("fourth", "fourth_week"),
    ("round", "the_round"),
    ("membership", "the_round"),
    ("aov", "aov"),
    ("order value", "aov"),
    ("drop", "drops"),
    ("sales", "sales"),
]

ROLLUP_LABELS = {"total", "grand total"}
BADGE_RE = re.compile(r"\s([A-Z]{0,4}\d{3,})$")
# Sane limits, so a misread number can't land as something silly.
LIMITS = {"sales": (0, 1000), "aov": (0, 500), "drops": (0, 7), "the_round": (0, 100),
          "fourth_week": (0, 100), "fail_rate": (0, 100)}


def rag(key: str, value) -> str | None:
    rule = TARGETS.get(key)
    if rule is None or value is None:
        return None
    if rule.get("lower_is_better"):
        return "green" if value < rule["green"] else ("amber" if value < rule["amber"] else "red")
    return "green" if value >= rule["green"] else ("amber" if value >= rule["amber"] else "red")


def parse_value(raw, kind: str):
    """'£11.60', '13.10 %', '43.00', 0.131 (Excel %), None → a number or None."""
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        v = float(raw)
    else:
        t = str(raw).strip().replace(",", "").replace("£", "").replace("%", "").strip()
        if not t or t.upper() in ("N/A", "NA", "-", "(BLANK)"):
            return None
        m = re.match(r"^-?\d+(\.\d+)?", t)
        if not m:
            return None
        v = float(m.group(0))
    if kind == "int":
        return int(round(v))
    return round(v, 4) if kind == "pct" else round(v, 2)  # Excel keeps 13.1% as 0.131


def clean_metrics(m: dict | None) -> dict:
    out = {}
    for key, kind in KINDS.items():
        v = parse_value((m or {}).get(key), kind)
        if v is None:
            continue
        lo, hi = LIMITS[key]
        if lo <= v <= hi:
            out[key] = v
    return out


def badge_of(label: str) -> str | None:
    m = BADGE_RE.search((label or "").strip())
    return m.group(1).upper() if m else None


def header_key(text: str) -> str | None:
    t = (text or "").strip().lower()
    if not t or t == "mc":
        return None
    for needle, key in HEADER_KEYS:
        if needle in t:
            return key
    return None


def parse_week(text) -> str | None:
    """'04 October 2026', '04/10/2026', '2026-10-04' → '2026-10-04'."""
    if isinstance(text, (date, datetime)):
        return (text.date() if isinstance(text, datetime) else text).isoformat()
    t = re.sub(r"\s+", " ", str(text or "").strip())
    for fmt in ("%Y-%m-%d", "%d %B %Y", "%d %b %Y", "%d/%m/%Y", "%d/%m/%y", "%A %d %B %Y"):
        try:
            return datetime.strptime(t, fmt).date().isoformat()
        except ValueError:
            continue
    m = re.search(r"(\d{1,2} [A-Za-z]+ \d{4}|\d{1,2}/\d{1,2}/\d{2,4}|\d{4}-\d{2}-\d{2})", t)
    return parse_week(m.group(1)) if m and m.group(1) != t else None


def from_tables(tables: list[list[list]]) -> dict:
    """Grids of cells (each an exported table, or one sheet holding several)
    → {week_ending, rows, total}. A table's header row is the one starting
    'MC'; any measure columns it has are read for each BA row under it."""
    rows: dict[str, dict] = {}
    total: dict = {}
    week = None
    for grid in tables:
        cols: dict[int, str] = {}
        for r in grid:
            cells = ["" if c is None else c for c in r]
            if not cells:
                continue
            first = str(cells[0]).strip()
            if not week:
                for c in cells:
                    if isinstance(c, (date, datetime)) or (isinstance(c, str) and re.search(r"\bWE\b|week ending", c, re.I)):
                        week = parse_week(c) or week
            if first.upper() == "MC":
                cols = {i: k for i, c in enumerate(cells) if (k := header_key(str(c)))}
                continue
            if not cols or not first:
                continue
            vals = {k: cells[i] for i, k in cols.items() if i < len(cells)}
            if first.lower() in ROLLUP_LABELS:
                total.update(clean_metrics(vals))
                continue
            badge = badge_of(first)
            if not badge:
                continue  # the office rollup row ("Ginger Leeds")
            row = rows.setdefault(badge, {"label": first, "badge": badge, "metrics": {}})
            row["metrics"].update(clean_metrics(vals))
    return finish({"week_ending": week, "rows": list(rows.values()), "total": total})


def from_ai(text: str) -> dict:
    """The AI's JSON reading of a screenshot → {week_ending, rows, total}."""
    t = (text or "").strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    start, end = t.find("{"), t.rfind("}")
    data = json.loads(t[start:end + 1]) if start >= 0 and end > start else {}
    rows: dict[str, dict] = {}
    for r in data.get("rows") or []:
        label = re.sub(r"\s+", " ", str(r.get("label") or "")).strip()
        badge = badge_of(label) or (str(r.get("badge") or "").strip().upper() or None)
        if not badge or label.lower() in ROLLUP_LABELS:
            continue
        if not badge_of(label):
            label = f"{label} {badge}".strip()
        rows.setdefault(badge, {"label": label, "badge": badge, "metrics": {}})["metrics"].update(clean_metrics(r))
    return finish({"week_ending": parse_week(data.get("week_ending")), "rows": list(rows.values()),
                   "total": clean_metrics(data.get("total"))})


def merge(parts: list[dict]) -> dict:
    """Several readings of the same week (one per screenshot or file)."""
    rows: dict[str, dict] = {}
    total: dict = {}
    week = None
    for p in parts:
        week = week or p.get("week_ending")
        total.update(p.get("total") or {})
        for r in p.get("rows") or []:
            cur = rows.setdefault(r["badge"], {"label": r["label"], "badge": r["badge"], "metrics": {}})
            cur["metrics"].update(r.get("metrics") or {})
    return finish({"week_ending": week, "rows": list(rows.values()), "total": total})


def finish(rep: dict) -> dict:
    """4th week only counts once it's due: a week where everyone (and the
    total) shows 0% hasn't reached the 4th delivery yet, so it's left blank."""
    rows = rep.get("rows") or []
    fw = [r["metrics"].get("fourth_week") for r in rows if "fourth_week" in r["metrics"]]
    if fw and all(v == 0 for v in fw) and not (rep.get("total") or {}).get("fourth_week"):
        for r in rows:
            r["metrics"].pop("fourth_week", None)
        (rep.get("total") or {}).pop("fourth_week", None)
        rep["fourth_week_due"] = False
    rows.sort(key=lambda r: r["label"].lower())
    return rep


def signups(w: dict) -> float | None:
    """Everything a person signed up that week, fails included, worked back
    from their sales (which leave fails out) and fail rate: 8 sales at a 20%
    fail rate is 10 sign-ups. All failed with no sales counts as 1."""
    s, f = w.get("sales"), w.get("fail_rate")
    if s is None:
        return None
    if f is None or f <= 0:
        return float(s)
    if f >= 100:
        return float(s) if s else 1.0
    return s / (1 - f / 100)


def aggregate(weeks: list[dict]) -> dict:
    """Several people's or weeks' numbers → one set, the way the Power BI
    report adds them up: by volume, never a plain average of everyone's
    figures, so someone with 17 sales counts 17 times as much as someone
    with 1.

      sales            added up
      fails            total fails ÷ total sign-ups (sales + fails)
      order value,     weighted by sign-ups (the report's order value
      drop days        includes the failed orders)
      The Round,       weighted by sales
      4th week

    A row with no sales figure counts once; 0 sales and no fails doesn't
    count towards the averages."""
    out: dict = {}
    sales = [w["sales"] for w in weeks if w.get("sales") is not None]
    if sales:
        out["sales"] = sum(sales)
    su_num = su_den = 0.0
    for key, _, _ in MEASURES:
        if key == "sales":
            continue
        num = den = 0.0
        for w in weeks:
            v = w.get(key)
            if v is None:
                continue
            if key in ("aov", "drops", "fail_rate"):
                g = signups(w)
                weight = 1.0 if g is None else g
            else:
                weight = 1.0 if w.get("sales") is None else w["sales"]
            num += v * weight
            den += weight
        if den:
            out[key] = round(num / den, 2)
    return out


VIEWS = [("week", "Week"), ("4w", "4 weeks"), ("month", "Month"), ("13w", "13 weeks"), ("all", "All time")]
_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
           "September", "October", "November", "December"]


def week_label(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"WE {d.day} {d.strftime('%b %Y')}"


def month_label(ym: str) -> str:
    y, m = ym.split("-")
    return f"{_MONTHS[int(m) - 1]} {y}"


def pick_weeks(weeks: list[str], view: str, week: str | None = None, month: str | None = None):
    """The saved weeks (newest first) → (weeks in the period, the period
    before it for comparison, a label). A month holds the weeks that end in
    it; 4 and 13 weeks run back from `week` (the newest if not given)."""
    if not weeks:
        return [], [], ""
    if view == "all":
        return list(weeks), [], f"All time · {len(weeks)} week{'' if len(weeks) == 1 else 's'} since {week_label(weeks[-1])}"
    if view == "month":
        months = sorted({w[:7] for w in weeks}, reverse=True)
        ym = month if month in months else months[0]
        i = months.index(ym)
        before = [w for w in weeks if i + 1 < len(months) and w[:7] == months[i + 1]]
        return [w for w in weeks if w[:7] == ym], before, month_label(ym)
    i = weeks.index(week) if week in weeks else 0
    n = {"4w": 4, "13w": 13}.get(view, 1)
    now, before = weeks[i:i + n], weeks[i + n:i + 2 * n]
    if n == 1:
        return now, before, week_label(now[0])
    return now, before, f"{len(now)} week{'' if len(now) == 1 else 's'} to {week_label(now[0])}"


# ── Excel (.xlsx) without extra libraries ────────────────────────────────
_NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def _col(ref: str) -> int:
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1


def xlsx_tables(data: bytes) -> list[list[list]]:
    """Every sheet of an .xlsx as a grid of cell values (text or numbers)."""
    z = zipfile.ZipFile(io.BytesIO(data))
    names = z.namelist()
    shared: list[str] = []
    if "xl/sharedStrings.xml" in names:
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall("m:si", _NS):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{_NS['m']}}}t")))
    out = []
    for name in sorted(n for n in names if re.match(r"xl/worksheets/sheet\d+\.xml$", n)):
        root = ET.fromstring(z.read(name))
        grid: list[list] = []
        for row in root.iter(f"{{{_NS['m']}}}row"):
            cells: list = []
            for c in row.findall("m:c", _NS):
                i = _col(c.get("r", "A1"))
                v = c.find("m:v", _NS)
                t = c.get("t")
                if t == "s" and v is not None:
                    val = shared[int(v.text)]
                elif t == "inlineStr":
                    val = "".join(x.text or "" for x in c.iter(f"{{{_NS['m']}}}t"))
                elif v is not None and v.text is not None:
                    try:
                        val = float(v.text)
                    except ValueError:
                        val = v.text
                else:
                    val = None
                while len(cells) < i:
                    cells.append(None)
                cells.append(val)
            grid.append(cells)
        out.append(grid)
    return out


def excel_percent_fix(rep: dict) -> dict:
    """Excel keeps 13.10% as 0.131: a % measure whose values are all at most 1
    across the file is scaled up."""
    for key in ("the_round", "fourth_week", "fail_rate"):
        vals = [r["metrics"][key] for r in rep["rows"] if key in r["metrics"]]
        tot = (rep.get("total") or {}).get(key)
        if vals and max(vals + ([tot] if tot is not None else [])) <= 1:
            for r in rep["rows"]:
                if key in r["metrics"]:
                    r["metrics"][key] = round(r["metrics"][key] * 100, 2)
            if tot is not None:
                rep["total"][key] = round(tot * 100, 2)
    return rep


AI_PROMPT = """This is a screenshot of a weekly quality report (Power BI) for a door-to-door sales office.
It has a week ending ("WE") and one or more tables. Each table's first column is "MC": an office row,
then one row per person written like "Example P MMC1234" or "Example P 12345", then "Total".
The tables are measures such as Sales Volume, AOV, Drops, 4th Delivery %, Fail Rate and possibly The Round.

Read every number exactly as shown. Return ONLY JSON, no commentary:
{"week_ending": "YYYY-MM-DD or null",
 "rows": [{"label": "the MC text exactly, name and badge", "sales": number|null, "aov": number|null,
           "drops": number|null, "fourth_week": number|null, "fail_rate": number|null, "the_round": number|null}],
 "total": {"sales": ..., "aov": ..., "drops": ..., "fourth_week": ..., "fail_rate": ..., "the_round": ...}}
Percentages as plain numbers (13.10 % → 13.1). Money without the £. Use null for a measure not in the
screenshot. One entry per person, combining all the tables. Leave out the office row."""
