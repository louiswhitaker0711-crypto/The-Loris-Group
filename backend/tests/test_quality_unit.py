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


def test_averages_over_weeks_are_weighted_by_sales():
    from core.quality import aggregate
    weeks = [
        {"sales": 8, "aov": 12.0, "drops": 2.0, "fail_rate": 25.0},
        {"sales": 2, "aov": 17.0, "drops": 3.0, "fail_rate": 0.0},
        {"sales": 0, "aov": 30.0},             # no sales: doesn't move the averages
        {"aov": 13.0},                          # no sales figure: counts once
    ]
    agg = aggregate(weeks)
    assert agg["sales"] == 10
    assert agg["aov"] == round((96 + 34 + 13) / 11, 2)
    assert agg["drops"] == 2.2
    assert agg["fail_rate"] == 20.0
    assert aggregate([]) == {}


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
