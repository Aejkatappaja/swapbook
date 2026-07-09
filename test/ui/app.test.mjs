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
