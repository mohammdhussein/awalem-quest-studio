import { test, expect, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { readFile } from "node:fs/promises";
function pngChunk(type: string, data: Buffer) {
  const name = Buffer.from(type),
    length = Buffer.alloc(4),
    check = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  check.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, name, data, check]);
}
const header = Buffer.alloc(13);
header.writeUInt32BE(1, 0);
header.writeUInt32BE(1, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk("IHDR", header),
  pngChunk("IDAT", deflateSync(Buffer.from([0, 255, 60, 160, 255]))),
  pngChunk("IEND", Buffer.alloc(0)),
]);
const errors = new WeakMap<Page, Error[]>();
test.beforeEach(({ page }) => {
  const list: Error[] = [];
  errors.set(page, list);
  page.on("pageerror", (error) => list.push(error));
});
test.afterEach(({ page }) => {
  expect(errors.get(page) ?? []).toEqual([]);
});
async function start(page: Page, count = 1) {
  await page.route("**/editor-fixture.png", (route) =>
    route.fulfill({ contentType: "image/png", body: png }),
  );
  await page.addInitScript(
    ({ count }) => {
      const entities = Array.from({ length: count }, (_, i) => ({
        id: `actor-${i}`,
        name: count === 1 ? "Test sprite" : `Actor ${i}`,
        shape: count === 1 ? "image" : "fish",
        layer: "playfield",
        x: count === 1 ? 400 : 20 + (i % 25) * 34,
        y: count === 1 ? 300 : 120 + Math.floor(i / 25) * 18,
        scale: 1,
        rotation: 0,
        depth: 0,
        color: "#ffd16f",
        ...(count === 1
          ? { assetUrl: "http://127.0.0.1:5178/editor-fixture.png" }
          : {}),
      }));
      localStorage.setItem(
        "awalem-studio-25d:sea_wonders:volume_01",
        JSON.stringify({
          schema_version: 1,
          render_mode: "2.5d",
          world_id: "sea_wonders",
          volume_id: "volume_01",
          dimensions: { width: 960, height: 540 },
          entities,
        }),
      );
    },
    { count },
  );
  await page.goto("/");
  await expect(page.locator(".canvas-host canvas")).toBeVisible();
  await page.getByRole("button", { name: "Assets", exact: true }).click();
  await page
    .locator(".hierarchy-select")
    .filter({ hasText: count === 1 ? "Test sprite" : `Actor ${count - 1}` })
    .last()
    .click();
  if (count === 1)
    await expect(page.getByLabel("Width", { exact: true })).toHaveValue("140");
}
async function center(page: Page, name: string) {
  const b = await page.getByRole("button", { name, exact: true }).boundingBox();
  if (!b) throw new Error(`Missing ${name}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function drag(page: Page, name: string, to: { x: number; y: number }) {
  const from = await center(page, name);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}
const numeric = async (page: Page, label: string) =>
  Number(await page.getByLabel(label, { exact: true }).inputValue());
async function input(page: Page, label: string, value: string) {
  const control = page.getByLabel(label, { exact: true });
  await control.fill(value);
  await control.press("Enter");
}
async function fitPoint(page: Page, x: number, y: number) {
  const b = await page.locator(".canvas-host canvas").boundingBox();
  if (!b) throw new Error("Canvas missing");
  const z = Math.min((b.width - 48) / 960, (b.height - 48) / 540);
  return {
    x: b.x + (b.width - 960 * z) / 2 + x * z,
    y: b.y + (b.height - 540 * z) / 2 + y * z,
  };
}
test("real canvas selection, outside-canvas capture, undo, zoom/pan and reload persistence", async ({
  page,
}, testInfo) => {
  await start(page);
  if (testInfo.project.name === "chrome-1x")
    await page.screenshot({ path: testInfo.outputPath("scene-editor.png") });
  const blank = await fitPoint(page, 10, 10);
  await page.mouse.click(blank.x, blank.y);
  await expect(page.getByLabel("X", { exact: true })).toHaveCount(0);
  const sprite = await fitPoint(page, 400, 230);
  await page.mouse.click(sprite.x, sprite.y);
  await expect(page.getByLabel("X", { exact: true })).toHaveValue("400");
  const initialHandle = await center(page, "Move freely");
  await page.mouse.move(initialHandle.x, initialHandle.y);
  await page.mouse.down();
  await page.mouse.move(initialHandle.x + 50, initialHandle.y + 10, {
    steps: 6,
  });
  await expect.poll(() => numeric(page, "X")).toBeGreaterThan(400);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.getByLabel("X", { exact: true })).toHaveValue("400");
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  const b = await page.locator(".canvas-host canvas").boundingBox();
  await drag(page, "Move freely", {
    x: b!.x + b!.width + 40,
    y: (await center(page, "Move freely")).y + 20,
  });
  await expect.poll(() => numeric(page, "X")).toBeGreaterThan(960);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("X", { exact: true })).toHaveValue("400");
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.poll(() => numeric(page, "X")).toBeGreaterThan(960);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.mouse.move(sprite.x, sprite.y);
  await page.mouse.wheel(0, -200);
  await expect(page.getByLabel("X", { exact: true })).toHaveValue("400");
  await page.locator(".canvas-host canvas").focus();
  await page.keyboard.down("Space");
  await page.mouse.move(b!.x + 80, b!.y + 80);
  await page.mouse.down();
  await page.mouse.move(b!.x + 160, b!.y + 130, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  await expect(page.getByLabel("Y", { exact: true })).toHaveValue("300");
  const move = await center(page, "Move freely");
  await drag(page, "Move freely", { x: move.x + 60, y: move.y - 20 });
  await expect.poll(() => numeric(page, "X")).toBeGreaterThan(400);
  const x = await numeric(page, "X"),
    y = await numeric(page, "Y");
  await expect(page.locator(".save-state")).toContainText(
    "Draft saved locally",
  );
  await page.reload();
  await page.getByRole("button", { name: "Test sprite", exact: true }).click();
  await expect(page.getByLabel("X", { exact: true })).toHaveValue(String(x));
  await expect(page.getByLabel("Y", { exact: true })).toHaveValue(String(y));
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
});
test("real rotation and scale handles, independent axes, transformed picking and origin controls", async ({
  page,
}) => {
  await start(page);
  const pivot = await center(page, "Move freely");
  await page.getByRole("button", { name: "Rotate E", exact: true }).click();
  const ring = await center(page, "Rotate object");
  await drag(page, "Rotate object", {
    x: pivot.x - (ring.y - pivot.y),
    y: pivot.y + (ring.x - pivot.x),
  });
  await expect.poll(() => numeric(page, "Rotation°")).toBeCloseTo(90, 0);
  await page.getByRole("button", { name: "Scale R", exact: true }).click();
  const fixed = await center(page, "Scale NW"),
    corner = await center(page, "Scale SE");
  await drag(page, "Scale SE", {
    x: fixed.x + (corner.x - fixed.x) * 1.3,
    y: fixed.y + (corner.y - fixed.y) * 1.3,
  });
  await expect.poll(() => numeric(page, "Scale X")).toBeCloseTo(1.3, 1);
  await expect.poll(() => numeric(page, "Scale Y")).toBeCloseTo(1.3, 1);
  const fixedAfter = await center(page, "Scale NW");
  expect(fixedAfter.x).toBeCloseTo(fixed.x, 0);
  expect(fixedAfter.y).toBeCloseTo(fixed.y, 0);
  await page.getByRole("button", { name: "Aspect lock", exact: true }).click();
  const west = await center(page, "Scale W"),
    east = await center(page, "Scale E");
  await drag(page, "Scale E", {
    x: west.x + (east.x - west.x) * 1.2,
    y: west.y + (east.y - west.y) * 1.2,
  });
  await expect.poll(() => numeric(page, "Scale X")).toBeCloseTo(1.56, 1);
  await expect.poll(() => numeric(page, "Scale Y")).toBeCloseTo(1.3, 1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => numeric(page, "Scale X")).toBeCloseTo(1.3, 1);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect.poll(() => numeric(page, "Scale X")).toBeCloseTo(1.56, 1);
  await input(page, "Rotation°", "45");
  await input(page, "Scale X", "1");
  await input(page, "Scale Y", "1");
  await input(page, "X", "400");
  await input(page, "Y", "300");
  const blank = await fitPoint(page, 10, 10);
  await page.mouse.click(blank.x, blank.y);
  const sprite = await fitPoint(
    page,
    400 + Math.sqrt(2) * 35,
    300 - Math.sqrt(2) * 35,
  );
  await page.mouse.click(sprite.x, sprite.y);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Test sprite",
  );
  const before = await center(page, "Scale NW");
  await input(page, "Anchor X", "0");
  await input(page, "Pivot Y", "20");
  const after = await center(page, "Scale NW");
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
  await input(page, "Opacity %", "42");
  const labels = [
    "X",
    "Y",
    "Rotation°",
    "Scale X",
    "Scale Y",
    "Anchor X",
    "Anchor Y",
    "Pivot X",
    "Pivot Y",
    "Opacity %",
  ];
  const saved = await Promise.all(labels.map((label) => numeric(page, label)));
  await expect(page.locator(".save-state")).toContainText(
    "Draft saved locally",
  );
  await page.reload();
  await page.getByRole("button", { name: "Test sprite", exact: true }).click();
  for (let i = 0; i < labels.length; i++)
    await expect(page.getByLabel(labels[i], { exact: true })).toHaveValue(
      String(saved[i]),
    );
});
test("locked/hidden/selectability rules, mission setup and independent scene histories", async ({
  page,
}) => {
  await start(page);
  await page.getByLabel("Locked", { exact: true }).check();
  await expect(page.getByLabel("X", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Move freely", exact: true }),
  ).toHaveCount(0);
  const sprite = await fitPoint(page, 400, 230);
  await page.mouse.click(sprite.x, sprite.y);
  await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Test sprite", exact: true }).click();
  await page.getByLabel("Visible", { exact: true }).uncheck();
  await expect(page.locator(".gizmo-handle")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Show Test sprite", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Unlock Test sprite", exact: true })
    .click();
  await page.getByLabel("Selectable in viewport", { exact: true }).uncheck();
  await page.mouse.click(sprite.x, sprite.y);
  await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Test sprite", exact: true }).click();
  await page.getByLabel("Selectable in viewport", { exact: true }).check();
  await input(page, "X", "444");
  await page
    .getByRole("button", { name: "Set up / open Mission 1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Set up and open", exact: true })
    .click();
  await expect(
    page.getByRole("treeitem", { name: "Mission 1", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Set up / open Mission 1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Set up and open", exact: true })
    .click();
  await expect(
    page.getByRole("treeitem", { name: "Mission 1", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "+ New", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Item type").selectOption("scene");
  await dialog.getByLabel("Name", { exact: true }).fill("Second Scene");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await page.getByRole("button", { name: "+ Add sample", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeDisabled();
  await page.getByRole("treeitem", { name: "Main Scene", exact: true }).click();
  await page.getByRole("button", { name: "Test sprite", exact: true }).click();
  await expect(page.getByLabel("X", { exact: true })).toHaveValue("444");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("X", { exact: true })).toHaveValue("400");
});
test("500 real Pixi objects remain editable", async ({ page }) => {
  await start(page, 500);
  await expect(page.locator(".hierarchy-select")).toHaveCount(500);
  const from = await center(page, "Move freely");
  const before = await numeric(page, "X");
  await drag(page, "Move freely", { x: from.x + 25, y: from.y + 10 });
  await expect.poll(() => numeric(page, "X")).toBeGreaterThan(before);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("X", { exact: true })).toHaveValue(
    String(before),
  );
});
test("keyboard tools, snapping, grouped edits, object commands and export data", async ({
  page,
}) => {
  await start(page);
  await page.locator(".canvas-host canvas").focus();
  await page.keyboard.press("r");
  await expect(
    page.getByRole("button", { name: "Scale R", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await input(page, "Name", "wear sprite");
  await expect(
    page.getByRole("button", { name: "Scale R", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Control+z");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Test sprite",
  );
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "wear sprite",
  );
  await page.keyboard.press("w");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Grid size (scene units)").fill("25");
  await dialog.getByLabel("Angle snap (degrees)").fill("30");
  await dialog.getByRole("button", { name: "Apply settings" }).click();
  await page.getByRole("button", { name: "Snap", exact: true }).click();
  const xHandle = await center(page, "Move X");
  await drag(page, "Move X", { x: xHandle.x + 40, y: xHandle.y + 25 });
  expect((await numeric(page, "X")) % 25).toBeCloseTo(0);
  await expect(page.getByLabel("Y", { exact: true })).toHaveValue("300");
  const pivot = await center(page, "Move freely");
  await page.getByRole("button", { name: "Rotate E", exact: true }).click();
  await page.getByRole("button", { name: "Angle snap", exact: true }).click();
  const ring = await center(page, "Rotate object"),
    r = (42 * Math.PI) / 180,
    vx = ring.x - pivot.x,
    vy = ring.y - pivot.y;
  await drag(page, "Rotate object", {
    x: pivot.x + vx * Math.cos(r) - vy * Math.sin(r),
    y: pivot.y + vx * Math.sin(r) + vy * Math.cos(r),
  });
  await expect.poll(() => numeric(page, "Rotation°")).toBeCloseTo(30, 0);
  await input(page, "Opacity %", "1e309");
  await expect(page.getByLabel("Opacity %", { exact: true })).toHaveValue(
    "100",
  );
  await expect(page.getByRole("alert")).toContainText("previous value");
  await page.locator(".canvas-host canvas").focus();
  await page.keyboard.press("Control+d");
  await expect(page.locator(".hierarchy-select")).toHaveCount(2);
  await page.keyboard.press("Delete");
  await expect(page.locator(".hierarchy-select")).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".hierarchy-select")).toHaveCount(2);
  await page.locator(".canvas-host canvas").focus();
  await page.keyboard.press("F2");
  const rename = page.getByRole("dialog");
  await rename.getByLabel("Name", { exact: true }).fill("Renamed instance");
  await rename.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Renamed instance",
  );
  await page.keyboard.press("Control+z");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "wear sprite copy",
  );
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export scene", exact: true }).click();
  const download = await downloadEvent,
    data = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(data.schema_version).toBe(2);
  expect(data.entities).toHaveLength(2);
  expect(data.entities[0].id).toBe("actor-0");
  expect(data.entities[0].rotation).toBeCloseTo(30);
  for (const field of ["camera", "undo", "redo", "gesture", "selectedIds"])
    expect(data[field]).toBeUndefined();
});
test("asset drops use the same zoom and pan coordinate conversion as transforms", async ({
  page,
}) => {
  await start(page);
  const b = await page.locator(".canvas-host canvas").boundingBox();
  const initialZoom = await page.getByLabel("Viewport zoom").textContent();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2);
  await page.mouse.wheel(0, -200);
  await expect(page.getByLabel("Viewport zoom")).not.toHaveText(initialZoom!);
  // Native wheel deltas differ with Chrome's device scale. Measure the actual rendered
  // zoom from the known 80-unit gap between the selected pivot and scene center.
  const selectedPivot = await center(page, "Move freely");
  const z = (b!.x + b!.width / 2 - selectedPivot.x) / 80;
  await page.locator(".canvas-host canvas").focus();
  await page.keyboard.down("Space");
  await page.mouse.move(b!.x + 80, b!.y + 80);
  await page.mouse.down();
  await page.mouse.move(b!.x + 160, b!.y + 130, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Space");
  // A manual camera must retain its center when the Inspector changes canvas width.
  await page.getByRole("button", { name: "Inspector", exact: true }).click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const resizedCanvas = (await page
    .locator(".canvas-host canvas")
    .boundingBox())!;
  await page
    .locator(".asset-card")
    .dragTo(page.locator(".canvas-host canvas"), {
      targetPosition: {
        x: resizedCanvas.width / 2,
        y: resizedCanvas.height / 2,
      },
    });
  await page.getByRole("button", { name: "Inspector", exact: true }).click();
  await expect(page.locator(".hierarchy-select")).toHaveCount(2);
  expect(Math.abs((await numeric(page, "X")) - (480 - 80 / z))).toBeLessThan(1);
  expect(Math.abs((await numeric(page, "Y")) - (270 - 50 / z))).toBeLessThan(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".hierarchy-select")).toHaveCount(1);
  await expect(page.locator(".asset-card")).toHaveCount(1);
});
