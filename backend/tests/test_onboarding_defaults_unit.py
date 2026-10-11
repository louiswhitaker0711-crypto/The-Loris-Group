"""Start Here defaults (routes/onboarding.py): the playbook's first weeks,
expectations and pay rules, contacts as role titles only, and nothing that
the admin editor's own validation would reject.
"""
import re
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes.onboarding import DEFAULT_CONTENT, ContactItem, OnboardingContentBody, _merge_content  # noqa: E402


def test_defaults_pass_the_editor_validation():
    body = OnboardingContentBody(**{k: v for k, v in DEFAULT_CONTENT.items() if k != "updated_at"})
    assert len(body.contacts) == len(DEFAULT_CONTENT["contacts"])
    for c in DEFAULT_CONTENT["contacts"]:
        ContactItem(**c)


def test_defaults_carry_the_playbook_content():
    week = DEFAULT_CONTENT["week_one_note"]
    for day in ("Induction Day", "Product knowledge", "First day in the field",
                "G.I.F.T.S", "Closing, taking control, rehash", "Independent Growth"):
        assert day in week
    assert "in the field 13:30 to 20:00" in week
    assert "100% Effort" in DEFAULT_CONTENT["welcome_message"]
    pay = DEFAULT_CONTENT["pay_notes"]
    assert "£12 for a Silver sign-up" in pay and "£20 for a Gold sign-up" in pay
    assert "The Round" in pay and "4th week" in pay


def test_contacts_are_roles_only_no_personal_details():
    for c in DEFAULT_CONTENT["contacts"]:
        assert not c["email"]
        assert c["phone"] == ""
    blob = " ".join(str(v) for v in DEFAULT_CONTENT.values())
    assert not re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", blob)


def test_admin_can_clear_the_default_contacts_but_blank_text_falls_back():
    merged = _merge_content({"contacts": [], "welcome_message": "  "})
    assert merged["contacts"] == []
    assert merged["welcome_message"] == DEFAULT_CONTENT["welcome_message"]
    assert _merge_content(None)["contacts"] == DEFAULT_CONTENT["contacts"]
