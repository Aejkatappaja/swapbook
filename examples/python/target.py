# Swapbook example target in plain Python stdlib. No deps, no templating lib,
# no adapter package: it implements the Swapbook protocol (see SPEC.md) by hand.
# Renders a subset of the shared demo design system (same ds.css classes as the
# Go/Django/Rails/Laravel demos) to prove any stdlib server works.
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlsplit


def btn(a):
    dis = " disabled" if a.get("disabled") else ""
    return f'<button class="btn btn-{a.get("variant", "primary")} btn-{a.get("size", "md")}"{dis}>{a.get("label", "Save")}</button>'


def badge(a):
    return f'<span class="badge badge-{a.get("status", "open")}">{a.get("label", "open")}</span>'


def card(a):
    title, status = a.get("title", "Add dark mode"), a.get("status", "open")
    reviews = int(a.get("reviews", 0) or 0)
    p = f'<p class="muted">{reviews} review{"" if reviews == 1 else "s"}</p>' if reviews else ""
    return f'<div class="card"><div class="card-head"><strong>{title}</strong><span class="badge badge-{status}">{status}</span></div>{p}</div>'


TODO = '<div class="todo"><ul id="rows"><li>Write the launch post</li><li>Record the demo gif</li></ul><button class="btn btn-secondary" hx-get="/ds/row" hx-target="#rows" hx-swap="beforeend">+ add row</button></div>'


def ctl(name, type="text", default=None, options=None):
    c = {"name": name, "type": type, "default": default}
    if options:
        c["options"] = options
    return c


# A subset of the shared DS: static variants, live controls, and an htmx mock.
STORIES = [
    {"id": "button", "name": "Button", "group": "actions", "docs": "The button primitive, from a raw Python server.", "variants": [
        {"name": "primary", "render": lambda a: btn({"label": "Save", "variant": "primary"})},
        {"name": "secondary", "render": lambda a: btn({"label": "Cancel", "variant": "secondary"})},
        {"name": "danger", "render": lambda a: btn({"label": "Delete", "variant": "danger"})},
        {"name": "controls", "render": btn, "controls": [
            ctl("label", "text", "Save"),
            ctl("variant", "select", "primary", ["primary", "secondary", "danger"]),
            ctl("size", "select", "md", ["sm", "md", "lg"]),
            ctl("disabled", "bool", False),
        ]},
    ]},
    {"id": "badge", "name": "Badge", "group": "data-display", "variants": [
        {"name": "open", "render": lambda a: badge({"status": "open", "label": "open"})},
        {"name": "merged", "render": lambda a: badge({"status": "merged", "label": "merged"})},
        {"name": "closed", "render": lambda a: badge({"status": "closed", "label": "closed"})},
    ]},
    {"id": "pr-card", "name": "PR Card", "group": "data-display", "variants": [
        {"name": "open", "render": lambda a: card({})},
        {"name": "with-reviews", "render": lambda a: card({"title": "Refactor router", "status": "merged", "reviews": 3})},
        {"name": "controls", "render": card, "controls": [
            ctl("title", "text", "Add dark mode"),
            ctl("status", "select", "open", ["open", "merged", "closed"]),
            ctl("reviews", "number", 0),
        ]},
    ]},
    {"id": "todo-list", "name": "Todo list", "group": "interactive", "variants": [
        {"name": "default", "render": lambda a: TODO,
         "docs": "Click **+ add row**: the mock returns a new `<li>` htmx appends.",
         "mocks": [{"verb": "GET", "path": "/ds/row", "render": lambda a: "<li>New task</li>"}]},
    ]},
]


def find(sid, vname):
    for s in STORIES:
        if s["id"] == sid:
            for v in s["variants"]:
                if v["name"] == vname:
                    return v
    return None


def coerce(controls, qs):
    args = {}
    for c in controls:
        name, t = c["name"], c["type"]
        if name not in qs:  # absent -> default; present-but-empty is a real value
            args[name] = c["default"]
            continue
        raw = qs[name][0]
        if t == "number":
            try:
                args[name] = float(raw)
            except ValueError:
                args[name] = c["default"]
        elif t == "bool":
            args[name] = raw in ("true", "1", "on")
        else:
            args[name] = raw
    return args


def manifest():
    return {"htmxSrc": "", "cssSrc": "/static/ds.css", "stories": [
        {"id": s["id"], "name": s["name"], "group": s["group"], "docs": s.get("docs", ""),
         "variants": [{"name": v["name"], "controls": v.get("controls", []), "docs": v.get("docs", "")} for v in s["variants"]]}
        for s in STORIES
    ]}


def ds_css():
    for cand in (os.path.join(os.path.dirname(__file__), "ds.css"), "examples/shared/ds.css"):
        if os.path.exists(cand):
            with open(cand, encoding="utf-8") as f:
                return f.read()
    return ""


class H(BaseHTTPRequestHandler):
    def _send(self, body, ctype, code=200):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.end_headers()
        self.wfile.write(body.encode())

    def do_GET(self):
        u = urlsplit(self.path)
        p, qs = u.path, parse_qs(u.query)
        parts = p.split("/")  # ["", "_swapbook", kind, id, variant, ...]
        if p == "/static/ds.css":
            self._send(ds_css(), "text/css; charset=utf-8")
        elif p == "/_swapbook/manifest.json":
            self._send(json.dumps(manifest()), "application/json")
        elif p.startswith("/_swapbook/preview/"):
            v = find(parts[3], parts[4])
            self._send(v["render"](coerce(v.get("controls", []), qs)) if v else "", "text/html", 200 if v else 404)
        elif p.startswith("/_swapbook/mocks/"):
            v = find(parts[3], parts[4])
            body = [{"verb": m["verb"], "path": m["path"], "index": i} for i, m in enumerate(v.get("mocks", []))] if v else []
            self._send(json.dumps(body), "application/json")
        elif p.startswith("/_swapbook/mock/"):
            v = find(parts[3], parts[4])
            mocks = v.get("mocks", []) if v else []
            i = int(parts[5])
            self._send(mocks[i]["render"]({}) if 0 <= i < len(mocks) else "", "text/html", 200 if v else 404)
        else:
            self.send_response(404)
            self.end_headers()

    do_POST = do_GET

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9090
    HTTPServer(("", port), H).serve_forever()
