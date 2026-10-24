"""Shared test setup.

OwnerIQ is switched off in the live app (core.owneriq_session.disabled(): on
only with OWNERIQ_ENABLED=true). The OwnerIQ code is kept and tested, so the
tests run with it switched on; test_owneriq_off_unit.py checks the off state.
"""
import os

os.environ.setdefault("OWNERIQ_ENABLED", "true")

import pytest


@pytest.fixture(autouse=True)
def _field_day_over(monkeypatch, request):
    """Older grading tests were written before today's day waited for the
    field to end (core/grading_time.py): run them as if it has. The timing
    itself is tested in test_grading_time_unit.py."""
    if request.module.__name__.endswith("test_grading_time_unit"):
        return
    import core.grading_time as gt
    monkeypatch.setattr(gt, "todays_day_ready", lambda now=None: True)
