"""Bunny hops, solos and shadows from Plan sectors (core/hops.py).

Lines like the office whiteboard: each line a hop with its own colour, one
person alone a solo, a shadow watching a hop.
"""
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.hops import clean_lines, keep_shadows, shadow_ids, describe  # noqa: E402

MEMBERS = ["lead", "a", "b", "c", "d", "e"]
NAMES = {"lead": "Example Lead", "a": "Alex One", "b": "Bea Two", "c": "Cal Three", "d": "Dee Four", "e": "Eve Five"}


def test_lines_become_hops_with_colours_in_order():
    hops = clean_lines([{"member_ids": ["a", "b"], "shadow_ids": ["c"]},
                        {"member_ids": ["lead"]},
                        {"member_ids": ["d", "e"]}], MEMBERS)
    assert [h["colour"] for h in hops] == ["red", "blue", "green"]
    assert hops[0]["member_ids"] == ["a", "b"] and hops[0]["shadow_ids"] == []   # c wasn't on the line
    assert hops[1]["member_ids"] == ["lead"]                                      # a solo


def test_a_shadow_must_be_on_the_line_and_people_appear_once():
    hops = clean_lines([{"member_ids": ["a", "b", "c"], "shadow_ids": ["c"]},
                        {"member_ids": ["c", "zz", "d"]}], MEMBERS)
    assert hops[0]["shadow_ids"] == ["c"]
    assert hops[1]["member_ids"] == ["d"]          # c already placed, zz not in the sector


def test_a_line_of_only_shadows_is_a_solo():
    hops = clean_lines([{"member_ids": ["a"], "shadow_ids": ["a"]}], MEMBERS)
    assert hops[0]["shadow_ids"] == []


def test_the_leader_resetting_hops_keeps_shadows():
    old = [{"colour": "red", "member_ids": ["a", "b", "c"], "shadow_ids": ["c"]}]
    new = keep_shadows([{"colour": "blue", "member_ids": ["c", "d"]}], old)
    assert new[0]["shadow_ids"] == ["c"]
    assert shadow_ids({"hops": new}) == {"c"}


def test_what_each_person_is_told():
    sec = {"hops": clean_lines([{"member_ids": ["a", "b", "c"], "shadow_ids": ["c"]},
                                {"member_ids": ["lead"]}], MEMBERS)}
    assert describe(sec, "a", NAMES) == "With Bea · Red (with Cal shadowing)"
    assert describe(sec, "c", NAMES) == "Shadowing Alex and Bea · Red"
    assert describe(sec, "lead", NAMES) == "On a solo · Blue"
    assert describe(sec, "e", NAMES) is None
