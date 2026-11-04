"""Weekly quality report (core/quality.py): reading a screenshot's JSON,
Excel exports, colours against the Owner's targets."""
import io
import json
import zipfile

from core.coach_suggestions import quality_suggestions
from core.quality import (excel_percent_fix, from_ai, from_tables, merge, parse_week, rag,
                          xlsx_tables)


def test_targets_colour_like_the_owner_says():
    assert rag("aov", 13) == "green" and rag("aov", 11.6) == "amber" and rag("aov", 9.08) == "red"
    assert rag("drops", 2.5) == "green" and rag("drops", 2.19) == "amber" and rag("drops", 2.0) == "red"
    assert rag("fail_rate", 9.09) == "green" and rag("fail_rate", 13.1) == "amber" and rag("fail_rate", 33.33) == "red"
    assert rag("the_round", 75) == "green" and rag("fourth_week", 50) == "red"
    assert rag("sales", 8) is None


def test_week_ending_formats():
    assert parse_week("04 October 2026") == "2026-10-04"
    assert parse_week("04/10/2026") == "2026-10-04"
    assert parse_week("WE 04 October 2026") == "2026-10-04"
    assert parse_week("nonsense") is None


def test_reads_the_ai_reading_of_a_screenshot():
    text = "```json\n" + json.dumps({
        "week_ending": "2026-10-04",
        "rows": [
            {"label": "Example A MMC1234", "sales": 8, "aov": "11.48", "drops": 2.08, "fourth_week": 0, "fail_rate": "19.23 %"},
            {"label": "Example B 23891", "sales": 1, "aov": 10.61, "drops": 3, "fourth_week": 0, "fail_rate": 0},
            {"label": "Ginger Leeds", "sales": 9},
            {"label": "Total", "sales": 9},
        ],
        "total": {"sales": 9, "aov": 11.6, "drops": 2.19, "fourth_week": 0, "fail_rate": 13.1},
    }) + "\n```"
    rep = from_ai(text)
    assert rep["week_ending"] == "2026-10-04"
    assert [r["badge"] for r in rep["rows"]] == ["MMC1234", "23891"]
    a = rep["rows"][0]["metrics"]
    assert a == {"sales": 8, "aov": 11.48, "drops": 2.08, "fail_rate": 19.23}  # 4th week not due yet
    assert rep["fourth_week_due"] is False
    assert "fourth_week" not in rep["total"]


def test_a_real_fourth_week_is_kept():
    rep = from_ai(json.dumps({"rows": [{"label": "Example A MMC1234", "fourth_week": 0},
                                       {"label": "Example B MMC5678", "fourth_week": 80}]}))
    assert rep["rows"][0]["metrics"]["fourth_week"] == 0
    assert rep["rows"][1]["metrics"]["fourth_week"] == 80


def test_tables_one_per_measure_merge_by_badge():
    t1 = [["MC", "Sales Volume"], ["Ginger Leeds", 9], ["Example A MMC1234", 8], ["Example B MMC5678", 1], ["Total", 9]]
    t2 = [["MC", "AOV"], ["Ginger Leeds", 11.6], ["Example A MMC1234", "11.48"], ["Total", 11.6]]
    t3 = [["MC", "Fail rate"], ["Example A MMC1234", "19.23 %"], ["Example B MMC5678", "0.00 %"]]
    rep = merge([from_tables([t1]), from_tables([t2, t3])])
    by = {r["badge"]: r["metrics"] for r in rep["rows"]}
    assert by["MMC1234"] == {"sales": 8, "aov": 11.48, "fail_rate": 19.23}
    assert by["MMC5678"] == {"sales": 1, "fail_rate": 0}
    assert rep["total"] == {"sales": 9, "aov": 11.6}


