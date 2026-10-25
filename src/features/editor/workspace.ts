import { create } from "zustand";
import {
  cancelGesture,
  finishGesture,
  requestView,
  session,
  setCamera,
  setParallaxPreview,
  useEditor,
} from "./store";
import { useProject } from "../project/store";
import type { Camera, CameraMode, ViewportSize } from "./geometry";
export type Panel = "left" | "right" | "assets";
export type WorkspacePreferences = {
  version: 1;
  leftOpen: boolean;
  rightOpen: boolean;
  assetsOpen: boolean;
  assetsHeight: number;
  leftWidth: number;
  rightWidth: number;
};
export const workspaceDefaults: WorkspacePreferences = {
  version: 1,
  leftOpen: true,
  rightOpen: true,
  assetsOpen: false,
  assetsHeight: 240,
  leftWidth: 280,
  rightWidth: 270,
};
export const workspaceStorageKey = "awalem-workspace-v1";
export function readPanelSize(
  side: string,
  fallback: number,
  storage?: Pick<Storage, "getItem">,
) {
  try {
    const value = Number(
      (storage ?? localStorage).getItem(`awalem-panel-${side}`),
    );
    return value >= 210 && value <= 440 ? value : fallback;
  } catch {
    return fallback;
  }
}
export function readWorkspacePreferences(): WorkspacePreferences {
  try {
    const raw = JSON.parse(localStorage.getItem(workspaceStorageKey) ?? "null");
    const valid =
      raw?.version === 1 &&
      ["leftOpen", "rightOpen", "assetsOpen"].every(
        (k) => typeof raw[k] === "boolean",
      ) &&
      Number.isFinite(raw.assetsHeight) &&
      raw.assetsHeight >= 140 &&
      raw.assetsHeight <= 1000;
    return {
      ...workspaceDefaults,
      ...(valid
        ? {
            leftOpen: raw.leftOpen,
            rightOpen: raw.rightOpen,
            assetsOpen: raw.assetsOpen,
            assetsHeight: raw.assetsHeight,
          }
        : {}),
      leftWidth: readPanelSize("left", 280),
      rightWidth: readPanelSize("right", 270),
    };
  } catch {
    return { ...workspaceDefaults };
  }
}
export function drawerLayout(
  workspaceHeight: number,
  chromeHeight: number,
  preferred: number,
  open: boolean,
) {
  const max = Math.floor(
    Math.min(workspaceHeight * 0.45, workspaceHeight - chromeHeight - 260 - 6),
  );
  const expanded = open && max >= 140;
  return {
    expanded,
    canExpand: max >= 140,
    height: expanded ? Math.min(max, Math.max(140, preferred)) : 36,
    max: Math.max(140, max),
  };
}
export function sidebarLayout(
  width: number,
  leftOpen: boolean,
  rightOpen: boolean,
  leftWidth: number,
  rightWidth: number,
) {
  const budget = Math.max(
    0,
    width - 360 - (leftOpen ? 5 : 0) - (rightOpen ? 5 : 0),
  );
  const left = leftOpen
    ? Math.min(leftWidth, Math.max(210, budget - (rightOpen ? 210 : 0)))
    : 0;
  const right = rightOpen
    ? Math.min(rightWidth, Math.max(210, budget - left))
    : 0;
  return {
    left,
    right,
    leftMax: Math.max(210, Math.min(440, budget - right)),
    rightMax: Math.max(210, Math.min(440, budget - left)),
  };
}
type FocusSnapshot = {
  key: string;
  camera: Camera | null;
  mode: CameraMode;
  viewport: ViewportSize | null;
};
type WorkspaceState = {
  preferences: WorkspacePreferences;
  compact: boolean;
  drawer: "left" | "right" | null;
  focus: boolean;
  snapshot: FocusSnapshot | null;
};
export const useWorkspace = create<WorkspaceState>(() => ({
  preferences: readWorkspacePreferences(),
  compact: typeof window !== "undefined" && window.innerWidth < 1100,
  drawer: null,
  focus: false,
  snapshot: null,
}));
export function prepareLayout() {
  const g = useEditor.getState().gesture;
  if (g?.source === "pointer") cancelGesture();
  else finishGesture();
  const key = useProject.getState().project?.active_scene_key;
  if (key && session(key).preview) setParallaxPreview(key, "stop");
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("awalem-workspace-change"));
}
function persist(p: WorkspacePreferences) {
  try {
    const { leftWidth, rightWidth, ...rest } = p;
    localStorage.setItem(workspaceStorageKey, JSON.stringify(rest));
    localStorage.setItem("awalem-panel-left", String(leftWidth));
    localStorage.setItem("awalem-panel-right", String(rightWidth));
  } catch {
    /* Optional presentation preferences. */
  }
}
export function setWorkspacePreferences(patch: Partial<WorkspacePreferences>) {
  const previous = useWorkspace.getState().preferences,
    p = { ...previous, ...patch, version: 1 as const };
  validateWorkspacePreferences(p);
  if (
    useWorkspace.getState().focus &&
    JSON.stringify(p) !== JSON.stringify(previous)
  )
    exitSceneFocus();
  prepareLayout();
  useWorkspace.setState({ preferences: p });
  persist(p);
}
export function validateWorkspacePreferences(p: WorkspacePreferences) {
  if (
    !["leftOpen", "rightOpen", "assetsOpen"].every(
      (k) => typeof p[k as keyof WorkspacePreferences] === "boolean",
    ) ||
    !Number.isFinite(p.assetsHeight) ||
    p.assetsHeight < 140 ||
    p.assetsHeight > 1000 ||
    ![p.leftWidth, p.rightWidth].every(
      (v) => Number.isFinite(v) && v >= 210 && v <= 440,
    )
  )
    throw new Error("Invalid workspace settings.");
}
export function setCompact(compact: boolean) {
  if (compact !== useWorkspace.getState().compact) {
    prepareLayout();
    useWorkspace.setState({ compact, drawer: null });
  }
}
export function exitSceneFocus() {
  const { snapshot } = useWorkspace.getState();
  prepareLayout();
  useWorkspace.setState({ focus: false, snapshot: null });
  if (snapshot?.camera)
    setCamera(snapshot.key, snapshot.camera, snapshot.mode, snapshot.viewport);
}
export function togglePanel(panel: Panel) {
  const old = useWorkspace.getState();
  const wasFocus = old.focus;
  if (wasFocus) exitSceneFocus();
  else prepareLayout();
  const s = useWorkspace.getState();
  if (panel !== "assets" && s.compact) {
    useWorkspace.setState({
      drawer: s.drawer === panel && !wasFocus ? null : panel,
    });
    return;
  }
  const field =
    panel === "left"
      ? "leftOpen"
      : panel === "right"
        ? "rightOpen"
        : "assetsOpen";
  setWorkspacePreferences({ [field]: wasFocus ? true : !s.preferences[field] });
}
export function closeDrawer() {
  prepareLayout();
  useWorkspace.setState({ drawer: null });
}
export function toggleSceneFocus(key: string | null) {
  if (useWorkspace.getState().focus) {
    exitSceneFocus();
    return;
  }
  prepareLayout();
  const s = key ? session(key) : null;
  useWorkspace.setState({
    focus: true,
    drawer: null,
    snapshot:
      key && s
        ? {
            key,
            camera: s.camera ? { ...s.camera } : null,
            mode: s.cameraMode ?? "fit",
            viewport: s.cameraViewport ?? null,
          }
        : null,
  });
  if (key) requestView(key, "fit");
}
export function resetWorkspace(key: string | null) {
  if (useWorkspace.getState().focus) exitSceneFocus();
  setWorkspacePreferences({ ...workspaceDefaults });
  useWorkspace.setState({ drawer: null });
  if (key) requestView(key, "fit");
}
export function visiblePanel(panel: Panel) {
  const s = useWorkspace.getState();
  return (
    !s.focus &&
    (panel === "assets"
      ? s.preferences.assetsOpen
      : s.compact
        ? s.drawer === panel
        : s.preferences[panel === "left" ? "leftOpen" : "rightOpen"])
  );
}
