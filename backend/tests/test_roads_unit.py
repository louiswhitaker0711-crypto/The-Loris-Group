"""Street snapping: a wobbly finger line lands on the roads it went along,
turns corners through the junction, keeps its own shape where there's no
road, and knows which side of the road it was drawn on."""
import asyncio
import math
import os
import random
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:1/unused")
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core import roads  # noqa: E402

F = roads.Frame(53.52, -1.13)


def grid():
    """Streets every 100 m east-west and every 150 m north-south, 600 x 400 m."""
    nodes, ways, nid = {}, [], 0
    ids = {}
    for gx in range(0, 601, 50):
        for gy in range(0, 401, 50):
            nid += 1
            ids[(gx, gy)] = nid
            nodes[nid] = tuple(F.ll(gx, gy))
    for gy in range(0, 401, 100):
        ways.append([ids[(gx, gy)] for gx in range(0, 601, 50)])
    for gx in range(0, 601, 150):
        ways.append([ids[(gx, gy)] for gy in range(0, 401, 50)])
    return nodes, ways


def wobble(pts, amp=6, side=0.0, seed=1):
    rnd = random.Random(seed)
    out = []
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        steps = max(2, int(math.hypot(x1 - x0, y1 - y0) / 4))
        dx, dy = (x1 - x0), (y1 - y0)
        ln = math.hypot(dx, dy)
        nx, ny = -dy / ln, dx / ln           # left of travel
        for k in range(steps):
            t = k / steps
            w = rnd.uniform(-amp, amp) + side
            out.append(F.ll(x0 + dx * t + nx * w, y0 + dy * t + ny * w))
    out.append(F.ll(*pts[-1]))
    return out


def off_road(xy):
    """Metres from the nearest grid street."""
    x, y = xy
    dy = min(abs(y - gy) for gy in range(0, 401, 100))
    dx = min(abs(x - gx) for gx in range(0, 601, 150))
    return min(dx if 0 <= y <= 400 else 99, dy if 0 <= x <= 600 else 99)


def test_a_wobbly_line_round_a_corner_lands_on_the_streets():
    nodes, ways = grid()
    drawn = wobble([(10, 4), (300, 4), (300, 190)], amp=8)
    r = roads.match_line(drawn, nodes, ways, tol_m=25)
    assert r["snapped"]
    pts = [F.xy(*p) for p in r["line"]]
    assert max(off_road(p) for p in pts) < 0.6
    # Through the junction at (300, 0), not cutting the corner.
    assert min(math.hypot(x - 300, y - 0) for x, y in pts) < 1
    assert math.hypot(pts[0][0] - 10, pts[0][1]) < 8
    assert math.hypot(pts[-1][0] - 300, pts[-1][1] - 190) < 8
    assert len(r["line"]) < 40        # straight streets need few points


def test_up_one_side_and_back_the_other_is_the_same_relative_side():
    nodes, ways = grid()
    out_and_back = wobble([(20, 0), (280, 0), (280, 0.1), (20, 0.1)], amp=1.5, side=5)
    r = roads.match_line(out_and_back, nodes, ways, tol_m=25)
    assert r["snapped"] and r["side"] == "left"
    right = wobble([(20, 100), (280, 100)], amp=1.5, side=-5)
    assert roads.match_line(right, nodes, ways, tol_m=25)["side"] == "right"


def test_no_road_nearby_keeps_the_drawn_line():
    nodes, ways = grid()
    # Out past the grid's east edge: a new estate with no roads mapped.
    drawn = wobble([(700, 40), (900, 60)], amp=3)
    r = roads.match_line(drawn, nodes, ways, tol_m=20)
    assert not r["snapped"]
    pts = [F.xy(*p) for p in r["line"]]
    assert pts[0][0] > 690 and pts[-1][0] > 880
    # No roads at all: same.
    assert not roads.match_line(drawn, {}, [], 20)["snapped"]


def test_overpass_query_is_roads_only_and_tiles_are_cached():
    q = roads.overpass_query(53.5, -1.2, 53.52, -1.17)
    assert "residential" in q and "footway" not in q and "path" not in q and '[!"service"]' in q
    assert roads.tile_keys(53.501, -1.199, 53.519, -1.171) == ["2675:-40"]
    from mongomock_motor import AsyncMongoMockClient
    db = AsyncMongoMockClient()["t"]
    calls = []
    nodes, ways = grid()

    async def fake(s, w, n, e):
        calls.append((s, w, n, e))
        return {"nodes": [[k, v[0], v[1]] for k, v in nodes.items()], "ways": ways}

    drawn = wobble([(10, 4), (300, 4)], amp=5)
    out = asyncio.run(roads.snap_lines(db, [drawn], 25, fetch=fake))
    assert out[0]["snapped"] and calls
    n_calls = len(calls)
    asyncio.run(roads.snap_lines(db, [drawn], 25, fetch=fake))
    assert len(calls) == n_calls       # second time from the cache

    async def broken(*_a):
        raise RuntimeError("down")

    db2 = AsyncMongoMockClient()["t2"]
    res = asyncio.run(roads.snap_lines(db2, [drawn], 25, fetch=broken))
    assert res[0]["snapped"] is False and len(res[0]["line"]) >= 2