def _xlsx(rows):
    """A tiny .xlsx with inline strings and numbers, no libraries."""
    def cell(ref, v):
        if isinstance(v, str):
            return f'<c r="{ref}" t="inlineStr"><is><t>{v}</t></is></c>'
        return f'<c r="{ref}"><v>{v}</v></c>'
    body = "".join(
        f'<row r="{i + 1}">' + "".join(cell(f"{chr(65 + j)}{i + 1}", v) for j, v in enumerate(r)) + "</row>"
        for i, r in enumerate(rows))
    sheet = ('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
             f"<sheetData>{body}</sheetData></worksheet>")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/worksheets/sheet1.xml", sheet)
    return buf.getvalue()


def test_excel_export_with_fraction_percentages():
    data = _xlsx([["MC", "Sales Volume", "Fail rate"], ["Example A MMC1234", 8, 0.1923], ["Total", 9, 0.131]])
    rep = excel_percent_fix(from_tables(xlsx_tables(data)))
    assert rep["rows"][0]["metrics"] == {"sales": 8, "fail_rate": 19.23}
    assert rep["total"]["fail_rate"] == 13.1


def test_silly_numbers_are_dropped():
    rep = from_ai(json.dumps({"rows": [{"label": "Example A MMC1234", "aov": 1150, "drops": 2.2}]}))
    assert rep["rows"][0]["metrics"] == {"drops": 2.2}


def test_quality_suggestions():
    s = quality_suggestions("Example", {"sales": 8, "aov": 11.48, "drops": 2.08, "fail_rate": 19.23}, "WE 4 Oct")
    kinds = [x["kind"] for x in s]
    assert kinds == ["fails", "order_value", "drops"]
    assert s[0]["why"] == "19.23% fails in WE 4 Oct (target under 10%)"
    # Too few sales that week to judge.
    assert quality_suggestions("Example", {"sales": 1, "fail_rate": 100}) == []


def test_averages_count_each_person_by_their_volume():
    from core.quality import aggregate, signups
    assert signups({"sales": 8, "fail_rate": 20}) == 10
    assert signups({"sales": 0, "fail_rate": 100}) == 1
    people = [
        {"sales": 8, "aov": 12.0, "drops": 2.0, "fail_rate": 20.0},   # 10 sign-ups, 2 fails
        {"sales": 2, "aov": 17.0, "drops": 3.0, "fail_rate": 0.0},    # 2 sign-ups
        {"sales": 0, "aov": 30.0},                                     # nothing signed: no weight
    ]
    agg = aggregate(people)
    assert agg["sales"] == 12          # everything signed up, fails included
    assert agg["aov"] == round((10 * 12 + 2 * 17) / 12, 2)            # 12.83, not the plain 14.50
    assert agg["drops"] == round((10 * 2 + 2 * 3) / 12, 2)
    assert agg["fail_rate"] == round(100 * 2 / 12, 2)                  # 2 fails in 12 sign-ups
    assert aggregate([]) == {}


def test_matches_the_reports_own_total():
    """WE 27 Sep 2026 as the report showed it (names swapped for examples):
    the report's total order value was £11.10 and drops 2.23."""
    from core.quality import aggregate
    rows = [(6, 7.58, 2.57, 0), (17, 13.06, 1.72, 5.26), (4, 15.75, 2.50, 0), (16, 7.69, 2.11, 0),
            (1, 9.65, 2.00, 0), (3, 11.65, 3.00, 0), (10, 13.00, 2.36, 9.09), (12, 12.32, 2.58, 0)]
    agg = aggregate([{"sales": s, "aov": a, "drops": d, "fail_rate": f} for s, a, d, f in rows])
    assert agg["sales"] == 72          # sign-ups: 17 at 5.26% is 19, 10 at 9.09% is 11
    assert abs(agg["aov"] - 11.10) < 0.25 and abs(agg["drops"] - 2.23) < 0.02
    plain = sum(r[1] for r in rows) / len(rows)
    assert abs(plain - 11.10) > abs(agg["aov"] - 11.10)


