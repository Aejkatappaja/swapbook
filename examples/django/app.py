"""Single-file Django app demoing the Swapbook adapter: no project scaffold,
just inline settings, the shared demo design system rendered from real Django
templates, the adapter mounted, and the dev server. Same component set as the
Go, Rails and Laravel demos so the gallery looks identical across stacks."""
import os
import sys

import django
from django.conf import settings

settings.configure(
    DEBUG=True,
    ALLOWED_HOSTS=["*"],
    SECRET_KEY="swapbook-demo",
    ROOT_URLCONF=__name__,
    TEMPLATES=[{"BACKEND": "django.template.backends.django.DjangoTemplates", "DIRS": [], "APP_DIRS": False, "OPTIONS": {}}],
    INSTALLED_APPS=[],
)
django.setup()

from django.http import HttpResponse  # noqa: E402
from django.template import Context, Template  # noqa: E402
from django.urls import path  # noqa: E402
from swapbook_adapter import Registry, control, mock, variant  # noqa: E402


def T(src):
    tpl = Template(src)
    return lambda ctx=None: tpl.render(Context(ctx or {}))


# Each component is a real Django template; args map straight onto the context.
btn = T('<button class="btn btn-{{ variant }} btn-{{ size }}"{% if disabled %} disabled{% endif %}>{{ label }}</button>')
badge = T('<span class="badge badge-{{ status }}">{{ label }}</span>')
alert = T('<div class="alert alert-{{ kind }}">{{ msg }}</div>')
card = T('<div class="card"><div class="card-head"><strong>{{ title }}</strong><span class="badge badge-{{ status }}">{{ status }}</span></div>{% if reviews %}<p class="muted">{{ reviews }} review{{ reviews|pluralize }}</p>{% endif %}</div>')
field = T('<div class="field{% if error %} error{% endif %}"><label>{{ label }}</label><input value="{{ value }}" placeholder="{{ label }}"{% if disabled %} disabled{% endif %}>{% if error %}<span class="err">{{ error }}</span>{% endif %}</div>')
empty = T('<div class="empty"><div class="mark">📭</div><h4>{{ title }}</h4><div>{{ hint }}</div></div>')
table = T('<table class="ds"><thead><tr><th>name</th><th>role</th><th>status</th></tr></thead><tbody>{% for r in rows %}<tr><td>{{ r.name }}</td><td>{{ r.role }}</td><td><span class="badge badge-{{ r.status }}">{{ r.status }}</span></td></tr>{% endfor %}</tbody></table>')
todo = T('<div class="todo"><ul id="rows"><li>Write the launch post</li><li>Record the demo gif</li></ul><button class="btn btn-secondary" hx-get="/ds/row" hx-target="#rows" hx-swap="beforeend">+ add row</button></div>')
phantom_t = T('<script src="https://cdn.jsdelivr.net/npm/@aejkatappaja/phantom-ui/dist/phantom-ui.cdn.js"></script><phantom-ui{% if loading %} loading{% endif %} animation="{{ animation }}" style="display:block;max-width:420px"><div class="card"><div class="card-head"><strong>Ada Lovelace</strong></div><p class="muted">First programmer, probably.</p></div></phantom-ui>')


def phantom(a):
    return phantom_t({"loading": a.get("loading", True), "animation": a.get("animation", "shimmer")})


reg = Registry(css_src="/static/ds.css")  # htmx_src empty -> Swapbook's embedded htmx

reg.register("Button", group="actions", docs="The button primitive. `variant` and `size` are props, not classes you type.", variants=[
    variant("primary", lambda a: btn({"label": "Save", "variant": "primary", "size": "md"})),
    variant("secondary", lambda a: btn({"label": "Cancel", "variant": "secondary", "size": "md"})),
    variant("danger", lambda a: btn({"label": "Delete", "variant": "danger", "size": "md"})),
    variant("disabled", lambda a: btn({"label": "Save", "variant": "primary", "size": "md", "disabled": True})),
    variant("controls", lambda a: btn({"label": a["label"], "variant": a["variant"], "size": a["size"], "disabled": a["disabled"]}), controls=[
        control("label", "text", "Save"),
        control("variant", "select", "primary", options=["primary", "secondary", "danger"]),
        control("size", "select", "md", options=["sm", "md", "lg"]),
        control("disabled", "bool", False),
    ]),
])

