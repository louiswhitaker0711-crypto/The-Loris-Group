"""Reading Acwyre's territory map (a Folium HTML file, usually sent zipped).

The file is a Leaflet map with named layers in its layer control:

    Active Territory      blue sectors: the office's territory
    Priority Territory    yellow sectors: further out, road-trip territory
    Not Active Yet        red sectors: has to be requested first (not blocked)
    Ginger New Builds     orange new-build zones (no sector names)
    Sales                 green dots, one per sale (the weekly file)
    Out of Territory      red dots, sales outside the territory
    Zero Sales List       (kept by name, whatever it holds)

Each sector carries Acwyre's figures: sector ("DN69" = DN6 9), households,
last worked ("20-Apr-25"), sales and weeks since last worked.

`parse_territory_file` reads one upload (a .zip of .html files, or one .html)
and returns plain data; nothing here touches the database, so it's tested on
its own. Layers are found by their NAME, not their colour.
"""
from __future__ import annotations

import io
import json
import re
import zipfile
from datetime import datetime
from typing import Optional

MAX_HTML_BYTES = 40 * 1024 * 1024

# Layer name (lower case) → kind.
SECTOR_LAYERS = {
    "active territory": "active",
    "priority territory": "priority",
    "not active yet": "not_active",
}
ZONE_LAYERS = {"new builds": "new_build"}          # matched as "… new builds"
DOT_LAYERS = {"sales": "sale", "out of territory": "out_of_territory"}

KIND_LABEL = {
    "active": "Active territory",
    "priority": "Priority (road trip)",
    "not_active": "Not active yet (request first)",
    "new_build": "New builds",
}


def sector_code(raw) -> str:
    """'DN69' → 'DN6 9', 'BB120' → 'BB12 0', 'S445' → 'S44 5'. Already
    spaced codes are tidied; anything else comes back upper-cased."""
    s = re.sub(r"[^A-Z0-9 ]", "", str(raw or "").upper()).strip()
    if " " in s:
        return " ".join(s.split())
    if len(s) >= 3 and s[-1].isdigit():
        return f"{s[:-1]} {s[-1]}"
    return s


def postcode_to_sector(pc) -> str:
    """'dn6 9ab' → 'DN6 9'; 'DN69AB' → 'DN6 9'; 'DN6 9' stays."""
    s = re.sub(r"[^A-Z0-9]", "", str(pc or "").upper())
    if len(s) >= 5 and s[-2:].isalpha() and s[-3].isdigit():
        return f"{s[:-3]} {s[-3]}"
    return sector_code(pc)


