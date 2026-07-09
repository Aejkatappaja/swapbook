// Swapbook example target in plain Node stdlib. No deps, no templating lib, no
// adapter package: it implements the Swapbook protocol (see SPEC.md) by hand.
// Renders a subset of the shared demo design system (same ds.css classes as the
// Go/Django/Rails/Laravel demos) to prove any stdlib server works.
const http = require("http");
const fs = require("fs");
const path = require("path");

const btn = (a) =>
  `<button class="btn btn-${a.variant || "primary"} btn-${a.size || "md"}"${a.disabled ? " disabled" : ""}>${a.label || "Save"}</button>`;
const badge = (a) => `<span class="badge badge-${a.status || "open"}">${a.label || "open"}</span>`;
const card = (a) => {
  const reviews = parseInt(a.reviews || 0, 10) || 0;
  const p = reviews ? `<p class="muted">${reviews} review${reviews === 1 ? "" : "s"}</p>` : "";
  return `<div class="card"><div class="card-head"><strong>${a.title || "Add dark mode"}</strong><span class="badge badge-${a.status || "open"}">${a.status || "open"}</span></div>${p}</div>`;
};
const TODO =
  '<div class="todo"><ul id="rows"><li>Write the launch post</li><li>Record the demo gif</li></ul><button class="btn btn-secondary" hx-get="/ds/row" hx-target="#rows" hx-swap="beforeend">+ add row</button></div>';

const ctl = (name, type, def, options) => ({ name, type, default: def, ...(options ? { options } : {}) });

// A subset of the shared DS: static variants, live controls, and an htmx mock.
const STORIES = [
  { id: "button", name: "Button", group: "actions", docs: "The button primitive, from a raw Node server.", variants: [
    { name: "primary", render: () => btn({ label: "Save", variant: "primary" }) },
    { name: "secondary", render: () => btn({ label: "Cancel", variant: "secondary" }) },
    { name: "danger", render: () => btn({ label: "Delete", variant: "danger" }) },
    { name: "controls", render: btn, controls: [
      ctl("label", "text", "Save"),
      ctl("variant", "select", "primary", ["primary", "secondary", "danger"]),
      ctl("size", "select", "md", ["sm", "md", "lg"]),
      ctl("disabled", "bool", false),
    ] },
  ] },
  { id: "badge", name: "Badge", group: "data-display", variants: [
    { name: "open", render: () => badge({ status: "open", label: "open" }) },
    { name: "merged", render: () => badge({ status: "merged", label: "merged" }) },
    { name: "closed", render: () => badge({ status: "closed", label: "closed" }) },
  ] },
  { id: "pr-card", name: "PR Card", group: "data-display", variants: [
    { name: "open", render: () => card({}) },
    { name: "with-reviews", render: () => card({ title: "Refactor router", status: "merged", reviews: 3 }) },
    { name: "controls", render: card, controls: [
      ctl("title", "text", "Add dark mode"),
      ctl("status", "select", "open", ["open", "merged", "closed"]),
      ctl("reviews", "number", 0),
    ] },
  ] },
  { id: "todo-list", name: "Todo list", group: "interactive", variants: [
    { name: "default", render: () => TODO,
      docs: "Click **+ add row**: the mock returns a new `<li>` htmx appends.",
      mocks: [{ verb: "GET", path: "/ds/row", render: () => "<li>New task</li>" }] },
  ] },
];

const find = (sid, vname) =>
  (STORIES.find((s) => s.id === sid) || { variants: [] }).variants.find((v) => v.name === vname);

const coerce = (controls, qs) => {
  const args = {};
  for (const c of controls || []) {
    if (!(c.name in qs)) { args[c.name] = c.default; continue; } // absent -> default
    const raw = qs[c.name];
    if (c.type === "number") { const n = parseFloat(raw); args[c.name] = Number.isNaN(n) ? c.default : n; }
    else if (c.type === "bool") args[c.name] = ["true", "1", "on"].includes(raw);
    else args[c.name] = raw;
  }
  return args;
};

const manifest = () => ({
  htmxSrc: "", cssSrc: "/static/ds.css",
  stories: STORIES.map((s) => ({
    id: s.id, name: s.name, group: s.group, docs: s.docs || "",
    variants: s.variants.map((v) => ({ name: v.name, controls: v.controls || [], docs: v.docs || "" })),
  })),
});

const dsCss = () => {
  for (const cand of [path.join(__dirname, "ds.css"), "examples/shared/ds.css"]) {
    if (fs.existsSync(cand)) return fs.readFileSync(cand, "utf8");
  }
  return "";
};

const send = (res, body, ct, code = 200) => {
  res.writeHead(code, { "Content-Type": ct });
  res.end(body);
};

const port = parseInt(process.argv[2] || "9091", 10);
http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    const parts = p.split("/"); // ["", "_swapbook", kind, id, variant, ...]
    const qs = Object.fromEntries(url.searchParams);
    if (p === "/static/ds.css") send(res, dsCss(), "text/css; charset=utf-8");
    else if (p === "/_swapbook/manifest.json") send(res, JSON.stringify(manifest()), "application/json");
    else if (p.startsWith("/_swapbook/preview/")) {
      const v = find(parts[3], parts[4]);
      send(res, v ? v.render(coerce(v.controls, qs)) : "", "text/html", v ? 200 : 404);
    } else if (p.startsWith("/_swapbook/mocks/")) {
      const v = find(parts[3], parts[4]);
      const body = v ? (v.mocks || []).map((m, i) => ({ verb: m.verb, path: m.path, index: i })) : [];
      send(res, JSON.stringify(body), "application/json");
    } else if (p.startsWith("/_swapbook/mock/")) {
      const v = find(parts[3], parts[4]);
      const mocks = (v && v.mocks) || [];
      const i = parseInt(parts[5], 10);
      send(res, mocks[i] ? mocks[i].render({}) : "", "text/html", v ? 200 : 404);
    } else {
      res.writeHead(404);
      res.end();
    }
  })
  .listen(port);
