// Drives the inspector's play runner in a real browser: post a play command (as
// the chrome does), let the inspector run the steps against the real DOM, and
// assert the results stream back (#14).
import { test, expect } from "@playwright/test";

test("play: runs steps against the real DOM and reports the outcome", async ({ page }) => {
  await page.addInitScript(() => {
    window.__sb = [];
    addEventListener("message", (e) => {
      if (e.data && e.data.source === "swapbook") window.__sb.push(e.data);
    });
  });
  await page.goto("/__sb/frame/play/default?mode=mock");
  await page.waitForLoadState("networkidle");

  await page.evaluate(() =>
    window.postMessage(
      {
        source: "swapbook-cmd",
        cmd: "play",
        steps: [
          { action: "click", target: "#go" },
          { action: "expect-text", target: "#out", text: "clicked" },
        ],
      },
      "*",
    ),
  );

  await expect
    .poll(() => page.evaluate(() => window.__sb.find((m) => m.event === "play:done")?.data.ok))
    .toBe(true);
  const results = await page.evaluate(() => window.__sb.filter((m) => m.event === "play:result").map((m) => m.data.ok));
  expect(results).toEqual([true, true]);
});
