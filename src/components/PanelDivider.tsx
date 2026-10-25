import { useRef, type PointerEvent } from "react";
export { readPanelSize } from "../features/editor/workspace";
export default function PanelDivider({
  side,
  value,
  onResize,
  onBeforeResize,
  min = side === "assets" ? 140 : 210,
  max = 440,
}: {
  side: "left" | "right" | "assets";
  value: number;
  onResize: (value: number) => void;
  onBeforeResize?: () => void;
  min?: number;
  max?: number;
}) {
  const start = useRef<{ position: number; value: number } | null>(null);
  const horizontal = side === "assets";
  function resize(next: number) {
    onResize(Math.max(min, Math.min(max, next)));
  }
  function release(e: PointerEvent<HTMLDivElement>, cancel = false) {
    const initial = start.current;
    start.current = null;
    if (cancel && initial) resize(initial.value);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  }
  return (
    <div
      role="separator"
      aria-label={horizontal ? "Resize Asset Browser" : `Resize ${side} panel`}
      aria-orientation={horizontal ? "horizontal" : "vertical"}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${Math.round(value)} pixels`}
      tabIndex={0}
      className={`panel-divider ${side}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        onBeforeResize?.();
        e.currentTarget.focus();
        start.current = { position: horizontal ? e.clientY : e.clientX, value };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!start.current || !e.currentTarget.hasPointerCapture(e.pointerId))
          return;
        resize(
          start.current.value +
            ((horizontal ? e.clientY : e.clientX) - start.current.position) *
              (side === "left" ? 1 : -1),
        );
      }}
      onPointerUp={(e) => release(e)}
      onPointerCancel={(e) => release(e, true)}
      onLostPointerCapture={(e) => release(e, true)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && start.current) {
          e.preventDefault();
          resize(start.current.value);
          start.current = null;
          return;
        }
        const keys = horizontal
          ? ["ArrowDown", "ArrowUp"]
          : side === "left"
            ? ["ArrowLeft", "ArrowRight"]
            : ["ArrowRight", "ArrowLeft"];
        if (keys.includes(e.key) || ["Home", "End"].includes(e.key)) {
          e.preventDefault();
          onBeforeResize?.();
          resize(
            e.key === "Home"
              ? min
              : e.key === "End"
                ? max
                : value + (e.key === keys[1] ? 10 : -10),
          );
        }
      }}
    />
  );
}
