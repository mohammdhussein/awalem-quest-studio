import type { SceneDocument, SceneEntity } from "../../data/scene";
import { validateScene } from "../project/validation";

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
  return validateScene(
    { ...scene, entities },
    scene.world_id,
    scene.volume_id,
    scene.scene_id ?? "main",
  );
}
