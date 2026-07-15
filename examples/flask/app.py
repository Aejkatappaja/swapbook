# Swapbook demo target on Flask, using the Flask adapter. Renders a subset of
# the shared demo design system (same ds.css classes as the other demos).
# Run:  PYTHONPATH=adapters/flask python3 examples/flask/app.py [port]
import os
import sys

from flask import Flask
from swapbook import Registry, mock, variant

BTN = '<button class="btn btn-primary">Save</button>'
TODO = (
    '<div class="todo"><ul id="rows">'
    "<li>Write the launch post</li><li>Record the demo gif</li>"
    '</ul><button class="btn btn-secondary" hx-get="/ds/row" hx-target="#rows" hx-swap="beforeend">+ add row</button></div>'
)

reg = Registry(css_src="/static/ds.css")
reg.register("Button", [variant("primary", lambda a: BTN)], group="actions",
             docs="The button primitive, from a raw Flask server.")
reg.register("Todo list", [
    variant("default", lambda a: TODO, docs="Click **+ add row**.",
            mocks=[mock("GET /ds/row", lambda a: "<li>New task</li>")]),
], group="interactive")

app = Flask(__name__)
app.register_blueprint(reg.blueprint)


@app.route("/static/ds.css")
def ds_css():
    for cand in ("examples/shared/ds.css", os.path.join(os.path.dirname(__file__), "..", "shared", "ds.css")):
        if os.path.exists(cand):
            with open(cand, encoding="utf-8") as f:
                return f.read(), 200, {"Content-Type": "text/css; charset=utf-8"}
    return "", 404


if __name__ == "__main__":
    app.run(port=int(sys.argv[1]) if len(sys.argv) > 1 else 9095)
