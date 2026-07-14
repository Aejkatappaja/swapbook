// Verifies the inspector's SSE lens against a real EventSource streaming through
// the Swapbook proxy: the "sse" story opens EventSource('/sse'), the target
// streams two events, and the inspector must report streamOpen + streamMsg (#17).
import { test, expect } from "@playwright/test";

test("sse: a real EventSource is wrapped and its events are streamed", async ({ page }) => {
  await page.addInitScript(() => {
    window.__sb = [];
    addEventListener("message", (e) => {
      if (e.data && e.data.source === "swapbook") window.__sb.push(e.data);
    });
  });
  const events = () => page.evaluate(() => window.__sb.map((m) => ({ event: m.event, data: m.data })));

  await page.goto("/__sb/frame/sse/default?mode=live");

  // the connection opens, tagged SSE with the origin path
  await expect.poll(async () => (await events()).find((m) => m.event === "streamOpen")?.data.kind).toBe("SSE");
  const open = (await events()).find((m) => m.event === "streamOpen");
  expect(open.data.path).toBe("/sse");

  // the streamed events arrive as recv messages
  await expect.poll(async () => (await events()).filter((m) => m.event === "streamMsg").length).toBeGreaterThan(0);
  const msg = (await events()).find((m) => m.event === "streamMsg");
  expect(msg.data.dir).toBe("recv");
  expect(msg.data.data).toContain("tick");
});
