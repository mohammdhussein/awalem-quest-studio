import { useEffect, useRef } from 'react';
import { Application, Assets, Container, Graphics, Rectangle, Sprite, type FederatedPointerEvent, type Texture } from 'pixi.js';
import type { SceneDocument, SceneEntity } from '../data/scene';

type Props = { scene: SceneDocument; selectedId: string | null; onSelect: (id: string | null) => void; onMove: (id: string, x: number, y: number) => void };
const palettes: Record<string, number[]> = {
  sea_wonders: [0x153c70, 0x28779a, 0x146782, 0x164f70, 0x67c5bb],
  jungle_kingdom: [0x244b58, 0x317761, 0x205f52, 0x214e47, 0x91c078],
  birds_of_the_sky: [0x4d779c, 0x729cb6, 0x4c829b, 0x345a75, 0xd9d9a9],
  desert_kingdom: [0x916e75, 0xd7a77a, 0xb87961, 0x895c51, 0xe4c28b],
  polar_explorers: [0x426887, 0x94b8cf, 0x5b91aa, 0x36738b, 0xe3f8fa]
};
function paintBackground(base: Graphics, scenery: Graphics, foreground: Graphics, world: string) {
  const p = palettes[world] ?? palettes.sea_wonders;
  base.rect(0, 0, 960, 540).fill(p[0]);
  base.circle(740, 115, 65).fill({ color: 0xffffff, alpha: .09 });
  scenery.poly([0, 280, 170, 180, 355, 270, 535, 170, 755, 260, 960, 175, 960, 540, 0, 540]).fill(p[1]);
  scenery.poly([0, 365, 210, 265, 415, 340, 600, 270, 810, 340, 960, 300, 960, 540, 0, 540]).fill(p[2]);
  scenery.poly([0, 458, 170, 432, 340, 458, 545, 418, 725, 453, 960, 424, 960, 540, 0, 540]).fill(p[3]);
  for (let i = 0; i < 10; i++) {
    const x = 28 + i * 105;
    if (world === 'sea_wonders') scenery.circle(x, 100 + i % 3 * 70, 5).stroke({ color: 0xc8f1ff, width: 2, alpha: .25 });
    else if (world === 'polar_explorers') scenery.poly([x, 430, x + 14, 375, x + 35, 430]).fill({ color: 0xeaf8ff, alpha: .25 });
    else scenery.ellipse(x, 380 + i % 3 * 25, 25, 10).fill({ color: p[4], alpha: .13 });
  }
  foreground.rect(0, 514, 960, 26).fill({ color: p[4], alpha: .12 });
  foreground.ellipse(150, 522, 130, 24).fill({ color: p[4], alpha: .14 });
}
function makeGraphic(item: SceneEntity): Graphics {
  const g = new Graphics(); const color = parseInt(item.color.slice(1), 16) || 0xffffff;
  switch (item.shape) {
    case 'fish':
      g.ellipse(0, -45, 59, 32).fill(color);
      g.poly([-44, -45, -97, -79, -97, -14]).fill(color);
      g.ellipse(19, -54, 14, 8).fill({ color: 0xffffff, alpha: .3 });
      g.circle(29, -52, 5).fill(0x183347); break;
    case 'bird':
      g.ellipse(0, -50, 48, 30).fill(color);
      g.ellipse(-12, -58, 29, 13).fill({ color: 0xffffff, alpha: .2 });
      g.poly([33, -57, 67, -45, 33, -37]).fill(0xf9ba6c);
      g.circle(21, -60, 5).fill(0x25354b); break;
    case 'rock':
      g.poly([-75, 0, -56, -61, -14, -91, 45, -63, 72, 0]).fill(color);
      g.poly([-56, -61, -14, -91, 0, -31, -75, 0]).fill({ color: 0xffffff, alpha: .15 }); break;
    case 'plant':
      g.roundRect(-8, -116, 17, 118, 7).fill(0x477a67);
      g.ellipse(-29, -76, 42, 19).fill(color);
      g.ellipse(33, -102, 36, 16).fill(color);
      g.ellipse(-24, -43, 37, 16).fill({ color, alpha: .75 }); break;
    case 'coral':
      g.roundRect(-13, -108, 25, 110, 11).fill(color);
      g.roundRect(-44, -85, 22, 71, 11).fill(color);
      g.roundRect(26, -70, 20, 65, 10).fill(color);
      g.ellipse(0, 0, 64, 17).fill({ color, alpha: .55 }); break;
    case 'crystal':
      g.poly([-35, 0, -55, -47, -8, -123, 34, -45, 44, 0]).fill(color);
      g.poly([-8, -123, 6, -39, -35, 0, -55, -47]).fill({ color: 0xffffff, alpha: .22 }); break;
    case 'hotspot':
      g.circle(0, -42, 35).fill({ color, alpha: .19 });
      g.circle(0, -42, 32).stroke({ color, width: 3 });
      g.circle(0, -42, 9).fill(color); break;
    case 'image':
      g.roundRect(-55, -105, 110, 105, 12).fill(0x234d67);
      g.roundRect(-55, -105, 110, 105, 12).stroke({ color, width: 2 }); break;
  }
  return g;
}

