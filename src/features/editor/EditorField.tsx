import { useEffect, useId, useRef, useState } from "react";
import {
  beginGesture,
  cancelGesture,
  finishGesture,
  invalidateGesture,
} from "./store";

type Props = {
  sceneKey: string;
  id: string;
  label: string;
  value: number | string;
  onPreview: (value: number | string) => void;
  disabled?: boolean;
  type?: "number" | "text" | "color";
  min?: number;
  max?: number;
  step?: number;
};
/** A focus session is one reversible edit; invalid text stays outside the scene model. */
export default function EditorField({
  sceneKey,
  id,
  label,
  value,
  onPreview,
  disabled,
  type = "number",
  min,
  max,
  step = "any",
}: Omit<Props, "step"> & { step?: number | "any" }) {
  const [raw, setRaw] = useState(String(value)),
    [error, setError] = useState("");
  const inputId = useId();
  const editing = useRef(false),
    initial = useRef(String(value));
  useEffect(() => {
    if (!editing.current) setRaw(String(value));
  }, [value]);
  const valid = (text: string) =>
    type !== "number"
      ? !!text.trim() && text.length <= 160
      : !!text.trim() &&
        Number.isFinite(Number(text)) &&
        (min === undefined || Number(text) >= min) &&
        (max === undefined || Number(text) <= max);
  function cancel() {
    cancelGesture();
    editing.current = false;
    setRaw(initial.current);
  }
  return (
    <div className="editor-field">
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type={type}
        disabled={disabled}
        value={raw}
        step={step}
        min={min}
        max={max}
        maxLength={type === "text" ? 160 : undefined}
        aria-invalid={!!error}
        aria-describedby={error ? `${inputId}-error` : undefined}
        onFocus={() => {
          initial.current = String(value);
          editing.current = beginGesture(sceneKey, id, label, "inspector");
          setError("");
        }}
        onChange={(event) => {
          const text = event.target.value;
          setRaw(text);
          if (valid(text)) onPreview(type === "number" ? Number(text) : text);
          else invalidateGesture();
        }}
        onBlur={() => {
          if (!editing.current) return;
          if (valid(raw)) {
            editing.current = false;
            finishGesture();
          } else {
            cancel();
            setError("Enter a valid value. The previous value was restored.");
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
            event.currentTarget.blur();
          }
        }}
      />
      {error && (
        <small id={`${inputId}-error`} role="alert" className="error-text">
          {error}
        </small>
      )}
    </div>
  );
}
