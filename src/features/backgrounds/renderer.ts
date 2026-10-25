import {
  Container,
  Graphics,
  Sprite,
  TilingSprite,
  type Texture,
} from "pixi.js";
import type { BackgroundConfiguration } from "./model";
import { layerLayout, parallaxOffset } from "./layout";
import { acquireTexture, releaseTexture } from "../editor/textures";
import type { Camera } from "../editor/geometry";
type Entry = {
  node: Container;
  content: Sprite | TilingSprite | Graphics;
  signature: string;
  width: number;
  height: number;
  ready: boolean;
};
/** Authored transforms remain untouched; preview motion is applied only to Pixi nodes. */
export class BackgroundRenderer {
  private nodes = new Map<string, Entry>();
  private urls = new Set<string>();
  private textures = new Map<string, Texture>();
  private failed = new Set<string>();
  private disposed = false;
  private missing = 0;
  constructor(
    private back: Container,
    private front: Container,
    private changed: () => void,
  ) {
    for (const group of [back, front]) {
      group.eventMode = "none";
      group.sortableChildren = true;
      const mask = new Graphics().rect(0, 0, 960, 540).fill(0xffffff);
      group.addChild(mask);
      group.mask = mask;
    }
  }
  sync(
    b: BackgroundConfiguration,
    resolve: (key: string) => string | undefined,
  ) {
    const wanted = new Set(
      b.layers.map((l) => resolve(l.assetKey)).filter((u): u is string => !!u),
    );
    for (const url of this.urls)
      if (!wanted.has(url)) {
        releaseTexture(url);
        this.urls.delete(url);
        this.textures.delete(url);
        this.failed.delete(url);
      }
    for (const url of wanted)
      if (!this.urls.has(url)) {
        this.urls.add(url);
        void acquireTexture(url)
          .then((texture) => {
            if (!this.disposed && this.urls.has(url)) {
              this.textures.set(url, texture);
              this.changed();
            }
          })
          .catch(() => {
            if (!this.disposed && this.urls.has(url)) {
              this.failed.add(url);
              this.changed();
            }
          });
      }
    const ids = new Set(b.layers.map((l) => l.id));
    for (const [id, entry] of this.nodes)
      if (!ids.has(id)) {
        entry.node.destroy({ children: true });
        this.nodes.delete(id);
      }
    this.missing = 0;
    for (const l of b.layers) {
      const url = resolve(l.assetKey),
        texture = url && this.textures.get(url),
        signature = `${url}|${!!texture}|${l.mode === "tile"}`;
      if (!url) this.missing++;
      let entry = this.nodes.get(l.id);
      if (!entry) {
        entry = {
          node: new Container(),
          content: new Graphics(),
          signature: "",
          width: 960,
          height: 540,
          ready: false,
        };
        this.nodes.set(l.id, entry);
        entry.node.label = `background:${l.id}`;
      }
      if (entry.signature !== signature) {
        entry.content.destroy();
        entry.content = texture
          ? l.mode === "tile"
            ? new TilingSprite({ texture, width: 960, height: 540 })
            : new Sprite(texture)
          : new Graphics()
              .rect(0, 0, 960, 540)
              .fill(0x234d67)
              .stroke({ color: 0xffb2b4, width: 2 });
        entry.node.addChild(entry.content);
        entry.signature = signature;
        entry.width = texture ? texture.width : 960;
        entry.height = texture ? texture.height : 540;
        entry.ready = !!texture;
      }
      const parent = l.placement === "background" ? this.back : this.front;
      if (entry.node.parent !== parent) parent.addChild(entry.node);
      entry.node.visible = l.visible;
      entry.node.alpha = l.opacity;
      entry.content.tint = parseInt(l.tint.slice(1), 16);
    }
    for (const group of ["background", "foreground"] as const)
      b.layers
        .filter((l) => l.placement === group)
        .sort((a, b) => a.depth - b.depth)
        .forEach((l, i) => {
          this.nodes.get(l.id)!.node.zIndex = i;
        });
  }
  draw(
    b: BackgroundConfiguration,
    camera: Camera,
    width: number,
    height: number,
    seconds: number | null,
  ) {
    const center = {
      x: (width / 2 - camera.x) / camera.zoom,
      y: (height / 2 - camera.y) / camera.zoom,
    };
    for (const l of b.layers) {
      const entry = this.nodes.get(l.id);
      if (!entry) continue;
      const layout = layerLayout(l, entry.width, entry.height),
        motion =
          seconds === null
            ? { x: 0, y: 0 }
            : parallaxOffset(l, center, seconds);
      if (entry.content instanceof TilingSprite) {
        entry.node.position.set(0, 0);
        entry.node.scale.set(1);
        entry.content.tileScale.set(layout.scaleX, layout.scaleY);
        entry.content.tilePosition.set(
          layout.x + motion.x,
          layout.y + motion.y,
        );
      } else {
        entry.node.position.set(layout.x + motion.x, layout.y + motion.y);
        entry.node.scale.set(layout.scaleX, layout.scaleY);
      }
    }
  }
  bounds(id: string) {
    const e = this.nodes.get(id);
    return (
      e && { x: 0, y: 0, width: e.width, height: e.height, ready: e.ready }
    );
  }
  error() {
    return this.missing
      ? `${this.missing} background asset(s) missing or in Trash. Replace image to relink.`
      : this.failed.size
        ? `${this.failed.size} background image(s) could not load. Check source access, Storage CORS, and connectivity, then retry.`
        : "";
  }
  retry() {
    for (const url of this.failed) {
      releaseTexture(url);
      this.urls.delete(url);
    }
    this.failed.clear();
  }
  dispose() {
    this.disposed = true;
    for (const url of this.urls) releaseTexture(url);
    this.urls.clear();
    this.nodes.clear();
  }
}
