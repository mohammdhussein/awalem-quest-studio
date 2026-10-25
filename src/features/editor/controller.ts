import {
  Application,
  Container,
  Graphics,
  Point,
  Rectangle,
  Sprite,
  type Texture,
} from "pixi.js";
import type { SceneDocument, SceneEntity } from "../../data/scene";
import { makeGraphic, paintBackground } from "./art";
import { acquireTexture, releaseTexture } from "./textures";
import { BackgroundRenderer } from "../backgrounds/renderer";
import { resizeCamera, type CameraMode } from "./geometry";
import { layerEntity } from "../backgrounds/model";
import { entityImageUrl, resolveAsset } from "../assets/catalog";
import { useProject } from "../project/store";
import {
  anchor,
  boundsCorners,
  fitCamera,
  localToWorld,
  pivot,
  resizeEntity,
  resizeHandles,
  scales,
  screenToWorld,
  snap,
  worldToScreen,
  zoomAt,
  type Bounds,
  type Camera,
  type Point as XY,
} from "./geometry";
import {
  beginGesture,
  beginLayerGesture,
  effectiveBackground,
  cancelGesture,
  finishGesture,
  previewGesture,
  session,
  setBounds,
  setCamera,
  useEditor,
} from "./store";

export type Handle = XY & { kind: string; label: string };
export type Overlay = { handles: Handle[]; error: string };
type RenderNode = {
  node: Container;
  content: Container;
  signature: string;
  bounds: Bounds;
  anchorKey: string;
};
type Drag = {
  pointer: number;
  kind: string;
  start: XY;
  beforeCamera: Camera;
  entity?: SceneEntity;
  bounds?: Bounds;
  bias?: XY;
  lastAngle: number;
  angle: number;
  moved?: boolean;
};
export class SceneController {
  readonly app = new Application();
  private sceneRoot = new Container();
  private layers = {
    background: new Container(),
    playfield: new Container(),
    foreground: new Container(),
  };
  private decor = [new Graphics(), new Graphics(), new Graphics()];
  private backImages = new Container();
  private frontImages = new Container();
  private backgrounds?: BackgroundRenderer;
  private grid = new Graphics();
  private overlay = new Graphics();
  private nodes = new Map<string, RenderNode>();
  private urls = new Set<string>();
  private textures = new Map<string, Texture>();
  private errors = new Set<string>();
  private observer?: ResizeObserver;
  private disposed = false;
  private mounted = false;
  private scene?: SceneDocument;
  private key = "";
  private selected: string | null = null;
  private camera: Camera = { zoom: 1, x: 0, y: 0 };
  private lastViewRequest = -1;
  private drag: Drag | null = null;
  private space = false;
  private frame = 0;
  private pending: XY | null = null;
  private handles: Handle[] = [];
  constructor(
    private host: HTMLDivElement,
    private onSelect: (id: string | null) => void,
    private onOverlay: (overlay: Overlay) => void,
  ) {}
  async mount() {
    try {
      await this.app.init({
        resizeTo: this.host,
        backgroundColor: 0x091423,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      });
      if (this.disposed) {
        this.app.destroy(true, { children: true });
        return;
      }
      this.host.prepend(this.app.canvas);
      this.app.canvas.tabIndex = 0;
      this.app.canvas.setAttribute("aria-label", "Scene canvas");
      this.app.stage.eventMode = "static";
      const [base, far, front] = this.decor;
      this.sceneRoot.addChild(
        base,
        far,
        this.backImages,
        this.layers.background,
        this.layers.playfield,
        this.layers.foreground,
        front,
        this.frontImages,
      );
      this.backgrounds = new BackgroundRenderer(
        this.backImages,
        this.frontImages,
        () => this.sync(),
      );
      this.app.ticker.add(this.previewFrame);
      this.app.stage.addChild(this.sceneRoot, this.grid, this.overlay);
      for (const layer of Object.values(this.layers)) {
        layer.sortableChildren = true;
        layer.eventMode = "passive";
      }
      for (const g of [...this.decor, this.grid, this.overlay])
        g.eventMode = "none";
      const canvas = this.app.canvas;
      canvas.addEventListener("pointerdown", this.down);
      canvas.addEventListener("pointermove", this.move);
      canvas.addEventListener("pointerup", this.up);
      canvas.addEventListener("pointercancel", this.cancel);
      canvas.addEventListener("lostpointercapture", this.cancel);
      canvas.addEventListener("wheel", this.wheel, { passive: false });
      canvas.addEventListener("contextmenu", this.context);
      window.addEventListener("keydown", this.keyDown);
      window.addEventListener("keyup", this.keyUp);
      window.addEventListener("blur", this.cancel);
      window.addEventListener("resize", this.resize);
      window.addEventListener("awalem-workspace-change", this.cancel);
      this.mounted = true;
      this.observer = new ResizeObserver(this.resize);
      this.observer.observe(this.host);
      this.resize();
      this.sync();
    } catch (error) {
      if (!this.disposed)
        this.onOverlay({
          handles: [],
          error: `Canvas could not start: ${error instanceof Error ? error.message : error}`,
        });
    }
  }
  update(key: string, scene: SceneDocument, selected: string | null) {
    if (this.key !== key) {
      this.cancel();
      this.key = key;
      this.lastViewRequest = -1;
      this.camera =
        session(key).camera ??
        fitCamera(this.host.clientWidth, this.host.clientHeight);
    }
    this.scene = scene;
    this.selected = selected;
    this.sync();
  }
  private resize = () => {
    if (!this.mounted || this.disposed) return;
    if (this.drag) this.cancel();
    this.app.renderer.resize(
      this.host.clientWidth,
      this.host.clientHeight,
      window.devicePixelRatio || 1,
    );
    this.app.stage.hitArea = new Rectangle(
      0,
      0,
      this.host.clientWidth,
      this.host.clientHeight,
    );
    if (this.key) {
      const s = session(this.key),
        mode = s.cameraMode ?? "fit";
      this.publishCamera(
        resizeCamera(
          s.camera,
          s.cameraViewport ?? null,
          { width: this.host.clientWidth, height: this.host.clientHeight },
          mode,
        ),
        mode,
      );
    }
    this.draw();
  };
  private publishCamera(
    camera: Camera,
    mode: CameraMode = session(this.key).cameraMode ?? "fit",
  ) {
    this.camera = camera;
    if (this.key) {
      const old = session(this.key).camera;
      if (
        !old ||
        old.x !== camera.x ||
        old.y !== camera.y ||
        old.zoom !== camera.zoom ||
        session(this.key).cameraMode !== mode ||
        session(this.key).cameraViewport?.width !== this.host.clientWidth ||
        session(this.key).cameraViewport?.height !== this.host.clientHeight
      )
        setCamera(this.key, camera, mode, {
          width: this.host.clientWidth,
          height: this.host.clientHeight,
        });
    }
    this.draw();
  }
  clientToWorld(x: number, y: number) {
    return screenToWorld(this.clientPoint(x, y), this.camera);
  }
  private clientPoint(x: number, y: number): XY {
    const point = new Point();
    this.app.renderer.events.mapPositionToPoint(point, x, y);
    return { x: point.x, y: point.y };
  }
  private entities() {
    const gesture = useEditor.getState().gesture;
    const project = useProject.getState().project;
    return (
      this.scene?.entities.map((e) => {
        const authored =
          gesture?.sceneKey === this.key &&
          !gesture.layerBefore &&
          gesture.id === e.id
            ? { ...e, ...gesture.patch }
            : e;
        return project && this.scene && e.shape === "image"
          ? {
              ...authored,
              assetUrl: entityImageUrl(project, this.scene, authored),
            }
          : authored;
      }) ?? []
    );
  }
  private sync() {
    if (!this.mounted || this.disposed || !this.scene) return;
    const s = session(this.key);
    if (this.lastViewRequest === -1) {
      this.camera = resizeCamera(
        s.camera,
        s.cameraViewport ?? null,
        { width: this.host.clientWidth, height: this.host.clientHeight },
        s.cameraMode ?? "fit",
      );
      this.lastViewRequest = s.viewRequest;
      this.publishCamera(this.camera, s.cameraMode ?? "fit");
    } else if (s.viewRequest !== this.lastViewRequest) {
      this.lastViewRequest = s.viewRequest;
      this.publishCamera(
        fitCamera(
          this.host.clientWidth,
          this.host.clientHeight,
          s.viewMode === "reset" ? 1 : undefined,
        ),
        s.viewMode === "fit" ? "fit" : "manual",
      );
    } else if (s.camera)
      this.publishCamera(
        resizeCamera(
          s.camera,
          s.cameraViewport ?? null,
          { width: this.host.clientWidth, height: this.host.clientHeight },
          s.cameraMode ?? "fit",
        ),
        s.cameraMode ?? "fit",
      );
    const entities = this.entities(),
      ids = new Set(entities.map((e) => e.id));
    for (const [id, entry] of this.nodes)
      if (!ids.has(id)) {
        entry.node.destroy({ children: true });
        this.nodes.delete(id);
      }
    const wanted = new Set(
      entities
        .filter((e) => e.shape === "image" && e.assetUrl)
        .map((e) => e.assetUrl!),
    );
    for (const url of this.urls)
      if (!wanted.has(url)) {
        releaseTexture(url);
        this.urls.delete(url);
        this.textures.delete(url);
        this.errors.delete(url);
      }
    for (const url of wanted)
      if (!this.urls.has(url)) {
        this.urls.add(url);
        void acquireTexture(url)
          .then((texture) => {
            if (!this.disposed && this.urls.has(url)) {
              this.textures.set(url, texture);
              this.sync();
            }
          })
          .catch(() => {
            if (!this.disposed && this.urls.has(url)) {
              this.errors.add(url);
              this.draw();
            }
          });
      }
    const bounds: Record<string, Bounds> = {};
    for (const e of entities) {
      let entry = this.nodes.get(e.id);
      const texture = e.assetUrl ? this.textures.get(e.assetUrl) : undefined;
      const signature = `${e.shape}|${e.color}|${e.assetUrl ?? ""}|${!!texture}`;
      if (!entry) {
        const node = new Container();
        node.label = e.id;
        entry = {
          node,
          content: new Container(),
          signature: "",
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          anchorKey: "",
        };
        this.nodes.set(e.id, entry);
      }
      if (entry.signature !== signature) {
        entry.node
          .removeChildren()
          .forEach((c) => c.destroy({ children: true }));
        if (e.shape === "image" && texture) {
          const sprite = new Sprite(texture);
          sprite.scale.set(Math.min(160 / texture.width, 140 / texture.height));
          entry.content = sprite;
        } else entry.content = makeGraphic(e);
        entry.content.eventMode = "static";
        entry.node.addChild(entry.content);
        entry.signature = signature;
        entry.anchorKey = "";
      }
      const a = anchor(e),
        anchorKey = `${a.x},${a.y}`;
      if (entry.content instanceof Sprite) entry.content.anchor.set(a.x, a.y);
      if (entry.anchorKey !== anchorKey) {
        const b = entry.node.getLocalBounds();
        entry.bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
        entry.anchorKey = anchorKey;
      }
      const p = pivot(e),
        scale = scales(e);
      entry.node.position.set(e.x, e.y);
      entry.node.pivot.set(p.x, p.y);
      entry.node.scale.set(scale.x, scale.y);
      entry.node.angle = e.rotation;
      entry.node.alpha = e.opacity ?? 1;
      entry.node.visible = e.visible !== false;
      entry.node.eventMode =
        e.locked || e.selectable === false || e.visible === false
          ? "none"
          : "passive";
      entry.content.cursor =
        useEditor.getState().tool === "move" ? "move" : "pointer";
      if (entry.node.parent !== this.layers[e.layer])
        this.layers[e.layer].addChild(entry.node);
      // Integer render ranks preserve Y+depth and original-array tie order, including undo insertion.
      bounds[e.id] = {
        ...entry.bounds,
        ready: e.shape !== "image" || !!texture,
      };
    }
    for (const layer of ["background", "playfield", "foreground"] as const)
      entities
        .filter((e) => e.layer === layer)
        .sort((a, b) => a.y + a.depth - b.y - b.depth)
        .forEach((e, index) => {
          this.nodes.get(e.id)!.node.zIndex = index;
        });
    this.decor.forEach((g) => g.clear());
    paintBackground(
      this.decor[0],
      this.decor[1],
      this.decor[2],
      this.scene.world_id,
    );
    const background = effectiveBackground(this.key);
    this.decor.forEach((g) => {
      g.visible = background.showWorldArtwork;
    });
    const project = useProject.getState().project;
    this.backgrounds?.sync(background, (key) =>
      project ? resolveAsset(project, key)?.url : undefined,
    );
    setBounds(this.key, bounds);
    this.draw();
  }
  private draw() {
    if (!this.mounted || this.disposed) return;
    const c = this.camera,
      settings = useEditor.getState().settings,
      width = this.host.clientWidth,
      height = this.host.clientHeight;
    this.sceneRoot.position.set(c.x, c.y);
    this.sceneRoot.scale.set(c.zoom);
    this.drawBackgrounds();
    this.grid.clear();
    this.overlay.clear();
    if (settings.grid) {
      const step =
          settings.gridSize *
          Math.max(1, Math.ceil(10 / (settings.gridSize * c.zoom))),
        from = screenToWorld({ x: 0, y: 0 }, c),
        to = screenToWorld({ x: width, y: height }, c);
      for (let x = Math.ceil(from.x / step) * step; x <= to.x; x += step) {
        const sx = x * c.zoom + c.x;
        this.grid.moveTo(sx, 0).lineTo(sx, height);
      }
      for (let y = Math.ceil(from.y / step) * step; y <= to.y; y += step) {
        const sy = y * c.zoom + c.y;
        this.grid.moveTo(0, sy).lineTo(width, sy);
      }
      this.grid.stroke({ color: 0x9ac3d5, alpha: 0.13, width: 1 });
    }
    this.overlay
      .rect(c.x, c.y, 960 * c.zoom, 540 * c.zoom)
      .stroke({ color: 0x8faebf, alpha: 0.5, width: 1 });
    const { entity: e, entry, isLayer } = this.selectedObject();
    this.handles = [];
    if (e && entry && e.visible !== false) {
      const corners = boundsCorners(entry.bounds).map((p) =>
        worldToScreen(localToWorld(e, p), c),
      );
      this.overlay
        .poly(corners.flatMap((p) => [p.x, p.y]))
        .closePath()
        .stroke({ color: e.locked ? 0x8b9baa : 0xffd478, width: 1.5 });
      const center = worldToScreen({ x: e.x, y: e.y }, c);
      this.overlay.circle(center.x, center.y, 3).fill(0xffd478);
      if (!e.locked && !session(this.key).preview) {
        const tool = useEditor.getState().tool;
        if (tool === "move") {
          this.overlay
            .moveTo(center.x, center.y)
            .lineTo(center.x + 50, center.y)
            .stroke({ color: 0xff958b, width: 2 });
          this.overlay
            .moveTo(center.x, center.y)
            .lineTo(center.x, center.y - 50)
            .stroke({ color: 0x8fd8b1, width: 2 });
          this.handles = [
            { ...center, kind: "move", label: "Move freely" },
            { x: center.x + 50, y: center.y, kind: "mx", label: "Move X" },
            { x: center.x, y: center.y - 50, kind: "my", label: "Move Y" },
          ];
        } else if (tool === "rotate" && !isLayer) {
          const top = {
            x:
              (Math.min(...corners.map((p) => p.x)) +
                Math.max(...corners.map((p) => p.x))) /
              2,
            y: Math.min(...corners.map((p) => p.y)) - 28,
          };
          this.overlay
            .moveTo(center.x, center.y)
            .lineTo(top.x, top.y)
            .stroke({ color: 0xffd478, alpha: 0.6, width: 1 });
          this.handles = [{ ...top, kind: "rotate", label: "Rotate object" }];
        } else if (
          tool === "scale" &&
          (isLayer
            ? !!entry.bounds.ready
            : e.shape !== "image" ||
              (e.assetUrl && this.textures.has(e.assetUrl)))
        )
          this.handles = Object.entries(resizeHandles).map(([kind, h]) => ({
            ...worldToScreen(
              localToWorld(e, {
                x: entry.bounds.x + h.x * entry.bounds.width,
                y: entry.bounds.y + h.y * entry.bounds.height,
              }),
              c,
            ),
            kind,
            label: `Scale ${kind.toUpperCase()}`,
          }));
      }
    }
    this.onOverlay({
      handles: this.handles,
      error: [
        this.errors.size
          ? `${this.errors.size} image(s) could not load. Check source access, Storage CORS, or connectivity, then retry.`
          : "",
        this.backgrounds?.error() ?? "",
        this.entities().some((e) => e.shape === "image" && !e.assetUrl)
          ? "An image asset is missing or in Trash. Relink its asset reference."
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    });
  }
  startHandle(kind: string, event: PointerEvent) {
    if (event.button !== 0 || session(this.key).preview) return;
    const { entity, entry, isLayer } = this.selectedObject(),
      b = entry?.bounds;
    if (!entity || !b || entity.locked) return;
    const point = this.clientToWorld(event.clientX, event.clientY);
    const label =
      kind === "rotate"
        ? "Rotate object"
        : resizeHandles[kind]
          ? "Scale object"
          : "Move object";
    if (
      !(isLayer
        ? beginLayerGesture(this.key, entity.id, label, "pointer")
        : beginGesture(this.key, entity.id, label))
    )
      return;
    const h = resizeHandles[kind],
      handleWorld = h
        ? localToWorld(entity, {
            x: b.x + h.x * b.width,
            y: b.y + h.y * b.height,
          })
        : point;
    this.drag = {
      pointer: event.pointerId,
      kind,
      start: point,
      beforeCamera: this.camera,
      entity: structuredClone(entity),
      bounds: b,
      bias: { x: handleWorld.x - point.x, y: handleWorld.y - point.y },
      lastAngle: Math.atan2(point.y - entity.y, point.x - entity.x),
      angle: entity.rotation,
    };
    this.capture(event);
  }
  private capture(event: PointerEvent) {
    this.app.canvas.focus({ preventScroll: true });
    this.app.canvas.setPointerCapture(event.pointerId);
  }
  private down = (event: PointerEvent) => {
    if (event.button === 1 || (event.button === 0 && this.space)) {
      event.preventDefault();
      this.drag = {
        pointer: event.pointerId,
        kind: "pan",
        start: this.clientPoint(event.clientX, event.clientY),
        beforeCamera: { ...this.camera },
        lastAngle: 0,
        angle: 0,
      };
      this.capture(event);
      return;
    }
    if (event.button !== 0) return;
    if (session(this.key).preview) return;
    event.preventDefault();
    this.app.canvas.focus({ preventScroll: true });
    const p = this.clientPoint(event.clientX, event.clientY);
    let hit: Container | null = this.app.renderer.events.rootBoundary.hitTest(
        p.x,
        p.y,
      ),
      id: string | null = null;
    while (hit) {
      if (this.nodes.has(hit.label)) {
        id = hit.label;
        break;
      }
      hit = hit.parent;
    }
    this.onSelect(id);
    this.selected = id;
    if (id && useEditor.getState().tool === "move")
      this.startHandle("move", event);
  };
  private move = (event: PointerEvent) => {
    if (!this.drag) {
      const p = this.clientToWorld(event.clientX, event.clientY);
      this.decor[1].x = (480 - p.x) * 0.012;
      return;
    }
    if (event.pointerId !== this.drag.pointer) return;
    if (this.drag.kind !== "pan" && !this.drag.moved) {
      const p = this.clientToWorld(event.clientX, event.clientY);
      if (
        Math.hypot(p.x - this.drag.start.x, p.y - this.drag.start.y) *
          this.camera.zoom <
        3
      )
        return;
    }
    this.drag.moved = true;
    this.pending = { x: event.clientX, y: event.clientY };
    if (!this.frame)
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.applyPending();
      });
  };
  private applyPending() {
    const point = this.pending,
      drag = this.drag;
    this.pending = null;
    if (!point || !drag) return;
    if (drag.kind === "pan") {
      const p = this.clientPoint(point.x, point.y);
      this.publishCamera(
        {
          ...drag.beforeCamera,
          x: drag.beforeCamera.x + p.x - drag.start.x,
          y: drag.beforeCamera.y + p.y - drag.start.y,
        },
        "manual",
      );
      return;
    }
    const g = useEditor.getState().gesture;
    if (!g || g.sceneKey !== this.key || g.id !== drag.entity?.id) return;
    const e = drag.entity!,
      current = this.clientToWorld(point.x, point.y),
      settings = useEditor.getState().settings;
    if (drag.kind === "rotate") {
      const angle = Math.atan2(current.y - e.y, current.x - e.x);
      const delta = Math.atan2(
        Math.sin(angle - drag.lastAngle),
        Math.cos(angle - drag.lastAngle),
      );
      drag.angle += (delta * 180) / Math.PI;
      drag.lastAngle = angle;
      previewGesture({
        rotation: settings.angleSnap
          ? snap(drag.angle, settings.angleStep)
          : drag.angle,
      });
    } else if (resizeHandles[drag.kind])
      previewGesture(
        resizeEntity(
          e,
          drag.bounds!,
          drag.kind,
          { x: current.x + drag.bias!.x, y: current.y + drag.bias!.y },
          settings.aspect,
        ),
      );
    else {
      let x = drag.kind === "my" ? e.x : e.x + current.x - drag.start.x,
        y = drag.kind === "mx" ? e.y : e.y + current.y - drag.start.y;
      if (settings.snap) {
        if (drag.kind !== "my") x = snap(x, settings.gridSize);
        if (drag.kind !== "mx") y = snap(y, settings.gridSize);
      }
      previewGesture({ x, y });
    }
    this.sync();
  }
  private up = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.pointer) return;
    if (this.drag.moved || this.drag.kind === "pan") {
      this.pending = { x: event.clientX, y: event.clientY };
      this.applyPending();
    }
    const edit = this.drag.kind !== "pan";
    this.drag = null;
    if (edit) finishGesture();
    if (this.app.canvas.hasPointerCapture(event.pointerId))
      this.app.canvas.releasePointerCapture(event.pointerId);
    this.sync();
  };
  private cancel = () => {
    const drag = this.drag;
    this.drag = null;
    this.pending = null;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (drag?.kind !== "pan" && drag) cancelGesture();
    if (drag && this.mounted && this.app.canvas.hasPointerCapture(drag.pointer))
      this.app.canvas.releasePointerCapture(drag.pointer);
    if (this.mounted && !this.disposed) this.sync();
  };
  private wheel = (event: WheelEvent) => {
    event.preventDefault();
    if (this.drag) return;
    this.publishCamera(
      zoomAt(
        this.camera,
        this.clientPoint(event.clientX, event.clientY),
        this.camera.zoom *
          Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.025 : 0.0015)),
      ),
      "manual",
    );
  };
  private keyDown = (e: KeyboardEvent) => {
    if (document.activeElement !== this.app.canvas) return;
    if (e.code === "Space") {
      e.preventDefault();
      this.space = true;
    }
    if (e.key === "Escape") this.cancel();
  };
  private keyUp = (e: KeyboardEvent) => {
    if (e.code === "Space") this.space = false;
  };
  private context = (e: Event) => e.preventDefault();
  retryImages() {
    this.backgrounds?.retry();
    for (const url of this.errors) {
      releaseTexture(url);
      this.urls.delete(url);
    }
    this.errors.clear();
    this.sync();
  }
  dispose() {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
    this.backgrounds?.dispose();
    this.observer?.disconnect();
    if (this.mounted) {
      const canvas = this.app.canvas;
      canvas.removeEventListener("pointerdown", this.down);
      canvas.removeEventListener("pointermove", this.move);
      canvas.removeEventListener("pointerup", this.up);
      canvas.removeEventListener("pointercancel", this.cancel);
      canvas.removeEventListener("lostpointercapture", this.cancel);
      canvas.removeEventListener("wheel", this.wheel);
      canvas.removeEventListener("contextmenu", this.context);
      window.removeEventListener("keydown", this.keyDown);
      window.removeEventListener("keyup", this.keyUp);
      window.removeEventListener("blur", this.cancel);
      window.removeEventListener("resize", this.resize);
      window.removeEventListener("awalem-workspace-change", this.cancel);
      this.app.destroy(true, { children: true });
    }
    for (const url of this.urls) releaseTexture(url);
    this.urls.clear();
    this.nodes.clear();
  }
  private selectedObject() {
    const target = session(this.key).target;
    if (target?.kind === "background") {
      const layer = effectiveBackground(this.key).layers.find(
          (l) => l.id === target.id,
        ),
        bounds = this.backgrounds?.bounds(target.id);
      if (layer?.mode === "custom" && bounds)
        return { entity: layerEntity(layer), entry: { bounds }, isLayer: true };
      return { entity: undefined, entry: undefined, isLayer: true };
    }
    const entity = this.entities().find((e) => e.id === this.selected);
    return {
      entity,
      entry: entity && this.nodes.get(entity.id),
      isLayer: false,
    };
  }
  private drawBackgrounds() {
    if (!this.key) return;
    const preview = session(this.key).preview;
    const seconds = preview
      ? preview.elapsed +
        (preview.playing ? (performance.now() - preview.startedAt) / 1000 : 0)
      : null;
    this.backgrounds?.draw(
      effectiveBackground(this.key),
      this.camera,
      this.host.clientWidth,
      this.host.clientHeight,
      seconds,
    );
  }
  private previewFrame = () => {
    if (
      this.mounted &&
      !this.disposed &&
      this.key &&
      session(this.key).preview?.playing
    )
      this.drawBackgrounds();
  };
}
