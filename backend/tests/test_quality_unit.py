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
    assert agg["sales"] == 10
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
    assert agg["sales"] == 69
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
    assert agg["fails"] == 2 and agg["signups"] == 33
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
