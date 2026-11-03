import { test, expect } from "@playwright/test";
const start = async (page, params = "") => {
  await page.goto("/__sb/#story=play&variant=default" + params);
  await page.reload();
  await expect(page.frameLocator("#preview").locator("#go")).toBeVisible();
};
const pixels = (page) => page.locator("#preview").evaluate((frame) => frame.contentWindow.innerWidth);
const widthIs = async (page, width) => {
  await expect.poll(() => pixels(page)).toBe(width);
  await expect(page.locator("#width-readout")).toHaveText(width + "px");
};
async function drag(page, delta, finish = true) {
  const box = await page.locator("#resize-width").boundingBox();
  await page.mouse.move(box.x + 8, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 8 + delta, box.y + box.height / 2, { steps: 8 });
  if (finish) await page.mouse.up();
}
test("panels free space, stay reopenable, and persist", async ({ page }) => {
  await start(page);
  const width = await pixels(page);
  const height = (await page.locator("#preview").boundingBox()).height;
  await page.getByRole("button", { name: "hide stories", exact: true }).click();
  await expect(page.locator("#sidebar")).toBeHidden();
  await expect.poll(() => pixels(page)).toBe(width + 248);
  await page.getByRole("button", { name: "hide inspector", exact: true }).click();
  await expect(page.locator("#inspector")).toBeHidden();
  expect((await page.locator("#preview").boundingBox()).height).toBeGreaterThanOrEqual(height + 232);
  await page.reload();
  await expect(page.locator("#sidebar")).toBeHidden();
  await expect(page.locator("#inspector")).toBeHidden();
  const reopen = page.getByRole("button", { name: "show inspector", exact: true });
  await reopen.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#toggle-inspector")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("/");
  await expect(page.locator("#story-search")).toBeFocused();
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect.poll(() => pixels(page)).toBe(1104);
});
test("drag and keyboard resize preserve frame state and persist exact pixels", async ({ page }) => {
  await start(page, "&w=phone");
  await widthIs(page, 375);
  await page.frameLocator("#preview").locator("#go").click();
  await drag(page, 50);
  await widthIs(page, 475);
  await expect(page.frameLocator("#preview").locator("#out")).toHaveText("clicked");
  await expect(page).toHaveURL(/px=475/);
  await page.locator("#resize-width").focus();
  await page.keyboard.press("Shift+ArrowRight");
  await widthIs(page, 485);
  await page.keyboard.press("ArrowLeft");
  await widthIs(page, 484);
  await page.reload();
  await widthIs(page, 484);
  await page.locator('[data-sid="sse"][data-vname="default"]').click();
  await page.locator('[data-sid="play"][data-vname="default"]').click();
  await widthIs(page, 484);
  await page.getByRole("button", { name: "tablet", exact: true }).click();
  await widthIs(page, 768);
});
test("cancel restores preset and input; docs hide controls", async ({ page }) => {
  await start(page, "&w=phone");
  await drag(page, -35, false);
  await widthIs(page, 305);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await widthIs(page, 375);
  await page.frameLocator("#preview").locator("#go").click();
  await expect(page.frameLocator("#preview").locator("#out")).toHaveText("clicked");
  await page.locator('[data-sid="play"][data-docs="1"]').click();
  await expect(page.locator("#resize-width")).toBeHidden();
  await expect(page.locator("#width-readout")).toBeHidden();
});
test("shared widths override memory without changing it", async ({ page }) => {
  await start(page, "&w=phone");
  await page.locator("#resize-width").focus();
  await page.keyboard.press("ArrowRight");
  await start(page, "&px=641");
  await widthIs(page, 641);
  await page.locator('[data-sid="sse"][data-vname="default"]').click();
  await page.locator('[data-sid="play"][data-vname="default"]').click();
  await widthIs(page, 376);
  await start(page, "&px=999999&w=tablet");
  await widthIs(page, 768);
});
test("drag crosses available width and keeps overflow reachable", async ({ page }) => {
  await start(page);
  const width = await pixels(page);
  await drag(page, 50);
  await widthIs(page, width + 50);
  const stage = await page.locator("#stage").boundingBox();
  const frame = await page.locator("#preview").boundingBox();
  expect(frame.x).toBe(stage.x + 24);
  await page.locator("#stage").evaluate((el) => { el.scrollLeft = 40; });
  await drag(page, -10);
  await widthIs(page, width + 40);
});
test("invalid preferences fall back and preset names cannot collide with pixels", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("swapbook:panels", '{"sidebar":"false","inspector":null}');
    localStorage.setItem("swapbook:viewports", '{"play":{"kind":"pixels","value":-3}}');
  });
  await page.route("**/__sb/api/manifest", async (route) => {
    const manifest = await (await route.fetch()).json();
    manifest.viewports = [{ name: "641px", w: "1440px" }];
    await route.fulfill({ json: manifest });
  });
  await start(page, "&px=not-a-number");
  await expect(page.locator("#sidebar")).toBeVisible();
  await expect(page.locator("#inspector")).toBeVisible();
  await page.getByRole("button", { name: "641px", exact: true }).click();
  await widthIs(page, 1440);
  await start(page, "&px=641");
  await widthIs(page, 641);
});

test("panel controls remain reachable on a narrow workbench", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 900 });
  await start(page);
  for (const name of ["hide stories", "hide inspector", "show stories", "show inspector"]) {
    const button = page.getByRole("button", { name, exact: true });
    const box = await button.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(480);
    await button.click();
  }
});

test("pointer cancellation restores width and custom width bounds hold", async ({ page }) => {
  await start(page, "&px=240");
  await page.locator("#resize-width").focus();
  await page.keyboard.press("ArrowLeft");
  await widthIs(page, 240);
  await drag(page, 40, false);
  await page.locator("#resize-width").dispatchEvent("pointercancel");
  await page.mouse.up();
  await widthIs(page, 240);
  await expect(page.locator("body")).not.toHaveClass(/resizing-preview/);
  await start(page, "&px=3840");
  await page.locator("#resize-width").focus();
  await page.keyboard.press("ArrowRight");
  await widthIs(page, 3840);
});

test("shrinking a scrolled preview does not feed scroll clamping back into its width", async ({ page }) => {
  await start(page);
  const full = await pixels(page);
  await drag(page, 100);
  await page.locator("#stage").evaluate((el) => { el.scrollLeft = el.scrollWidth; });
  const handle = await page.locator("#resize-width").boundingBox();
  const x = handle.x + 8;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 80, y, { steps: 10 });
  await widthIs(page, full + 20);
  await page.mouse.move(x - 80, y);
  await widthIs(page, full + 20);
  await page.mouse.up();
});


test("preset shortcuts end a drag before changing the saved width", async ({ page }) => {
  await start(page, "&w=phone");
  await drag(page, 30, false);
  await page.keyboard.press("2");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await widthIs(page, 768);
  await expect(page).toHaveURL(/w=tablet/);
  await page.locator('[data-sid="sse"][data-vname="default"]').click();
  await page.locator('[data-sid="play"][data-vname="default"]').click();
  await widthIs(page, 768);
});
