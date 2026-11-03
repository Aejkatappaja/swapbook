import { test, expect } from "@playwright/test";
const start = async (page, params = "") => {
  await page.goto("/__sb/#story=play&variant=default" + params);
  await page.reload();
  await expect(page.frameLocator("#preview").locator("#go")).toBeVisible();
};
const pixels = (page) => page.locator("#preview").evaluate((frame) => frame.contentWindow.innerWidth);
const widthIs = async (page, width) => {
  await expect.poll(() => pixels(page)).toBe(width);
  const height = await page.locator("#preview").evaluate((frame) => frame.contentWindow.innerHeight);
  await expect(page.locator("#width-readout")).toHaveText(`${width} × ${height} px`);
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
  await expect(page.locator("#inspector .ins-head")).toBeVisible();
  await expect(page.locator("#events")).toBeHidden();
  const collapsedHeight = (await page.locator("#inspector").boundingBox()).height;
  expect((await page.locator("#preview").boundingBox()).height).toBeGreaterThanOrEqual(height + 232 - collapsedHeight);
  await page.reload();
  await expect(page.locator("#sidebar")).toBeHidden();
  await expect(page.locator("#inspector .ins-head")).toBeVisible();
  await expect(page.locator("#events")).toBeHidden();
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
  await expect(page.locator("#fit-height")).toBeHidden();
  for (const handle of await page.locator(".resize-handle").all()) await expect(handle).toBeHidden();
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

const sizeOf = (page) => page.locator("#preview").evaluate((frame) => [frame.contentWindow.innerWidth, frame.contentWindow.innerHeight]);
async function sizeIs(page, width, height) {
  await expect.poll(() => sizeOf(page)).toEqual([width, height]);
  await expect(page.locator("#width-readout")).toHaveText(`${width} × ${height} px`);
}
async function dragEdge(page, edge, dx, dy, finish = true) {
  const box = await page.locator(`[data-edge="${edge}"]`).boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  if (finish) await page.mouse.up();
}
for (const [edge, x, y] of [["n",0,-1], ["ne",1,-1], ["e",1,0], ["se",1,1], ["s",0,1], ["sw",-1,1], ["w",-1,0], ["nw",-1,-1]]) {
  test(`${edge} handle grows and shrinks its axes without reloading`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await start(page, "&px=640&h=320");
    await page.frameLocator("#preview").locator("#go").click();
    await dragEdge(page, edge, x * 20, y * 20);
    await sizeIs(page, 640 + Math.abs(x) * 40, 320 + Math.abs(y) * 40);
    await dragEdge(page, edge, -x * 20, -y * 20);
    await sizeIs(page, 640, 320);
    await expect(page.frameLocator("#preview").locator("#out")).toHaveText("clicked");
  });
}
test("height persists with width, presets preserve height, and old links restore auto height", async ({ page }) => {
  await start(page, "&w=phone&h=300");
  await page.locator('[data-edge="s"]').press("ArrowDown");
  await sizeIs(page, 375, 301);
  await page.getByRole("button", { name: "tablet", exact: true }).click();
  await sizeIs(page, 768, 301);
  await page.reload();
  await sizeIs(page, 768, 301);
  await start(page, "&px=641&h=400");
  await sizeIs(page, 641, 400);
  await page.locator('[data-sid="sse"][data-vname="default"]').click();
  await page.locator('[data-sid="play"][data-vname="default"]').click();
  await sizeIs(page, 768, 301);
  await start(page, "&w=phone");
  expect((await sizeOf(page))[1]).toBeGreaterThan(301);
  await expect(page.locator("#fit-height")).toHaveAttribute("aria-pressed", "true");
});
test("fixed height survives panel and browser changes, fit height resumes automatic height", async ({ page }) => {
  await start(page, "&px=640&h=320");
  await page.getByRole("button", { name: "hide inspector", exact: true }).click();
  await page.setViewportSize({ width: 1400, height: 1000 });
  await sizeIs(page, 640, 320);
  await page.getByRole("button", { name: "fit height", exact: true }).click();
  const height = (await sizeOf(page))[1];
  expect(height).toBeGreaterThan(320);
  await expect(page).not.toHaveURL(/(?:&|#)h=/);
  await page.setViewportSize({ width: 1400, height: 1100 });
  await sizeIs(page, 640, height + 100);
});
test("corner keyboard changes both axes and cancellation restores the complete snapshot", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await start(page, "&w=phone&h=300");
  const handle = page.locator('[data-edge="nw"]');
  await handle.press("Shift+ArrowLeft");
  await handle.press("ArrowUp");
  await sizeIs(page, 385, 301);
  const savedURL = page.url();
  await dragEdge(page, "se", 30, 20, false);
  await sizeIs(page, 445, 341);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await sizeIs(page, 385, 301);
  expect(page.url()).toBe(savedURL);
  await dragEdge(page, "ne", 20, -20, false);
  await page.locator('[data-edge="ne"]').dispatchEvent("pointercancel", { pointerType: "touch" });
  await page.mouse.up();
  await sizeIs(page, 385, 301);
  await expect(page.locator("body")).not.toHaveClass(/resizing-preview/);
});
test("corner drag shortcut restores both dimensions before selecting a preset", async ({ page }) => {
  await start(page, "&w=phone&h=300");
  await dragEdge(page, "se", 20, 20, false);
  await page.keyboard.press("2");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await sizeIs(page, 768, 300);
  await page.reload();
  await sizeIs(page, 768, 300);
});
test("vertical scroll clamping does not feed back into height and height bounds hold", async ({ page }) => {
  await start(page, "&px=640&h=1000");
  await page.locator("#stage").evaluate((stage) => { stage.scrollTop = stage.scrollHeight; });
  await dragEdge(page, "s", 0, -80);
  await sizeIs(page, 640, 920);
  await start(page, "&px=640&h=160");
  await page.locator('[data-edge="s"]').press("ArrowUp");
  await sizeIs(page, 640, 160);
  await start(page, "&px=640&h=2160");
  await page.locator('[data-edge="s"]').press("ArrowDown");
  await sizeIs(page, 640, 2160);
});

test("touch can resize a corner", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await start(page, "&px=640&h=320");
  const box = await page.locator('[data-edge="se"]').boundingBox();
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const session = await context.newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + 20, y: y + 20, id: 1 }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sizeIs(page, 680, 360);
  await session.detach();
});

