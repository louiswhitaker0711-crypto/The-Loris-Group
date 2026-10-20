"""Shared test setup.

OwnerIQ is switched off in the live app (core.owneriq_session.disabled(): on
only with OWNERIQ_ENABLED=true). The OwnerIQ code is kept and tested, so the
tests run with it switched on; test_owneriq_off_unit.py checks the off state.
"""
import os

os.environ.setdefault("OWNERIQ_ENABLED", "true")