reg.register("Badge", group="data-display", variants=[
    variant("open", lambda a: badge({"status": "open", "label": "open"})),
    variant("merged", lambda a: badge({"status": "merged", "label": "merged"})),
    variant("closed", lambda a: badge({"status": "closed", "label": "closed"})),
    variant("controls", lambda a: badge({"status": a["status"], "label": a["label"]}), controls=[
        control("status", "select", "open", options=["open", "merged", "closed"]),
        control("label", "text", "open"),
    ]),
])

reg.register("Alert", group="feedback", variants=[
    variant("info", lambda a: alert({"kind": "info", "msg": "A new version is available."})),
    variant("success", lambda a: alert({"kind": "success", "msg": "Saved successfully."})),
    variant("warning", lambda a: alert({"kind": "warning", "msg": "Your trial ends in 3 days."})),
    variant("error", lambda a: alert({"kind": "error", "msg": "Could not reach the server."})),
    variant("controls", lambda a: alert({"kind": a["kind"], "msg": a["message"]}), controls=[
        control("kind", "select", "info", options=["info", "success", "warning", "error"]),
        control("message", "text", "Heads up."),
    ]),
])

reg.register("PR Card", group="data-display", variants=[
    variant("open", lambda a: card({"title": "Add dark mode", "status": "open", "reviews": 0})),
    variant("with-reviews", lambda a: card({"title": "Refactor router", "status": "merged", "reviews": 3})),
    variant("controls", lambda a: card({"title": a["title"], "status": a["status"], "reviews": int(a["reviews"] or 0)}), controls=[
        control("title", "text", "Add dark mode"),
        control("status", "select", "open", options=["open", "merged", "closed"]),
        control("reviews", "number", 0),
    ]),
])

reg.register("Field", group="forms", variants=[
    variant("default", lambda a: field({"label": "Email", "value": ""})),
    variant("error", lambda a: field({"label": "Email", "value": "not-an-email", "error": "Enter a valid email"})),
    variant("disabled", lambda a: field({"label": "Email", "value": "you@example.com", "disabled": True})),
    variant("controls", lambda a: field({"label": a["label"], "value": a["value"], "error": a["error"], "disabled": a["disabled"]}), controls=[
        control("label", "text", "Email"),
        control("value", "text", ""),
        control("error", "text", ""),
        control("disabled", "bool", False),
    ]),
])

reg.register("Empty state", group="feedback", variants=[
    variant("default", lambda a: empty({"title": a["title"], "hint": a["hint"]}), controls=[
        control("title", "text", "No workouts yet"),
        control("hint", "text", "Create your first one to get started."),
    ]),
])

reg.register("Table", group="data-display", variants=[
    variant("default", lambda a: table({"rows": [
        {"name": "Ada Lovelace", "role": "Owner", "status": "open"},
        {"name": "Alan Turing", "role": "Maintainer", "status": "merged"},
        {"name": "Grace Hopper", "role": "Contributor", "status": "closed"},
    ]})),
])

reg.register("Todo list", group="interactive", variants=[
    variant("default", lambda a: todo(),
            docs="Click **+ add row**: the mock returns a new `<li>` htmx appends. Watch the swap-target flash in the inspector.",
            mocks=[mock("GET /ds/row", lambda a: "<li>New task</li>")]),
])

reg.register("Skeleton (phantom-ui)", group="web components", docs="A third-party **Web Component** (`@aejkatappaja/phantom-ui`) from jsdelivr. Toggle `loading` to swap skeleton and content.", variants=[
    variant("loading", phantom),
    variant("loaded", lambda a: phantom({"loading": False})),
    variant("controls", phantom, controls=[
        control("loading", "bool", True),
        control("animation", "select", "shimmer", options=["shimmer", "pulse", "breathe", "solid"]),
    ]),
])


def _ds_css(request):
    for cand in (os.path.join(os.path.dirname(__file__), "ds.css"), "examples/shared/ds.css"):
        if os.path.exists(cand):
            with open(cand, encoding="utf-8") as f:
                return HttpResponse(f.read(), content_type="text/css; charset=utf-8")
    return HttpResponse(status=404)


urlpatterns = reg.urls + [path("static/ds.css", _ds_css)]

if __name__ == "__main__":
    from django.core.management import execute_from_command_line

    execute_from_command_line([sys.argv[0], "runserver", "0.0.0.0:8000", "--noreload"])
