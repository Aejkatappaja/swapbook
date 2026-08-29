// Same three-mode contract as the htmx 2 suite, against htmx 4's rewritten
// surface: colon-separated event names, a single `ctx` carrying the request,
// and fetch() instead of XHR. The probe has to reroute through
// ctx.request.action and cancel on htmx:before:request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadInspector } from "./inspector-harness.mjs";

const MOCKS = { "GET /rows": "/__sb/mock/s/v/0", "POST /save-mocked": "/__sb/mock/s/v/1" };

/** A minimal htmx 4 request context: what the events actually carry. */
const ctxFor = (method, action, extra = {}) => ({
  request: { method, action, headers: { "HX-Request": "true" } },
  ...extra,
});

const load = (opts) => loadInspector({ libs: ["htmx4"], ...opts });

test("htmx 4: the v4 probe attaches, and announces itself as htmx", async () => {
  const sb = await load({ mode: "mock", mocks: MOCKS });
  const ready = sb.events("frame:ready");
  assert.deepEqual(Array.from(ready[0].data.libs), ["htmx"]); // one probe, not both
  sb.close();
});

test("htmx 4: a mocked route is rerouted through ctx.request.action", async () => {
  const sb = await load({ mode: "mock", mocks: MOCKS });
  const ctx = ctxFor("GET", "/rows?page=2"); // matched on the path, query and all
  sb.fire("htmx:config:request", { ctx });
  assert.equal(ctx.request.action, "/__sb/mock/s/v/0");
  assert.equal(sb.events("mock").length, 1);
  sb.close();
});

test("htmx 4: an unmocked route is left untouched", async () => {
  const sb = await load({ mode: "mock", mocks: MOCKS });
  const ctx = ctxFor("GET", "/nope");
  sb.fire("htmx:config:request", { ctx });
  assert.equal(ctx.request.action, "/nope");
  assert.equal(sb.events("mock").length, 0);
  sb.close();
});

test("htmx 4: mock mode blocks an unmocked mutation", async () => {
  const sb = await load({ mode: "mock", mocks: MOCKS });
  const e = sb.fire("htmx:before:request", { ctx: ctxFor("POST", "/save") });
  assert.equal(e.defaultPrevented, true);
  const blocked = sb.events("blocked");
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].data.verb, "POST");
  assert.equal(blocked[0].data.path, "/save");
  assert.equal(sb.events("beforeRequest").length, 0); // blocked rows are not doubled
  sb.close();
});

test("htmx 4: a GET is never blocked", async () => {
  const sb = await load({ mode: "mock", mocks: MOCKS });
  const e = sb.fire("htmx:before:request", { ctx: ctxFor("GET", "/rows") });
  assert.equal(e.defaultPrevented, false);
  assert.equal(sb.events("blocked").length, 0);
  assert.equal(sb.events("beforeRequest").length, 1);
  sb.close();
});

test("htmx 4: safe mode blocks the mutation but never reroutes", async () => {
  const sb = await load({ mode: "safe", mocks: MOCKS });
  const ctx = ctxFor("POST", "/save-mocked");
  sb.fire("htmx:config:request", { ctx });
  assert.equal(ctx.request.action, "/save-mocked");
  assert.equal(sb.fire("htmx:before:request", { ctx }).defaultPrevented, true);
  sb.close();
});

test("htmx 4: live mode lets a mutation through", async () => {
  const sb = await load({ mode: "live", mocks: MOCKS });
  const e = sb.fire("htmx:before:request", { ctx: ctxFor("POST", "/save") });
  assert.equal(e.defaultPrevented, false);
  assert.equal(sb.events("blocked").length, 0);
  sb.close();
});

test("htmx 4: a request already rerouted to a mock is never blocked", async () => {
  const sb = await load({ mode: "mock", mocks: MOCKS });
  const ctx = ctxFor("POST", "/save-mocked");
  sb.fire("htmx:config:request", { ctx });
  assert.equal(ctx.request.action, "/__sb/mock/s/v/1");
  assert.equal(sb.fire("htmx:before:request", { ctx }).defaultPrevented, false);
  assert.equal(sb.events("blocked").length, 0);
  sb.close();
});

