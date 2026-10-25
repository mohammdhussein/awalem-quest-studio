import type { SceneEntity } from "../../data/scene";
export type BackgroundMode = "fit" | "fill" | "stretch" | "tile" | "custom";
export type BackgroundLayer = {
  id: string;
  name: string;
  placement: "background" | "foreground";
  assetKey: string;
  mode: BackgroundMode;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  tint: string;
  depth: number;
  visible: boolean;
  locked: boolean;
  parallaxX: number;
  parallaxY: number;
  scrollX: number;
  scrollY: number;
};
export type BackgroundConfiguration = {
  version: 1;
  showWorldArtwork: boolean;
  layers: BackgroundLayer[];
};
export const emptyBackground = (): BackgroundConfiguration => ({
  version: 1,
  showWorldArtwork: true,
  layers: [],
});
export function newLayer(
  assetKey: string,
  name: string,
  placement: BackgroundLayer["placement"],
  depth = 0,
): BackgroundLayer {
  return {
    id: crypto.randomUUID(),
    name,
    placement,
    assetKey,
    mode: "fill",
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
    tint: "#ffffff",
    depth,
    visible: true,
    locked: false,
    parallaxX: 1,
    parallaxY: 1,
    scrollX: 0,
    scrollY: 0,
  };
}
export function validateBackground(
  value: unknown,
): asserts value is BackgroundConfiguration {
  const b = value as BackgroundConfiguration;
  if (
    !b ||
    b.version !== 1 ||
    typeof b.showWorldArtwork !== "boolean" ||
    !Array.isArray(b.layers)
  )
    throw new Error("Unsupported background configuration.");
  const ids = new Set<string>();
  for (const l of b.layers) {
    if (
      !l ||
      typeof l.id !== "string" ||
      !l.id ||
      ids.has(l.id) ||
      typeof l.name !== "string" ||
      !l.name.trim() ||
      l.name.length > 160 ||
      /[\u0000-\u001f]/.test(l.name) ||
      !["background", "foreground"].includes(l.placement) ||
      typeof l.assetKey !== "string" ||
      !/^studio_worlds\/[^/]+\/volumes\/[^/]+\/assets\/[^/]+$/.test(
        l.assetKey,
      ) ||
      !["fit", "fill", "stretch", "tile", "custom"].includes(l.mode) ||
      ![
        "x",
        "y",
        "scaleX",
        "scaleY",
        "opacity",
        "depth",
        "parallaxX",
        "parallaxY",
        "scrollX",
        "scrollY",
      ].every(
        (k) =>
          typeof l[k as keyof BackgroundLayer] === "number" &&
          Number.isFinite(l[k as keyof BackgroundLayer]),
      ) ||
      l.scaleX <= 0 ||
      l.scaleY <= 0 ||
      l.scaleX > 10000 ||
      l.scaleY > 10000 ||
      l.opacity < 0 ||
      l.opacity > 1 ||
      typeof l.tint !== "string" ||
      !/^#[\da-f]{6}$/i.test(l.tint) ||
      typeof l.visible !== "boolean" ||
      typeof l.locked !== "boolean"
    )
      throw new Error("Invalid background layer. Source data was retained.");
    ids.add(l.id);
  }
}
/** An adapter lets custom layers reuse the established move/resize geometry and gestures. */
export function layerEntity(l: BackgroundLayer): SceneEntity {
  return {
    id: l.id,
    name: l.name,
    shape: "image",
    layer: l.placement,
    x: l.x,
    y: l.y,
    scale: l.scaleX,
    scaleX: l.scaleX,
    scaleY: l.scaleY,
    rotation: 0,
    depth: l.depth,
    opacity: l.opacity,
    color: l.tint,
    visible: l.visible,
    locked: l.locked,
    anchor: { x: 0, y: 0 },
  };
}
export function entityLayerPatch(
  p: Partial<SceneEntity>,
): Partial<BackgroundLayer> {
  const result: Partial<BackgroundLayer> = {};
  for (const k of [
    "name",
    "x",
    "y",
    "scaleX",
    "scaleY",
    "opacity",
    "depth",
    "visible",
    "locked",
  ] as const)
    if (p[k] !== undefined) Object.assign(result, { [k]: p[k] });
  if (p.color !== undefined) result.tint = p.color;
  return result;
}
