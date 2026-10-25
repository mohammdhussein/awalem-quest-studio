import {
  execute,
  finishGesture,
  sceneRecord,
  selectLayer,
  session,
} from "../editor/store";
import { useEditor } from "../editor/store";
import {
  emptyBackground,
  newLayer,
  type BackgroundConfiguration,
  type BackgroundLayer,
} from "./model";
import { isTrashed, type AssetRecord } from "../project/model";
import { useProject } from "../project/store";
import { resolveAsset } from "../assets/catalog";

export function editBackground(
  key: string,
  label: string,
  edit: (b: BackgroundConfiguration) => void,
  targetId?: string,
) {
  if (useEditor.getState().gesture?.sceneKey === key) finishGesture();
  try {
    const before = sceneRecord(key).scene.background ?? null,
      after = structuredClone(before ?? emptyBackground());
    edit(after);
    for (const old of before?.layers ?? [])
      if (old.locked) {
        const next = after.layers.find((l) => l.id === old.id);
        if (
          !next ||
          Object.keys({ ...old, ...next }).some(
            (k) =>
              !["visible", "locked"].includes(k) &&
              JSON.stringify(old[k as keyof BackgroundLayer]) !==
                JSON.stringify(next[k as keyof BackgroundLayer]),
          )
        )
          throw new Error("Unlock this layer before editing it.");
      }
    const target = targetId
      ? { kind: "background" as const, id: targetId }
      : (session(key).target ?? null);
    return execute(
      key,
      label,
      [],
      target?.kind === "entity" ? [target.id] : [],
      { before, after },
      target?.kind === "background" &&
        !after.layers.some((l) => l.id === target.id)
        ? null
        : target,
    );
  } catch (error) {
    useEditor.setState({
      message:
        error instanceof Error ? error.message : "Background edit failed.",
    });
    return false;
  }
}
export type AssetAction = "base" | "background" | "foreground" | "replace";
export function assignBackgroundAsset(
  key: string,
  asset: AssetRecord,
  action: AssetAction,
  id?: string,
) {
  const project = useProject.getState().project!;
  if (!resolveAsset(project, asset.key) || isTrashed(project, asset.key)) {
    useEditor.setState({
      message: "Choose an available asset, or restore it before using it.",
    });
    return false;
  }
  let selected = id;
  const ok = editBackground(
    key,
    action === "replace" ? "Replace layer image" : "Set background image",
    (b) => {
      const target =
        action === "replace"
          ? b.layers.find((l) => l.id === id)
          : action === "base"
            ? b.layers
                .filter((l) => l.placement === "background")
                .sort((a, b) => a.depth - b.depth)[0]
            : undefined;
      if (action === "replace" && !target)
        throw new Error(
          "The destination layer is no longer available. The uploaded asset remains in the catalog.",
        );
      if (target) {
        target.assetKey = asset.key;
        selected = target.id;
      } else {
        const placement = action === "foreground" ? "foreground" : "background";
        const depth =
          Math.max(
            -1,
            ...b.layers
              .filter((l) => l.placement === placement)
              .map((l) => l.depth),
          ) + 1;
        const layer = newLayer(asset.key, asset.name, placement, depth);
        b.layers.push(layer);
        selected = layer.id;
      }
      if (action === "base") b.showWorldArtwork = false;
    },
  );
  if (ok && selected && useProject.getState().project?.active_scene_key === key)
    selectLayer(key, selected);
  return ok;
}
export function patchLayer(
  key: string,
  id: string,
  patch: Partial<BackgroundLayer>,
  label = "Edit layer",
) {
  return editBackground(
    key,
    label,
    (b) => {
      const l = b.layers.find((l) => l.id === id);
      if (!l) throw new Error("Layer no longer exists.");
      Object.assign(l, patch);
    },
    id,
  );
}
export function deleteLayer(key: string, id: string) {
  return editBackground(key, "Delete layer", (b) => {
    b.layers = b.layers.filter((l) => l.id !== id);
  });
}
export function duplicateLayer(key: string, id: string) {
  let copyId = "";
  const ok = editBackground(key, "Duplicate layer", (b) => {
    const l = b.layers.find((l) => l.id === id);
    if (!l || l.locked)
      throw new Error("Unlock this layer before duplicating it.");
    const copy = {
      ...structuredClone(l),
      id: crypto.randomUUID(),
      name: `${l.name.slice(0, 150)} copy`,
      depth:
        Math.max(
          ...b.layers
            .filter((x) => x.placement === l.placement)
            .map((x) => x.depth),
        ) + 1,
    };
    b.layers.push(copy);
    copyId = copy.id;
  });
  if (ok) selectLayer(key, copyId);
  return ok;
}
export function reorderLayer(key: string, id: string, direction: 1 | -1) {
  return editBackground(
    key,
    "Reorder layer",
    (b) => {
      const l = b.layers.find((l) => l.id === id);
      if (!l) return;
      const group = b.layers
        .filter((x) => x.placement === l.placement)
        .sort((a, b) => a.depth - b.depth);
      const at = group.indexOf(l),
        next = at + direction;
      if (next < 0 || next >= group.length) return;
      const neighbor = group[next],
        other = group[next + direction];
      l.depth = other
        ? (neighbor.depth + other.depth) / 2
        : neighbor.depth + direction;
      // Equal depths are valid imports. Moving this layer in the stable array resolves ties without changing locked neighbors.
      b.layers = b.layers.filter((x) => x.id !== id);
      const index = b.layers.indexOf(neighbor);
      b.layers.splice(index + (direction === 1 ? 1 : 0), 0, l);
    },
    id,
  );
}
