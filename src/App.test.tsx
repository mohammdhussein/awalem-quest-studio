// @vitest-environment jsdom
import { useWorkspace, workspaceDefaults } from "./features/editor/workspace";
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
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SceneDocument } from "./data/scene";
import App from "./App";
import {
  flushDraft,
  initializeProject,
  replaceFromCloud,
  useProject,
} from "./features/project/store";
import { seedProject } from "./features/project/migrations";
import { LocalDraftRepository, localDrafts } from "./lib/repositories/local";
import { itemKey, volumeKey } from "./features/project/model";
import { validateProject } from "./features/project/validation";
vi.mock("./lib/firebase", () => ({ firebase: null }));
vi.mock("./lib/studioAuth", () => ({
  useStudioAuth: () => ({
    user: null,
    admin: false,
    checking: false,
    error: "",
  }),
  requireStudioAdmin: vi.fn(),
}));
vi.mock("./components/SceneViewport", () => ({
  default: ({
    scene,
    onSelect,
  }: {
    scene: SceneDocument;
    onSelect: (id: string) => void;
  }) => (
    <div aria-label="Viewport test adapter">
      {scene.entities.map((entity) => (
        <button key={entity.id} onClick={() => onSelect(entity.id)}>
          Viewport {entity.name}
        </button>
      ))}
    </div>
  ),
}));
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
  useProject.setState({
    project: seedProject().project,
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
});
describe("editor workflow through React controls", () => {
  it("creates nested content, edits separate scenes, renames/moves, protects references, and restores Trash", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Assets" }));
    expect(
      (
        screen.getByRole("button", {
          name: "Save to Firebase",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(
      screen.getByRole("button", { name: "Viewport Example fish" }),
    );
    await user.clear(screen.getByLabelText("X"));
    await user.type(screen.getByLabelText("X"), "700");
    async function create(kind: string, name: string) {
      await user.click(screen.getByRole("button", { name: "+ New" }));
      const dialog = within(screen.getByRole("dialog"));
      await user.selectOptions(dialog.getByLabelText("Item type"), kind);
      await user.type(dialog.getByLabelText("Name"), name);
      await user.click(dialog.getByRole("button", { name: "Create" }));
      await waitFor(() =>
        expect(screen.getByRole("treeitem", { name })).toBeTruthy(),
      );
    }
    await create("folder", "Reef");
    await create("folder", "Kelp");
    await create("mission", "Mission 1");
    await user.type(screen.getByLabelText("Description"), "Find the dolphin");
    await user.selectOptions(screen.getByLabelText("Starting scene"), "main");
    await create("scene", "Reef Scene");
    const newSceneKey = useProject.getState().project!.active_scene_key!;
    await user.click(screen.getByRole("button", { name: "+ Add sample" }));
    await user.click(screen.getByRole("button", { name: "Viewport fish 1" }));
    await user.clear(screen.getByLabelText("X"));
    await user.type(screen.getByLabelText("X"), "250");
    await user.click(screen.getByRole("treeitem", { name: "Main Scene" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Viewport Example fish" }),
      ).toBeTruthy(),
    );
    await user.click(
      screen.getByRole("button", { name: "Viewport Example fish" }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText("X") as HTMLInputElement).value).toBe(
        "700",
      ),
    );
    await user.click(
      screen.getByRole("button", { name: "Actions for Main Scene" }),
    );
    await user.click(screen.getByRole("menuitem", { name: /Move to Trash/ }));
    expect(
      (
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Move to Trash",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText("Mission 1 starts in Main Scene")).toBeTruthy();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    await user.click(screen.getByRole("treeitem", { name: "Reef Scene" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Viewport fish 1" }),
      ).toBeTruthy(),
    );
    await user.click(screen.getByRole("button", { name: "Viewport fish 1" }));
    expect((screen.getByLabelText("X") as HTMLInputElement).value).toBe("250");
    await user.click(screen.getByRole("button", { name: "Move" }));
    await user.selectOptions(
      screen.getByLabelText("Destination"),
      volumeKey("sea_wonders", "volume_01"),
    );
    await user.click(screen.getByRole("button", { name: "Apply" }));
    await user.click(screen.getByRole("button", { name: "Rename" }));
    const rename = within(screen.getByRole("dialog"));
    await user.clear(rename.getByLabelText("Name"));
    await user.type(rename.getByLabelText("Name"), "Reef Return");
    await user.click(rename.getByRole("button", { name: "Apply" }));
    expect(useProject.getState().project!.records[newSceneKey]).toMatchObject({
      name: "Reef Return",
      parent_key: volumeKey("sea_wonders", "volume_01"),
    });
    await user.click(
      screen.getByRole("button", { name: "Actions for Reef Return" }),
    );
    await user.click(screen.getByRole("menuitem", { name: /Move to Trash/ }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Move to Trash",
      }),
    );
    expect(screen.getByRole("heading", { name: "No scene open" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Trash" }));
    await user.click(screen.getByRole("button", { name: "Restore" }));
    await user.click(screen.getByRole("button", { name: "Project" }));
    await user.click(screen.getByRole("treeitem", { name: "Reef Return" }));
    await flushDraft();
    const reopened = validateProject(await new LocalDraftRepository().read());
    expect(reopened.active_scene_key).toBe(newSceneKey);
    expect(reopened.records[newSceneKey].deleted_at).toBeNull();
    expect(
      Object.values(reopened.records).find((r) => r.name === "Kelp")
        ?.parent_key,
    ).toBe(Object.values(reopened.records).find((r) => r.name === "Reef")?.key);
  }, 30000);
  it("keeps the current scene selected when cloud replacement finishes after navigation", async () => {
    const other = itemKey("sea_wonders", "volume_02", "scene", "main");
    useProject.getState().change((p) => {
      p.selected_key = other;
      p.active_scene_key = other;
    });
    await flushDraft();
    const originalBackup = localDrafts.backup.bind(localDrafts);
    const backup = vi
      .spyOn(localDrafts, "backup")
      .mockImplementationOnce(async (...args) => {
        await originalBackup(...args);
        const latest = structuredClone(useProject.getState().project!);
        const first = itemKey("sea_wonders", "volume_01", "scene", "main");
        latest.selected_key = first;
        latest.active_scene_key = first;
        useProject.setState({ project: latest });
      });
    await replaceFromCloud(
      seedProject().project,
      useProject.getState().mutation,
    );
    expect(useProject.getState().project!.active_scene_key).toBe(
      itemKey("sea_wonders", "volume_01", "scene", "main"),
    );
    backup.mockRestore();
  });
  it("rejects delayed cloud content if local edits occurred during the request", async () => {
    const version = useProject.getState().mutation;
    useProject.getState().change((p) => {
      p.records[p.active_scene_key!].name = "Local edit";
    });
    await expect(
      replaceFromCloud(seedProject().project, version),
    ).rejects.toThrow("Local content changed");
    expect(
      useProject.getState().project!.records[
        useProject.getState().project!.active_scene_key!
      ].name,
    ).toBe("Local edit");
  });
});
