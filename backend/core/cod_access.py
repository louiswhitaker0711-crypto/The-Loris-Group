"""Which COD stages a person can open, from their OwnerIQ stage (the Owner's
rule, Oct 2026):

  • you can open every COD stage up to and including your own OwnerIQ stage:
    a Stage 3 opens 1, 2 and 3; a Stage 3+ also opens 3+; a Stage 4 opens
    1 to 4; a Stage 5 or above opens everything;
  • anyone at Stage 3 or above opens Stage 3+ (SL) too, whoever is on their
    team (the Owner, 28 Oct 2026: a Stage 3 with no Stage 3 below them gets
    the same as a Stage 3+);
  • a Coach opens Stages 1, 2, 3 and 3+ whatever their OwnerIQ stage;
  • Admins open everything.
People with no OwnerIQ stage fall back to the older role-based rules
(routes/modules.py).

COD stages are STORED as 1, 2, 3, 5 (= 3+), 4, 6 (= Stage 5); LEVEL is
where each sits on OwnerIQ's ladder (core.schedule_template.stage_num gives
3.5 for "stage_3_plus").
"""
from __future__ import annotations

from typing import Optional

from core.cod_stages import COD_STAGE_ORDER

LEVEL = {1: 1.0, 2: 2.0, 3: 3.0, 5: 3.5, 4: 4.0, 6: 5.0}
TEAM_STAGE_FOR_3_PLUS = 3.0


def unlocked_stages(owneriq_level: Optional[float], has_stage3_on_team: bool) -> set[int]:
    """COD stages (stored numbers) open to someone at this OwnerIQ level."""
    out = {s for s in COD_STAGE_ORDER if owneriq_level is not None and owneriq_level >= LEVEL[s]}
    out.add(1)
    if has_stage3_on_team or (owneriq_level is not None and owneriq_level >= 3.0):
        out.add(5)
    return out


COACH_STAGES = {1, 2, 3, 5}   # what every Coach opens, as a Stage 3 and SL


def visible_stages(unlocked: set[int]) -> set[int]:
    """What shows on the stage rail: everything open, plus the next stage as
    a locked teaser."""
    shown = set(unlocked)
    for i, s in enumerate(COD_STAGE_ORDER):
        if s not in unlocked:
            shown.add(s)
            break
    return shown
