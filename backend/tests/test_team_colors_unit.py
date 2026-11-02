"""Team colours (the Owner, 2 Nov 2026): picked from the logo, or set by hand."""
import io
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.team_colors import clean_colors, clean_hex, pick_colors  # noqa: E402


def _png(*blocks):
    from PIL import Image
    img = Image.new("RGB", (60, 60), (255, 255, 255))
    y = 0
    for colour, rows in blocks:
        for yy in range(y, y + rows):
            for x in range(60):
                img.putpixel((x, yy), colour)
        y += rows
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def test_clean_hex_and_colors():
    assert clean_hex("2F5FB3") == "#2f5fb3"
    assert clean_hex("blue") is None
    assert clean_colors({}) is None
    assert clean_colors({"primary": "#2f5fb3", "accent": ""}) == {"primary": "#2f5fb3", "accent": None}
    with pytest.raises(ValueError):
        clean_colors({"primary": "nope"})
    with pytest.raises(ValueError):
        clean_colors({"accent": "#ffffff"})


def test_two_colour_logo_darker_one_leads():
    picked = pick_colors(_png(((47, 95, 179), 20), ((242, 194, 48), 12)))
    assert picked["primary"] != picked["accent"]
    assert picked["accent"] is not None
    # Blue (darker) carries white text, so it leads; yellow is the accent.
    assert int(picked["primary"][5:7], 16) > int(picked["primary"][1:3], 16)


def test_single_colour_logo_has_no_accent():
    picked = pick_colors(_png(((1, 27, 89), 25)))
    assert picked["accent"] is None
    assert picked["primary"].startswith("#")


def test_unreadable_image():
    assert pick_colors(b"not an image") is None
