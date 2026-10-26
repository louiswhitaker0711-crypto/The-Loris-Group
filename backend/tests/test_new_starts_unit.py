"""Set up today's new starts (routes/new_starts.py): starter passwords are
easy to read out and long enough, emails are checked, codes are stored hashed."""
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from auth import MIN_PASSWORD_LENGTH  # noqa: E402
from routes.new_starts import starter_password, token_hash, clean_email, _WORDS  # noqa: E402


def test_starter_passwords_are_long_enough_and_easy_to_say():
    for _ in range(200):
        pw = starter_password()
        assert len(pw) >= MIN_PASSWORD_LENGTH
        word, digits = pw.split("-")[0], pw.split("-")[1]
        assert word in _WORDS
        assert digits.isdigit() and len(digits) >= 4


def test_codes_are_stored_as_a_hash_not_the_code():
    h = token_hash("abc")
    assert h != "abc" and len(h) == 64
    assert token_hash("abc") == h and token_hash("abd") != h


def test_emails_are_tidied_and_checked():
    assert clean_email("  Sam@Example.ORG ") == "sam@example.org"
    for bad in ["", "sam", "sam@", "sam@example", "two words@example.org"]:
        with pytest.raises(HTTPException):
            clean_email(bad)
