// Behavioral tests for the Swapbook chrome (app.js), driven through jsdom.
// Focus: the first-run states (target down vs adapter-not-mounted) and the
// inspector's "ready" line, none of which the Go tests can reach.
import { test } from "node:test";
import assert from "node:assert/strict";
import { boot, res, MANIFEST } from "./harness.mjs";

const txt = (w, id) => (w.document.getElementById(id)?.textContent || "").trim();
const errShown = (w) => w.document.getElementById("stage-error").hidden === false;

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
  w.HTMLElement.prototype.scrollIntoView = () => {}; // not implemented in jsdom
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
