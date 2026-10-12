"""Agenda rows that aren't on the office Schedule: their own days, a time per
day, and a private entry on the saving admin's calendar."""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes import agenda  # noqa: E402


def test_parse_time_accepts_the_usual_ways_of_writing_it():
    assert agenda.parse_time("15:00") == "15:00"
    assert agenda.parse_time("3pm") == "15:00"
    assert agenda.parse_time("3:30 PM") == "15:30"
    assert agenda.parse_time("9.30") == "09:30"
    assert agenda.parse_time("0930") == "09:30"
    assert agenda.parse_time("12am") == "00:00"
    assert agenda.parse_time("later") is None
    assert agenda.parse_time("25:00") is None


def test_row_keeps_its_days_and_day_times():
    row = agenda._normalize_row({"label": "Appointments", "days": [1, 3, 9, "x"],
                                 "cells": [{"day": 1, "presenter": "Example Person", "time": "15:00"}]})
    assert row["days"] == [1, 3]
    assert row["cells"][1]["time"] == "15:00"
    assert row["cells"][0]["time"] == ""


def test_picked_days_apply_only_when_the_schedule_has_no_match():
    rows = [{"label": "Appointments", "days": [1, 3]}, {"label": "Primetime", "days": [2]}]
    agenda._annotate_active_days(rows, {"primetime": [0, 1, 2, 3, 4]})
    assert rows[0]["active_days"] == [1, 3]
    assert rows[1]["active_days"] == [0, 1, 2, 3, 4]


def test_unscheduled_rows_with_a_time_go_on_the_admins_own_calendar():
    rows = [
        agenda._normalize_row({"label": "Appointments", "time_label": "",
                               "cells": [{"day": 1, "presenter": "Example Person", "time": "3pm"},
                                         {"day": 2, "topic": "No time given"}]}),
        agenda._normalize_row({"label": "Primetime", "time_label": "11:00",
                               "cells": [{"day": 0, "topic": "Rehash"}]}),
    ]
    blocks = agenda.agenda_calendar_blocks({"id": "admin-1"}, "office-a", "2026-10-18", rows,
                                           {"primetime": [0, 1, 2, 3, 4]})
    assert len(blocks) == 1
    b = blocks[0]
    assert (b["title"], b["date"], b["start_time"], b["end_time"]) == ("Appointments", "2026-10-13", "15:00", "15:30")
    assert b["audience"] == "personal" and b["owner_id"] == "admin-1" and b["reminder_minutes"] is None
    assert b["presenter"] == "Example Person"


def _cells(**kw):
    return [{"day": d, "topic": kw.get(f"t{d}", ""), "presenter": kw.get(f"p{d}", ""), "time": ""} for d in range(6)]


def test_the_schedule_leads_the_plan():
    schedule_rows = [
        {"label": "Coaches meeting", "time_label": "10:00 AM", "schedule_match_title": "Coaches meeting", "cells": _cells()},
        {"label": "Primetime", "time_label": "11:00 AM", "schedule_match_title": "Primetime", "cells": _cells()},
        {"label": "Morning meeting", "time_label": "11:45 AM", "schedule_match_title": "Morning meeting", "cells": _cells()},
    ]
    rows = [
        # On the schedule; its title was copied in as a topic on Tuesday.
        {"label": "Coaches meeting", "time_label": "9:00 AM", "schedule_match_title": "Coaches meeting",
         "cells": _cells(t1="Coaches meeting", p2="Example Person")},
        # Gone from the schedule, empty → dropped.
        {"label": "Old slot", "time_label": "", "schedule_match_title": "Old slot", "cells": _cells()},
        # Gone from the schedule but written in → kept.
        {"label": "Workshop", "time_label": "", "schedule_match_title": "Workshop", "cells": _cells(t0="Rehash")},
        # Never on the schedule → kept.
        {"label": "Appointments", "time_label": "", "schedule_match_title": None, "cells": _cells()},
        {"label": "Morning meeting", "time_label": "11:45 AM", "schedule_match_title": "Morning meeting", "cells": _cells()},
    ]
    out = agenda.follow_schedule(rows, schedule_rows)
    labels = [r["label"] for r in out]
    assert "Old slot" not in labels
    assert labels == ["Coaches meeting", "Workshop", "Appointments", "Primetime", "Morning meeting"]
    coaches = out[0]
    assert coaches["time_label"] == "10:00 AM"          # time follows the schedule
    assert coaches["cells"][1]["topic"] == ""            # the copied title is gone
    assert coaches["cells"][2]["presenter"] == "Example Person"


def test_a_topic_that_repeats_the_row_name_is_not_saved():
    row = agenda._normalize_row({"label": "Sector leaders meeting",
                                 "cells": [{"day": 1, "topic": "Sector Leaders Meeting"}, {"day": 2, "topic": "Targets"}]})
    assert row["cells"][1]["topic"] == ""
    assert row["cells"][2]["topic"] == "Targets"
