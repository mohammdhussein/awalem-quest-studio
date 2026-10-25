import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { seedProject } from "../project/migrations";
import { useProject } from "../project/store";
import {
  addAsset,
  duplicateScene,
  trashItem,
  renameItem,
  markChanged,
} from "../project/commands";
import { itemKey, volumeKey, type AssetRecord } from "../project/model";
import { validateScene } from "../project/validation";
import { assetUsers, missingReferences, resolveAsset } from "../assets/catalog";
import {
  assignBackgroundAsset,
  deleteLayer,
  duplicateLayer,
  editBackground,
  patchLayer,
  reorderLayer,
} from "./commands";
import { newLayer } from "./model";
import { layerLayout, parallaxOffset } from "./layout";
import {
  beginGesture,
  beginLayerGesture,
  cancelGesture,
  effectiveBackground,
  finishGesture,
  invalidateGesture,
  previewGesture,
  previewLayerGesture,
  redo,
  resetEditor,
  sceneRecord,
  selectLayer,
  session,
  setParallaxPreview,
  undo,
  useEditor,
} from "../editor/store";
import { projectSaveGroups } from "../../lib/repositories/firestore";
const key = itemKey("sea_wonders", "volume_01", "scene", "main"),
  other = itemKey("jungle_kingdom", "volume_01", "scene", "main");
