// The non-htmx probes (Turbo, Unpoly, Datastar) share the same mock/safe/live
// gate but reroute/cancel through each library's own mechanism. htmx is the
// verified flagship; these assert the best-effort probes actually gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadInspector } from "./inspector-harness.mjs";

const MOCKS = { "GET /rows": "/__sb/mock/s/v/0" };

// ---- Turbo (turbo:before-fetch-request document event) --------------------

test("turbo: mocked GET is rerouted to the mock endpoint", async () => {
  const sb = await loadInspector({ libs: ["turbo"], mode: "mock", mocks: MOCKS });
  assert.deepEqual(Array.from(sb.events("frame:ready")[0].data.libs), ["turbo"]);
  const detail = { url: "http://localhost/rows", fetchOptions: { method: "GET" } };
  sb.fire("turbo:before-fetch-request", detail);
  assert.match(String(detail.url), /\/__sb\/mock\/s\/v\/0$/);
  assert.equal(sb.events("mock").length, 1);
  sb.close();
});

test("turbo: unmocked mutation is blocked (preventDefault)", async () => {
  const sb = await loadInspector({ libs: ["turbo"], mode: "mock", mocks: MOCKS });
  const e = sb.fire("turbo:before-fetch-request", { url: "http://localhost/save", fetchOptions: { method: "POST" } });
  assert.equal(e.defaultPrevented, true);
  assert.equal(sb.events("blocked").length, 1);
  sb.close();
});

test("turbo: live mode lets a mutation through", async () => {
  const sb = await loadInspector({ libs: ["turbo"], mode: "live", mocks: MOCKS });
  const e = sb.fire("turbo:before-fetch-request", { url: "http://localhost/save", fetchOptions: { method: "POST" } });
  assert.equal(e.defaultPrevented, false);
  assert.equal(sb.events("blocked").length, 0);
  sb.close();
});

// ---- Unpoly (up.on("up:request:load")) ------------------------------------

test("unpoly: mocked GET has its request url rewritten", async () => {
  const sb = await loadInspector({ libs: ["unpoly"], mode: "mock", mocks: MOCKS });
  const req = { method: "GET", url: "http://localhost/rows" };
  sb.upHandlers["up:request:load"]({ request: req });
  assert.equal(req.url, "/__sb/mock/s/v/0");
  assert.equal(sb.events("mock").length, 1);
  sb.close();
});

test("unpoly: unmocked mutation is blocked", async () => {
  const sb = await loadInspector({ libs: ["unpoly"], mode: "mock", mocks: MOCKS });
  let prevented = false;
  sb.upHandlers["up:request:load"]({
    request: { method: "POST", url: "http://localhost/save" },
    preventDefault: () => { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.equal(sb.events("blocked").length, 1);
  sb.close();
});

// ---- Datastar (wraps window.fetch) ----------------------------------------

test("datastar: mocked GET forwards to the mock url", async () => {
  const sb = await loadInspector({ libs: ["datastar"], mode: "mock", mocks: MOCKS });
  await sb.w.fetch("http://localhost/rows", { method: "GET" });
  assert.equal(sb.fetchCalls.length, 1);
  assert.equal(sb.fetchCalls[0].input, "/__sb/mock/s/v/0");
  assert.equal(sb.events("mock").length, 1);
  sb.close();
});

test("datastar: unmocked mutation is rejected, original fetch never called", async () => {
  const sb = await loadInspector({ libs: ["datastar"], mode: "mock", mocks: MOCKS });
  await assert.rejects(() => sb.w.fetch("http://localhost/save", { method: "POST" }), /blocked by swapbook/);
  assert.equal(sb.fetchCalls.length, 0);
  assert.equal(sb.events("blocked").length, 1);
  sb.close();
});

test("datastar: live mode forwards untouched to the original fetch", async () => {
  const sb = await loadInspector({ libs: ["datastar"], mode: "live", mocks: MOCKS });
  await sb.w.fetch("http://localhost/save", { method: "POST" });
  assert.equal(sb.fetchCalls.length, 1);
  assert.equal(sb.fetchCalls[0].input, "http://localhost/save");
  assert.equal(sb.events("blocked").length, 0);
  sb.close();
});