def test_picking_the_weeks_for_a_period():
    from core.quality import pick_weeks
    weeks = ["2026-10-11", "2026-10-04", "2026-09-27", "2026-09-20", "2026-09-13", "2026-09-06", "2026-08-30"]
    assert pick_weeks(weeks, "week") == (["2026-10-11"], ["2026-10-04"], "WE 11 Oct 2026")
    now, before, label = pick_weeks(weeks, "4w", "2026-10-04")
    assert now == ["2026-10-04", "2026-09-27", "2026-09-20", "2026-09-13"] and before == ["2026-09-06", "2026-08-30"]
    assert label == "4 weeks to WE 4 Oct 2026"
    now, before, label = pick_weeks(weeks, "month", month="2026-09")
    assert now == ["2026-09-27", "2026-09-20", "2026-09-13", "2026-09-06"] and before == ["2026-08-30"]
    assert label == "September 2026"
    assert pick_weeks(weeks, "month")[2] == "October 2026"
    assert pick_weeks(weeks, "all")[0] == weeks
    assert pick_weeks([], "4w") == ([], [], "")


def test_fails_as_a_count():
    from core.quality import aggregate
    agg = aggregate([{"sales": 10, "fail_rate": 9.09}, {"sales": 17, "fail_rate": 5.26}, {"sales": 4, "fail_rate": 0}])
    assert agg["fails"] == 2 and agg["signups"] == 34   # 1 of 11, 1 of 19, 0 of 4
    assert "fails" not in aggregate([{"sales": 3}])


def test_a_second_upload_adds_to_the_saved_week():
    from core.quality import merge_week
    old = [{"badge": "MMC1", "label": "Example A MMC1", "user_id": "u1", "metrics": {"sales": 8, "aov": 11.5}},
           {"badge": "MMC2", "label": "Example B MMC2", "user_id": None, "metrics": {"sales": 2}}]
    new = [{"badge": "MMC1", "label": "Example A MMC1", "user_id": None, "metrics": {"the_round": 75.0, "fourth_week": 50.0}}]
    bas, total = merge_week(old, {"sales": 10}, new, {"the_round": 70.0})
    by = {b["badge"]: b for b in bas}
    assert by["MMC1"]["metrics"] == {"sales": 8, "aov": 11.5, "the_round": 75.0, "fourth_week": 50.0}
    assert by["MMC1"]["user_id"] == "u1"            # an upload without a link keeps the saved one
    assert by["MMC2"]["metrics"] == {"sales": 2}      # not in the new upload: kept
    assert total == {"sales": 10, "the_round": 70.0}


def test_retrain_alert_for_high_fails_two_weeks_running():
    from datetime import date
    from core.quality_alerts import fail_runs, is_current
    this = [{"user_id": "u1", "metrics": {"sales": 8, "fail_rate": 20.0}},     # 10 sign-ups, 2 fails
            {"user_id": "u2", "metrics": {"sales": 8, "fail_rate": 25.0}},
            {"user_id": "u3", "metrics": {"sales": 1, "fail_rate": 50.0}},     # 2 sign-ups: too few
            {"user_id": None, "metrics": {"sales": 5, "fail_rate": 50.0}}]
    prev = [{"user_id": "u1", "metrics": {"sales": 4, "fail_rate": 33.33}},
            {"user_id": "u2", "metrics": {"sales": 9, "fail_rate": 10.0}},
            {"user_id": "u3", "metrics": {"sales": 1, "fail_rate": 50.0}}]
    assert [r["user_id"] for r in fail_runs(this, prev)] == ["u1"]
    assert is_current("2026-10-11", date(2026, 10, 13)) and not is_current("2026-09-06", date(2026, 10, 13))


