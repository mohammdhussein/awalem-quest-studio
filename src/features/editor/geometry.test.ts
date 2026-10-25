import { describe, expect, it } from "vitest";
import {
  compensateOrigin,
  fitCamera,
  localToWorld,
  resizeEntity,
  scales,
  screenToWorld,
  worldToLocal,
  worldToScreen,
  zoomAt,
} from "./geometry";
import { makeScene } from "../../data/scene";
const entity = () => ({
  ...makeScene("sea_wonders", "volume_01").entities[0],
  shape: "image" as const,
  x: 400,
  y: 300,
});
describe("scene coordinates and transforms", () => {
  it("inverts camera transforms and preserves the scene point under wheel zoom", () => {
    const camera = { zoom: 2.5, x: -180, y: 75 },
      p = { x: 220, y: -44 };
    expect(screenToWorld(worldToScreen(p, camera), camera)).toEqual(p);
    const screen = { x: 333, y: 125 },
      next = zoomAt(camera, screen, 4);
    expect(screenToWorld(screen, next)).toEqual(screenToWorld(screen, camera));
    expect(fitCamera(1008, 588)).toEqual({ zoom: 1, x: 24, y: 24 });
  });
  it("inverts rotation, nonuniform scales, and pivot offsets", () => {
    const e = {
        ...entity(),
        rotation: 37,
        scaleX: 2,
        scaleY: 0.5,
        pivot: { x: 12, y: -8 },
      },
      p = { x: -30, y: 70 };
    const restored = worldToLocal(e, localToWorld(e, p));
    expect(restored.x).toBeCloseTo(p.x);
    expect(restored.y).toBeCloseTo(p.y);
    expect(scales({ ...e, scaleX: undefined, scaleY: undefined })).toEqual({
      x: 1,
      y: 1,
    });
  });
  it("resizes around the opposite corner under rotation and a custom pivot", () => {
    const e = { ...entity(), rotation: 43, pivot: { x: 10, y: -10 } },
      bounds = { x: -70, y: -140, width: 140, height: 140 };
    const fixed = localToWorld(e, { x: -70, y: -140 }),
      current = localToWorld(e, { x: 140, y: 70 });
    const patch = resizeEntity(e, bounds, "se", current, true),
      resized = { ...e, ...patch };
    const after = localToWorld(resized, { x: -70, y: -140 });
    expect(after.x).toBeCloseTo(fixed.x);
    expect(after.y).toBeCloseTo(fixed.y);
    expect(patch.scaleX).toBeCloseTo(1.5);
    expect(patch.scaleY).toBeCloseTo(1.5);
  });
  it("supports independent axes and never creates zero or negative scales", () => {
    const e = entity(),
      b = { x: -70, y: -140, width: 140, height: 140 };
    const patch = resizeEntity(
      e,
      b,
      "e",
      localToWorld(e, { x: 210, y: -70 }),
      false,
    );
    expect(patch.scaleX).toBeCloseTo(2);
    expect(patch.scaleY).toBe(1);
    const flipped = resizeEntity(
      e,
      b,
      "e",
      localToWorld(e, { x: -200, y: -70 }),
      false,
    );
    expect(flipped.scaleX).toBeGreaterThan(0);
  });
  it("compensates pivot and anchor changes without shifting the rendered image", () => {
    const e = { ...entity(), rotation: 30, scaleX: 2, scaleY: 0.5 },
      b = { x: -70, y: -140, width: 140, height: 140 };
    const before = localToWorld(e, { x: -70, y: -140 });
    const changed = {
      ...e,
      ...compensateOrigin(
        e,
        { anchor: { x: 0, y: 0 }, pivot: { x: 25, y: 10 } },
        b,
      ),
    };
    const after = localToWorld(changed, { x: 0, y: 0 });
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
});