def _date(v) -> Optional[str]:
    for fmt in ("%d-%b-%y", "%d-%b-%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(str(v).strip(), fmt).date().isoformat()
        except (TypeError, ValueError):
            continue
    return None


def _int(v) -> Optional[int]:
    try:
        return int(float(str(v).replace(",", "")))
    except (TypeError, ValueError):
        return None


def _round_coords(c):
    if isinstance(c, (list, tuple)):
        if c and isinstance(c[0], (int, float)):
            return [round(float(c[0]), 5), round(float(c[1]), 5)]
        return [_round_coords(x) for x in c]
    return c


def _bbox(geom: dict) -> dict:
    pts: list = []

    def walk(c):
        if c and isinstance(c[0], (int, float)):
            pts.append(c)
        else:
            for x in c:
                walk(x)
    walk(geom.get("coordinates") or [])
    lngs = [p[0] for p in pts]
    lats = [p[1] for p in pts]
    return {"s": min(lats), "w": min(lngs), "n": max(lats), "e": max(lngs)} if pts else {}


def _layer_kind(name: str) -> tuple[str, str]:
    n = name.strip().lower()
    if n in SECTOR_LAYERS:
        return "sector", SECTOR_LAYERS[n]
    if n.endswith("new builds"):
        return "zone", "new_build"
    if n in DOT_LAYERS:
        return "dot", DOT_LAYERS[n]
    return "other", re.sub(r"[^a-z0-9]+", "_", n).strip("_")


def parse_folium(html: str) -> dict:
    """One Folium map → {sectors, zones, dots, offices, layers}."""
    groups = {m.group(2): m.group(1) for m in re.finditer(r'"([^"]{2,60})"\s*:\s*(feature_group_\w+)', html)}
    owner = {m.group(1): m.group(2) for m in re.finditer(r'(geo_json_\w+)\.addTo\((feature_group_\w+)\)', html)}
    dec = json.JSONDecoder()
    sectors: list = []
    zones: list = []
    layers: dict = {}
    for m in re.finditer(r'(geo_json_\w+)_add\(\s*\{', html):
        var = m.group(1)
        name = groups.get(owner.get(var, ""), "")
        if not name:
            continue                      # an unnamed copy (Folium's hover layer)
        try:
            obj, _ = dec.raw_decode(html, m.end() - 1)
        except ValueError:
            continue
        what, kind = _layer_kind(name)
        layers[name] = len(obj.get("features") or [])
        for f in obj.get("features") or []:
            geom = f.get("geometry") or {}
            if geom.get("type") not in ("Polygon", "MultiPolygon"):
                continue
            geom = {"type": geom["type"], "coordinates": _round_coords(geom["coordinates"])}
            p = f.get("properties") or {}
            if what == "sector" and (p.get("sector") or p.get("name")):
                sectors.append({
                    "code": sector_code(p.get("sector") or p.get("name")),
                    "kind": kind,
                    "households": _int(p.get("households")),
                    "last_worked": _date(p.get("last_worked")),
                    "sales": _int(p.get("sales")),
                    "weeks_since": _int(p.get("weeks_since_last_worked")),
                    "office": str(p.get("office") or ""),
                    "geometry": geom, "bbox": _bbox(geom),
                })
            elif what in ("zone", "other", "sector"):
                zones.append({"kind": kind, "layer": name, "geometry": geom, "bbox": _bbox(geom)})
    dots: list = []
    for m in re.finditer(r'L\.circleMarker\(\s*\[\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\]\s*,\s*\{[^}]*\}\s*\)\.addTo\((feature_group_\w+)\)', html):
        name = groups.get(m.group(3), "")
        if not name:
            continue
        what, kind = _layer_kind(name)
        layers.setdefault(name, 0)
        layers[name] += 1
        dots.append({"kind": kind, "lat": round(float(m.group(1)), 5), "lng": round(float(m.group(2)), 5)})
    offices = []
    for m in re.finditer(r'L\.marker\(\s*\[\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\][^;]*;(.{0,1500}?)>([^<>]{2,60})</div>`\)', html, re.S):
        offices.append({"name": m.group(4).strip(), "lat": round(float(m.group(1)), 5), "lng": round(float(m.group(2)), 5)})
    return {"sectors": sectors, "zones": zones, "dots": dots, "offices": offices, "layers": layers}


def parse_territory_file(filename: str, data: bytes) -> dict:
    """A .zip of Folium maps, or one .html. Sectors with the same code are
    merged (the last one wins); everything else is added up."""
    htmls: list[str] = []
    if (filename or "").lower().endswith(".zip") or data[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            for info in z.infolist():
                if info.filename.lower().endswith((".html", ".htm")) and info.file_size <= MAX_HTML_BYTES:
                    htmls.append(z.read(info).decode("utf-8", errors="replace"))
    else:
        if len(data) > MAX_HTML_BYTES:
            raise ValueError("That file is too big")
        htmls.append(data.decode("utf-8", errors="replace"))
    if not htmls:
        raise ValueError("No map (.html) found in that file")
    by_code: dict = {}
    out = {"zones": [], "dots": [], "offices": [], "layers": {}}
    for h in htmls:
        r = parse_folium(h)
        for s in r["sectors"]:
            by_code[s["code"]] = s
        out["zones"] += r["zones"]
        out["dots"] += r["dots"]
        out["offices"] += r["offices"]
        for k, v in r["layers"].items():
            out["layers"][k] = out["layers"].get(k, 0) + v
    out["sectors"] = sorted(by_code.values(), key=lambda s: s["code"])
    return out


def summary(parsed: dict) -> dict:
    """Counts for the upload preview."""
    kinds: dict = {}
    for s in parsed.get("sectors") or []:
        kinds[s["kind"]] = kinds.get(s["kind"], 0) + 1
    dots: dict = {}
    for d in parsed.get("dots") or []:
        dots[d["kind"]] = dots.get(d["kind"], 0) + 1
    return {"sectors": len(parsed.get("sectors") or []), "by_kind": kinds,
            "zones": len(parsed.get("zones") or []), "dots": dots,
            "offices": [o["name"] for o in parsed.get("offices") or []],
            "layers": parsed.get("layers") or {}}
