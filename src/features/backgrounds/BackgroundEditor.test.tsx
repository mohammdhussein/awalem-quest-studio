// @vitest-environment jsdom
import { useWorkspace, workspaceDefaults } from "../editor/workspace";
import "fake-indexeddb/auto";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  act,
  cleanup,
  render,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import { initializeProject, flushDraft, useProject } from "../project/store";
import { seedProject } from "../project/migrations";
import { addAsset } from "../project/commands";
import { itemKey, volumeKey } from "../project/model";
import {
  effectiveBackground,
  resetEditor,
  sceneRecord,
  session,
} from "../editor/store";
import { uploadSprite } from "../../lib/cloud";
vi.mock("../../lib/firebase", () => ({ firebase: null }));
vi.mock("../../lib/studioAuth", () => ({
  useStudioAuth: () => ({
    user: { uid: "test-admin" },
    admin: true,
    checking: false,
    error: "",
  }),
  requireStudioAdmin: vi.fn(async () => ({})),
}));
vi.mock("../../lib/cloud", () => ({ uploadSprite: vi.fn() }));
vi.mock("../../components/SceneViewport", () => ({
  default: () => <div aria-label="Mock viewport" />,
}));
const key = itemKey("sea_wonders", "volume_01", "scene", "main"),
  other = itemKey("sea_wonders", "volume_02", "scene", "main");
beforeAll(async () => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
  await initializeProject();
});
beforeEach(() => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: 1440,
  });
  useWorkspace.setState({
    preferences: { ...workspaceDefaults },
    compact: false,
    drawer: null,
    focus: false,
    snapshot: null,
  });
  resetEditor();
  vi.mocked(uploadSprite).mockReset().mockResolvedValue({
    url: "https://example.test/upload.png",
    path: "studio-worlds/sea_wonders/volumes/volume_01/sprites/test.png",
  });
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width: 1600, height: 900, close: vi.fn() })),
  );
  const project = seedProject().project;
  addAsset(project, volumeKey("jungle_kingdom", "volume_01"), {
    name: "Shared underwater image",
    url: "https://example.test/shared.png",
    storage_path: null,
    width: 1600,
    height: 900,
    size: 1200,
    mime: "image/png",
  });
  useProject.setState({
    project,
    ready: true,
    localStatus: "saved",
    localError: "",
    notice: "",
    mutation: 0,
    storageBlocked: false,
  });
});
afterEach(async () => {
  cleanup();
  await flushDraft();
  vi.unstubAllGlobals();
});
describe("visual background controls with mocked upload SDK and viewport", () => {
  it("keeps sprite uploads and progress available while the Asset Browser is collapsed", async () => {
    let complete!: (value: { url: string; path: string }) => void;
    vi.mocked(uploadSprite).mockImplementation(
      (_file, _world, _volume, progress) => {
        progress?.(30);
        return new Promise((resolve) => {
          complete = resolve;
        });
      },
    );
    const user = userEvent.setup();
    render(<App />);
    const before = sceneRecord(key).scene.entities.length;
    const input = document.querySelector<HTMLInputElement>(
      "#workspace-assets input[type=file]",
    )!;
    fireEvent.change(input, {
      target: {
        files: [new File(["fixture"], "new-sprite.png", { type: "image/png" })],
      },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("progressbar", { name: "Image upload progress" }),
      ).toBeTruthy(),
    );
    expect(
      screen
        .getByRole("button", { name: "Assets" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.getByText("30%")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Assets" }));
    await user.click(screen.getByRole("button", { name: "Assets" }));
    expect(document.querySelector("#workspace-assets input[type=file]")).toBe(
      input,
    );
    await act(async () =>
      complete({
        url: "https://example.test/new-sprite.png",
        path: "sprites/new-sprite.png",
      }),
    );
    await waitFor(() =>
      expect(sceneRecord(key).scene.entities).toHaveLength(before + 1),
    );
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
    expect(
      screen
        .getByRole("button", { name: "Assets" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });
  it("selects an image across worlds and preserves all objects", async () => {
    const user = userEvent.setup(),
      before = structuredClone(sceneRecord(key).scene.entities);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Set background" }));
    expect(
      within(screen.getByRole("dialog")).getByLabelText("Asset scope"),
    ).toBeTruthy();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Use image",
      }),
    );
    expect(effectiveBackground(key).layers[0].assetKey).toContain(
      "jungle_kingdom",
    );
    expect(sceneRecord(key).scene.entities).toEqual(before);
    expect(screen.getByLabelText("Image mode")).toBeTruthy();
  });
  it("uploads and assigns a background without creating an extra scene object", async () => {
    const user = userEvent.setup(),
      before = structuredClone(sceneRecord(key).scene.entities);
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Set background" }));
    await user.upload(
      screen.getByLabelText("Upload background"),
      new File(["fixture"], "underwater.png", { type: "image/png" }),
    );
    await waitFor(() =>
      expect(effectiveBackground(key).layers).toHaveLength(1),
    );
    expect(uploadSprite).toHaveBeenCalledWith(
      expect.any(File),
      "sea_wonders",
      "volume_01",
      expect.any(Function),
    );
    expect(sceneRecord(key).scene.entities).toEqual(before);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      await screen.findByText(
        /Asset metadata and scene changes are local drafts/,
      ),
    ).toBeTruthy();
  });
  it("keeps delayed uploads assigned to the captured scene after navigation", async () => {
    let complete!: (v: { url: string; path: string }) => void;
    vi.mocked(uploadSprite).mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Set background" }));
    await user.upload(
      screen.getByLabelText("Upload background"),
      new File(["fixture"], "reef.png", { type: "image/png" }),
    );
    await waitFor(() => expect(uploadSprite).toHaveBeenCalled());
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
    );
    await act(() => useProject.getState().select(other));
    await act(async () => {
      complete({
        url: "https://example.test/reef.png",
        path: "sprites/reef.png",
      });
    });
    await waitFor(() =>
      expect(effectiveBackground(key).layers).toHaveLength(1),
    );
    expect(sceneRecord(other).scene.background).toBeUndefined();
    expect(useProject.getState().project!.active_scene_key).toBe(other);
  });
  it("commits one Inspector focus edit, restores invalid values, and locks editing", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Set background" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Use image",
      }),
    );
    const history = session(key).undo.length;
    await user.click(screen.getByLabelText("Offset X"));
    await user.clear(screen.getByLabelText("Offset X"));
    await user.type(screen.getByLabelText("Offset X"), "125");
    expect(sceneRecord(key).scene.background!.layers[0].x).toBe(0);
    await user.keyboard("{Enter}");
    expect(effectiveBackground(key).layers[0].x).toBe(125);
    expect(session(key).undo).toHaveLength(history + 1);
    await user.clear(screen.getByLabelText("Layer opacity"));
    await user.tab();
    expect(effectiveBackground(key).layers[0].opacity).toBe(1);
    await user.click(screen.getByLabelText("Locked", { exact: true }));
    expect(
      (screen.getByLabelText("Offset X") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Replace image",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
