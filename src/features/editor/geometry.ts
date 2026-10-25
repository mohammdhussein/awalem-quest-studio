import type { SceneEntity } from "../../data/scene";

export type Point = { x: number; y: number };
export type Bounds = Point & { width: number; height: number; ready?: boolean };
export type Camera = Point & { zoom: number };
export const scales = (e: SceneEntity) => ({
  x: e.scaleX ?? e.scale,
  y: e.scaleY ?? e.scale,
});
export const anchor = (e: SceneEntity) => e.anchor ?? { x: 0.5, y: 1 };
export const pivot = (e: SceneEntity) => e.pivot ?? { x: 0, y: 0 };
export const rotate = (p: Point, angle: number): Point => {
  const r = (angle / 180) * Math.PI,
    c = Math.cos(r),
    s = Math.sin(r);
  return { x: c * p.x - s * p.y, y: s * p.x + c * p.y };
};
export function localToWorld(e: SceneEntity, point: Point): Point {
  const s = scales(e),
    p = pivot(e),
    r = rotate(
      { x: (point.x - p.x) * s.x, y: (point.y - p.y) * s.y },
      e.rotation,
    );
  return { x: e.x + r.x, y: e.y + r.y };
}
export function worldToLocal(e: SceneEntity, point: Point): Point {
  const s = scales(e),
    p = pivot(e),
    r = rotate({ x: point.x - e.x, y: point.y - e.y }, -e.rotation);
  return { x: r.x / s.x + p.x, y: r.y / s.y + p.y };
}
export const screenToWorld = (p: Point, c: Camera): Point => ({
  x: (p.x - c.x) / c.zoom,
  y: (p.y - c.y) / c.zoom,
});
export const worldToScreen = (p: Point, c: Camera): Point => ({
  x: p.x * c.zoom + c.x,
  y: p.y * c.zoom + c.y,
});
export function zoomAt(c: Camera, p: Point, zoom: number): Camera {
  const z = Math.max(0.05, Math.min(8, zoom)),
    world = screenToWorld(p, c);
  return { zoom: z, x: p.x - world.x * z, y: p.y - world.y * z };
}
export function fitCamera(
  width: number,
  height: number,
  zoom?: number,
): Camera {
  const z =
    zoom ??
    Math.max(
      0.05,
      Math.min(
        8,
        Math.min(Math.max(1, width - 48) / 960, Math.max(1, height - 48) / 540),
      ),
    );
  return { zoom: z, x: (width - 960 * z) / 2, y: (height - 540 * z) / 2 };
}
export const snap = (value: number, step: number) =>
  Math.round(value / step) * step;
export const boundsCorners = (b: Bounds) => [
  { x: b.x, y: b.y },
  { x: b.x + b.width, y: b.y },
  { x: b.x + b.width, y: b.y + b.height },
  { x: b.x, y: b.y + b.height },
];
export const resizeHandles: Record<string, Point> = {
  nw: { x: 0, y: 0 },
  n: { x: 0.5, y: 0 },
  ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 },
  se: { x: 1, y: 1 },
  s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 },
  w: { x: 0, y: 0.5 },
};
export function resizeEntity(
  e: SceneEntity,
  b: Bounds,
  handle: string,
  pointer: Point,
  aspect: boolean,
): Partial<SceneEntity> {
  const h = resizeHandles[handle],
    s = scales(e),
    p = pivot(e);
  const fixed = { x: b.x + (1 - h.x) * b.width, y: b.y + (1 - h.y) * b.height },
    fixedWorld = localToWorld(e, fixed);
  const delta = { x: (2 * h.x - 1) * b.width, y: (2 * h.y - 1) * b.height };
  const current = rotate(
    { x: pointer.x - fixedWorld.x, y: pointer.y - fixedWorld.y },
    -e.rotation,
  );
  let x = h.x === 0.5 ? s.x : Math.max(0.001, current.x / delta.x),
    y = h.y === 0.5 ? s.y : Math.max(0.001, current.y / delta.y);
  if (aspect) {
    const vx = delta.x * s.x,
      vy = delta.y * s.y;
    const ratio = Math.max(
      0.001,
      (current.x * vx + current.y * vy) / (vx * vx + vy * vy),
    );
    x = s.x * ratio;
    y = s.y * ratio;
  }
  x = Math.min(10000, x);
  y = Math.min(10000, y);
  const offset = rotate(
    { x: (fixed.x - p.x) * x, y: (fixed.y - p.y) * y },
    e.rotation,
  );
  return {
    scaleX: x,
    scaleY: y,
    scale: x,
    x: fixedWorld.x - offset.x,
    y: fixedWorld.y - offset.y,
  };
}
export function compensateOrigin(
  e: SceneEntity,
  patch: Partial<SceneEntity>,
  b: Bounds,
): Partial<SceneEntity> {
  const oldP = pivot(e),
    nextP = patch.pivot ?? oldP,
    oldA = anchor(e),
    nextA = patch.anchor ?? oldA,
    s = scales(e);
  const dx =
    nextP.x - oldP.x + (e.shape === "image" ? (nextA.x - oldA.x) * b.width : 0);
  const dy =
    nextP.y -
    oldP.y +
    (e.shape === "image" ? (nextA.y - oldA.y) * b.height : 0);
  const delta = rotate({ x: dx * s.x, y: dy * s.y }, e.rotation);
  return { ...patch, x: e.x + delta.x, y: e.y + delta.y };
}
