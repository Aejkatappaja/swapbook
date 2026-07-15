// Swapbook demo target on Express, using the Express adapter. Renders a subset
// of the shared demo design system (same ds.css classes as the other demos).
// Run:  node examples/express/target.js [port]   (npm install first)
"use strict";
const fs = require("fs");
const path = require("path");
const express = require("express");
const { Registry, mock, variant } = require("../../adapters/express/swapbook");

const BTN = '<button class="btn btn-primary">Save</button>';
const TODO =
  '<div class="todo"><ul id="rows"><li>Write the launch post</li><li>Record the demo gif</li></ul>' +
  '<button class="btn btn-secondary" hx-get="/ds/row" hx-target="#rows" hx-swap="beforeend">+ add row</button></div>';

const reg = new Registry({ cssSrc: "/static/ds.css" });
reg.register("Button", [variant("primary", () => BTN)], { group: "actions", docs: "The button primitive, from a raw Express server." });
reg.register("Todo list", [
  variant("default", () => TODO, { docs: "Click **+ add row**.", mocks: [mock("GET /ds/row", () => "<li>New task</li>")] }),
], { group: "interactive" });

const app = express();
app.use(reg.router());
app.get("/static/ds.css", (_req, res) => {
  for (const cand of ["examples/shared/ds.css", path.join(__dirname, "..", "shared", "ds.css")]) {
    if (fs.existsSync(cand)) return res.type("css").send(fs.readFileSync(cand, "utf8"));
  }
  res.sendStatus(404);
});

app.listen(Number(process.argv[2]) || 9096);
