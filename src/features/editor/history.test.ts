import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { seedProject } from "../project/migrations";
import { useProject } from "../project/store";
import { itemKey } from "../project/model";
import { validateScene } from "../project/validation";
import {
  addEntity,
  beginGesture,
  cancelGesture,
  duplicateEntity,
  finishGesture,
  patchEntity,
  previewGesture,
  redo,
  removeEntity,
  resetEditor,
  selectEntity,
  session,
  setCamera,
  setSettings,
  undo,
  useEditor,
} from "./store";
const key = itemKey("sea_wonders", "volume_01", "scene", "main"),
  other = itemKey("sea_wonders", "volume_02", "scene", "main");
function entity(k = key) {
  const r = useProject.getState().project!.records[k];
  if (r.kind !== "scene") throw new Error("fixture");
  return r.scene.entities[0];
}
beforeEach(() => {
  resetEditor();
  setSettings({ maxCommands: 100, memoryMiB: 16 });
  useProject.setState({
    project: seedProject().project,
    ready: true,
    mutation: 0,
    storageBlocked: true,
  });
});
describe("scene command history", () => {
  it("keeps a captured transform active when an asynchronous instance arrives in another scene", () => {
    beginGesture(key, entity().id, "Move object");
    previewGesture({ x: 555 });
    addEntity(other, { ...entity(other), id: "async-upload" });
    expect(useEditor.getState().gesture?.sceneKey).toBe(key);
    expect(session(key).undo).toHaveLength(0);
    expect(session(other).undo).toHaveLength(1);
    finishGesture();
    expect(entity().x).toBe(555);
  });
  it("rejects non-finite live previews before they reach the renderer or authored data", () => {
    const before = entity().x;
    beginGesture(key, entity().id, "Move object");
    previewGesture({ x: Infinity });
    finishGesture();
    expect(entity().x).toBe(before);
    expect(session(key).undo).toHaveLength(0);
  });
  it("records hundreds of drag previews as one command and does not persist previews", () => {
    const before = entity();
    beginGesture(key, before.id, "Move object");
    for (let x = 0; x < 200; x++) previewGesture({ x });
    expect(entity().x).toBe(before.x);
    expect(useProject.getState().mutation).toBe(0);
    finishGesture();
    expect(entity().x).toBe(199);
    expect(session(key).undo).toHaveLength(1);
    undo(key);
    expect(entity().x).toBe(before.x);
    redo(key);
    expect(entity().x).toBe(199);
    expect(session(key).undo).toHaveLength(1);
  });
  it("does not dirty content for selection, navigation, canceled gestures or no-op gestures", () => {
    const id = entity().id;
    selectEntity(key, id);
    setCamera(key, { zoom: 2, x: 50, y: -10 });
    beginGesture(key, id, "Move object");
    previewGesture({ x: 900 });
    cancelGesture();
    beginGesture(key, id, "Move object");
    finishGesture();
    expect(useProject.getState().mutation).toBe(0);
    expect(session(key).undo).toHaveLength(0);
  });
  it("keeps histories isolated and invalidates redo after a new edit", () => {
    patchEntity(key, entity().id, { x: 700 });
    patchEntity(other, entity(other).id, { x: 800 });
    undo(key);
    expect(entity().x).not.toBe(700);
    expect(entity(other).x).toBe(800);
    expect(session(other).undo).toHaveLength(1);
    patchEntity(key, entity().id, { y: 123 });
    expect(session(key).redo).toHaveLength(0);
    redo(key);
    expect(entity().y).toBe(123);
  });
  it("reverses creation, deletion and duplication with stable IDs and preserved asset references", () => {
    const original = {
      ...entity(),
      id: "created-id",
      assetId: "shared",
      assetUrl: "https://example.test/sprite.png",
    };
    addEntity(key, original);
    expect(session(key).selectedIds).toEqual(["created-id"]);
    undo(key);
    expect(useProject.getState().project!.records[key]).not.toMatchObject({
      scene: { entities: [original] },
    });
    redo(key);
    expect(session(key).selectedIds).toEqual(["created-id"]);
    duplicateEntity(key, "created-id");
    const copy = session(key).selectedIds[0];
    expect(copy).not.toBe("created-id");
    removeEntity(key, copy);
    undo(key);
    const r = useProject.getState().project!.records[key];
    if (r.kind !== "scene") throw new Error("fixture");
    expect(r.scene.entities.find((e) => e.id === copy)?.assetId).toBe("shared");
  });
  it("protects locked content while allowing visibility and unlocking, including undo", () => {
    const id = entity().id;
    patchEntity(key, id, { locked: true }, "Lock");
    expect(patchEntity(key, id, { x: 999 })).toBe(false);
    expect(removeEntity(key, id)).toBe(false);
    expect(entity().x).not.toBe(999);
    patchEntity(key, id, { visible: false }, "Visibility");
    expect(entity().visible).toBe(false);
    undo(key);
    expect(entity().visible).toBeUndefined();
    undo(key);
    expect(entity().locked).toBeUndefined();
  });
  it("rejects invalid transforms without polluting history and preserves unknown entity data", () => {
    expect(patchEntity(key, entity().id, { scaleX: Infinity })).toBe(false);
    expect(patchEntity(key, entity().id, { opacity: 2 })).toBe(false);
    expect(patchEntity(key, entity().id, { pivot: { x: NaN, y: 0 } })).toBe(
      false,
    );
    expect(session(key).undo).toHaveLength(0);
    patchEntity(key, entity().id, {
      scaleX: 2,
      scaleY: 0.5,
      scale: 2,
      opacity: 0.7,
      pivot: { x: 10, y: -5 },
      anchor: { x: 0.5, y: 1 },
      visible: true,
      selectable: false,
    });
    const r = useProject.getState().project!.records[key];
    if (r.kind !== "scene") throw new Error("fixture");
    expect(
      validateScene(
        JSON.parse(JSON.stringify(r.scene)),
        "sea_wonders",
        "volume_01",
      ),
    ).toEqual(r.scene);
  });
  it("bounds history and clears transient stacks without changing authored data", () => {
    setSettings({ maxCommands: 2 });
    const id = entity().id;
    for (let x = 1; x < 5; x++) patchEntity(key, id, { x });
    expect(session(key).undo).toHaveLength(2);
    undo(key);
    undo(key);
    undo(key);
    expect(entity().x).toBe(2);
    resetEditor();
    expect(session(key).undo).toHaveLength(0);
    expect(entity().x).toBe(2);
  });
  it("prunes a dependent redo branch safely when its required oldest command exceeds the budget", () => {
    setSettings({ memoryMiB: 1 });
    const id = entity().id,
      payload = "x".repeat(180000);
    patchEntity(key, id, {
      interaction: { type: "show_fact", target: payload },
    });
    patchEntity(key, id, { x: 1 });
    patchEntity(key, id, { x: 2 });
    expect(session(key).undo).toHaveLength(1);
    undo(key);
    const otherId = entity(other).id;
    patchEntity(other, otherId, {
      interaction: { type: "show_fact", target: payload },
    });
    patchEntity(other, otherId, { x: 3 });
    expect(session(key).redo).toHaveLength(0);
    redo(key);
    expect(entity().x).toBe(1);
  });
});
