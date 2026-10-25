// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedProject } from "../project/migrations";
import { useProject } from "../project/store";
import { itemKey } from "../project/model";
import {
  beginGesture,
  previewGesture,
  resetEditor,
  sceneRecord,
  session,
  setCamera,
  setParallaxPreview,
  useEditor,
} from "./store";
import {
  closeDrawer,
  drawerLayout,
  readWorkspacePreferences,
  resetWorkspace,
  setCompact,
  setWorkspacePreferences,
  togglePanel,
  toggleSceneFocus,
  useWorkspace,
  visiblePanel,
  workspaceDefaults,
  workspaceStorageKey,
  sidebarLayout,
} from "./workspace";
import { fitCamera, resizeCamera, screenToWorld } from "./geometry";
const key = itemKey("sea_wonders", "volume_01", "scene", "main");
beforeEach(() => {
  localStorage.clear();
  resetEditor();
  useWorkspace.setState({
    preferences: { ...workspaceDefaults },
    compact: false,
    drawer: null,
    focus: false,
    snapshot: null,
  });
  useProject.setState({
    project: seedProject().project,
    ready: true,
    storageBlocked: true,
    mutation: 0,
  });
});
describe("workspace presentation state", () => {
  it("clamps wide sidebars without losing their saved preferred sizes", () => {
    const layout = sidebarLayout(1100, true, true, 440, 440);
    expect(1100 - layout.left - layout.right - 10).toBeGreaterThanOrEqual(360);
    expect(layout.left).toBeGreaterThanOrEqual(210);
    expect(layout.right).toBeGreaterThanOrEqual(210);
    expect(sidebarLayout(1440, true, true, 440, 440)).toMatchObject({
      left: 440,
      right: 440,
    });
  });
  it("defaults to open sidebars and collapsed assets", () =>
    expect(readWorkspacePreferences()).toEqual(workspaceDefaults));
  it("retains existing saved widths and versioned visibility preferences", () => {
    localStorage.setItem("awalem-panel-left", "340");
    localStorage.setItem("awalem-panel-right", "310");
    localStorage.setItem(
      workspaceStorageKey,
      JSON.stringify({
        version: 1,
        leftOpen: false,
        rightOpen: true,
        assetsOpen: true,
        assetsHeight: 300,
      }),
    );
    expect(readWorkspacePreferences()).toMatchObject({
      leftWidth: 340,
      rightWidth: 310,
      leftOpen: false,
      assetsOpen: true,
      assetsHeight: 300,
    });
  });
  it.each([
    "{invalid",
    JSON.stringify({ version: 99 }),
    JSON.stringify({
      version: 1,
      leftOpen: "yes",
      rightOpen: true,
      assetsOpen: false,
      assetsHeight: 240,
    }),
  ])(
    "recovers malformed preferences without changing authored data (%s)",
    (value) => {
      localStorage.setItem(workspaceStorageKey, value);
      expect(readWorkspacePreferences()).toEqual(workspaceDefaults);
    },
  );
  it("works when preference storage fails", () => {
    const get = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    expect(readWorkspacePreferences()).toEqual(workspaceDefaults);
    get.mockRestore();
    const put = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    expect(() => togglePanel("left")).not.toThrow();
    expect(visiblePanel("left")).toBe(false);
    put.mockRestore();
  });
  it("toggles panels independently while retaining width and authored scene state", () => {
    const original = JSON.stringify(useProject.getState().project);
    setWorkspacePreferences({ leftWidth: 350, rightWidth: 300 });
    togglePanel("left");
    togglePanel("assets");
    expect(visiblePanel("left")).toBe(false);
    expect(visiblePanel("right")).toBe(true);
    togglePanel("left");
    expect(useWorkspace.getState().preferences.leftWidth).toBe(350);
    expect(readWorkspacePreferences()).toEqual(
      useWorkspace.getState().preferences,
    );
    expect(JSON.stringify(useProject.getState().project)).toBe(original);
    expect(session(key).undo).toHaveLength(0);
    expect(useProject.getState().mutation).toBe(0);
  });
  it("uses one compact overlay without overwriting desktop visibility", () => {
    setCompact(true);
    expect(visiblePanel("left")).toBe(false);
    togglePanel("left");
    expect(visiblePanel("left")).toBe(true);
    togglePanel("right");
    expect(visiblePanel("left")).toBe(false);
    expect(visiblePanel("right")).toBe(true);
    closeDrawer();
    setCompact(false);
    expect(visiblePanel("left")).toBe(true);
    expect(visiblePanel("right")).toBe(true);
  });
  it("clamps the asset drawer and temporarily collapses when scene space is insufficient", () => {
    const normal = drawerLayout(744, 100, 1000, true);
    expect(normal.height).toBeLessThanOrEqual(744 * 0.45);
    expect(744 - 100 - normal.height - 6).toBeGreaterThanOrEqual(260);
    expect(drawerLayout(400, 100, 240, true)).toMatchObject({
      expanded: false,
      canExpand: false,
      height: 36,
    });
    expect(drawerLayout(800, 100, 240, true)).toMatchObject({
      expanded: true,
      height: 240,
    });
  });
  it("restores the prior layout and manual camera after focus mode", () => {
    const camera = { zoom: 1.2, x: 10, y: -30 },
      viewport = { width: 900, height: 600 };
    setCamera(key, camera, "manual", viewport);
    const prefs = JSON.stringify(useWorkspace.getState().preferences);
    toggleSceneFocus(key);
    expect(useWorkspace.getState().focus).toBe(true);
    expect(visiblePanel("left")).toBe(false);
    expect(session(key).cameraMode).toBe("fit");
    setCamera(key, { zoom: 2, x: 40, y: 50 });
    toggleSceneFocus(key);
    expect(session(key).camera).toEqual(camera);
    expect(session(key).cameraViewport).toEqual(viewport);
    expect(session(key).cameraMode).toBe("manual");
    expect(JSON.stringify(useWorkspace.getState().preferences)).toBe(prefs);
    expect(localStorage.getItem(workspaceStorageKey)).toBeNull();
  });
  it("exits focus when a panel is requested", () => {
    toggleSceneFocus(key);
    togglePanel("assets");
    expect(useWorkspace.getState().focus).toBe(false);
    expect(visiblePanel("assets")).toBe(true);
    expect(visiblePanel("left")).toBe(true);
  });
  it("stops parallax and restores its camera policy before layout changes", () => {
    const camera = fitCamera(900, 600);
    setCamera(key, camera, "fit", { width: 900, height: 600 });
    setParallaxPreview(key, "play");
    setCamera(key, { zoom: 3, x: -10, y: 50 }, "manual", {
      width: 900,
      height: 600,
    });
    togglePanel("left");
    expect(session(key).preview).toBeNull();
    expect(session(key).camera).toEqual(camera);
    expect(session(key).cameraMode).toBe("fit");
  });
  it("commits pending Inspector edits once and cancels unfinished pointer drags", () => {
    const e = sceneRecord(key).scene.entities[0];
    beginGesture(key, e.id, "X", "inspector");
    previewGesture({ x: 555 });
    togglePanel("right");
    expect(sceneRecord(key).scene.entities[0].x).toBe(555);
    expect(session(key).undo).toHaveLength(1);
    beginGesture(key, e.id, "Move", "pointer");
    previewGesture({ x: 700 });
    togglePanel("left");
    expect(sceneRecord(key).scene.entities[0].x).toBe(555);
    expect(useEditor.getState().gesture).toBeNull();
    expect(session(key).undo).toHaveLength(1);
  });
  it("resets layout and widths without changing scene content or history", () => {
    setWorkspacePreferences({
      leftOpen: false,
      rightWidth: 400,
      assetsHeight: 300,
      assetsOpen: true,
    });
    resetWorkspace(key);
    expect(useWorkspace.getState().preferences).toEqual(workspaceDefaults);
    expect(session(key).cameraMode).toBe("fit");
    expect(session(key).undo).toHaveLength(0);
  });
});
describe("Smart Fit camera", () => {
  it("fits the new area when fit policy is active", () =>
    expect(
      resizeCamera(
        { zoom: 0.2, x: 1, y: 2 },
        { width: 600, height: 400 },
        { width: 1200, height: 800 },
        "fit",
      ),
    ).toEqual(fitCamera(1200, 800)));
  it("preserves manual zoom and the world point at viewport center", () => {
    const old = { zoom: 1.3, x: -100, y: 20 },
      before = { width: 800, height: 600 },
      after = { width: 1200, height: 700 };
    const next = resizeCamera(old, before, after, "manual");
    expect(next.zoom).toBe(old.zoom);
    expect(
      screenToWorld({ x: after.width / 2, y: after.height / 2 }, next),
    ).toEqual(
      screenToWorld({ x: before.width / 2, y: before.height / 2 }, old),
    );
  });
  it("keeps camera policy independent for each scene", () => {
    const other = itemKey("sea_wonders", "volume_02", "scene", "main");
    setCamera(key, { zoom: 2, x: 10, y: 20 }, "manual");
    setCamera(other, fitCamera(900, 600), "fit");
    expect(session(key).cameraMode).toBe("manual");
    expect(session(other).cameraMode).toBe("fit");
  });
});
