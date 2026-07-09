// The core product promise: the inspector gates htmx traffic per mode.
//   mock  - mocked routes rerouted to the mock endpoint; unmocked writes blocked
//   safe  - real requests, all mutations blocked
//   live  - everything passes through
// These are driven through jsdom against the real inspector.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadInspector } from "./inspector-harness.mjs";

const MOCKS = { "GET /rows": "/__sb/mock/s/v/0", "POST /save-mocked": "/__sb/mock/s/v/1" };

test("htmx probe attaches and announces itself", async () => {
  const sb = await loadInspector({ mode: "mock", mocks: MOCKS });
  const ready = sb.events("frame:ready");
  assert.equal(ready.length, 1);
  assert.deepEqual(Array.from(ready[0].data.libs), ["htmx"]);
  assert.equal(ready[0].data.mode, "mock");
  sb.close();
});

test("mock mode: a mocked route is rerouted to its mock endpoint", async () => {
  const sb = await loadInspector({ mode: "mock", mocks: MOCKS });
  const detail = { verb: "get", path: "/rows" };
  sb.fire("htmx:configRequest", detail);
  assert.equal(detail.path, "/__sb/mock/s/v/0"); // rewritten in place
  assert.equal(sb.events("mock").length, 1);
  sb.close();
});

test("mock mode: an unmocked route is left untouched", async () => {
  const sb = await loadInspector({ mode: "mock", mocks: MOCKS });
  const detail = { verb: "get", path: "/nope" };
  sb.fire("htmx:configRequest", detail);
  assert.equal(detail.path, "/nope");
  assert.equal(sb.events("mock").length, 0);
  sb.close();
});

test("mock mode: an unmocked mutation is blocked", async () => {
  const sb = await loadInspector({ mode: "mock", mocks: MOCKS });
  const e = sb.fire("htmx:beforeRequest", { requestConfig: { verb: "post", path: "/save" } });
  assert.equal(e.defaultPrevented, true);
  assert.equal(sb.events("blocked").length, 1);
  sb.close();
});

test("mock mode: a GET is never blocked (not a mutation)", async () => {
  const sb = await loadInspector({ mode: "mock", mocks: MOCKS });
  const e = sb.fire("htmx:beforeRequest", { requestConfig: { verb: "get", path: "/rows" } });
  assert.equal(e.defaultPrevented, false);
  assert.equal(sb.events("blocked").length, 0);
  sb.close();
});

test("safe mode: mutation blocked, but no mock rerouting", async () => {
  const sb = await loadInspector({ mode: "safe", mocks: MOCKS });
  // safe never reroutes, even for a declared mock
  const detail = { verb: "post", path: "/save-mocked" };
  sb.fire("htmx:configRequest", detail);
  assert.equal(detail.path, "/save-mocked");
  // but it still blocks the mutation
  const e = sb.fire("htmx:beforeRequest", { requestConfig: { verb: "post", path: "/save-mocked" } });
  assert.equal(e.defaultPrevented, true);
  assert.equal(sb.events("blocked").length, 1);
  sb.close();
});

test("live mode: mutations pass through untouched", async () => {
  const sb = await loadInspector({ mode: "live", mocks: MOCKS });
  const e = sb.fire("htmx:beforeRequest", { requestConfig: { verb: "post", path: "/save" } });
  assert.equal(e.defaultPrevented, false);
  assert.equal(sb.events("blocked").length, 0);
  sb.close();
});

test("a request already rerouted to a mock endpoint is never blocked", async () => {
  const sb = await loadInspector({ mode: "mock", mocks: MOCKS });
  const e = sb.fire("htmx:beforeRequest", { requestConfig: { verb: "post", path: "/__sb/mock/s/v/1" } });
  assert.equal(e.defaultPrevented, false);
  assert.equal(sb.events("blocked").length, 0);
  sb.close();
});
