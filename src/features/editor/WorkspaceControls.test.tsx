// @vitest-environment jsdom
import "fake-indexeddb/auto";
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../../App";
import { initializeProject, flushDraft, useProject } from "../project/store";
import { seedProject } from "../project/migrations";
import { resetEditor, session } from "./store";
import { itemKey } from "../project/model";
import { useWorkspace, workspaceDefaults } from "./workspace";
vi.mock("../../lib/firebase", () => ({ firebase: null }));
vi.mock("../../lib/studioAuth", () => ({
  useStudioAuth: () => ({
    user: null,
    admin: false,
    checking: false,
    error: "",
  }),
  requireStudioAdmin: vi.fn(),
}));
vi.mock("../../components/SceneViewport", () => ({
  default: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button onClick={() => onSelect("example-2")}>Select test fish</button>
  ),
}));
const key = itemKey("sea_wonders", "volume_01", "scene", "main");
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
describe("workspace controls in the existing application", () => {
  it("opens canvas-first, preserves mounted searches, and has no scene history side effects", async () => {
    const user = userEvent.setup();
    render(<App />);
    const scene = JSON.stringify(useProject.getState().project!.records[key]);
    expect(
      screen
        .getByRole("button", { name: "Assets" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.getByRole("button", { name: "Upload sprite" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "+ Add sample" })).toBeNull();
    const search = screen.getByLabelText("Search project");
    await user.type(search, "Coral");
    await user.click(screen.getByRole("button", { name: "Left panel" }));
    expect(
      screen.queryByRole("complementary", { name: "Project and layers" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Left panel" }));
    expect(screen.getByLabelText("Search project")).toBe(search);
    expect((search as HTMLInputElement).value).toBe("Coral");
    await user.click(screen.getByRole("button", { name: "Assets" }));
    const assetSearch = screen.getByLabelText("Search assets");
    await user.type(assetSearch, "reef");
    await user.click(screen.getByRole("button", { name: "Assets" }));
    await user.click(screen.getByRole("button", { name: "Assets" }));
    expect(screen.getByLabelText("Search assets")).toBe(assetSearch);
    expect((assetSearch as HTMLInputElement).value).toBe("reef");
    expect(JSON.stringify(useProject.getState().project!.records[key])).toBe(
      scene,
    );
    expect(session(key).undo).toHaveLength(0);
  });
  it("retains selection and finishes a valid Inspector edit before hiding it", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Select test fish" }));
    await user.clear(screen.getByLabelText("X"));
    await user.type(screen.getByLabelText("X"), "555");
    await user.click(screen.getByRole("button", { name: "Inspector" }));
    expect(
      screen.queryByRole("complementary", { name: "Inspector" }),
    ).toBeNull();
    expect(session(key).selectedIds).toEqual(["example-2"]);
    expect(session(key).undo).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Inspector" }));
    expect((screen.getByLabelText("X") as HTMLInputElement).value).toBe("555");
  });
  it("supports keyboard resizing and remembers sidebar widths", async () => {
    const user = userEvent.setup();
    render(<App />);
    const right = screen.getByRole("separator", { name: "Resize right panel" });
    right.focus();
    await user.keyboard("{ArrowLeft}");
    expect(useWorkspace.getState().preferences.rightWidth).toBe(280);
    await user.click(screen.getByRole("button", { name: "Inspector" }));
    await user.click(screen.getByRole("button", { name: "Inspector" }));
    expect(
      screen
        .getByRole("separator", { name: "Resize right panel" })
        .getAttribute("aria-valuenow"),
    ).toBe("280");
    await user.click(screen.getByRole("button", { name: "Assets" }));
    screen.getByRole("separator", { name: "Resize Asset Browser" }).focus();
    await user.keyboard("{ArrowUp}");
    expect(useWorkspace.getState().preferences.assetsHeight).toBe(250);
    expect(session(key).undo).toHaveLength(0);
  });
  it("stages Settings changes until Apply and restores defaults with Reset workspace", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    let dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByLabelText("Inspector open"));
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    expect(useWorkspace.getState().preferences.rightOpen).toBe(true);
    await user.click(screen.getByRole("button", { name: "Settings" }));
    dialog = within(screen.getByRole("dialog"));
    await user.click(dialog.getByLabelText("Inspector open"));
    await user.clear(dialog.getByLabelText("Asset Browser height (px)"));
    await user.type(dialog.getByLabelText("Asset Browser height (px)"), "300");
    await user.click(dialog.getByRole("button", { name: "Apply settings" }));
    expect(useWorkspace.getState().preferences).toMatchObject({
      rightOpen: false,
      assetsHeight: 300,
    });
    await user.click(screen.getByRole("button", { name: "Settings" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Reset workspace",
      }),
    );
    expect(useWorkspace.getState().preferences).toEqual(workspaceDefaults);
  });
  it("opens one compact overlay at a time and returns focus when closing", async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1024,
    });
    render(<App />);
    expect(
      screen.queryByRole("complementary", { name: "Inspector" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Left panel" }));
    expect(
      screen.getByRole("complementary", { name: "Project and layers" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Inspector" }));
    expect(
      screen.queryByRole("complementary", { name: "Project and layers" }),
    ).toBeNull();
    expect(
      screen.getByRole("complementary", { name: "Inspector" }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close Inspector" }));
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Inspector" }),
    );
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1440,
    });
    await act(() => window.dispatchEvent(new Event("resize")));
    expect(
      screen.getByRole("complementary", { name: "Project and layers" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("complementary", { name: "Inspector" }),
    ).toBeTruthy();
  });
});
