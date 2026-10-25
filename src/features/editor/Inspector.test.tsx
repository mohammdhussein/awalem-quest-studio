// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EntityInspector from "../../components/EntityInspector";
import { seedProject } from "../project/migrations";
import { itemKey } from "../project/model";
import { useProject } from "../project/store";
import {
  effectiveEntity,
  finishGesture,
  resetEditor,
  session,
  undo,
  useEditor,
} from "./store";
const key = itemKey("sea_wonders", "volume_01", "scene", "main");
const entity = () => {
  const r = useProject.getState().project!.records[key];
  if (r.kind !== "scene") throw new Error("fixture");
  return r.scene.entities[0];
};
function Harness() {
  useEditor();
  return (
    <EntityInspector
      sceneKey={key}
      selected={effectiveEntity(key, entity().id)!}
    />
  );
}
beforeEach(() => {
  resetEditor();
  useProject.setState({
    project: seedProject().project,
    ready: true,
    mutation: 0,
    storageBlocked: true,
  });
});
afterEach(cleanup);
describe("transactional Inspector fields", () => {
  it("keeps incomplete numbers outside authored data and commits one undo step on Enter", async () => {
    const user = userEvent.setup(),
      before = entity().x;
    render(<Harness />);
    await user.click(screen.getByLabelText("X"));
    await user.clear(screen.getByLabelText("X"));
    expect(entity().x).toBe(before);
    await user.tab();
    expect(entity().x).toBe(before);
    expect(session(key).undo).toHaveLength(0);
    expect(screen.getByRole("alert").textContent).toContain("previous value");
    await user.click(screen.getByLabelText("X"));
    await user.clear(screen.getByLabelText("X"));
    await user.type(screen.getByLabelText("X"), "707.5");
    expect(entity().x).toBe(before);
    expect(useEditor.getState().gesture?.patch.x).toBe(707.5);
    await user.keyboard("{Enter}");
    expect(entity().x).toBe(707.5);
    expect(session(key).undo).toHaveLength(1);
    act(() => undo(key));
    expect(entity().x).toBe(before);
  });
  it("cancels the entire edit if an incomplete field is finished by navigation or export", async () => {
    const user = userEvent.setup(),
      before = entity().x;
    render(<Harness />);
    await user.click(screen.getByLabelText("X"));
    await user.clear(screen.getByLabelText("X"));
    await user.type(screen.getByLabelText("X"), "9");
    fireEvent.change(screen.getByLabelText("X"), { target: { value: "" } });
    act(() => finishGesture());
    expect(entity().x).toBe(before);
    expect(session(key).undo).toHaveLength(0);
  });
  it("Escape cancels previews and opacity/locking remain reversible", async () => {
    const user = userEvent.setup(),
      before = entity().x;
    render(<Harness />);
    await user.click(screen.getByLabelText("X"));
    await user.clear(screen.getByLabelText("X"));
    await user.type(screen.getByLabelText("X"), "888");
    await user.keyboard("{Escape}");
    expect(entity().x).toBe(before);
    expect(session(key).undo).toHaveLength(0);
    await user.click(screen.getByLabelText("Opacity %"));
    await user.clear(screen.getByLabelText("Opacity %"));
    await user.type(screen.getByLabelText("Opacity %"), "40");
    await user.keyboard("{Enter}");
    expect(entity().opacity).toBe(0.4);
    await user.click(screen.getByLabelText("Locked"));
    expect((screen.getByLabelText("X") as HTMLInputElement).disabled).toBe(
      true,
    );
    act(() => undo(key));
    expect(entity().locked).toBeUndefined();
    act(() => undo(key));
    expect(entity().opacity).toBeUndefined();
  });
});