def test_excel_export_with_a_namebadge_column_and_two_membership_columns():
    """Power BI's Excel export: office in MC, the person in NameBadge, a
    membership count and a membership %, and the filters (with the week) under it."""
    grid = [
        ["MC", "NameBadge", "Sales Volume", "AOV", "Drops", "Doors Knocked", "Memberships on signup", "Membership on signup %"],
        ["Example Office", "Total", 10, 11.5, 2.4, 900, 3, 0.3],
        ["Example Office", "Example P - MMC1234", 6, 12.0, 2.5, 500, 2, 0.3333],
        ["Example Office", "Sample Q - MMC5678", 4, 10.75, 2.25, 400, 1, 0.25],
        ["Applied filters:\nNameBadge is not (Blank)\nWeekEnding_Date is 11 October 2026"],
    ]
    rep = excel_percent_fix(from_tables([grid]))
    assert rep["week_ending"] == "2026-10-11"
    assert [r["badge"] for r in rep["rows"]] == ["MMC1234", "MMC5678"]
    assert rep["rows"][0]["metrics"]["the_round"] == 33.33 and rep["rows"][0]["metrics"]["sales"] == 6
    assert rep["total"]["the_round"] == 30.0 and rep["total"]["sales"] == 10


def test_round_as_a_fraction_reads_as_a_percentage_even_mixed_in_one_file():
    """0.3 is 30%; a 100% Round (1.0) next to 0.3 is 100%, and a value already
    written as 30 stays 30, so one odd cell can't leave the rest as 0.3."""
    from core.quality import percent_fix
    grid = [
        ["MC", "NameBadge", "Sales Volume", "Membership on signup %", "4th Delivery %", "Fail Rate"],
        ["Example Office", "Total", 10, 0.3, "75.00 %", 0.1],
        ["Example Office", "Example P - MMC1234", 6, 0.3333, "80.00 %", 0],
        ["Example Office", "Sample Q - MMC5678", 3, 1, "70.00 %", 0.25],
        ["Example Office", "Other R - MMC9012", 1, "30.00 %", "75.00 %", 0],
    ]
    rep = percent_fix(from_tables([grid]))
    by = {r["badge"]: r["metrics"] for r in rep["rows"]}
    assert by["MMC1234"]["the_round"] == 33.33
    assert by["MMC5678"]["the_round"] == 100.0
    assert by["MMC9012"]["the_round"] == 30.0
    assert by["MMC1234"]["fourth_week"] == 80.0          # already a percentage
    assert by["MMC5678"]["fail_rate"] == 25.0 and by["MMC1234"]["fail_rate"] == 0
    assert rep["total"]["the_round"] == 30.0 and rep["total"]["fail_rate"] == 10.0


def test_a_screenshot_read_as_fractions_is_fixed_too():
    from core.quality import percent_fix
    rep = percent_fix(from_ai(json.dumps({"rows": [
        {"label": "Example A MMC1234", "sales": 5, "aov": 0.5, "drops": 0.8, "the_round": 0.3, "fail_rate": 20},
    ], "total": {"the_round": 0.3}})))
    m = rep["rows"][0]["metrics"]
    assert m["the_round"] == 30.0 and rep["total"]["the_round"] == 30.0
    assert m["fail_rate"] == 20            # already a percentage
    assert m["aov"] == 0.5 and m["drops"] == 0.8   # not percentages, never scaled


def test_saved_weeks_with_fractions_are_corrected_once():
    import asyncio
    from core.content_fixes import _fix_quality_percents

    class Coll:
        def __init__(self, docs):
            self.docs = docs

        def find(self, q, proj=None):
            docs = [d for d in self.docs if d.get("pct_ok") is not True]

            async def gen():
                for d in docs:
                    yield d
            return gen()

        async def update_one(self, q, upd):
            d = next(d for d in self.docs if d["_id"] == q["_id"])
            d.update(upd["$set"])

    weeks = Coll([
        {"_id": 1, "bas": [{"badge": "MMC1234", "metrics": {"the_round": 0.3, "fourth_week": 0.75, "aov": 12.5}},
                           {"badge": "2026", "label": "Applied filters: CampaignName is Modern Milkman 2026", "metrics": {}}],
         "total": {"the_round": 0.3}},
        {"_id": 2, "bas": [{"badge": "MMC1234", "metrics": {"the_round": 40}}], "total": {}},
    ])

    class DB:
        quality_weeks = weeks

    assert asyncio.run(_fix_quality_percents(DB())) == 2
    a, b = weeks.docs
    assert len(a["bas"]) == 1              # the filter note is gone
    assert a["bas"][0]["metrics"] == {"the_round": 30.0, "fourth_week": 75.0, "aov": 12.5}
    assert a["total"]["the_round"] == 30.0 and a["pct_ok"] is True
    assert b["bas"][0]["metrics"]["the_round"] == 40
    assert asyncio.run(_fix_quality_percents(DB())) == 0   # never twice


