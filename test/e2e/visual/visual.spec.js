// Visual regression over the examples/go demo: navigate to every story/variant
// preview and diff the render against a committed baseline. Manifest-driven, so
// new stories are picked up automatically. Soft assertions so one run reports
// every drifted variant, not just the first.
import { test, expect } from "@playwright/test";

// Non-deterministic stories are excluded: live-feed streams timestamped SSE
// events, and the phantom-ui skeleton loads from a CDN and animates.
const EXCLUDE = new Set(["live-feed", "skeleton-phantom-ui"]);

test("every variant matches its visual baseline", async ({ page, request }) => {
  const manifest = await (await request.get("/__sb/api/manifest")).json();
  // Frame params the chrome normally passes, so the preview renders styled (the
  // app's CSS/JS) instead of bare markup. Fixed bg keeps the canvas deterministic.
  const base = { mode: "mock", bg: "light" };
  if (manifest.cssSrc) base.css = manifest.cssSrc;
  if (manifest.htmxSrc) base.htmx = manifest.htmxSrc;
  if (manifest.jsSrc) base.js = manifest.jsSrc;

  for (const s of manifest.stories || []) {
    if (EXCLUDE.has(s.id)) continue;
    for (const v of s.variants || []) {
      const name = typeof v === "string" ? v : v.name;
      const q = new URLSearchParams({ ...base });
      await page.goto(`/__sb/frame/${s.id}/${encodeURIComponent(name)}?${q}`);
      await page.waitForLoadState("networkidle");
      await expect.soft(page).toHaveScreenshot(`${s.id}-${name}.png`, { fullPage: true });
    }
  }
});
