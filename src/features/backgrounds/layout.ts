import type { BackgroundLayer } from "./model";
export function layerLayout(l: BackgroundLayer, width: number, height: number) {
  const fit = Math.min(960 / width, 540 / height),
    fill = Math.max(960 / width, 540 / height);
  const sx =
    l.mode === "stretch"
      ? 960 / width
      : l.mode === "fit"
        ? fit
        : l.mode === "fill"
          ? fill
          : 1;
  const sy = l.mode === "stretch" ? 540 / height : sx;
  const scaleX = sx * l.scaleX,
    scaleY = sy * l.scaleY;
  return {
    x:
      l.x +
      (["fit", "fill", "stretch"].includes(l.mode)
        ? (960 - width * scaleX) / 2
        : 0),
    y:
      l.y +
      (["fit", "fill", "stretch"].includes(l.mode)
        ? (540 - height * scaleY) / 2
        : 0),
    scaleX,
    scaleY,
  };
}
export function parallaxOffset(
  l: BackgroundLayer,
  center: { x: number; y: number },
  seconds: number,
) {
  return {
    x: (center.x - 480) * (1 - l.parallaxX) + l.scrollX * seconds,
    y: (center.y - 270) * (1 - l.parallaxY) + l.scrollY * seconds,
  };
}