def test_power_bis_filter_note_is_never_a_ba():
    rep = from_ai(json.dumps({"rows": [
        {"label": "Example A MMC1234", "sales": 5},
        {"label": "Applied filters: CampaignName is Modern Milkman, WeekEnding is 11 October 2026", "sales": 0},
    ]}))
    assert [r["badge"] for r in rep["rows"]] == ["MMC1234"]
    grid = [["MC", "Sales Volume"], ["Example A MMC1234", 5],
            ["Applied filters: WeekEnding_Date is 11 October 2026", None]]
    assert [r["badge"] for r in from_tables([grid])["rows"]] == ["MMC1234"]


def test_fourth_delivery_page_reads_counts_and_rate():
    from core.quality import percent_fix
    from core.quality import is_fourth_week_report
    grid = [["WE 30/08/2026"], ["MC", "1st Week", "4th Week", "4th Week Rate"],
            ["Ginger Leeds", 12, 9, 0.75],
            ["Example A - MMC1234", 10, 8, 0.8], ["Example B - MMC5678", 2, 1, 0.5],
            ["Total", 12, 9, 0.75]]
    rep = percent_fix(from_tables([grid]))
    assert rep["week_ending"] == "2026-08-30"
    a = rep["rows"][0]["metrics"]
    assert a == {"fourth_week_of": 10, "fourth_week_n": 8, "fourth_week": 80.0}   # 8 is a count, never 8%
    assert rep["total"] == {"fourth_week_of": 12, "fourth_week_n": 9, "fourth_week": 75.0}
    assert is_fourth_week_report(rep)


def test_fourth_week_rate_worked_out_from_counts_and_zeros_kept():
    grid = [["MC", "1st Week", "4th Week"], ["Example A MMC1234", 4, 0], ["Example B MMC5678", 3, 0]]
    rep = from_tables([grid])
    assert [r["metrics"]["fourth_week"] for r in rep["rows"]] == [0.0, 0.0]   # real zeros, not "not due"


def test_fourth_week_shows_8_weeks_later():
    from core.quality import fourth_week_shows_on
    assert fourth_week_shows_on("2026-08-30") == "2026-10-25"
    assert fourth_week_shows_on("2026-08-16") == "2026-10-11"
    assert fourth_week_shows_on(None) is None


def test_quality_report_is_not_a_fourth_week_report():
    from core.quality import is_fourth_week_report
    rep = from_tables([[["MC", "Sales Volume", "Fail Rate"], ["Example A MMC1234", 8, 0.1]]])
    assert not is_fourth_week_report(rep)


def test_fourth_week_averages_by_customers():
    from core.quality import aggregate
    out = aggregate([{"sales": 3, "fourth_week": 80, "fourth_week_n": 8, "fourth_week_of": 10},
                     {"sales": 9, "fourth_week": 40, "fourth_week_n": 2, "fourth_week_of": 5}])
    assert out["fourth_week_n"] == 10 and out["fourth_week_of"] == 15
    assert out["fourth_week"] == 66.67   # 10 of 15, not weighted by sales


