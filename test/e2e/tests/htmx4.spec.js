// The htmx 4 probe against real htmx 4, behind the Swapbook binary, in mock
// mode. Nothing here is shared with the htmx 2 path the jsdom suite covers, so
// this is the only place the colon events, the ctx.request.action rerouting and
// the cancel on htmx:before:request run for real.
import { test, expect } from "@playwright/test";

test("htmx 4: detects, reroutes mocked GET into a real swap, blocks unmocked POST", async ({ page }) => {
  const reqs = [];
  page.on("request", (r) => reqs.push(`${r.method()} ${new URL(r.url()).pathname}`));

  await page.addInitScript(() => {
    window.__sb = [];
    addEventListener("message", (e) => {
      if (e.data && e.data.source === "swapbook") window.__sb.push(e.data);
    });
  });
  const events = () => page.evaluate(() => window.__sb.map((m) => ({ event: m.event, data: m.data })));
  const seen = async (event) => (await events()).some((m) => m.event === event && m.data.lib === "htmx");

  await page.goto("/__sb/frame/htmx4/default?mode=mock");
  await expect
    .poll(async () => (await events()).some((m) => m.event === "frame:ready" && m.data.libs.includes("htmx")))
    .toBe(true);

  // mocked GET: rerouted, swapped for real, origin route never hit
  await page.click("#go-get");
  await expect(page.locator("#target")).toHaveText("ROW");
  expect(reqs).toContainEqual(expect.stringContaining("/__sb/mock/"));
  expect(reqs.some((r) => r.endsWith(" /rows"))).toBe(false);
  for (const e of ["mock", "beforeRequest", "afterRequest", "beforeSwap", "afterSwap"]) {
    expect(await seen(e), `missing ${e}`).toBe(true);
  }

  // unmocked mutation: cancelled before the fetch, and nothing leaves
  await page.click("#go-post");
  await expect.poll(() => seen("blocked")).toBe(true);
  expect(reqs.some((r) => r === "POST /save")).toBe(false);
  await expect(page.locator("#target")).toHaveText("ROW"); // no swap happened
});
