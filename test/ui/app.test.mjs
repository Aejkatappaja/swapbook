// Behavioral tests for the Swapbook chrome (app.js), driven through jsdom.
// Focus: the first-run states (target down vs adapter-not-mounted) and the
// inspector's "ready" line, none of which the Go tests can reach.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boot, res, MANIFEST } from "./harness.mjs";

const txt = (w, id) => (w.document.getElementById(id)?.textContent || "").trim();
const errShown = (w) => w.document.getElementById("stage-error").hidden === false;
const frameQuery = (w) => new URL(w.document.getElementById("preview").src, "http://localhost").searchParams;

test("adapter answers: stories render, no error overlay", async () => {
  const w = await boot(
    async () => res(200, MANIFEST),
    (w) => txt(w, "stories").includes("Button"),
  );
  assert.equal(errShown(w), false);
  assert.match(txt(w, "stories"), /Button/);
  assert.match(txt(w, "stories"), /Todo list/);
});

test("target up but no adapter (404): dedicated 'no adapter' screen", async () => {
  const w = await boot(
    async () => res(404, "<html>404 not found</html>"),
    (w) => errShown(w),
  );
  assert.equal(errShown(w), true);
  assert.equal(txt(w, "err-title"), "no swapbook adapter");
  assert.match(txt(w, "err-sub"), /mount the adapter/i);
  assert.match(txt(w, "err-sub"), /_swapbook/);
});

test("target unreachable (network error): 'target unreachable' screen", async () => {
  const w = await boot(
    async () => {
      throw new Error("ECONNREFUSED");
    },
    (w) => errShown(w),
  );
  assert.equal(errShown(w), true);
  assert.equal(txt(w, "err-title"), "target unreachable");
});

test("inspector ready line flags non-htmx probes as beta", async () => {
  const w = await boot(
    async () => res(200, MANIFEST),
    (w) => txt(w, "stories").includes("Button"),
  );
  w.onReady({ libs: ["htmx", "turbo", "datastar"] });
  const line = txt(w, "events");
  assert.match(line, /hypermedia:/);
  assert.match(line, /htmx/);
  assert.match(line, /turbo \(beta\)/);
  assert.match(line, /datastar \(beta\)/);
  assert.doesNotMatch(line, /htmx \(beta\)/);
});

// A manifest declaring a custom viewport, plus two stories to switch between.
const MANIFEST_VW = JSON.stringify({
  htmxSrc: "",
  cssSrc: "",
  viewports: [{ name: "wide", w: "1440px" }],
  stories: [
    { id: "button", name: "Button", variants: [{ name: "primary" }] },
    { id: "todo-list", name: "Todo list", variants: [{ name: "default" }] },
  ],
});
const widthOf = (w) => w.document.getElementById("preview").style.width;

test("project viewports extend the built-in width buttons", async () => {
  const w = await boot(
    async () => res(200, MANIFEST_VW),
    (w) => txt(w, "stories").includes("Button"),
  );
  const labels = Array.from(
    w.document.getElementById("widths").querySelectorAll("button"),
  ).map((b) => b.textContent);
  assert.deepEqual(labels, ["full", "tablet", "phone", "wide"]);
});

test("viewport choice is remembered per story", async () => {
  const w = await boot(
    async () => res(200, MANIFEST_VW),
    (w) => txt(w, "stories").includes("Button"),
  );
  const stories = w.currentStoryList();
  const button = stories.find((s) => s.id === "button");
  const todo = stories.find((s) => s.id === "todo-list");

  w.selectVariant(button, button.variants[0]);
  w.setWidth("wide");
  assert.equal(widthOf(w), "1440px");

  // a different story keeps its own default (full)…
  w.selectVariant(todo, todo.variants[0]);
  assert.equal(widthOf(w), "100%");

  // …and returning to the first story restores its remembered viewport
  w.selectVariant(button, button.variants[0]);
  assert.equal(widthOf(w), "1440px");
});

// The frame takes the param once per file, so the chrome has to append rather
// than set, or only the last stylesheet would reach the preview.
test("several stylesheets reach the preview, in declaration order", async () => {
  const manifest = JSON.stringify({
    htmxSrc: "",
    cssSrc: ["/static/icons.css", "/static/app.css"],
    jsSrc: ["/static/a.js", "/static/b.js"],
    stories: [{ id: "button", name: "Button", group: "actions", variants: [{ name: "primary" }] }],
  });
  const w = await boot(
    async () => res(200, manifest),
    (w) => (w.document.getElementById("preview").getAttribute("src") || "").includes("css="),
    "story=button&variant=primary",
  );
  const q = frameQuery(w);
  assert.deepEqual(q.getAll("css"), ["/static/icons.css", "/static/app.css"]);
  assert.deepEqual(q.getAll("js"), ["/static/a.js", "/static/b.js"]);
});

test("a single stylesheet still works as a plain string", async () => {
  const w = await boot(
    async () => res(200, MANIFEST),
    (w) => (w.document.getElementById("preview").getAttribute("src") || "").includes("css="),
    "story=button&variant=primary",
  );
  const q = frameQuery(w);
  assert.deepEqual(q.getAll("css"), ["/static/ds.css"]);
  assert.deepEqual(q.getAll("js"), []);
});

// htmxSrc stays singular while its siblings went plural. An adapter that emits
// a list anyway must not produce <script src="/a.js,/b.js"> and a dead preview.
test("a list in htmxSrc collapses to its first entry", async () => {
  const manifest = JSON.stringify({
    htmxSrc: ["/static/htmx.js", "/static/nope.js"],
    stories: [{ id: "button", name: "Button", group: "actions", variants: [{ name: "primary" }] }],
  });
  const w = await boot(
    async () => res(200, manifest),
    (w) => (w.document.getElementById("preview").getAttribute("src") || "").includes("htmx="),
    "story=button&variant=primary",
  );
  assert.deepEqual(frameQuery(w).getAll("htmx"), ["/static/htmx.js"]);
});