def test_misread_fourth_week_on_25_oct_is_cleared_once():
    import asyncio
    from core.content_fixes import _clear_bad_fourth_week

    class Coll:
        def __init__(self, docs):
            self.docs = docs

        def find(self, q, proj=None):
            docs = [d for d in self.docs if d["week_ending"] == q["week_ending"]
                    and "fourth_week_from" not in d and d.get("fw_cleared") is not True]

            async def gen():
                for d in docs:
                    yield d
            return gen()

        async def update_one(self, q, upd):
            next(d for d in self.docs if d["_id"] == q["_id"]).update(upd["$set"])

    weeks = Coll([
        {"_id": 1, "week_ending": "2026-10-25", "bas": [{"badge": "MMC1234", "metrics": {"sales": 8, "fourth_week": 8}}],
         "total": {"sales": 38, "fourth_week": 32}},
        {"_id": 2, "week_ending": "2026-10-18", "bas": [{"badge": "MMC1234", "metrics": {"fourth_week": 50}}], "total": {}},
    ])

    class DB:
        quality_weeks = weeks

    assert asyncio.run(_clear_bad_fourth_week(DB())) == 1
    a, b = weeks.docs
    assert a["bas"][0]["metrics"] == {"sales": 8} and a["total"] == {"sales": 38}
    assert b["bas"][0]["metrics"] == {"fourth_week": 50}      # other weeks untouched
    assert asyncio.run(_clear_bad_fourth_week(DB())) == 0


# The Power BI PDF, as pypdf lays its pages out (made-up people and badges).
_PDF_WEEKLY = """\
    Weekly KPIs             4th Delivery            Fail Report           Doors Knocked           KPI Comparison
 Month                          WE                            MC Name                        Name_Badge
 All                           25/10/2026                    All                           All
MC                                      Sales Volume     AOV    Drops          Doors     Memberships       Membership
                                                                            Knocked          on signup     on signup %
  Example Office                                  20   11.14     2.67         2,335                 21          0
   Total                                           20   11.14    2.67          2,335                 21          0
"""
_PDF_FOURTH = """\
                   Weekly KPIs             4th Delivery            Fail Report           Doors Knocked          KPI Comparison
Month                         WE                            MC Name                        Name_Badge                    Membership Status
All                           30/08/2026                   All                          All                          All
                               MC                                        1st Week    4th Week   4th Week Rate
                                  Example Office                                  12          9         75.00%
                                    Example A - MMC1234                           10           8          80.00%
                                    Example B - MMC5678                            2           1          50.00%
                                  Total                                         12          9         75.00%
"""
_PDF_FAILS = """\
                    Weekly KPIs               4th Delivery               Fail Report            Doors Knocked            KPI Comparison
                 Month                             WE                              MC Name                          Name_Badge
                  All                             25/10/2026                      All                            All
 MC                                              Total Sales   Fail Count   Fail Rate                   Fail Reason                   Fail Count
  Example Office                                          20             3   15.00 %                    Customer Cancelled                      2
    Total                                                 20             3  15.00 %                     Start Date is Over 8 Days               1
                                                                                                        Total                                   3
                                                                                                                               (Blank)
0%                     20%                     40%                     60%                      80%                    100%
                                                       Fail count
"""
_PDF_DOORS = """\
DayOfWeekName                       Monday                          Total
MC                                    Doors      Spoken     Total    Doors      Spoken     Total
     Example A - MMC1234              99.00       53.00     4.00     99.00      53.00      4.00
"""
def _side(*cols):
    """Tables side by side, each 34 characters wide, as the PDF lays them out."""
    return "\n".join("".join(f"{c:<34}" for c in row) for row in zip(*cols)) + "\n"


_PDF_COMPARE = "                     WE\n                      25/10/2026\n" + _side(
    ["MC          Sales Volume", "  Example Office      16", "    Example A - MMC1234   12", "    Example B - MMC5678    4", "  Total               16"],
    ["MC                 AOV", "  Example Office    11.14", "    Example B - MMC5678   9.75", "    Example A - MMC1234  12.86", "  Total             11.14"],
    ["MC               Drops", "  Example Office     2.67", "    Example A - MMC1234   3.00", "    Example B - MMC5678   2.80", "  Total              2.67"],
    ["MC      4th Delivery %", "  Example Office   0.00 %", "    Example A - MMC1234  0.00 %", "    Example B - MMC5678  0.00 %", "  Total            0.00 %"],
    ["MC           Fail rate", "  Example Office  15.00 %", "    Example A - MMC1234  20.00 %", "    Example B - MMC5678   0.00 %", "  Total           15.00 %"])


