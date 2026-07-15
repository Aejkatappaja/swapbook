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

// ---- SSE / WebSocket lens (wraps EventSource / WebSocket) ------------------

test("SSE: open, message and close are streamed to the chrome", async () => {
  const sb = await loadInspector({ libs: ["htmx"] });
  const es = new sb.w.EventSource("http://localhost/app/events");
  assert.equal(sb.events("streamOpen").length, 1);
  assert.equal(sb.events("streamOpen")[0].data.kind, "SSE");
  assert.equal(sb.events("streamOpen")[0].data.path, "/app/events");

  es.emit("message", { data: "tick 1" });
  const msgs = sb.events("streamMsg");
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].data.dir, "recv");
  assert.equal(msgs[0].data.data, "tick 1");

  es.close();
  assert.equal(sb.events("streamClose").length, 1);
  sb.close();
});

// ---- Play (scripted interactions + assertions) ----------------------------

const waitForDone = async (sb) => {
  for (let i = 0; i < 400 && sb.events("play:done").length === 0; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
};
const play = (sb, steps) =>
  sb.w.dispatchEvent(new sb.w.MessageEvent("message", { data: { source: "swapbook-cmd", cmd: "play", steps } }));

test("play: runs click + assertion and reports all steps passing", async () => {
  const sb = await loadInspector({ body: '<ul id="rows"></ul><button id="add">add</button>' });
  // simulate the swap a click would trigger
  sb.w.document.getElementById("add").addEventListener("click", () => {
    sb.w.document.getElementById("rows").innerHTML = "<li>New task</li>";
  });
  play(sb, [
    { action: "click", target: "#add" },
    { action: "expect-text", target: "#rows", text: "New task" },
  ]);
  await waitForDone(sb);
  const done = sb.events("play:done")[0].data;
  assert.equal(done.ok, true);
  assert.equal(done.passed, 2);
  assert.equal(sb.events("play:result").length, 2);
  assert.ok(sb.events("play:result").every((r) => r.data.ok));
  sb.close();
});

test("play: stops at the first failing assertion", async () => {
  const sb = await loadInspector({ body: '<div id="out">nope</div>' });
  play(sb, [
    { action: "expect-text", target: "#out", text: "yes" }, // fails (polls, then gives up)
    { action: "click", target: "#never" }, // never reached
  ]);
  await waitForDone(sb);
  const done = sb.events("play:done")[0].data;
  assert.equal(done.ok, false);
  assert.equal(done.passed, 0);
  assert.equal(sb.events("play:result").length, 1);
  assert.equal(sb.events("play:result")[0].data.ok, false);
  sb.close();
});

test("WebSocket: send and receive are tagged by direction", async () => {
  const sb = await loadInspector({ libs: ["htmx"] });
  const ws = new sb.w.WebSocket("ws://localhost/app/ws");
  assert.equal(sb.events("streamOpen")[0].data.kind, "WS");

  ws.send("hello");
  ws.emit("message", { data: "world" });
  const msgs = sb.events("streamMsg");
  assert.deepEqual(msgs.map((m) => m.data.dir), ["send", "recv"]);
  assert.equal(msgs[0].data.data, "hello");
  assert.equal(msgs[1].data.data, "world");

  ws.emit("close", { code: 1000 });
  assert.equal(sb.events("streamClose")[0].data.code, 1000);
  sb.close();
});
