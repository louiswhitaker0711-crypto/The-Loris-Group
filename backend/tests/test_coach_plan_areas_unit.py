"""Any Coach in a sector can plan the bunny hop areas (the Owner, 18 Nov 2026)."""
from routes.coverage import can_plan_areas

SEC = {"leader_id": "lead", "member_ids": ["coach", "ba"]}


def test_sector_leader_and_admin_plan():
    assert can_plan_areas({"id": "lead", "role": "leader"}, SEC)
    assert can_plan_areas({"id": "boss", "role": "admin"}, SEC)


def test_coach_in_the_sector_plans():
    assert can_plan_areas({"id": "coach", "role": "leader"}, SEC)


def test_ba_and_outside_coach_dont():
    assert not can_plan_areas({"id": "ba", "role": "trainee"}, SEC)
    assert not can_plan_areas({"id": "other", "role": "leader"}, SEC)
    assert not can_plan_areas({"id": "coach", "role": "leader"}, None)
