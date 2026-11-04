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
# The 4th week report's counts: how many signed up that week ("1st Week")
# and how many of them reached their 4th delivery ("4th Week").
COUNTS = {"fourth_week_n": "int", "fourth_week_of": "int",
          # The office's own counts from the PDF: everyone signed up (fails
          # included) and how many failed.
          "signups_n": "int", "fails_n": "int"}
KINDS = {**{k: kind for k, _, kind in MEASURES}, **COUNTS}
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
# Header of the column holding the person in an Excel export (spaces and _ ignored).
NAME_HEADERS = {"namebadge", "name", "ba", "rep", "badge"}
BADGE_RE = re.compile(r"\s([A-Z]{0,4}\d{3,})$")
# Sane limits, so a misread number can't land as something silly.
LIMITS = {"fourth_week_n": (0, 1000), "fourth_week_of": (0, 1000), "signups_n": (0, 5000), "fails_n": (0, 5000), "sales": (0, 1000), "aov": (0, 500), "drops": (0, 7), "the_round": (0, 100),
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


def is_filter_note(label) -> bool:
    """Power BI's note of the filters under a table ("Applied filters: …"),
    never a person, though it can end in a year that looks like a badge."""
    t = str(label or "")
    return "\n" in t.strip() or t.strip().lower().startswith("applied filter")


def badge_of(label: str) -> str | None:
    m = BADGE_RE.search((label or "").strip())
    return m.group(1).upper() if m else None


def header_key(text: str) -> str | None:
    t = (text or "").strip().lower()
    if not t or t == "mc":
        return None
    # The 4th Delivery page: "1st Week" and "4th Week" are counts of
    # customers, "4th Week Rate" the percentage.
    if "1st week" in t or "first week" in t:
        return "fourth_week_of"
    if ("4th week" in t or "fourth week" in t) and "rate" not in t and "%" not in t:
        return "fourth_week_n"
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
        label_col = 0
        for r in grid:
            cells = ["" if c is None else c for c in r]
            if not cells:
                continue
            first = str(cells[0]).strip()
            if not week:
                for c in cells:
                    if isinstance(c, (date, datetime)) or (isinstance(c, str) and re.search(r"\bWE\b|week\s*_?\s*ending", c, re.I)):
                        week = parse_week(c) or week
            if first.upper() == "MC":
                # The person can be in the MC column ("Example P MMC1234") or, in
                # an Excel export, a "NameBadge" column next to the office.
                label_col = next((i for i, c in enumerate(cells)
                                  if re.sub(r"[\s_]", "", str(c)).lower() in NAME_HEADERS), 0)
                cols = {}
                for i, c in enumerate(cells):
                    k = header_key(str(c)) if i != label_col else None
                    if not k:
                        continue
                    prev = next((j for j, kk in cols.items() if kk == k), None)
                    if prev is not None:
                        # One measure twice (e.g. Memberships, and Membership %): keep the %.
                        if "%" in str(c) and "%" not in str(cells[prev]):
                            del cols[prev]
                        else:
                            continue
                    cols[i] = k
                continue
            first = str(cells[label_col]).strip() if label_col < len(cells) else ""
            if not cols or not first:
                continue
            if is_filter_note(first):
                continue   # Power BI's note of the filters under an export
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
        if not badge or label.lower() in ROLLUP_LABELS or is_filter_note(r.get("label")):
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


def merge_week(old_bas: list[dict], old_total: dict, new_bas: list[dict], new_total: dict):
    """A second upload for a week already saved: each person's new numbers
    are added to (or replace) their saved ones; anyone not in the new upload
    is kept as they were."""
    by = {b["badge"]: {**b, "metrics": dict(b.get("metrics") or {})} for b in old_bas}
    for b in new_bas:
        cur = by.get(b["badge"])
        if cur:
            cur["metrics"].update(b.get("metrics") or {})
            cur["user_id"] = b.get("user_id") or cur.get("user_id")
            cur["label"] = b.get("label") or cur.get("label")
        else:
            by[b["badge"]] = b
    return list(by.values()), {**(old_total or {}), **(new_total or {})}


def finish(rep: dict) -> dict:
    """4th week only counts once it's due: a week where everyone (and the
    total) shows 0% hasn't reached the 4th delivery yet, so it's left blank."""
    rows = rep.get("rows") or []
    for m in [r["metrics"] for r in rows] + [rep.get("total") or {}]:
        # Counts but no rate: work the rate out (8 of 10 → 80%).
        if m.get("fourth_week") is None and m.get("fourth_week_of") and m.get("fourth_week_n") is not None:
            m["fourth_week"] = round(m["fourth_week_n"] / m["fourth_week_of"] * 100, 2)
    counted = any("fourth_week_of" in r["metrics"] for r in rows)
    fw = [r["metrics"].get("fourth_week") for r in rows if "fourth_week" in r["metrics"]]
    if fw and not counted and all(v == 0 for v in fw) and not (rep.get("total") or {}).get("fourth_week"):
        for r in rows:
            r["metrics"].pop("fourth_week", None)
        (rep.get("total") or {}).pop("fourth_week", None)
        rep["fourth_week_due"] = False
    rows.sort(key=lambda r: r["label"].lower())
    return rep


# The 4th week report for a week's sign-ups comes in 8 weeks later, alongside
# that week's quality report (4th week for WE 30 Aug with the report for WE
# 25 Oct), and shows on that later week (the Owner, 3 Nov 2026).
FOURTH_WEEK_LAG_DAYS = 56
FOURTH_WEEK_KEYS = {"fourth_week", "fourth_week_n", "fourth_week_of"}


def is_fourth_week_report(rep: dict) -> bool:
    """A reading holding only 4th week figures: the 4th Delivery page."""
    keys = set((rep.get("total") or {}).keys())
    for r in rep.get("rows") or []:
        keys |= set((r.get("metrics") or {}).keys())
    return bool(keys) and keys <= FOURTH_WEEK_KEYS


def fourth_week_shows_on(signed_up_week: str | None) -> str | None:
    """The week a sign-up week's 4th week figures show on: 8 weeks later."""
    if not signed_up_week:
        return None
    from datetime import timedelta
    return (date.fromisoformat(signed_up_week) + timedelta(days=FOURTH_WEEK_LAG_DAYS)).isoformat()


def counts(w: dict) -> tuple | None:
    """(fails, sign-ups) for one person's or the office's week, exactly.

    Power BI gives each BA a fail % but no counts, and its per-BA "Sales
    Volume" is a smaller figure than everything they signed up. A fail % is
    a fraction, though: 28.57% can only be 2 of 7, 27.27% 3 of 11. So the
    sign-ups are the smallest whole number, at least their sales, that
    gives that % exactly (the Owner, 4 Nov 2026: sales on the Quality page
    and bulletin are everything signed up, fails included). 0% is no fails
    out of their sales; 100% with no sales is 1 of 1. The office's own
    counts from the PDF (`signups_n`, `fails_n`) win."""
    rate, s = w.get("fail_rate"), w.get("sales")
    if w.get("signups_n") is not None:
        n = int(w["signups_n"])
        if w.get("fails_n") is not None:
            return int(w["fails_n"]), n
        return (int(round(rate * n / 100)) if rate is not None else None), n
    if rate is None:
        return (None, int(s)) if s is not None else None
    if rate <= 0:
        return 0, int(s or 0)
    lo = max(1, int(s or 0))
    for d in range(lo, lo + 1000):
        k = int(round(rate * d / 100))
        if k >= 1 and abs(k * 100 / d - rate) <= 0.0051:
            return k, d
    if s is None or rate >= 100:
        return None
    g = int(round(s / (1 - rate / 100)))
    return g - int(s), g


def signups(w: dict) -> float | None:
    """Everything signed up that week, fails included (see counts)."""
    c = counts(w)
    return float(c[1]) if c else None


def aggregate(weeks: list[dict]) -> dict:
    """Several people's or weeks' numbers → one set, the way the Power BI
    report adds them up: by volume, never a plain average of everyone's
    figures, so someone with 17 sign-ups counts 17 times as much as someone
    with 1.

      sales            everything signed up, fails included (counts()),
                       added up; also as `signups`
      fails            the fail counts added up (`fails`), and the % is
                       fails ÷ sign-ups, so the two always agree
      order value,     weighted by sign-ups
      drop days,
      The Round
      4th week         customers kept ÷ customers signed, from its counts

    A row with no sign-ups counts once in the averages."""
    out: dict = {}
    for key in COUNTS:
        vals = [w[key] for w in weeks if w.get(key) is not None]
        if vals:
            out[key] = sum(vals)
    cs = [(w, counts(w)) for w in weeks]
    got = [c for _, c in cs if c is not None]
    if got:
        out["sales"] = sum(c[1] for c in got)
        out["signups"] = out["sales"]
    rated = [c for w, c in cs if c is not None and w.get("fail_rate") is not None and c[0] is not None]
    if rated:
        out["fails"] = sum(c[0] for c in rated)
        den = sum(c[1] for c in rated)
        if den:
            out["fail_rate"] = round(out["fails"] * 100 / den, 2)
    for key, _, _ in MEASURES:
        if key in ("sales", "fail_rate") and key in out:
            continue
        num = den = 0.0
        for w in weeks:
            v = w.get(key)
            if v is None:
                continue
            if key == "fourth_week" and w.get("fourth_week_of") is not None:
                weight = w["fourth_week_of"]   # 8 of 10 and 2 of 5 is 10 of 15
            else:
                g = signups(w)
                weight = 1.0 if g is None else g   # 0 signed up: no weight
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


PCT_KEYS = ("the_round", "fourth_week", "fail_rate")


def percent_fix(rep: dict) -> dict:
    """The Round, 4th week and Fails are percentages, but Excel (and sometimes
    the screenshot reader) gives 30% as 0.3. A real figure under 1% would need
    100+ sign-ups in a week, so any value between 0 and 1 is a fraction. When a
    measure has any such fraction, or every value is 1 or less, each value of
    1 or less is scaled up (1 → 100%); values already over 1 are left alone,
    so a file mixing 0.3 and 30 reads 30 for both."""
    rows = rep.get("rows") or rep.get("bas") or []
    total = rep.get("total") or {}
    for key in PCT_KEYS:
        vals = [r["metrics"][key] for r in rows if (r.get("metrics") or {}).get(key) is not None]
        if total.get(key) is not None:
            vals.append(total[key])
        if not vals or not (any(0 < v < 1 for v in vals) or max(vals) <= 1):
            continue
        for m in [r["metrics"] for r in rows if r.get("metrics")] + [total]:
            v = m.get(key)
            if v is not None and v <= 1:
                m[key] = round(v * 100, 2)
    return rep


excel_percent_fix = percent_fix  # the old name, kept for older callers


AI_PROMPT = """This is a screenshot of a weekly quality report (Power BI) for a door-to-door sales office.
It has a week ending ("WE") and one or more tables. Each table's first column is "MC": an office row,
then one row per person written like "Example P MMC1234" or "Example P 12345", then "Total".
The tables are measures such as Sales Volume, AOV, Drops, 4th Delivery %, Fail Rate and possibly The Round.
It may instead be the 4th Delivery page: columns "1st Week" (customers signed up), "4th Week" (how many
reached their 4th delivery) and "4th Week Rate" (a percentage). Put those in fourth_week_of, fourth_week_n
and fourth_week.

Read every number exactly as shown. Return ONLY JSON, no commentary:
{"week_ending": "YYYY-MM-DD or null",
 "rows": [{"label": "the MC text exactly, name and badge", "sales": number|null, "aov": number|null,
           "drops": number|null, "fourth_week": number|null, "fail_rate": number|null, "the_round": number|null,
           "fourth_week_n": number|null, "fourth_week_of": number|null}],
 "total": {"sales": ..., "aov": ..., "drops": ..., "fourth_week": ..., "fail_rate": ..., "the_round": ..., "fourth_week_n": ..., "fourth_week_of": ...}}
Percentages as plain numbers (13.10 % → 13.1). Money without the £. Use null for a measure not in the
screenshot. One entry per person, combining all the tables. Leave out the office row."""


# ── The Power BI report as a PDF ──────────────────────────────────────────
# Power BI's "Export to PDF" keeps the numbers as text, so they're read
# exactly, with no AI. One page per tab of the report:
#   Weekly KPIs     the office's sign-ups (the bigger figure, the one that
#                   matches Bells: everything signed up, fails included)
#   4th Delivery    each BA's 4th week, for whatever week that page was on
#   Fail Report     the office's fails and why
#   Doors Knocked   not used
#   KPI Comparison  each BA's sales, order value, drop days and fails
# (the Owner, 4 Nov 2026).
_DATE_RE = re.compile(r"\b(\d{2}/\d{2}/\d{4})\b")
_MC_RE = re.compile(r"(?<![A-Za-z])MC(?![A-Za-z])")


def _cells(line: str) -> list:
    """A layout line → its cells: columns are 2+ spaces apart, a name has 1."""
    line = re.sub(r"[\ue000-\uf8ff]", " ", line)   # Power BI's expand/collapse icons
    return [c for c in re.split(r"\s{2,}", line.strip()) if c]


def _after_header(lines: list[str]) -> list[str]:
    """The lines under a table's 'MC' header (the tabs and filters above it
    hold words like '4th Delivery' and dates that aren't figures)."""
    i = next((i for i, ln in enumerate(lines) if (_cells(ln) or [""])[0] == "MC"), None)
    return lines[i + 1:] if i is not None else []


def pdf_pages(data: bytes) -> list[str]:
    from pypdf import PdfReader
    return [p.extract_text(extraction_mode="layout") or "" for p in PdfReader(io.BytesIO(data)).pages]


def _page_week(text: str) -> str | None:
    m = _DATE_RE.search(text)
    return parse_week(m.group(1)) if m else None


def _side_by_side(lines: list[str]) -> list[list[list]]:
    """The KPI Comparison page: tables side by side, each starting 'MC'.
    Cut every line at the header's 'MC's, then read each table alone."""
    head = next(i for i, ln in enumerate(lines) if len(_MC_RE.findall(ln)) >= 2)
    starts = [max(0, m.start() - 2) for m in _MC_RE.finditer(lines[head])]
    bounds = list(zip(starts, starts[1:] + [10 ** 6]))
    grids: list[list[list]] = [[] for _ in bounds]
    for ln in lines[head:]:
        for g, (a, b) in zip(grids, bounds):
            cells = _cells(ln[a:b])
            if cells:
                g.append(cells)
    return grids


def from_pdf(data: bytes) -> list[dict]:
    """A Power BI PDF → readings like from_tables: the week's quality (each
    BA from KPI Comparison, the office's sign-ups and fails from Weekly KPIs
    and the Fail Report, with `fail_reasons`) and, as its own reading, the
    4th Delivery page. Pages it doesn't know are skipped."""
    quality = None
    office: dict = {}
    reasons: list[dict] = []
    office_week = None
    out = []
    for text in pdf_pages(data):
        lines = [ln for ln in text.splitlines() if ln.strip()]
        low = text.lower()
        week = _page_week(text)
        if "dayofweekname" in low:
            continue                                   # Doors Knocked
        if any(len(_MC_RE.findall(ln)) >= 2 for ln in lines):
            rep = from_tables(_side_by_side(lines))    # KPI Comparison
            rep["week_ending"] = rep.get("week_ending") or week
            quality = rep
            continue
        if "1st week" in low and "4th week" in low:     # 4th Delivery
            rep = from_tables([[_cells(ln) for ln in lines if not _DATE_RE.search(ln)]])
            rep["week_ending"] = week
            out.append(finish(rep))
            continue
        if "fail reason" in low or ("total sales" in low and "fail count" in low):
            office_week = office_week or week          # Fail Report
            for ln in _after_header(lines):
                c = _cells(ln)
                if not c:
                    continue
                if c[0].lower() not in ROLLUP_LABELS and len(c) >= 4 and "fails_n" not in office \
                        and parse_value(c[1], "int") is not None and parse_value(c[2], "int") is not None:
                    office["signups_n"] = parse_value(c[1], "int")
                    office["fails_n"] = parse_value(c[2], "int")
                # The reasons table sits on the right: its last two cells.
                if len(c) >= 2 and re.fullmatch(r"\d+", c[-1]) and re.search(r"[A-Za-z]", c[-2]):
                    name = c[-2].strip()
                    if name.lower() not in ROLLUP_LABELS and "fail" not in name.lower() \
                            and not any(r["reason"] == name for r in reasons):
                        reasons.append({"reason": name[:60], "count": int(c[-1])})
            continue
        if "sales volume" in low:                      # Weekly KPIs
            office_week = office_week or week
            for ln in _after_header(lines):
                c = _cells(ln)
                if c and c[0].lower() not in ROLLUP_LABELS and c[0].lower() != "mc" and len(c) >= 2 \
                        and parse_value(c[1], "int") is not None and "sales" not in office:
                    office["sales"] = parse_value(c[1], "int")
    if quality is None and (office or reasons):
        quality = {"week_ending": office_week, "rows": [], "total": {}}
    if quality is not None:
        if office_week and quality.get("week_ending") and office_week != quality["week_ending"]:
            office, reasons = {}, []   # those pages were on another week: don't mix them in
        sign = office.get("sales") or office.get("signups_n")
        total = quality.setdefault("total", {})
        if sign is not None:
            total["sales"] = sign      # the bigger figure, as Bells counts it
            total["signups_n"] = sign
        if office.get("fails_n") is not None:
            total["fails_n"] = office["fails_n"]
        if reasons:
            quality["fail_reasons"] = reasons
        out.insert(0, quality)
    return out