def _pdf(monkeypatch, pages):
    from core.quality import percent_fix
    import core.quality as cq
    monkeypatch.setattr(cq, "pdf_pages", lambda data: pages)
    return [percent_fix(r) for r in cq.from_pdf(b"%PDF-")]


def test_pdf_reads_each_ba_and_the_offices_sign_ups(monkeypatch):
    from core.quality import aggregate
    reps = _pdf(monkeypatch, [_PDF_WEEKLY, _PDF_FOURTH, _PDF_FAILS, _PDF_DOORS, _PDF_COMPARE])
    q, fw = reps
    assert q["week_ending"] == "2026-10-25"
    by = {r["badge"]: r["metrics"] for r in q["rows"]}
    assert by["MMC1234"] == {"sales": 12, "aov": 12.86, "drops": 3.0, "fail_rate": 20.0}   # 4th week 0%: left out
    assert by["MMC5678"] == {"sales": 4, "aov": 9.75, "drops": 2.8, "fail_rate": 0.0}
    # The office: the bigger figure (as Bells counts it), with its own fail count.
    assert q["total"]["sales"] == 20 and q["total"]["signups_n"] == 20 and q["total"]["fails_n"] == 3
    assert q["fail_reasons"] == [{"reason": "Customer Cancelled", "count": 2},
                                 {"reason": "Start Date is Over 8 Days", "count": 1}]
    a = aggregate([q["total"]])
    assert (a["fails"], a["signups"]) == (3, 20)   # "3 fails of 20", not worked back from sales
    assert fw["week_ending"] == "2026-08-30"
    assert {r["badge"]: r["metrics"]["fourth_week_n"] for r in fw["rows"]} == {"MMC1234": 8, "MMC5678": 1}


def test_pdf_office_pages_on_another_week_are_not_mixed_in(monkeypatch):
    other = _PDF_FAILS.replace("25/10/2026", "18/10/2026")
    q = _pdf(monkeypatch, [other, _PDF_COMPARE])[0]
    assert "fails_n" not in q["total"] and "fail_reasons" not in q
    assert q["total"]["sales"] == 16


def test_ba_sign_ups_still_worked_back_from_sales():
    from core.quality import aggregate
    a = aggregate([{"sales": 8, "fail_rate": 20}])
    assert (a["fails"], a["signups"]) == (2, 10)


def test_fails_and_sign_ups_worked_out_exactly_from_the_fail_rate():
    """Power BI gives each BA a fail % only: 28.57% can only be 2 of 7."""
    from core.quality import aggregate, counts
    assert counts({"sales": 2, "fail_rate": 28.57}) == (2, 7)
    assert counts({"sales": 7, "fail_rate": 27.27}) == (3, 11)
    assert counts({"sales": 5, "fail_rate": 11.11}) == (1, 9)
    assert counts({"sales": 38, "fail_rate": 13.21}) == (7, 53)   # an office saved without its counts
    assert counts({"fail_rate": 100}) == (1, 1)                    # all failed, no sales
    assert counts({"sales": 10, "fail_rate": 0}) == (0, 10)
    assert counts({"sales": 38, "fail_rate": 13.21, "signups_n": 53, "fails_n": 7}) == (7, 53)
    # A team's fail % and fail count always agree: 1 of 11 is 9.09%, not "9.1% but 0 fails".
    team = aggregate([{"sales": 10, "fail_rate": 0}, {"fail_rate": 100, "aov": 10.85}])
    assert (team["fails"], team["sales"], team["fail_rate"]) == (1, 11, 9.09)
