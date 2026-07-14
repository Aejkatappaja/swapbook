// Loads the real inspector.js (the script injected into every preview frame)
// into a jsdom window, faking whichever hypermedia library the test wants so the
// matching probe attaches. Lets tests drive each library's request lifecycle and
// observe the shared mock/safe/live gating.
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../../cmd/swapbook/ui/inspector.js", import.meta.url), "utf8");

/**
 * @param {{mode?: string, mocks?: Record<string,string>, libs?: string[], body?: string}} opts
 */
export async function loadInspector(opts = {}) {
  const libs = opts.libs || ["htmx"];
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM(`<!doctype html><body>${opts.body || ""}</body>`, {
    runScripts: "dangerously",
    url: "http://localhost/",
  });
  const w = dom.window;
  const messages = [];
  const upHandlers = {}; // unpoly registers via up.on(name, fn); we capture them
  const fetchCalls = []; // what datastar's wrapper forwarded to the original fetch

  w.__SB = { mode: opts.mode || "mock", mocks: opts.mocks || {} };
  // datastar wraps window.fetch; give it a spyable original to forward to.
  w.fetch = (input, init) => {
    fetchCalls.push({ input: String(input && input.url ? input.url : input), init });
    return Promise.resolve({ status: 200 });
  };
  if (libs.includes("htmx")) w.htmx = {};
  if (libs.includes("turbo")) w.Turbo = {};
  if (libs.includes("unpoly")) w.up = { on: (name, fn) => { upHandlers[name] = fn; } };
  if (libs.includes("datastar")) w.Datastar = {};
  // Fake EventSource / WebSocket the inspector's stream lens wraps. Each stores
  // listeners and exposes emit() so a test can drive the connection lifecycle.
  class FakeStream {
    constructor(url) { this.url = url; this._h = {}; }
    addEventListener(n, f) { (this._h[n] ??= []).push(f); }
    emit(n, ev) { (this._h[n] || []).forEach((f) => f(ev)); }
    close() {}
    send() {}
  }
  w.EventSource = FakeStream;
  w.WebSocket = FakeStream;
  w.postMessage = (m) => messages.push(m); // send() posts to parent === window here

  const s = w.document.createElement("script");
  s.textContent = SRC;
  w.document.body.appendChild(s); // runs the inspector IIFE -> wire()

  /** Dispatch a document CustomEvent with a mutable detail; returns the event. */
  function fire(name, detail, cancelable = true) {
    const e = new w.CustomEvent(name, { detail, cancelable, bubbles: true });
    w.document.dispatchEvent(e);
    return e;
  }
  const events = (name) => messages.filter((m) => m.event === name);

  return { w, messages, fire, events, upHandlers, fetchCalls, close: () => w.close() };
}
