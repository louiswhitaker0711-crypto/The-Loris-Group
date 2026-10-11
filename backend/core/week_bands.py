"""The owner's traffic light system — sign-ups in one Bells week.

    Super Green   20+          beating the standard
    Green         15–19        meeting the standard
    Amber         8–14         developing performance
    Red           under 8      below the required standard

A "Green Week" is Green or better (15+). Every weekly green count in the app —
the Bells green %, the Green Week badge, the Sales Development Path ramp —
reads these constants, so the standard lives in one place.
"""

SUPER_GREEN_WEEK_SALES = 20
GREEN_WEEK_SALES = 15
AMBER_WEEK_SALES = 8
# Anything below AMBER_WEEK_SALES (under 8) is Red: 8 sign-ups in a week takes
# you out of the red zone.
RED_EXIT_WEEK_SALES = AMBER_WEEK_SALES

WEEK_BANDS = (
    (SUPER_GREEN_WEEK_SALES, "super_green", "Super Green"),
    (GREEN_WEEK_SALES, "green", "Green"),
    (AMBER_WEEK_SALES, "amber", "Amber"),
    (0, "red", "Red"),
)


def week_band(sign_ups: int | float | None) -> str:
    """'super_green' | 'green' | 'amber' | 'red' for a week's sign-ups."""
    n = sign_ups or 0
    for floor, key, _label in WEEK_BANDS:
        if n >= floor:
            return key
    return "red"


def is_green_week(sign_ups: int | float | None) -> bool:
    """Green or better — the owner's 'meeting the standard' (15+)."""
    return (sign_ups or 0) >= GREEN_WEEK_SALES
