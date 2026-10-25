import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
const sizes = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
];
async function start(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.addInitScript(() =>
    localStorage.setItem(
      "awalem-studio-25d:sea_wonders:volume_01",
      JSON.stringify({
        schema_version: 1,
        render_mode: "2.5d",
        world_id: "sea_wonders",
        volume_id: "volume_01",
        dimensions: { width: 960, height: 540 },
        entities: [
          {
            id: "actor",
            name: "Workspace fish",
            shape: "fish",
            layer: "playfield",
            x: 480,
            y: 300,
            scale: 1,
            rotation: 0,
            depth: 0,
            color: "#ffd16f",
            interaction: { type: "show_fact", target: "preserve" },
          },
        ],
      }),
    ),
  );
  await page.goto("/");
  await expect(page.locator(".canvas-host canvas")).toBeVisible();
  await stable(page);
}
async function stable(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
const canvas = (page: Page) => page.locator(".canvas-host canvas");
async function box(page: Page) {
  await stable(page);
  return (await canvas(page).boundingBox())!;
}
async function exported(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export scene", exact: true }).click();
  return JSON.parse(await readFile((await (await waiting).path())!, "utf8"));
}
async function selectActor(page: Page) {
  if (
    (await page
      .getByRole("button", { name: "Left panel", exact: true })
      .getAttribute("aria-expanded")) !== "true"
  )
    await page.getByRole("button", { name: "Left panel", exact: true }).click();
  await page
    .locator(".hierarchy-select")
    .filter({ hasText: "Workspace fish" })
    .click();
  if (page.viewportSize()!.width < 1100)
    await page.getByRole("button", { name: "Close left panel" }).click();
  await stable(page);
}
async function framing(page: Page) {
  const b = await box(page),
    h = (await page
      .getByRole("button", { name: "Move freely", exact: true })
      .boundingBox())!;
  return {
    zoom: await page.getByLabel("Viewport zoom").textContent(),
    x: h.x + h.width / 2 - b.x - b.width / 2,
    y: h.y + h.height / 2 - b.y - b.height / 2,
  };
}
test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});
for (const size of sizes) {
  test(`panel sizing, mounted state, and refresh at ${size.width}x${size.height}`, async ({
    page,
  }, info) => {
    await start(page, size);
    const initial = await box(page),
      scene = await exported(page);
    await expect(
      page.getByRole("button", { name: "Assets", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.getByRole("button", { name: "Upload sprite", exact: true }),
    ).toBeVisible();
    expect(initial.height).toBeGreaterThan(size.height * 0.6);
    await page.getByRole("button", { name: "Assets", exact: true }).click();
    const expanded = await box(page);
    expect(expanded.height).toBeLessThan(initial.height - 140);
    await page
      .getByLabel("Search assets", { exact: true })
      .fill("retained search");
    const separator = page.getByRole("separator", {
      name: "Resize Asset Browser",
      exact: true,
    });
    await separator.focus();
    await page.keyboard.press("ArrowUp");
    await expect(separator).toHaveAttribute("aria-valuenow", "250");
    const s = (await separator.boundingBox())!;
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2);
    await page.mouse.down();
    await page.mouse.move(s.x + s.width / 2, s.y - 26, { steps: 8 });
    await page.mouse.up();
    const height = Number(await separator.getAttribute("aria-valuenow"));
    expect(height).toBeGreaterThan(250);
    await page.getByRole("button", { name: "Assets", exact: true }).click();
    await page.getByRole("button", { name: "Assets", exact: true }).click();
    await expect(page.getByLabel("Search assets", { exact: true })).toHaveValue(
      "retained search",
    );
    if (size.width >= 1100) {
      const before = await box(page);
      await page
        .getByRole("button", { name: "Left panel", exact: true })
        .click();
      expect((await box(page)).width).toBeGreaterThan(before.width + 200);
      await page
        .getByRole("button", { name: "Left panel", exact: true })
        .click();
    } else {
      await page
        .getByRole("button", { name: "Left panel", exact: true })
        .click();
      await expect(
        page.getByRole("complementary", { name: "Project and layers" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Inspector", exact: true })
        .click();
      await expect(
        page.getByRole("complementary", { name: "Project and layers" }),
      ).toBeHidden();
      await expect(
        page.getByRole("complementary", { name: "Inspector", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Close Inspector", exact: true })
        .click();
    }
    await expect(
      page.getByRole("button", { name: "Undo", exact: true }),
    ).toBeDisabled();
    expect(await exported(page)).toEqual(scene);
    await page.screenshot({
      path: info.outputPath(`assets-open-${size.width}.png`),
    });
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await expect(
      page.getByRole("separator", { name: "Resize Asset Browser" }),
    ).toHaveAttribute("aria-valuenow", String(height));
    expect(await exported(page)).toEqual(scene);
  });
  test(`Smart Fit and focus camera restoration at ${size.width}x${size.height}`, async ({
    page,
  }, info) => {
    await start(page, size);
    await selectActor(page);
    const scene = await exported(page);
    const fitZoom = await page.getByLabel("Viewport zoom").textContent();
    await page.getByRole("button", { name: "Assets", exact: true }).click();
    await stable(page);
    expect(await page.getByLabel("Viewport zoom").textContent()).not.toBe(
      fitZoom,
    );
    await page.getByRole("button", { name: "Assets", exact: true }).click();
    const b = await box(page);
    await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2);
    await page.mouse.wheel(0, -180);
    await stable(page);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(b.x + b.width / 2 + 110, b.y + b.height / 2 + 25, {
      steps: 8,
    });
    await page.mouse.up({ button: "middle" });
    const before = await framing(page);
    await page.getByRole("button", { name: "Assets", exact: true }).click();
    const after = await framing(page);
    expect(after.zoom).toBe(before.zoom);
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
    await page.getByRole("button", { name: "Assets", exact: true }).click();
    await page
      .getByRole("button", { name: "Scene focus", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Scene focus", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#workspace-assets")).toBeHidden();
    expect((await box(page)).width).toBeGreaterThanOrEqual(
      initialWidth(size.width),
    );
    await page.screenshot({
      path: info.outputPath(`focused-${size.width}.png`),
    });
    await page
      .getByRole("button", { name: "Scene focus", exact: true })
      .click();
    const restored = await framing(page);
    expect(restored.zoom).toBe(before.zoom);
    expect(restored.x).toBeCloseTo(before.x, 0);
    expect(restored.y).toBeCloseTo(before.y, 0);
    const smaller = { width: size.width, height: size.height - 80 };
    await page.setViewportSize(smaller);
    const resized = await framing(page);
    expect(resized.zoom).toBe(before.zoom);
    expect(resized.x).toBeCloseTo(before.x, 0);
    expect(resized.y).toBeCloseTo(before.y, 0);
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    const fitted = await page.getByLabel("Viewport zoom").textContent();
    await page.getByRole("button", { name: "Assets", exact: true }).click();
    await stable(page);
    expect(await page.getByLabel("Viewport zoom").textContent()).not.toBe(
      fitted,
    );
    expect(await exported(page)).toEqual(scene);
    await expect(
      page.getByRole("button", { name: "Undo", exact: true }),
    ).toBeDisabled();
  });
  test(`settings, overlay accessibility, and authored data at ${size.width}x${size.height}`, async ({
    page,
  }, info) => {
    await start(page, size);
    const original = await exported(page);
    await page.screenshot({
      path: info.outputPath(`default-${size.width}.png`),
    });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Inspector open", { exact: true }).uncheck();
    await dialog.getByLabel("Asset Browser height (px)").fill("300");
    await dialog
      .getByRole("button", { name: "Apply settings", exact: true })
      .click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    dialog = page.getByRole("dialog");
    await expect(
      dialog.getByLabel("Inspector open", { exact: true }),
    ).not.toBeChecked();
    await expect(dialog.getByLabel("Asset Browser height (px)")).toHaveValue(
      "300",
    );
    await dialog
      .getByRole("button", { name: "Reset workspace", exact: true })
      .click();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Assets", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
    await selectActor(page);
    if (size.width < 1100)
      await page
        .getByRole("button", { name: "Inspector", exact: true })
        .click();
    const x = page.getByLabel("X", { exact: true });
    await x.fill("555");
    await page.getByRole("button", { name: "Inspector", exact: true }).click();
    await page.getByRole("button", { name: "Inspector", exact: true }).click();
    await expect(page.getByLabel("X", { exact: true })).toHaveValue("555");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByLabel("X", { exact: true })).toHaveValue("480");
    if (size.width < 1100) {
      await page
        .getByRole("button", { name: "Close Inspector", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Left panel", exact: true })
        .click();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("complementary", { name: "Project and layers" }),
      ).toBeHidden();
      await expect(
        page.getByRole("button", { name: "Left panel", exact: true }),
      ).toBeFocused();
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(
        page.getByRole("complementary", { name: "Inspector", exact: true }),
      ).toBeVisible();
    }
    expect(await exported(page)).toEqual(original);
  });
}
function initialWidth(width: number) {
  return width - 2;
}
