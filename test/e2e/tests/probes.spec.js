// Exercises each non-htmx inspector probe against the real library, behind the
// Swapbook binary, in mock mode. Confirms the three things the probe promises:
//   1. detection      - the probe attaches for the loaded library
//   2. mock rerouting  - a mocked GET is rewritten to the mock endpoint (and the
//                        origin route is never hit)
//   3. mutation block  - an unmocked POST is cancelled (no request leaves)
// plus that both are logged. htmx is covered by the jsdom suite; this is the
// real-browser check for the best-effort Turbo/Unpoly/Datastar probes (#16).
import { test, expect } from "@playwright/test";

const LIBS = ["turbo", "unpoly", "datastar"];

for (const lib of LIBS) {
  test(`${lib}: detects, reroutes mocked GET, blocks unmocked POST`, async ({ page }) => {
    const reqs = [];
    page.on("request", (r) => reqs.push(`${r.method()} ${new URL(r.url()).pathname}`));

    // Capture the inspector's postMessage stream from before any script runs
    // (send() posts to parent, which is this same window when loaded top-level).
    await page.addInitScript(() => {
      window.__sb = [];
      addEventListener("message", (e) => {
        if (e.data && e.data.source === "swapbook") window.__sb.push(e.data);
      });
    });
    const events = () => page.evaluate(() => window.__sb.map((m) => ({ event: m.event, data: m.data })));
    const seen = async (event, lib) => (await events()).some((m) => m.event === event && (!lib || m.data.lib === lib));

    await page.goto(`/__sb/frame/${lib}/default?mode=mock`);

    // 1. detection: the probe attached for this library
    await expect
      .poll(async () => (await events()).some((m) => m.event === "frame:ready" && m.data.libs.includes(lib)))
      .toBe(true);
    // library scripts (Turbo/Unpoly are eager; Datastar is a deferred module) settle
    await page.waitForLoadState("networkidle");

    // 2. mocked GET is rerouted through the probe to the mock endpoint
    await page.click("#go-get");
    await expect.poll(() => seen("mock", lib)).toBe(true);
    expect(reqs).toContainEqual(expect.stringContaining("/__sb/mock/"));
    expect(reqs.some((r) => r.endsWith(" /rows"))).toBe(false); // origin route never hit

    // 3. unmocked mutation is blocked and logged; nothing leaves for /save
    await page.click("#go-post");
    await expect.poll(() => seen("blocked", lib)).toBe(true);
    expect(reqs.some((r) => r === "POST /save")).toBe(false);
  });
}
