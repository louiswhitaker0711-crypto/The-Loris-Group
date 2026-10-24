"""The shared Bells link opens the app's own sheet (routes/public_html.py).

The server-drawn page used to answer /public/bells/<office> in front of the
app, so the link showed an older layout. Now the app's exported page wins;
the old page only answers when there's no web build (local runs).
"""
import asyncio
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from routes import public_html  # noqa: E402


def test_the_apps_page_answers_the_link(tmp_path, monkeypatch):
    page = tmp_path / "public" / "bells"
    page.mkdir(parents=True)
    (page / "[office].html").write_text("<html>app sheet</html>", encoding="utf-8")
    (tmp_path / "index.html").write_text("<html>index</html>", encoding="utf-8")
    monkeypatch.setenv("WEB_DIST_PATH", str(tmp_path))
    resp = asyncio.run(public_html.public_bells_html("my-office"))
    assert b"app sheet" in resp.body


def test_index_when_no_exported_page(tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<html>index</html>", encoding="utf-8")
    monkeypatch.setenv("WEB_DIST_PATH", str(tmp_path))
    assert b"index" in asyncio.run(public_html.public_bells_html("my-office")).body


def test_old_page_without_a_web_build(tmp_path, monkeypatch):
    monkeypatch.setenv("WEB_DIST_PATH", str(tmp_path / "missing"))
    body = asyncio.run(public_html.public_bells_html("my-office")).body
    assert b"/api/public/bells/" in body and b"Unassigned" not in body
