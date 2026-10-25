import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  cancelGesture,
  duplicateEntity,
  redo,
  removeEntity,
  session,
  setTool,
  undo,
  requestRename,
} from "./store";
export function editorShortcuts(
  event: KeyboardEvent | ReactKeyboardEvent,
  key: string | null,
) {
  const target = event.target as Element | null;
  if (
    !key ||
    event.defaultPrevented ||
    target?.closest?.(
      "input:not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable=true],[role=tree],.project-explorer,dialog",
    )
  )
    return;
  const letter = event.key.toLowerCase(),
    modifier = event.ctrlKey || event.metaKey;
  if (event.key === "F2") {
    event.preventDefault();
    requestRename(key);
  } else if (modifier && letter === "z") {
    event.preventDefault();
    event.shiftKey ? redo(key) : undo(key);
  } else if (modifier && letter === "y") {
    event.preventDefault();
    redo(key);
  } else if (modifier && letter === "d") {
    event.preventDefault();
    const id = session(key).selectedIds[0];
    if (id) duplicateEntity(key, id);
  } else if (!modifier && !event.altKey && ["w", "e", "r"].includes(letter)) {
    event.preventDefault();
    setTool(letter === "w" ? "move" : letter === "e" ? "rotate" : "scale");
  } else if (event.key === "Delete") {
    event.preventDefault();
    const id = session(key).selectedIds[0];
    if (id) removeEntity(key, id);
  } else if (event.key === "Escape") {
    cancelGesture();
  }
}
