import type { SceneDocument, SceneEntity } from "../../data/scene";
import { validateScene } from "../project/validation";
import type { BackgroundConfiguration } from "../backgrounds/model";
export type EditorTarget = { kind: "entity" | "background"; id: string };
export type BackgroundDelta = {
  before: BackgroundConfiguration | null;
  after: BackgroundConfiguration | null;
};

export type EntityDelta = {
  id: string;
  before: SceneEntity | null;
  after: SceneEntity | null;
  index: number;
};
export type SceneCommand = {
  label: string;
  changes: EntityDelta[];
  sequence: number;
  bytes: number;
  selectedBefore: string[];
  selectedAfter: string[];
  background?: BackgroundDelta;
  targetBefore?: EditorTarget | null;
  targetAfter?: EditorTarget | null;
};
export function applyCommand(
  scene: SceneDocument,
  command: SceneCommand,
  reverse = false,
): SceneDocument {
  const entities = [...scene.entities];
  for (const change of command.changes) {
    const value = reverse ? change.before : change.after,
      expected = reverse ? change.after : change.before;
    const index = entities.findIndex((e) => e.id === change.id);
    if (
      expected === null
        ? index >= 0
        : index < 0 ||
          JSON.stringify(entities[index]) !== JSON.stringify(expected)
    )
      throw new Error(
        "Scene content changed outside this history. Reload the scene history before continuing.",
      );
    if (value === null) {
      entities.splice(index, 1);
    } else if (index >= 0) entities[index] = structuredClone(value);
    else
      entities.splice(
        Math.min(change.index, entities.length),
        0,
        structuredClone(value),
      );
  }
  const next = { ...scene, entities };
  if (command.background) {
    const expected = reverse
      ? command.background.after
      : command.background.before;
    if (JSON.stringify(scene.background ?? null) !== JSON.stringify(expected))
      throw new Error(
        "Background changed outside this history. Reload before continuing.",
      );
    const value = reverse
      ? command.background.before
      : command.background.after;
    if (value === null) delete next.background;
    else next.background = structuredClone(value);
  }
  return validateScene(
    next,
    scene.world_id,
    scene.volume_id,
    scene.scene_id ?? "main",
  );
}
