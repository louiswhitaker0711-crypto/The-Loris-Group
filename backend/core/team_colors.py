"""A team's colours (the Owner, 2 Nov 2026).

When a team logo is uploaded its two main colours are picked out and saved as
`users.team_colors_auto`; a leader (or an Admin) can set them by hand as
`users.team_colors`, which wins. The app works out every shade from these two
(frontend/src/theme/teamTheme.tsx), so only the raw colours are stored.
"""
from __future__ import annotations

import colorsys
import io
import re
from typing import Optional

HEX = re.compile(r"^#?([0-9a-fA-F]{6})$")


def clean_hex(v) -> Optional[str]:
    """'#AABBCC' style, or None when it isn't a colour."""
    m = HEX.match(str(v or "").strip())
    return f"#{m.group(1).lower()}" if m else None


def clean_colors(body: dict) -> Optional[dict]:
    """{"primary", "accent"} from a request body; None clears them. Raises
    ValueError when something was sent that isn't a colour."""
    p_raw, a_raw = body.get("primary"), body.get("accent")
    if not p_raw and not a_raw:
        return None
    p, a = clean_hex(p_raw), clean_hex(a_raw)
    if (p_raw and not p) or (a_raw and not a):
        raise ValueError("Colours are hex codes like #2f5fb3")
    if not p:
        raise ValueError("Pick the main colour")
    return {"primary": p, "accent": a}


def pick_colors(raw: bytes) -> Optional[dict]:
    """The logo's main colour and, when it has one, a second colour that's a
    clearly different hue. Whites, near-blacks and greys are skipped unless the
    logo is nothing but."""
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(raw)).convert("RGBA")
    except Exception:
        return None
    light_bg = has_light_background(img)
    img.thumbnail((96, 96))
    counts: dict = {}
    for r, g, b, a in img.getdata():
        if a < 128:
            continue
        key = (r // 16 * 16 + 8, g // 16 * 16 + 8, b // 16 * 16 + 8)
        counts[key] = counts.get(key, 0) + 1
    if not counts:
        return None

    def hsv(c):
        return colorsys.rgb_to_hsv(c[0] / 255, c[1] / 255, c[2] / 255)

    chromatic = [(n, c) for c, n in counts.items() if hsv(c)[1] >= 0.25 and 0.12 <= hsv(c)[2] <= 0.98]
    chromatic.sort(reverse=True)
    to_hex = lambda c: "#%02x%02x%02x" % c  # noqa: E731
    if not chromatic:
        # A black or grey logo: its darkest common colour.
        dark = sorted(((n, c) for c, n in counts.items() if hsv(c)[2] < 0.9), reverse=True)
        return {"primary": to_hex(dark[0][1]), "accent": None, "light_bg": light_bg} if dark else None
    primary = chromatic[0][1]
    ph = hsv(primary)[0]
    accent = None
    total = sum(n for n, _ in chromatic)
    for n, c in chromatic[1:]:
        dh = abs(hsv(c)[0] - ph)
        if min(dh, 1 - dh) >= 0.11 and n >= total * 0.06:
            accent = c
            break
    # The darker of the two leads (it carries white text).
    if accent and hsv(accent)[2] < hsv(primary)[2]:
        primary, accent = accent, primary
    return {"primary": to_hex(primary), "accent": to_hex(accent) if accent else None, "light_bg": light_bg}


def has_light_background(img) -> bool:
    """True when the logo sits on its own white (or near-white) background: all
    four corners solid and light. Such a logo can't go on a dark band without a
    white box round it, so the app gives that team a white look instead."""
    w, h = img.size
    if w < 2 or h < 2:
        return False
    for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        r, g, b, a = img.getpixel((x, y))
        if a < 200 or min(r, g, b) < 225:
            return False
    return True


async def ensure_auto_colors(db, user: dict) -> Optional[dict]:
    """For a logo uploaded before colours were picked: pick them once now and
    save them. Returns the colours (or None)."""
    auto = user.get("team_colors_auto")
    # Colours picked before light_bg existed are picked again once.
    if (auto and "light_bg" in auto) or not user.get("team_logo"):
        return auto
    logo = str(user.get("team_logo") or "")
    raw = None
    try:
        from core import media_store, object_storage
        if logo.startswith("data:"):
            raw = media_store.decode_image(logo)
        else:
            key = media_store.key_from_avatar_url(logo)
            if key:
                raw = await object_storage.get_bytes(key)
    except Exception:
        raw = None
    picked = pick_colors(raw) if raw else None
    if picked:
        from bson import ObjectId
        uid = user.get("_id") or user.get("id")
        try:
            await db.users.update_one({"_id": ObjectId(str(uid))}, {"$set": {"team_colors_auto": picked}})
        except Exception:
            pass
    return picked