let asset: AssetRecord;
beforeEach(() => {
  resetEditor();
  const project = seedProject().project;
  asset = addAsset(project, volumeKey("sea_wonders", "volume_01"), {
    name: "Reef",
    url: "https://example.test/reef.png",
    storage_path: null,
    width: 1600,
    height: 800,
    size: 500,
    mime: "image/png",
  });
  useProject.setState({
    project,
    ready: true,
    storageBlocked: true,
    mutation: 0,
  });
});
describe("background layout and compatibility", () => {
  it.each([
    ["fit", 0, 30, 0.6, 0.6],
    ["fill", -60, 0, 0.675, 0.675],
    ["stretch", 0, 0, 0.6, 0.675],
    ["custom", 0, 0, 1, 1],
    ["tile", 0, 0, 1, 1],
  ] as const)("%s sizing is deterministic", (mode, x, y, sx, sy) => {
    const l = { ...newLayer(asset.key, "Reef", "background"), mode };
    expect(layerLayout(l, 1600, 800)).toEqual({ x, y, scaleX: sx, scaleY: sy });
  });
  it("applies authored offsets and axis scales after base layout", () => {
    const l = {
      ...newLayer(asset.key, "Reef", "background"),
      mode: "custom" as const,
      x: -25,
      y: 12,
      scaleX: 2,
      scaleY: 0.5,
    };
    expect(layerLayout(l, 200, 100)).toEqual({
      x: -25,
      y: 12,
      scaleX: 2,
      scaleY: 0.5,
    });
  });
  it("calculates camera and timed motion without mutating layers", () => {
    const l = {
        ...newLayer(asset.key, "Reef", "background"),
        parallaxX: 0,
        parallaxY: 0.5,
        scrollX: 10,
        scrollY: -5,
      },
      before = structuredClone(l);
    expect(parallaxOffset(l, { x: 580, y: 370 }, 2)).toEqual({ x: 120, y: 40 });
    expect(l).toEqual(before);
  });
  it("leaves legacy scene appearance implicit until a background is authored", () => {
    const r = sceneRecord(key);
    expect(r.scene.background).toBeUndefined();
    expect(effectiveBackground(key).showWorldArtwork).toBe(true);
    expect(r.scene.background).toBeUndefined();
  });
  it("rejects duplicate IDs, invalid data, and unsupported nested versions", () => {
    assignBackgroundAsset(key, asset, "base");
    const scene = structuredClone(sceneRecord(key).scene);
    scene.background!.layers.push({ ...scene.background!.layers[0] });
    expect(() =>
      validateScene(scene, "sea_wonders", "volume_01", "main"),
    ).toThrow();
    scene.background!.layers.pop();
    scene.background!.layers[0].scaleX = Infinity;
    expect(() =>
      validateScene(scene, "sea_wonders", "volume_01", "main"),
    ).toThrow();
    scene.background!.layers[0].scaleX = 1;
    (scene.background as { version: number }).version = 99;
    expect(() =>
      validateScene(scene, "sea_wonders", "volume_01", "main"),
    ).toThrow();
  });
});
describe("background commands and shared references", () => {
  it("replaces artwork in one undo command without changing any entities", () => {
    const entities = structuredClone(sceneRecord(key).scene.entities);
    assignBackgroundAsset(key, asset, "base");
    expect(sceneRecord(key).scene.entities).toEqual(entities);
    expect(effectiveBackground(key).showWorldArtwork).toBe(false);
    expect(session(key).undo).toHaveLength(1);
    undo(key);
    expect(sceneRecord(key).scene.background).toBeUndefined();
    redo(key);
    expect(effectiveBackground(key).layers[0].assetKey).toBe(asset.key);
    expect(sceneRecord(key).scene.entities).toEqual(entities);
  });
  it("replaces only the selected image and preserves the other layer settings", () => {
    assignBackgroundAsset(key, asset, "base");
    assignBackgroundAsset(key, asset, "foreground");
    const original = structuredClone(effectiveBackground(key));
    const id = original.layers[0].id;
    patchLayer(key, id, { opacity: 0.4, scrollX: 12 });
    assignBackgroundAsset(
      key,
      addAsset(
        useProject.getState().project!,
        volumeKey("sea_wonders", "volume_01"),
        {
          name: "Replacement",
          url: "https://example.test/replacement.png",
          storage_path: null,
          width: 100,
          height: 100,
          size: 100,
          mime: "image/png",
        },
      ),
      "replace",
      id,
    );
    expect(effectiveBackground(key).layers[0]).toMatchObject({
      id,
      opacity: 0.4,
      scrollX: 12,
    });
    expect(effectiveBackground(key).layers[1]).toEqual(original.layers[1]);
  });
  it("groups valid live Inspector edits, cancels invalid and escaped edits", () => {
    assignBackgroundAsset(key, asset, "base");
    const id = effectiveBackground(key).layers[0].id;
    beginLayerGesture(key, id, "Offset X");
    previewLayerGesture({ x: 20 });
    previewLayerGesture({ x: 30 });
    expect(sceneRecord(key).scene.background!.layers[0].x).toBe(0);
    expect(effectiveBackground(key).layers[0].x).toBe(30);
    finishGesture();
    expect(session(key).undo).toHaveLength(2);
    undo(key);
    expect(effectiveBackground(key).layers[0].x).toBe(0);
    beginLayerGesture(key, id, "Offset X");
    previewLayerGesture({ x: 55 });
    invalidateGesture();
    finishGesture();
    expect(effectiveBackground(key).layers[0].x).toBe(0);
    beginLayerGesture(key, id, "Offset X");
    previewLayerGesture({ x: 99 });
    cancelGesture();
    expect(effectiveBackground(key).layers[0].x).toBe(0);
  });
  it("uses Phase 2 transform gesture patches for custom layers", () => {
    assignBackgroundAsset(key, asset, "base");
    const id = effectiveBackground(key).layers[0].id;
    patchLayer(key, id, { mode: "custom" });
    beginLayerGesture(key, id, "Move layer", "pointer");
    previewGesture({ x: 80, scaleX: 2, scaleY: 0.5 });
    finishGesture();
    expect(effectiveBackground(key).layers[0]).toMatchObject({
      x: 80,
      scaleX: 2,
      scaleY: 0.5,
    });
  });
  it("duplicates, reorders, deletes, restores, and invalidates redo", () => {
    assignBackgroundAsset(key, asset, "base");
    const id = effectiveBackground(key).layers[0].id;
    duplicateLayer(key, id);
    const copy = effectiveBackground(key).layers[1];
    expect(copy.id).not.toBe(id);
    expect(copy.assetKey).toBe(asset.key);
    reorderLayer(key, id, 1);
    expect(
      effectiveBackground(key).layers.find((l) => l.id === id)!.depth,
    ).toBeGreaterThan(copy.depth);
    deleteLayer(key, id);
    undo(key);
    expect(effectiveBackground(key).layers.some((l) => l.id === id)).toBe(true);
    patchLayer(key, id, { tint: "#123456" });
    expect(session(key).redo).toHaveLength(0);
  });
  it("protects locked layers while allowing visibility and unlocking", () => {
    assignBackgroundAsset(key, asset, "base");
    const id = effectiveBackground(key).layers[0].id;
    patchLayer(key, id, { locked: true });
    expect(patchLayer(key, id, { x: 40 })).toBe(false);
    expect(deleteLayer(key, id)).toBe(false);
    expect(duplicateLayer(key, id)).toBe(false);
    expect(patchLayer(key, id, { visible: false })).toBe(true);
    expect(patchLayer(key, id, { locked: false })).toBe(true);
  });
  it("keeps scene histories and backgrounds independent", () => {
    assignBackgroundAsset(key, asset, "base");
    assignBackgroundAsset(other, asset, "base");
    undo(other);
    expect(sceneRecord(other).scene.background).toBeUndefined();
    expect(effectiveBackground(key).layers).toHaveLength(1);
  });
  it("does not disturb an active gesture when another scene receives an uploaded background", () => {
    const entity = sceneRecord(key).scene.entities[0];
    beginGesture(key, entity.id, "Move");
    previewGesture({ x: 777 });
    assignBackgroundAsset(other, asset, "base");
    expect(useEditor.getState().gesture?.sceneKey).toBe(key);
    expect(session(key).undo).toHaveLength(0);
    cancelGesture();
  });
  it("shares original assets across worlds and protects referenced source branches", () => {
    assignBackgroundAsset(other, asset, "base");
    const p = useProject.getState().project!;
    expect(assetUsers(p, asset).map((r) => r.key)).toContain(other);
    expect(() => trashItem(p, volumeKey("sea_wonders", "volume_01"))).toThrow(
      "uses",
    );
    renameItem(p, asset.key, "Renamed shared asset");
    expect(resolveAsset(p, asset.key)?.name).toBe("Renamed shared asset");
  });
  it("reports missing assets without recreating records or deleting layer settings", () => {
    assignBackgroundAsset(key, asset, "base");
    const p = useProject.getState().project!;
    delete p.records[asset.key];
    expect(missingReferences(p)[0].message).toContain("background asset");
    expect(effectiveBackground(key).layers[0].assetKey).toBe(asset.key);
  });
  it("regenerates layer IDs on scene duplication and retains references", () => {
    assignBackgroundAsset(key, asset, "base");
    const before = effectiveBackground(key).layers[0];
    const duplicate = duplicateScene(useProject.getState().project!, key);
    if (duplicate.kind !== "scene") throw new Error("fixture");
    expect(duplicate.scene.background!.layers[0].id).not.toBe(before.id);
    expect(duplicate.scene.background!.layers[0].assetKey).toBe(
      before.assetKey,
    );
  });
  it("keeps preview motion out of drafts, history and JSON and blocks authored edits during preview", () => {
    assignBackgroundAsset(key, asset, "base");
    const before = JSON.stringify(sceneRecord(key).scene),
      history = session(key).undo.length,
      mutation = useProject.getState().mutation;
    setParallaxPreview(key, "play");
    setParallaxPreview(key, "pause");
    expect(
      patchLayer(key, effectiveBackground(key).layers[0].id, { x: 100 }),
    ).toBe(false);
    setParallaxPreview(key, "stop");
    expect(JSON.stringify(sceneRecord(key).scene)).toBe(before);
    expect(session(key).undo).toHaveLength(history);
    expect(useProject.getState().mutation).toBe(mutation);
  });
  it("groups connected volumes including cycles and leaves unrelated volumes independent", () => {
    const p = useProject.getState().project!;
    p.dirty = [];
    const second = addAsset(p, volumeKey("jungle_kingdom", "volume_01"), {
      name: "Second",
      url: "https://example.test/other.png",
      storage_path: null,
      width: 1600,
      height: 800,
      size: 500,
      mime: "image/png",
    });
    assignBackgroundAsset(key, second, "base");
    assignBackgroundAsset(other, asset, "base");
    const current = useProject.getState().project!;
    markChanged(current, current.records[asset.key]);
    const unrelated =
      current.records[itemKey("sea_wonders", "volume_03", "scene", "main")];
    markChanged(current, unrelated);
    const groups = projectSaveGroups(useProject.getState().project!);
    expect(
      groups.some(
        (g) =>
          g.scopes.includes(volumeKey("sea_wonders", "volume_01")) &&
          g.scopes.includes(volumeKey("jungle_kingdom", "volume_01")),
      ),
    ).toBe(true);
    expect(
      groups.some(
        (g) =>
          g.scopes.length === 1 &&
          g.scopes[0] === volumeKey("sea_wonders", "volume_03"),
      ),
    ).toBe(true);
  });
});
