"""Snapping a finger-drawn line onto the real streets (the Owner, 26 Nov 2026).

The map's tiles are OpenStreetMap, and OpenStreetMap keeps every road as
data. For a sector we fetch the roads once (Overpass API), cache them in
tiles (`road_tiles`, refreshed after ROAD_DAYS), and match each drawn stroke
to the roads it went along (a small hidden-Markov map matcher: each point
of the stroke picks a nearby road, preferring the choice whose route
between points is as long as the finger actually moved). The wobbly line is
swapped for the road's own shape.

Roads only: no footpaths, steps, cycleways or driveways (the Owner).
Where there's no road near the finger (a new estate missing from
OpenStreetMap), that stretch keeps the hand-drawn line.

Half street: the side of the road the finger was on, relative to the way
it was drawn ("left" / "right"), so a line can sit on that side. Going up
one side and back down the other is the same relative side both ways.
"""
from __future__ import annotations

import asyncio
import heapq
import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

TILE_LAT = 0.02          # ~2.2 km
TILE_LNG = 0.03          # ~2 km at UK latitudes
ROAD_DAYS = 30
# Fastest first (26 Nov 2026: maps.mail.ru ~15 s a tile, overpass-api.de ~2 min).
OVERPASS = ("https://maps.mail.ru/osm/tools/overpass/api/interpreter",
            "https://overpass-api.de/api/interpreter",
            "https://overpass.private.coffee/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter")
ROAD_TYPES = ("trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|"
              "unclassified|residential|living_street|road")
STEP_M = 8.0             # resample the stroke every 8 m
MAX_OUT = 380            # points per line (the server keeps 400)
SEARCH_M = 160.0         # how far a route between two points may wander
BETA = 6.0               # transition: metres of extra route per unit cost

_locks: dict[str, asyncio.Lock] = {}
_failed: dict[str, float] = {}   # tile key → when a fetch last failed (don't hammer a busy server)
last_error: dict[str, str] = {}  # tile key → why the last fetch failed
RETRY_AFTER_S = 120


# ── Geometry ─────────────────────────────────────────────────────────────────

class Frame:
    """Flat metres around a point (fine over a few km)."""

    def __init__(self, lat0: float, lng0: float):
        self.lat0, self.lng0 = lat0, lng0
        self.kx = math.cos(math.radians(lat0)) * 111320.0
        self.ky = 110540.0

    def xy(self, lat: float, lng: float) -> tuple[float, float]:
        return ((lng - self.lng0) * self.kx, (lat - self.lat0) * self.ky)

    def ll(self, x: float, y: float) -> list[float]:
        return [round(self.lat0 + y / self.ky, 6), round(self.lng0 + x / self.kx, 6)]


def _resample(pts: list[tuple[float, float]], step: float) -> list[tuple[float, float]]:
    if len(pts) < 2:
        return list(pts)
    out = [pts[0]]
    carry = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        seg = math.hypot(x1 - x0, y1 - y0)
        if seg == 0:
            continue
        d = step - carry
        while d <= seg:
            t = d / seg
            out.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
            d += step
        carry = seg - (d - step)
    if math.hypot(out[-1][0] - pts[-1][0], out[-1][1] - pts[-1][1]) > step * 0.3:
        out.append(pts[-1])
    return out


def _project(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    l2 = dx * dx + dy * dy
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
    qx, qy = ax + dx * t, ay + dy * t
    return t, qx, qy, math.hypot(px - qx, py - qy)


def _rdp(pts: list, eps: float) -> list:
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        best, idx = -1.0, -1
        ax, ay = pts[a]
        bx, by = pts[b]
        for i in range(a + 1, b):
            d = _project(pts[i][0], pts[i][1], ax, ay, bx, by)[3]
            if d > best:
                best, idx = d, i
        if best > eps:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]