test("manifest replacement cancels a drag before removing its preset", async ({ page }) => {
  let changed = false;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/__sb/api/manifest", async (route) => {
    const manifest = await (await route.fetch()).json();
    manifest.viewports = changed ? [] : [{ name: "custom", w: "640px" }];
    await route.fulfill({ json: manifest });
  });
  await start(page, "&w=custom&h=300");
  await dragEdge(page, "se", 15, 15, false);
  changed = true;
  await expect(page.locator('#widths button[data-val="custom"]')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator("body")).not.toHaveClass(/resizing-preview/);
  await page.getByRole("button", { name: "fit height", exact: true }).click();
  expect(errors).toEqual([]);
});

for (const saved of ["phone", { kind: "pixels", value: 641 }]) {
  test(`legacy saved viewport ${JSON.stringify(saved)} restores automatic height`, async ({ page }) => {
    await page.addInitScript((saved) => localStorage.setItem("swapbook:viewports", JSON.stringify({ play: saved })), saved);
    await start(page);
    await widthIs(page, typeof saved === "string" ? 375 : 641);
    await expect(page.locator("#fit-height")).toHaveAttribute("aria-pressed", "true");
  });
}


test("collapsed inspector keeps its tabs and toggle beside clear", async ({ page }) => {
  await page.route("**/__sb/api/manifest", async (route) => {
    const manifest = await (await route.fetch()).json();
    manifest.stories.find((story) => story.id === "play").variants = [{ name: "default", docs: "Inspector documentation" }];
    await route.fulfill({ json: manifest });
  });
  await start(page);
  const header = page.locator("#inspector .ins-head");
  const toggle = header.locator("#toggle-inspector");
  await expect(toggle).toHaveText("hide inspector");
  expect(await page.locator("#clear").evaluate((button) => button.nextElementSibling.id)).toBe("toggle-inspector");
  await header.getByRole("button", { name: "docs", exact: true }).click();
  await expect(page.locator("#docs")).toHaveText("Inspector documentation");
  await toggle.click();
  await expect(toggle).toHaveText("show inspector");
  await expect(toggle).toBeFocused();
  for (const tab of ["network", "a11y", "docs"]) await expect(header.locator(`[data-tab="${tab === "network" ? "net" : tab}"]`)).toBeVisible();
  await expect(page.locator("#docs")).toBeHidden();
  const box = await header.boundingBox();
  expect(Math.round(box.y + box.height)).toBe(page.viewportSize().height);
  await page.keyboard.press("Enter");
  await expect(page.locator("#docs")).toBeVisible();
  await expect(page.locator("#docs")).toHaveText("Inspector documentation");
});


test("sidebar hide control stays inside and toolbar reopens it with keyboard focus", async ({ page }) => {
  await start(page);
  const hide = page.locator("#sidebar").getByRole("button", { name: "hide stories", exact: true });
  const show = page.locator("#toolbar").getByRole("button", { name: "show stories", exact: true });
  await expect(hide).toBeVisible();
  await expect(show).toBeHidden();
  await hide.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#sidebar")).toBeHidden();
  await expect(show).toBeFocused();
  await expect(show).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(hide).toBeFocused();
  await expect(show).toBeHidden();
  await hide.click();
  await page.reload();
  await expect(show).toBeVisible();
  await expect(page.locator("#sidebar")).toBeHidden();
  await show.click();
  await expect(hide).toBeVisible();
  await expect(show).toBeHidden();
});
