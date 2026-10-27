"""JSON-string API over SongEditorPro7Generic.py for the web frontend (runs under Pyodide)."""

import base64
import json
import os
import sys
import tempfile

# Patch resource_path so it finds files in Pyodide's virtual filesystem
import SongEditorPro7Generic


def _resource_path(relative_path):
    for base in [os.getcwd(), "/home/pyodide", "/", "/tmp"]:
        p = os.path.join(base, relative_path)
        if os.path.exists(p):
            return p
    return relative_path


SongEditorPro7Generic.resource_path = _resource_path

from SongEditorPro7Generic import gen_pro_data, get_text_block_names, split_slides
from single_export import gen_single_pro


MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


def _temp_path():
    if sys.platform == "emscripten":
        return "/tmp/songeditor_work.pro"
    return os.path.join(tempfile.gettempdir(), "songeditor_bridge.pro")


def _read_b64(path):
    with open(path, "rb") as fh:
        data = fh.read()
    try:
        os.remove(path)
    except OSError:
        pass
    return base64.b64encode(data).decode("ascii")


def get_text_block_names_json():
    try:
        names = get_text_block_names()
        return json.dumps({"ok": True, "names": names})
    except Exception as exc:
        return json.dumps({"ok": False, "error": str(exc)})


def get_group_names_json():
    try:
        path = _resource_path("GroupNames.txt")
        with open(path, "r", encoding="utf-8") as f:
            labels = [l.strip() for l in f.read().split("\n") if l.strip()]
        return json.dumps({"ok": True, "labels": labels})
    except Exception as exc:
        return json.dumps({"ok": False, "error": str(exc)})


def generate_pro_json(song_texts_json, line_count, arrangement_order=""):
    try:
        song_texts = json.loads(song_texts_json)
        lc = int(line_count) if line_count else 2
        arr = arrangement_order.strip() if (arrangement_order and arrangement_order.strip()) else None
        raw = gen_pro_data(get_text_block_names(), song_texts, lc, arrangement_order=arr)
        path = _temp_path()
        with open(path, "wb") as f:
            f.write(raw)
        return json.dumps({"ok": True, "filename": "song.pro", "mime": MIME, "b64": _read_b64(path)})
    except Exception as exc:
        return json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"})


def generate_single_pro_json(song_texts_json, line_count, arrangement_order="", block_name=None):
    try:
        song_texts = json.loads(song_texts_json)
        lc = int(line_count) if line_count else 2
        arr = arrangement_order.strip() if (arrangement_order and arrangement_order.strip()) else None
        names = get_text_block_names()
        bn = block_name or (names[0] if names else "Romana")
        raw = gen_single_pro(bn, song_texts, lc, arrangement_order=arr)
        path = _temp_path().replace(".pro", "_single.pro")
        with open(path, "wb") as f:
            f.write(raw)
        return json.dumps({"ok": True, "filename": f"{bn} (Single).pro", "mime": MIME, "b64": _read_b64(path)})
    except Exception as exc:
        return json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"})


def split_slides_json(song_texts_json, line_count):
    try:
        song_texts = json.loads(song_texts_json)
        lc = int(line_count) if line_count else 2
        names = get_text_block_names()
        slides = split_slides(names, song_texts, lc)
        return json.dumps({"ok": True, "slides": slides})
    except Exception as exc:
        return json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"})
