import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { deflateSync } from "node:zlib";
import { readFile } from "node:fs/promises";

function chunk(type: string, data: Buffer) {
  const name = Buffer.from(type),
    len = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  let n = 0xffffffff;
  for (const b of Buffer.concat([name, data])) {
    n ^= b;
    for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  }
  crc.writeUInt32BE((n ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, name, data, crc]);
}
function image() {
  const width = 160,
    height = 80,
    head = Buffer.alloc(13);
  head.writeUInt32BE(width);
  head.writeUInt32BE(height, 4);
  head[8] = 8;
  head[9] = 6;
  const rows = Buffer.alloc((1 + width * 4) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * (1 + width * 4) + 1 + x * 4;
      rows.set(x < 80 ? [20, 160, 210, 255] : [240, 190, 40, 255], i);
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
let server: Server,
  origin: string,
  cors = true;
test.beforeAll(async () => {
  const bytes = image();
  server = createServer((request, response) => {
    if (cors)
      response.setHeader(
        "Access-Control-Allow-Origin",
        "http://127.0.0.1:5178",
      );
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "image/png");
    response.end(bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture server unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
test.beforeEach(() => {
  cors = true;
});
async function start(page: Page) {
  await page.addInitScript(
    ({ origin }) => {
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
              id: "source-image",
              name: "Underwater texture",
              shape: "image",
              layer: "playfield",
              x: 400,
              y: 300,
              scale: 1,
              rotation: 0,
              depth: 0,
              color: "#ffffff",
              assetUrl: origin + "/reef.png",
              interaction: { type: "none" },
            },
            {
              id: "character",
              name: "Existing character",
              shape: "fish",
              layer: "playfield",
              x: 700,
              y: 400,
              scale: 1,
              rotation: 17,
              depth: 5,
              color: "#fa718a",
              interaction: { type: "show_fact", target: "preserved" },
            },
          ],
        }),
      );
    },
    { origin },
  );
  await page.goto("/");
  await expect(page.locator(".canvas-host canvas")).toBeVisible();
  await page.getByRole("button", { name: "Grid", exact: true }).click();
}
async function edit(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.press("Enter");
}
async function exported(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export scene", exact: true }).click();
  const download = await waiting;
  return JSON.parse(await readFile((await download.path())!, "utf8"));
}
async function setBackground(page: Page) {
  await page
    .getByRole("button", { name: "Set background", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Use image", exact: true })
    .click();
  await expect(page.getByLabel("Image mode")).toBeVisible();
}
async function pixel(page: Page, x: number, y: number) {
  const canvas = page.locator(".canvas-host canvas"),
    box = (await canvas.boundingBox())!;
  const zoom = Math.min((box.width - 48) / 960, (box.height - 48) / 540);
  const sx = (box.width - 960 * zoom) / 2 + x * zoom,
    sy = (box.height - 540 * zoom) / 2 + y * zoom;
  const png = await canvas.screenshot();
  return page.evaluate(
    async ({ base64, x, y, width, height }) => {
      const img = new Image();
      img.src = "data:image/png;base64," + base64;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(img, 0, 0);
      return [
        ...context.getImageData(
          Math.floor((x * img.width) / width),
          Math.floor((y * img.height) / height),
          1,
          1,
        ).data,
      ].slice(0, 3);
    },
    {
      base64: png.toString("base64"),
      x: sx,
      y: sy,
      width: box.width,
      height: box.height,
    },
  );
}

test("real cross-origin images render as thumbnails but require CORS in Pixi, then Retry recovers", async ({
  page,
}) => {
  cors = false;
  await start(page);
  await setBackground(page);
  await expect
    .poll(() =>
      page
        .locator(".asset-preview img")
        .first()
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(160);
  await expect(page.locator(".canvas-error")).toContainText("CORS");
  expect(await pixel(page, 50, 50)).not.toEqual([20, 160, 210]);
  cors = true;
  await page.getByRole("button", { name: "Retry images", exact: true }).click();
  await expect(page.locator(".canvas-error")).toHaveCount(0);
  await expect.poll(() => pixel(page, 50, 50)).toEqual([20, 160, 210]);
  expect((await exported(page)).background.layers).toHaveLength(1);
});

test("Mission 1 backgrounds, multiple layers, parallax, custom handles, history and refresh preserve objects", async ({
  page,
}, info) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await start(page);
  const before = (await exported(page)).entities;
  await page.getByRole("button", { name: "Set up / open Mission 1" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Set up and open", exact: true })
    .click();
  await setBackground(page);
  await expect.poll(() => pixel(page, 50, 50)).toEqual([20, 160, 210]);
  await page.getByLabel("Image mode").selectOption("tile");
  await edit(page, "Camera factor X", ".3");
  await edit(page, "Scroll X (px/s)", "60");
  await edit(page, "Layer tint", "#80ffff");
  const first = (await exported(page)).background.layers[0];
  await page.getByRole("button", { name: "+ Foreground", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Use image", exact: true })
    .click();
  await page.getByLabel("Image mode").selectOption("custom");
  await edit(page, "Offset X", "100");
  await edit(page, "Offset Y", "100");
  await edit(page, "Layer opacity", ".5");
  await expect(
    page.getByRole("button", { name: "Move freely", exact: true }),
  ).toBeVisible();
  const handle = page.getByRole("button", { name: "Move freely", exact: true });
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 50, h.y + 35, { steps: 8 });
  await page.mouse.up();
  expect(
    Number(await page.getByLabel("Offset X").inputValue()),
  ).toBeGreaterThan(100);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Offset X")).toHaveValue("100");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  const movedX = await page.getByLabel("Offset X").inputValue();
  await page.keyboard.press("r");
  const se = (await page
    .getByRole("button", { name: "Scale SE", exact: true })
    .boundingBox())!;
  await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
  await page.mouse.down();
  await page.mouse.move(se.x + 35, se.y + 20, { steps: 8 });
  await page.mouse.up();
  expect(
    Number(await page.getByLabel("Layer scale X").inputValue()),
  ).toBeGreaterThan(1);
  await expect(page.getByLabel("Offset X")).toHaveValue(movedX);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Layer scale X")).toHaveValue("1");
  await page
    .getByRole("button", { name: "Duplicate layer", exact: true })
    .click();
  await expect(page.locator(".background-scroll [role=listitem]")).toHaveCount(
    3,
  );
  await page.getByRole("button", { name: "Layer down", exact: true }).click();
  await page.getByRole("button", { name: "Delete layer", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const authored = await exported(page);
  await page
    .getByRole("button", { name: "Play parallax", exact: true })
    .click();
  await page.waitForTimeout(150);
  expect((await exported(page)).background).toEqual(authored.background);
  await expect(page.getByLabel("Offset X")).toBeDisabled();
  await page
    .getByRole("button", { name: "Pause preview", exact: true })
    .click();
  await page.getByRole("button", { name: "Stop / Reset", exact: true }).click();
  expect((await exported(page)).entities).toEqual(before);
  await expect(page.getByText(/Draft saved locally/)).toBeVisible();
  await page.reload();
  await expect(page.locator(".canvas-host canvas")).toBeVisible();
  const restored = await exported(page);
  expect(restored.background).toEqual(authored.background);
  expect(restored.entities).toEqual(before);
  expect(restored.background.layers[0]).toMatchObject({
    id: first.id,
    scrollX: 60,
    parallaxX: 0.3,
  });
  await page.screenshot({ path: info.outputPath("background-editor.png") });
  expect(errors).toEqual([]);
});

test("reuses a source asset in another volume while keeping scene backgrounds independent", async ({
  page,
}) => {
  await start(page);
  await setBackground(page);
  const original = await exported(page);
  await page
    .getByRole("button", { name: "Expand Volume 2", exact: true })
    .click();
  const mainScenes = page.getByRole("treeitem", {
    name: "Main Scene",
    exact: true,
  });
  await mainScenes.last().click();
  await page
    .getByRole("button", { name: "Set background", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Use image", exact: true })
    .click();
  const other = await exported(page);
  expect(other.volume_id).toBe("volume_02");
  expect(other.background.layers[0].assetKey).toBe(
    original.background.layers[0].assetKey,
  );
  await edit(page, "Layer opacity", ".25");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Layer opacity")).toHaveValue("1");
  await page
    .getByRole("treeitem", { name: "Main Scene", exact: true })
    .first()
    .click();
  expect((await exported(page)).background).toEqual(original.background);
});