def smooth(pts: list[tuple[float, float]], passes: int = 2) -> list[tuple[float, float]]:
    """A light moving average, ends kept: takes the wobble out of freehand."""
    out = list(pts)
    for _ in range(passes):
        if len(out) < 3:
            return out
        out = [out[0]] + [((a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4)
                          for a, b, c in zip(out, out[1:], out[2:])] + [out[-1]]
    return out


# ── The road network ─────────────────────────────────────────────────────────

class Network:
    """Road nodes and the edges between them, in a flat frame, with a grid
    index of edges for finding the ones near a point."""

    CELL = 25.0

    def __init__(self, nodes: dict, ways: Iterable[list], frame: Frame):
        self.f = frame
        self.xy: dict = {}
        self.adj: dict = {}
        self.edges: list[tuple] = []
        self.grid: dict = {}
        seen = set()
        for w in ways:
            for a, b in zip(w, w[1:]):
                if a == b or a not in nodes or b not in nodes:
                    continue
                key = (a, b) if str(a) < str(b) else (b, a)
                if key in seen:
                    continue
                seen.add(key)
                for n in (a, b):
                    if n not in self.xy:
                        self.xy[n] = frame.xy(*nodes[n])
                (ax, ay), (bx, by) = self.xy[a], self.xy[b]
                ln = math.hypot(bx - ax, by - ay)
                ei = len(self.edges)
                self.edges.append((a, b, ln))
                self.adj.setdefault(a, []).append((b, ln))
                self.adj.setdefault(b, []).append((a, ln))
                for cell in self._cells(min(ax, bx), min(ay, by), max(ax, bx), max(ay, by)):
                    self.grid.setdefault(cell, []).append(ei)

    def _cells(self, x0, y0, x1, y1):
        c = self.CELL
        for i in range(int(math.floor(x0 / c)), int(math.floor(x1 / c)) + 1):
            for j in range(int(math.floor(y0 / c)), int(math.floor(y1 / c)) + 1):
                yield (i, j)

    def near(self, x: float, y: float, tol: float, k: int = 5) -> list[dict]:
        found: dict[int, dict] = {}
        for cell in self._cells(x - tol, y - tol, x + tol, y + tol):
            for ei in self.grid.get(cell, ()):
                if ei in found:
                    continue
                a, b, ln = self.edges[ei]
                t, qx, qy, d = _project(x, y, *self.xy[a], *self.xy[b])
                if d <= tol:
                    found[ei] = {"e": ei, "t": t, "x": qx, "y": qy, "d": d}
        return sorted(found.values(), key=lambda c: c["d"])[:k]

    def dijkstra(self, src, limit: float) -> tuple[dict, dict]:
        dist = {src: 0.0}
        parent: dict = {src: None}
        heap = [(0.0, 0, src)]
        tie = 0
        while heap:
            d, _, n = heapq.heappop(heap)
            if d > dist.get(n, math.inf) or d > limit:
                continue
            for m, ln in self.adj.get(n, ()):
                nd = d + ln
                if nd < dist.get(m, math.inf) and nd <= limit:
                    dist[m] = nd
                    parent[m] = n
                    tie += 1
                    heapq.heappush(heap, (nd, tie, m))
        return dist, parent


def _path(parent: dict, src, dst) -> list:
    out = [dst]
    while out[-1] != src:
        p = parent.get(out[-1])
        if p is None:
            return [src, dst]
        out.append(p)
    return out[::-1]


# ── Matching ─────────────────────────────────────────────────────────────────

def match_line(latlngs: list, nodes: dict, ways: list, tol_m: float = 25.0) -> dict:
    """One drawn stroke → {line: [[lat, lng], …], side: left|right, snapped: bool}.

    `nodes` {id: (lat, lng)}, `ways` [[id, …], …]. Stretches with no road
    within `tol_m` keep the (smoothed) hand-drawn points.
    """
    raw_ll = [(float(p[0]), float(p[1])) for p in latlngs if p and len(p) >= 2]
    if len(raw_ll) < 2:
        return {"line": [list(p) for p in raw_ll], "side": "left", "snapped": False}
    lat0 = sum(p[0] for p in raw_ll) / len(raw_ll)
    lng0 = sum(p[1] for p in raw_ll) / len(raw_ll)
    f = Frame(lat0, lng0)
    raw = [f.xy(*p) for p in raw_ll]
    net = Network(nodes, ways, f)
    samples = _resample(raw, STEP_M)
    if len(samples) < 2:
        samples = [raw[0], raw[-1]]
    tol = max(6.0, min(60.0, float(tol_m or 25.0)))
    sigma = max(5.0, tol / 2.5)
    cands = [net.near(x, y, tol) for x, y in samples]
    memo: dict = {}

    def dj(n):
        if n not in memo:
            memo[n] = net.dijkstra(n, SEARCH_M)
        return memo[n]

    def route(cj: dict, ck: dict):
        """Shortest walk from candidate j to k: (metres, [node ids between])."""
        a, b, ln = net.edges[cj["e"]]
        c, d, lk = net.edges[ck["e"]]
        if cj["e"] == ck["e"]:
            return abs(cj["t"] - ck["t"]) * ln, []
        best = (math.inf, [])
        for u, du in ((a, cj["t"] * ln), (b, (1 - cj["t"]) * ln)):
            dist, parent = dj(u)
            for v, dv in ((c, ck["t"] * lk), (d, (1 - ck["t"]) * lk)):
                if v in dist:
                    tot = du + dist[v] + dv
                    if tot < best[0]:
                        best = (tot, (u, v, parent))
        if best[0] == math.inf:
            return math.inf, []
        u, v, parent = best[1]
        return best[0], _path(parent, u, v)

    # Viterbi over runs of samples that have roads nearby.
    runs: list[list[tuple[int, dict, list]]] = []   # [(sample index, candidate, nodes before it)]
    i = 0
    n = len(samples)
    while i < n:
        if not cands[i]:
            i += 1
            continue
        score = [(c["d"] / sigma) ** 2 * 0.5 for c in cands[i]]
        back: list[list] = [[(None, []) for _ in cands[i]]]
        idxs = [i]
        j = i + 1
        while j < n and cands[j]:
            prev = cands[idxs[-1]]
            sx, sy = samples[idxs[-1]]
            tx, ty = samples[j]
            straight = math.hypot(tx - sx, ty - sy)
            new_score, new_back = [], []
            for ck in cands[j]:
                em = (ck["d"] / sigma) ** 2 * 0.5
                best, arg = math.inf, (None, [])
                for pj, cj in enumerate(prev):
                    r, via = route(cj, ck)
                    if r == math.inf or r > straight * 4 + 60:
                        continue
                    cost = score[pj] + abs(r - straight) / BETA
                    if cost < best:
                        best, arg = cost, (pj, via)
                new_score.append(best + em)
                new_back.append(arg)
            if min(new_score) == math.inf:
                break   # no way along the roads from here: a new run starts
            score, idxs = new_score, idxs + [j]
            back.append(new_back)
            j += 1
        # Backtrack this run.
        k = min(range(len(score)), key=lambda q: score[q])
        chain = []
        for step in range(len(idxs) - 1, -1, -1):
            pj, via = back[step][k]
            chain.append((idxs[step], cands[idxs[step]][k], via))
            if pj is None:
                break
            k = pj
        chain.reverse()
        if len(chain) >= 2:
            runs.append(chain)
        i = idxs[-1] + 1

    if not runs:
        line = smooth(raw)
        return {"line": [f.ll(*p) for p in _rdp(line, 0.8)], "side": "left", "snapped": False}

    # Build the line: matched runs along the roads, gaps as drawn.
    out: list[tuple[float, float]] = []
    where: dict[int, int] = {}          # sample index → index in `out`
    matched = 0
    last = -1
    for chain in runs:
        first_i = chain[0][0]
        if first_i > last + 1:
            out.extend(smooth(samples[last + 1:first_i]))
        for si, cand, via in chain:
            for node in via:
                out.append(net.xy[node])
            where[si] = len(out)
            out.append((cand["x"], cand["y"]))
            matched += 1
        last = chain[-1][0]
    if last < n - 1:
        out.extend(smooth(samples[last + 1:]))

    # Which side of the road the finger was on, against the way it was drawn.
    signed = 0.0
    for si, oi in where.items():
        a = out[max(0, oi - 1)]
        b = out[min(len(out) - 1, oi + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(dx, dy)
        if ln == 0:
            continue
        rx, ry = samples[si][0] - out[oi][0], samples[si][1] - out[oi][1]
        signed += (dx * ry - dy * rx) / ln
    side = "right" if signed < -1.0 * len(where) else "left"

    clean = [out[0]]
    for p in out[1:]:
        if math.hypot(p[0] - clean[-1][0], p[1] - clean[-1][1]) > 0.3:
            clean.append(p)
    eps = 0.5
    while True:
        simp = _rdp(clean, eps)
        if len(simp) <= MAX_OUT:
            break
        eps *= 2
    return {"line": [f.ll(*p) for p in simp], "side": side, "snapped": matched >= max(2, n * 0.5)}


# ── Fetching and caching the roads ───────────────────────────────────────────

def tile_keys(s: float, w: float, n: float, e: float) -> list[str]:
    out = []
    for i in range(int(math.floor(s / TILE_LAT)), int(math.floor(n / TILE_LAT)) + 1):
        for j in range(int(math.floor(w / TILE_LNG)), int(math.floor(e / TILE_LNG)) + 1):
            out.append(f"{i}:{j}")
    return out


def tile_box(key: str) -> tuple[float, float, float, float]:
    i, j = (int(x) for x in key.split(":"))
    return (round(i * TILE_LAT, 6), round(j * TILE_LNG, 6), round((i + 1) * TILE_LAT, 6), round((j + 1) * TILE_LNG, 6))


def overpass_query(s: float, w: float, n: float, e: float) -> str:
    box = f"{s},{w},{n},{e}"
    return (f'[out:json][timeout:25];'
            f'(way["highway"~"^({ROAD_TYPES})$"]["area"!="yes"]({box});'
            f'way["highway"="service"][!"service"]["area"!="yes"]({box}););'
            f'(._;>;);out skel qt;')


def parse_overpass(data: dict) -> dict:
    nodes, ways = [], []
    for el in (data or {}).get("elements") or []:
        if el.get("type") == "node" and "lat" in el:
            nodes.append([el["id"], round(el["lat"], 7), round(el["lon"], 7)])
        elif el.get("type") == "way" and el.get("nodes"):
            ways.append(el["nodes"])
    return {"nodes": nodes, "ways": ways}


# ── Vector tiles (OpenFreeMap): the fast, reliable source ───────────────────
# Overpass's free servers are often overloaded (502/504, minutes per area,
# 27 Nov 2026). OpenFreeMap serves OpenStreetMap as vector tiles from a CDN:
# the same roads, in a second. Roads come from the `transportation` layer
# (OpenMapTiles schema); we read the tiles with a small decoder below.

VECTOR_TILEJSON = "https://tiles.openfreemap.org/planet"
VECTOR_Z = 14
ROAD_CLASSES = {"motorway_link", "trunk", "primary", "secondary", "tertiary", "minor", "service", "living_street", "residential", "unclassified"}
NOT_SERVICE = {"driveway", "parking_aisle", "drive-through", "drive_through"}
_tilejson: dict = {}


def _varint(buf: bytes, i: int) -> tuple[int, int]:
    out = shift = 0
    while True:
        b = buf[i]
        i += 1
        out |= (b & 0x7F) << shift
        if b < 0x80:
            return out, i
        shift += 7


def _fields(buf: bytes):
    """Protobuf fields: (number, wire type, value)."""
    i, n = 0, len(buf)
    while i < n:
        key, i = _varint(buf, i)
        num, wt = key >> 3, key & 7
        if wt == 0:
            v, i = _varint(buf, i)
        elif wt == 2:
            ln, i = _varint(buf, i)
            v = buf[i:i + ln]
            i += ln
        elif wt == 1:
            v = buf[i:i + 8]
            i += 8
        elif wt == 5:
            v = buf[i:i + 4]
            i += 4
        else:
            raise ValueError("bad tile")
        yield num, wt, v


def _packed(buf: bytes) -> list[int]:
    out, i = [], 0
    while i < len(buf):
        v, i = _varint(buf, i)
        out.append(v)
    return out


def _value(buf: bytes):
    import struct
    for num, wt, v in _fields(buf):
        if num == 1:
            return v.decode("utf-8", "replace")
        if num == 2:
            return struct.unpack("<f", v)[0]
        if num == 3:
            return struct.unpack("<d", v)[0]
        if num in (4, 5):
            return v
        if num == 6:
            return (v >> 1) ^ -(v & 1)
        if num == 7:
            return bool(v)
    return None


def decode_roads(tile: bytes, tx: int, ty: int, z: int = VECTOR_Z) -> list[list[tuple[int, int]]]:
    """The road lines in one vector tile, as global integer pixel points
    (tile x · extent + x), so points shared across tiles match exactly."""
    import gzip
    if tile[:2] == b"\x1f\x8b":
        tile = gzip.decompress(tile)
    lines = []
    for num, wt, layer in _fields(tile):
        if num != 3:
            continue
        name, keys, values, feats, extent = "", [], [], [], 4096
        for ln, lwt, lv in _fields(layer):
            if ln == 1:
                name = lv.decode()
            elif ln == 2:
                feats.append(lv)
            elif ln == 3:
                keys.append(lv.decode())
            elif ln == 4:
                values.append(_value(lv))
            elif ln == 5:
                extent = lv
        if name != "transportation":
            continue
        for f in feats:
            tags, gtype, geom = [], 0, []
            for fn, fwt, fv in _fields(f):
                if fn == 2:
                    tags = _packed(fv)
                elif fn == 3:
                    gtype = fv
                elif fn == 4:
                    geom = _packed(fv)
            if gtype != 2:
                continue
            props = {keys[tags[k]]: values[tags[k + 1]] for k in range(0, len(tags) - 1, 2)
                     if tags[k] < len(keys) and tags[k + 1] < len(values)}
            cls = str(props.get("class") or "")
            if cls not in ROAD_CLASSES:
                continue
            if cls == "service" and str(props.get("service") or "") in NOT_SERVICE:
                continue
            x = y = 0
            i = 0
            cur: list = []
            while i < len(geom):
                cmd, count = geom[i] & 7, geom[i] >> 3
                i += 1
                if cmd == 7:
                    continue
                for _ in range(count):
                    dx, dy = geom[i], geom[i + 1]
                    i += 2
                    x += (dx >> 1) ^ -(dx & 1)
                    y += (dy >> 1) ^ -(dy & 1)
                    pt = (tx * extent + x, ty * extent + y)
                    if cmd == 1:
                        if len(cur) >= 2:
                            lines.append(cur)
                        cur = [pt]
                    else:
                        cur.append(pt)
            if len(cur) >= 2:
                lines.append(cur)
    return lines


def _tile_xy(lat: float, lng: float, z: int) -> tuple[int, int]:
    n = 2 ** z
    x = int((lng + 180) / 360 * n)
    y = int((1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def _px_to_ll(gx: int, gy: int, z: int, extent: int = 4096) -> tuple[float, float]:
    n = 2 ** z * extent
    lng = gx / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * gy / n))))
    return round(lat, 7), round(lng, 7)


def lines_to_network(lines: list, s: float, w: float, n: float, e: float, z: int = VECTOR_Z) -> dict:
    """Vector-tile lines → {nodes, ways} like Overpass gives, with roads that
    meet mid-line joined (the tiles don't always share a point there)."""
    pad = 0.003
    ways = []
    for ln in lines:
        lls = [_px_to_ll(gx, gy, z) for gx, gy in ln]
        if all(not (s - pad <= a <= n + pad and w - pad <= b <= e + pad) for a, b in lls):
            continue
        ways.append(list(ln))
    # Join a road's end onto the road it meets, if within ~3 m and not already joined.
    seg_grid: dict = {}
    CELL = 64     # ~ 6 m at z14 in pixels
    for wi, way in enumerate(ways):
        for si, (a, b) in enumerate(zip(way, way[1:])):
            for cx in range(min(a[0], b[0]) // CELL, max(a[0], b[0]) // CELL + 1):
                for cy in range(min(a[1], b[1]) // CELL, max(a[1], b[1]) // CELL + 1):
                    seg_grid.setdefault((cx, cy), []).append((wi, si))
    points = {p for way in ways for p in way}
    lat0 = (s + n) / 2
    m_per_px = 156543.03 * math.cos(math.radians(lat0)) / (2 ** z) * 256 / 4096
    reach = 3.5 / m_per_px
    inserts: dict = {}
    extra = []
    for way in ways:
        for end in (way[0], way[-1]):
            best = None
            cx, cy = end[0] // CELL, end[1] // CELL
            for gx in (cx - 1, cx, cx + 1):
                for gy in (cy - 1, cy, cy + 1):
                    for wi, si in seg_grid.get((gx, gy), ()):
                        a, b = ways[wi][si], ways[wi][si + 1]
                        if end in (a, b):
                            continue
                        t, qx, qy, d = _project(end[0], end[1], a[0], a[1], b[0], b[1])
                        if d <= reach and (best is None or d < best[0]):
                            best = (d, wi, si, t, (round(qx), round(qy)))
            if best and best[4] not in points:
                d, wi, si, t, q = best
                inserts.setdefault((wi, si), []).append((t, q))
                points.add(q)
                extra.append([end, q])
            elif best:
                extra.append([end, best[4]])
    for (wi, si), qs in sorted(inserts.items(), reverse=True):
        for t, q in sorted(qs, reverse=True):
            ways[wi].insert(si + 1, q)
    ways += [x for x in extra if x[0] != x[1]]
    ids: dict = {}
    nodes = []
    out_ways = []
    for way in ways:
        row = []
        for p in way:
            if p not in ids:
                ids[p] = -(p[0] * (1 << 28) + p[1] + 1)   # negative: never clashes with an OSM id
                lat, lng = _px_to_ll(p[0], p[1], z)
                nodes.append([ids[p], lat, lng])
            if not row or row[-1] != ids[p]:
                row.append(ids[p])
        if len(row) >= 2:
            out_ways.append(row)
    return {"nodes": nodes, "ways": out_ways}


async def fetch_vector(s, w, n, e) -> dict:
    """The roads in a box from OpenFreeMap's vector tiles."""
    import httpx
    async with httpx.AsyncClient(timeout=httpx.Timeout(15, connect=6),
                                 headers={"User-Agent": "TheLorisHub/1.0 (street snapping)"}) as client:
        now = datetime.now(timezone.utc)
        if not _tilejson.get("url") or _tilejson.get("at", now) < now - timedelta(hours=12):
            r = await client.get(VECTOR_TILEJSON)
            r.raise_for_status()
            _tilejson.update({"url": r.json()["tiles"][0], "at": now})
        x0, y0 = _tile_xy(n, w, VECTOR_Z)
        x1, y1 = _tile_xy(s, e, VECTOR_Z)
        lines = []
        for tx in range(x0, x1 + 1):
            for ty in range(y0, y1 + 1):
                url = _tilejson["url"].replace("{z}", str(VECTOR_Z)).replace("{x}", str(tx)).replace("{y}", str(ty))
                r = await client.get(url)
                if r.status_code == 404:
                    continue
                r.raise_for_status()
                lines += decode_roads(r.content, tx, ty)
    got = lines_to_network(lines, s, w, n, e)
    if not got["nodes"]:
        raise RuntimeError("no roads in the vector tiles")
    return got


async def fetch_any(s, w, n, e) -> dict:
    """Vector tiles first (fast), Overpass if they fail."""
    try:
        return await fetch_vector(s, w, n, e)
    except Exception as ex:
        logger.warning("vector roads failed, trying Overpass: %s", ex)
        return await _fetch(s, w, n, e)


async def _fetch(s, w, n, e) -> dict:
    import httpx
    q = overpass_query(s, w, n, e)
    last: Optional[Exception] = None
    async with httpx.AsyncClient(timeout=httpx.Timeout(45, connect=8), headers={"User-Agent": "TheLorisHub/1.0 (street snapping)"}) as client:
        for url in OVERPASS:
            try:
                r = await client.post(url, data={"data": q}, headers={"Accept": "application/json"})
                if r.status_code != 200:
                    raise RuntimeError(f"{url} answered {r.status_code}: {r.text[:120]}")
                return parse_overpass(r.json())
            except Exception as ex:   # try the next server
                last = RuntimeError(f"{url}: {type(ex).__name__} {ex}")
    raise RuntimeError(f"Overpass unavailable: {last}")


async def _tile(db, key: str, fetch=None, cached_only: bool = False) -> Optional[dict]:
    fresh = (datetime.now(timezone.utc) - timedelta(days=ROAD_DAYS)).isoformat()
    doc = await db.road_tiles.find_one({"key": key}, {"_id": 0})
    if doc and (doc.get("fetched_at", "") >= fresh or cached_only):
        return doc
    if cached_only:
        return None
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        doc2 = await db.road_tiles.find_one({"key": key}, {"_id": 0})
        if doc2 and doc2.get("fetched_at", "") >= fresh:
            return doc2
        import time
        if time.monotonic() - _failed.get(key, -1e9) < RETRY_AFTER_S:
            return doc
        s, w, n, e = tile_box(key)
        pad = 0.001
        try:
            got = await (fetch or fetch_any)(s - pad, w - pad, n + pad, e + pad)
        except Exception as ex:
            logger.warning("road tile %s fetch failed: %s", key, ex)
            _failed[key] = time.monotonic()
            last_error[key] = f"{type(ex).__name__}: {ex!r}"[:300]
            return doc   # an old copy beats nothing
        new = {"key": key, "nodes": got["nodes"], "ways": got["ways"],
               "fetched_at": datetime.now(timezone.utc).isoformat()}
        await db.road_tiles.update_one({"key": key}, {"$set": new}, upsert=True)
        return new


async def roads_in(db, s: float, w: float, n: float, e: float, fetch=None,
                   missing: Optional[list] = None, cached_only: bool = False) -> tuple[dict, list]:
    """Every road in the box: ({node id: (lat, lng)}, [[node ids], …]).
    Tiles that couldn't be fetched are added to `missing`."""
    nodes: dict = {}
    ways: list = []
    for key in tile_keys(s, w, n, e)[:12]:
        t = await _tile(db, key, fetch, cached_only)
        if not t:
            if missing is not None:
                missing.append(key)
            continue
        for nid, lat, lng in t.get("nodes") or []:
            nodes[nid] = (lat, lng)
        ways.extend(t.get("ways") or [])
    return nodes, ways


def tile_from_upload(key: str, data: dict) -> dict:
    """A tile the phone fetched from OpenStreetMap itself (when the server
    can't reach it), checked: node ids and points inside the tile's box."""
    s, w, n, e = tile_box(key)
    pad = 0.01
    got = parse_overpass(data)
    if len(got["nodes"]) > 120000 or len(got["ways"]) > 30000:
        raise ValueError("too big")
    nodes = [[int(i), float(lat), float(lng)] for i, lat, lng in got["nodes"]
             if s - pad <= float(lat) <= n + pad and w - pad <= float(lng) <= e + pad]
    ways = [[int(x) for x in way][:2000] for way in got["ways"] if isinstance(way, list)]
    return {"key": key, "nodes": nodes, "ways": ways, "fetched_at": datetime.now(timezone.utc).isoformat(), "from": "phone"}


async def snap_lines(db, lines: list, tol_m: float = 25.0, fetch=None, missing: Optional[list] = None,
                     cached_only: bool = False) -> list[dict]:
    """Each drawn stroke snapped to the streets (see `match_line`)."""
    pts = [p for line in lines for p in line]
    if not pts:
        return []
    pad = max(tol_m, 30.0) * 2 / 111000.0
    s = min(p[0] for p in pts) - pad
    n = max(p[0] for p in pts) + pad
    w = min(p[1] for p in pts) - pad * 1.7
    e = max(p[1] for p in pts) + pad * 1.7
    try:
        nodes, ways = await roads_in(db, s, w, n, e, fetch, missing, cached_only)
    except Exception as ex:
        logger.warning("road lookup failed: %s", ex)
        nodes, ways = {}, []
    return [match_line(line, nodes, ways, tol_m) for line in lines]


async def prefetch_territory(db, limit: int = 400) -> int:
    """Overnight: fetch the streets for every sector on the territory map
    that isn't saved yet (or is a month old), so drawing never waits."""
    fresh = (datetime.now(timezone.utc) - timedelta(days=ROAD_DAYS - 2)).isoformat()
    have = {d["key"] async for d in db.road_tiles.find({"fetched_at": {"$gte": fresh}}, {"key": 1})}
    keys: list[str] = []
    async for sec in db.territory_sectors.find({"bbox": {"$exists": True}}, {"bbox": 1}):
        b = sec.get("bbox") or {}
        if not all(k in b for k in "swne"):
            continue
        for k in tile_keys(b["s"], b["w"], b["n"], b["e"]):
            if k not in have and k not in keys:
                keys.append(k)
    done = 0
    for k in keys[:limit]:
        if await _tile(db, k):
            done += 1
    return done
