import { useEffect, useRef, useState } from "react";
import type { SceneDocument } from "../data/scene";
import { SceneController, type Overlay } from "../features/editor/controller";
import { useEditor } from "../features/editor/store";
import type { Point } from "../features/editor/geometry";
import { useProject } from "../features/project/store";

type Props = {
  sceneKey: string;
  scene: SceneDocument;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDropAsset: (key: string, position: Point) => void;
};
export default function SceneViewport({
  sceneKey,
  scene,
  selectedId,
  onSelect,
  onDropAsset,
}: Props) {
  const host = useRef<HTMLDivElement>(null),
    controller = useRef<SceneController | null>(null);
  const latest = useRef(onSelect);
  latest.current = onSelect;
  const editor = useEditor();
  const project = useProject((s) => s.project);
  const [overlay, setOverlay] = useState<Overlay>({ handles: [], error: "" });
  const authored = scene.entities.find((e) => e.id === selectedId);
  const live =
    authored &&
    editor.gesture?.sceneKey === sceneKey &&
    editor.gesture.id === authored.id
      ? { ...authored, ...editor.gesture.patch }
      : authored;
  useEffect(() => {
    const engine = new SceneController(
      host.current!,
      (id) => latest.current(id),
      setOverlay,
    );
    controller.current = engine;
    void engine.mount();
    return () => {
      engine.dispose();
      controller.current = null;
    };
  }, []);
  useEffect(() => {
    controller.current?.update(sceneKey, scene, selectedId);
  }, [sceneKey, scene, selectedId, editor, project]);
  return (
    <div
      ref={host}
      className="canvas-host"
      role="application"
      aria-label="2.5D scene editor canvas"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-awalem-asset"))
          e.preventDefault();
      }}
      onDrop={(e) => {
        const key = e.dataTransfer.getData("application/x-awalem-asset");
        if (!key || !controller.current) return;
        e.preventDefault();
        e.stopPropagation();
        onDropAsset(
          key,
          controller.current.clientToWorld(e.clientX, e.clientY),
        );
      }}
    >
      {live && (
        <output className="transform-readout" aria-label="Object coordinates">
          X {Math.round(live.x * 100) / 100} · Y{" "}
          {Math.round(live.y * 100) / 100} ·{" "}
          {Math.round(live.rotation * 100) / 100}°
        </output>
      )}
      <div className="gizmo-overlay">
        {overlay.handles.map((handle) => (
          <button
            type="button"
            key={handle.kind}
            aria-label={handle.label}
            title={handle.label}
            className={`gizmo-handle ${handle.kind}`}
            style={{ left: handle.x, top: handle.y }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              controller.current?.startHandle(handle.kind, event.nativeEvent);
            }}
          />
        ))}
      </div>
      {overlay.error && (
        <div className="canvas-error" role="alert">
          {overlay.error}
          <button
            type="button"
            onClick={() => controller.current?.retryImages()}
          >
            Retry images
          </button>
        </div>
      )}
    </div>
  );
}
