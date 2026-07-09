// Loads the real Swapbook browser UI (index.html + app.js, unmodified) into a
// jsdom window with a stubbed fetch, so tests exercise the actual client logic.
// This is dev-only tooling; the shipped UI stays a plain <script>, no build.
import { readFileSync } from "node:fs";

const UI = new URL("../../cmd/swapbook/ui/", import.meta.url);
const HTML = readFileSync(new URL("index.html", UI), "utf8")
  .replace(/<script[^>]*app\.js[^>]*><\/script>/, ""); // we inject app.js ourselves
const APP = readFileSync(new URL("app.js", UI), "utf8");

/** A minimal fetch Response for a given status + body. */
export function res(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

/**
 * Boot the UI with a fetch stub, then wait until `ready(window)` is truthy.
 * Returns the jsdom window.
 */
export async function boot(fetchImpl, ready) {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM(HTML, {
    runScripts: "dangerously",
    url: "http://localhost/__sb/",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  w.fetch = fetchImpl;
  w.setInterval = () => 0; // app.js starts a 1.5s reconnect poller; skip it so
  //                          jsdom timers don't keep the test process alive.

  const s = w.document.createElement("script");
  s.textContent = APP; // top-level function decls attach to the window global
  w.document.body.appendChild(s); // runs app.js -> boot()

  for (let i = 0; i < 100; i++) {
    if (ready(w)) return w;
    await new Promise((r) => setTimeout(r, 10));
  }
  return w; // let the assertion report the failure
}

/** Manifest JSON with a couple of stories, one carrying a control + a mock. */
export const MANIFEST = JSON.stringify({
  htmxSrc: "",
  cssSrc: "/static/ds.css",
  stories: [
    {
      id: "button",
      name: "Button",
      group: "actions",
      variants: [
        { name: "primary" },
        { name: "controls", controls: [{ name: "label", type: "text", default: "Save" }] },
      ],
    },
    { id: "todo-list", name: "Todo list", group: "interactive", variants: [{ name: "default" }] },
  ],
});
