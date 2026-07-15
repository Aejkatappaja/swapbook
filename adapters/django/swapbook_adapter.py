"""Swapbook adapter for Django.

Exposes the Swapbook protocol (manifest / preview / mocks / mock) on your
Django app. Render-agnostic: a variant is just a callable ``(args) -> str`` that
returns HTML, so it works with plain templates, django-components, cotton, or
raw strings, on any modern Django (3.2+). Mount ``registry.urls`` in your
urlpatterns.
"""
import json
import re

from django.http import HttpResponse, JsonResponse, HttpResponseNotFound
from django.urls import path

Args = dict  # {control_name: coerced_value}


def slug(s: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower())).strip("-")


def control(name, type="text", default=None, options=None):
    """Declare an editable control (knob). type: text|number|bool|select."""
    c = {"name": name, "type": type, "default": default}
    if options:
        c["options"] = options
    return c


def mock(route, render, status=200):
    """A canned response: route is "VERB /path", render is (args)->str.

    Pass a non-2xx status (422, 500, …) to preview a component's error state."""
    verb, _, p = route.partition(" ") if " " in route else ("GET", "", route)
    return {"verb": verb.upper(), "path": p or route, "render": render, "status": status}


def viewport(name, w):
    """A named preview width, added to the built-in full/tablet/phone."""
    return {"name": name, "w": w}


# Play steps: scripted interactions + assertions run against the preview.
def click(target):
    return {"action": "click", "target": target}


def type_(target, value):
    return {"action": "type", "target": target, "value": value}


def expect_text(target, text):
    return {"action": "expect-text", "target": target, "text": text}


def expect_visible(target):
    return {"action": "expect-visible", "target": target}


def wait(target):
    return {"action": "wait", "target": target}


def variant(name, render, controls=None, docs="", mocks=None, play=None):
    """One rendered state. render is a callable (args: dict) -> html str.

    play is an optional list of steps (see click/type_/expect_text/...) run on
    demand against the preview."""
    return {"name": name, "render": render, "controls": controls or [], "docs": docs, "mocks": mocks or [], "play": play or []}


def _coerce(controls, GET):
    args = {}
    for c in controls:
        name = c["name"]
        if name not in GET:  # absent -> default; present-but-empty is a real value
            args[name] = c.get("default")
            continue
        raw = GET.get(name, "")
        t = c.get("type")
        if t == "number":
            try:
                args[name] = float(raw)
            except ValueError:
                args[name] = c.get("default")
        elif t == "bool":
            args[name] = raw in ("true", "1", "on")
        else:
            args[name] = raw
    return args


class Registry:
    def __init__(self, htmx_src="", css_src="", js_src="", viewports=None):
        self.htmx_src, self.css_src, self.js_src = htmx_src, css_src, js_src
        self.viewports = viewports or []
        self._stories = []
        self._global_mocks = []

    def register(self, name, variants, group="", docs=""):
        self._stories.append(
            {"id": slug(name), "name": name, "group": group, "docs": docs, "variants": variants}
        )

    def mock(self, route, render, status=200):
        """Declare a registry-level mock merged into every variant, for routes
        shared across stories. A variant's own mock for the same route wins."""
        self._global_mocks.append(mock(route, render, status))
        return self

    def _mocks_for(self, v):
        return self._global_mocks + v["mocks"]

    def _find(self, sid, vname):
        for s in self._stories:
            if s["id"] == sid:
                for v in s["variants"]:
                    if v["name"] == vname:
                        return v
        return None

    @property
    def urls(self):
        return [
            path("_swapbook/manifest.json", self._manifest),
            path("_swapbook/preview/<str:sid>/<str:vname>", self._preview),
            path("_swapbook/mocks/<str:sid>/<str:vname>", self._mocks),
            path("_swapbook/mock/<str:sid>/<str:vname>/<int:index>", self._mock),
        ]

    def _manifest(self, request):
        def vmeta(v):
            m = {"name": v["name"], "controls": v["controls"], "docs": v["docs"]}
            if v.get("play"):
                m["play"] = v["play"]
            return m

        out = {
            "htmxSrc": self.htmx_src, "cssSrc": self.css_src, "jsSrc": self.js_src,
            "stories": [{
                "id": s["id"], "name": s["name"], "group": s["group"], "docs": s["docs"],
                "variants": [vmeta(v) for v in s["variants"]],
            } for s in self._stories],
        }
        if self.viewports:
            out["viewports"] = self.viewports
        return JsonResponse(out)

    def _preview(self, request, sid, vname):
        v = self._find(sid, vname)
        if not v:
            return HttpResponseNotFound()
        return HttpResponse(v["render"](_coerce(v["controls"], request.GET)))

    def _mocks(self, request, sid, vname):
        v = self._find(sid, vname)
        if not v:
            return HttpResponseNotFound()
        mks = self._mocks_for(v)
        return JsonResponse(
            [{"verb": m["verb"], "path": m["path"], "index": i} for i, m in enumerate(mks)],
            safe=False,
        )

    def _mock(self, request, sid, vname, index):
        v = self._find(sid, vname)
        if not v:
            return HttpResponseNotFound()
        mks = self._mocks_for(v)
        if index < 0 or index >= len(mks):
            return HttpResponseNotFound()
        mk = mks[index]
        return HttpResponse(mk["render"]({}), status=mk.get("status", 200))
