import { Graphics } from "pixi.js";
import type { SceneEntity } from "../../data/scene";
const palettes: Record<string, number[]> = {
  sea_wonders: [0x153c70, 0x28779a, 0x146782, 0x164f70, 0x67c5bb],
  jungle_kingdom: [0x244b58, 0x317761, 0x205f52, 0x214e47, 0x91c078],
  birds_of_the_sky: [0x4d779c, 0x729cb6, 0x4c829b, 0x345a75, 0xd9d9a9],
  desert_kingdom: [0x916e75, 0xd7a77a, 0xb87961, 0x895c51, 0xe4c28b],
  polar_explorers: [0x426887, 0x94b8cf, 0x5b91aa, 0x36738b, 0xe3f8fa],
};
export function paintBackground(
  base: Graphics,
  scenery: Graphics,
  foreground: Graphics,
  world: string,
) {
  const p = palettes[world] ?? palettes.sea_wonders;
  base.rect(0, 0, 960, 540).fill(p[0]);
  base.circle(740, 115, 65).fill({ color: 0xffffff, alpha: 0.09 });
  scenery
    .poly([
      0, 280, 170, 180, 355, 270, 535, 170, 755, 260, 960, 175, 960, 540, 0,
      540,
    ])
    .fill(p[1]);
  scenery
    .poly([
      0, 365, 210, 265, 415, 340, 600, 270, 810, 340, 960, 300, 960, 540, 0,
      540,
    ])
    .fill(p[2]);
  scenery
    .poly([
      0, 458, 170, 432, 340, 458, 545, 418, 725, 453, 960, 424, 960, 540, 0,
      540,
    ])
    .fill(p[3]);
  for (let i = 0; i < 10; i++) {
    const x = 28 + i * 105;
    if (world === "sea_wonders")
      scenery
        .circle(x, 100 + (i % 3) * 70, 5)
        .stroke({ color: 0xc8f1ff, width: 2, alpha: 0.25 });
    else if (world === "polar_explorers")
      scenery
        .poly([x, 430, x + 14, 375, x + 35, 430])
        .fill({ color: 0xeaf8ff, alpha: 0.25 });
    else
      scenery
        .ellipse(x, 380 + (i % 3) * 25, 25, 10)
        .fill({ color: p[4], alpha: 0.13 });
  }
  foreground.rect(0, 514, 960, 26).fill({ color: p[4], alpha: 0.12 });
  foreground.ellipse(150, 522, 130, 24).fill({ color: p[4], alpha: 0.14 });
}
export function makeGraphic(item: SceneEntity): Graphics {
  const g = new Graphics();
  const color = parseInt(item.color.slice(1), 16);
  switch (item.shape) {
    case "fish":
      g.ellipse(0, -45, 59, 32).fill(color);
      g.poly([-44, -45, -97, -79, -97, -14]).fill(color);
      g.ellipse(19, -54, 14, 8).fill({ color: 0xffffff, alpha: 0.3 });
      g.circle(29, -52, 5).fill(0x183347);
      break;
    case "bird":
      g.ellipse(0, -50, 48, 30).fill(color);
      g.ellipse(-12, -58, 29, 13).fill({ color: 0xffffff, alpha: 0.2 });
      g.poly([33, -57, 67, -45, 33, -37]).fill(0xf9ba6c);
      g.circle(21, -60, 5).fill(0x25354b);
      break;
    case "rock":
      g.poly([-75, 0, -56, -61, -14, -91, 45, -63, 72, 0]).fill(color);
      g.poly([-56, -61, -14, -91, 0, -31, -75, 0]).fill({
        color: 0xffffff,
        alpha: 0.15,
      });
      break;
    case "plant":
      g.roundRect(-8, -116, 17, 118, 7).fill(0x477a67);
      g.ellipse(-29, -76, 42, 19).fill(color);
      g.ellipse(33, -102, 36, 16).fill(color);
      g.ellipse(-24, -43, 37, 16).fill({ color, alpha: 0.75 });
      break;
    case "coral":
      g.roundRect(-13, -108, 25, 110, 11).fill(color);
      g.roundRect(-44, -85, 22, 71, 11).fill(color);
      g.roundRect(26, -70, 20, 65, 10).fill(color);
      g.ellipse(0, 0, 64, 17).fill({ color, alpha: 0.55 });
      break;
    case "crystal":
      g.poly([-35, 0, -55, -47, -8, -123, 34, -45, 44, 0]).fill(color);
      g.poly([-8, -123, 6, -39, -35, 0, -55, -47]).fill({
        color: 0xffffff,
        alpha: 0.22,
      });
      break;
    case "hotspot":
      g.circle(0, -42, 35).fill({ color, alpha: 0.19 });
      g.circle(0, -42, 32).stroke({ color, width: 3 });
      g.circle(0, -42, 9).fill(color);
      break;
    case "image":
      g.roundRect(-55, -105, 110, 105, 12).fill(0x234d67);
      g.roundRect(-55, -105, 110, 105, 12).stroke({ color, width: 2 });
      break;
  }
  return g;
}