export default function SceneViewport({ scene, selectedId, onSelect, onMove }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<Container | null>(null);
  const elements = useRef<Container | null>(null);
  const decor = useRef<Graphics[]>([]);
  const textures = useRef<Map<string, Texture>>(new Map());
  const loading = useRef(new Set<string>());
  const latest = useRef({ onSelect, onMove });
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const redraw = useRef<() => void>(() => {});
  useEffect(() => { latest.current = { onSelect, onMove }; }, [onSelect, onMove]);

  useEffect(() => {
    const element = host.current; if (!element) return;
    let disposed = false; let observer: ResizeObserver | undefined;
    const app = new Application();
    void app.init({ resizeTo: element, backgroundColor: 0x101e2b, antialias: true }).then(() => {
      if (disposed) { app.destroy(true, { children: true }); return; }
      element.appendChild(app.canvas);
      const stage = new Container();
      stage.sortableChildren = true; stage.eventMode = 'static'; stage.hitArea = new Rectangle(0, 0, 960, 540);
      app.stage.addChild(stage); view.current = stage;
      const bg = new Graphics(); const far = new Graphics(); const objects = new Container(); const front = new Graphics();
      bg.zIndex = -1000; far.zIndex = -500; objects.zIndex = 0; front.zIndex = 500;
      objects.sortableChildren = true;
      stage.addChild(bg, far, objects, front);
      decor.current = [bg, far, front]; elements.current = objects;
      function fit() {
        const scale = Math.min(app.screen.width / 960, app.screen.height / 540);
        stage.scale.set(scale); stage.position.set((app.screen.width - 960 * scale) / 2, (app.screen.height - 540 * scale) / 2);
      }
      fit(); observer = new ResizeObserver(fit); observer.observe(element);
      stage.on('pointerdown', event => { if (event.target === stage) latest.current.onSelect(null); });
      stage.on('pointermove', (event: FederatedPointerEvent) => {
        const point = stage.toLocal(event.global);
        if (drag.current) {
          const { id, dx, dy } = drag.current;
          latest.current.onMove(id, Math.round(Math.max(0, Math.min(960, point.x + dx))), Math.round(Math.max(0, Math.min(540, point.y + dy))));
        } else far.x = (480 - point.x) * .012;
      });
      stage.on('pointerup', () => { drag.current = null; });
      stage.on('pointerupoutside', () => { drag.current = null; });
      redraw.current();
    }).catch(console.error);
    return () => { disposed = true; observer?.disconnect(); view.current = null; elements.current = null; if (app.renderer) app.destroy(true, { children: true }); };
  }, []);

  useEffect(() => {
    const render = () => {
      const stage = view.current; const layer = elements.current;
      if (!stage || !layer) return;
      decor.current.forEach(g => g.clear());
      paintBackground(decor.current[0], decor.current[1], decor.current[2], scene.world_id);
      layer.removeChildren().forEach(child => child.destroy({ children: true }));
      const order = { background: -1, playfield: 0, foreground: 1 };
      for (const entry of scene.entities) {
        const node = new Container(); node.position.set(entry.x, entry.y);
        node.rotation = entry.rotation * Math.PI / 180; node.scale.set(entry.scale);
        node.zIndex = order[entry.layer] * 1000 + entry.y + entry.depth;
        const texture = entry.assetUrl && textures.current.get(entry.assetUrl);
        if (entry.shape === 'image' && texture) {
          const sprite = new Sprite(texture); sprite.anchor.set(.5, 1);
          sprite.scale.set(Math.min(160 / Math.max(texture.width, 1), 140 / Math.max(texture.height, 1)));
          node.addChild(sprite);
        } else node.addChild(makeGraphic(entry));
        if (entry.id === selectedId) {
          const outline = new Graphics();
          outline.roundRect(-110, -142, 220, 154, 8).stroke({ color: 0xffd478, width: 2 });
          outline.circle(0, 0, 5).fill(0xffd478); node.addChild(outline);
        }
        node.eventMode = 'static'; node.cursor = 'grab'; node.hitArea = new Rectangle(-115, -147, 230, 160);
        node.on('pointerdown', (event: FederatedPointerEvent) => {
          event.stopPropagation(); const point = stage.toLocal(event.global);
          drag.current = { id: entry.id, dx: entry.x - point.x, dy: entry.y - point.y };
          latest.current.onSelect(entry.id);
        });
        layer.addChild(node);
      }
      for (const item of scene.entities) {
        const url = item.assetUrl;
        if (!url || textures.current.has(url) || loading.current.has(url)) continue;
        loading.current.add(url);
        void Assets.load<Texture>(url).then(texture => { textures.current.set(url, texture); redraw.current(); })
          .catch(error => console.warn('Sprite texture could not load', error));
      }
    };
    redraw.current = render; render();
  }, [scene, selectedId]);
  return <div ref={host} className="canvas-host" role="application" aria-label="2.5D scene editor canvas" />;
}