test("htmx 4: the response body and status reach the beforeSwap row", async () => {
  const sb = await load({ mode: "mock", mocks: MOCKS });
  const ctx = ctxFor("GET", "/rows", { response: { status: 422 }, text: "<li>row</li>" });
  sb.fire("htmx:before:swap", { ctx, tasks: [] });
  const [swap] = sb.events("beforeSwap");
  assert.equal(swap.data.status, 422);
  assert.equal(swap.data.response, "<li>row</li>");
  assert.equal(swap.data.responseBytes, 12);
  sb.close();
});

test("htmx 4: out-of-band swaps are logged from the swap plan", async () => {
  const sb = await load({ mode: "mock", mocks: MOCKS, body: '<div id="count">0</div>' });
  const oob = sb.w.document.getElementById("count");
  const ctx = ctxFor("GET", "/rows", { text: "" });
  sb.fire("htmx:before:swap", {
    ctx,
    tasks: [{ type: "oob", target: oob }, { type: "partial", target: oob }, { type: "partial", target: null }],
  });
  const rows = sb.events("oobSwap");
  assert.equal(rows.length, 2); // oob + partial; the unmatched partial is dropped
  assert.match(rows[0].data.target, /^div#count/);
  // an outerHTML oob swap replaces the node, so after:swap must re-resolve by id
  oob.remove();
  sb.fire("htmx:after:swap", { ctx });
  assert.equal(sb.events("afterSwap").length, 1);
  sb.close();
});

test("htmx 4: a request is timed from before:request to after:request", async () => {
  const sb = await load({ mode: "mock", mocks: MOCKS });
  const ctx = ctxFor("GET", "/rows");
  sb.fire("htmx:before:request", { ctx });
  sb.fire("htmx:after:request", { ctx });
  const [done] = sb.events("afterRequest");
  assert.equal(typeof done.data.ms, "number");
  assert.ok(done.data.ms >= 0);
  sb.close();
});

test("htmx 4: an error response is logged as responseError", async () => {
  const sb = await load({ mode: "mock", mocks: MOCKS });
  sb.fire("htmx:response:error", { ctx: ctxFor("GET", "/rows", { response: { status: 500 } }) });
  assert.equal(sb.events("responseError")[0].data.status, 500);
  sb.close();
});

test("htmx 4: a renamed meta character is honoured", async () => {
  const sb = await load({ mode: "mock", mocks: MOCKS, htmxConfig: { metaCharacter: "-" } });
  const ctx = ctxFor("GET", "/rows");
  sb.fire("htmx-config-request", { ctx });
  assert.equal(ctx.request.action, "/__sb/mock/s/v/0");
  sb.close();
});

test("htmx 4: a GET's parameters are read back off the encoded action", async () => {
  const sb = await load({ mode: "live", mocks: MOCKS });
  sb.fire("htmx:before:request", { ctx: ctxFor("GET", "/rows?page=2&q=hi") });
  // spread out of the jsdom realm, so the prototypes match (cf. Array.from above)
  assert.deepEqual({ ...sb.events("beforeRequest")[0].data.params }, { page: "2", q: "hi" });
  sb.close();
});

test("htmx 4: a request its own probe gated is not gated again by the fetch wrapper", async () => {
  // htmx 4 fetches, so on a page running Datastar too both probes see the same
  // request. The marker the htmx probe leaves on it keeps the wrapper's hands off.
  const sb = await loadInspector({ libs: ["htmx4", "datastar"], mode: "mock", mocks: MOCKS });
  const ctx = ctxFor("POST", "/save-mocked");
  sb.fire("htmx:config:request", { ctx });
  sb.fire("htmx:before:request", { ctx });
  await sb.w.fetch(ctx.request.action, ctx.request); // what htmx 4 does next
  assert.equal(sb.fetchCalls.length, 1);
  assert.equal(sb.messages.filter((m) => m.data.lib === "datastar").length, 0);
  sb.close();
});

test("htmx 4: the response row survives a swap plan the probe cannot read", async () => {
  const sb = await load({ mode: "mock", mocks: MOCKS });
  sb.fire("htmx:before:swap", { ctx: ctxFor("GET", "/rows", { text: "<li>row</li>" }) }); // no tasks
  assert.equal(sb.events("beforeSwap")[0].data.response, "<li>row</li>");
  sb.close();
});
