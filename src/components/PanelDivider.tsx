export function readPanelSize(side: string, fallback: number) {
  try { const value = Number(localStorage.getItem(`awalem-panel-${side}`)); return value >= 210 && value <= 440 ? value : fallback; } catch { return fallback; }
}
export default function PanelDivider({ side, width, onResize }: { side: 'left'|'right'; width: number; onResize: (value: number) => void }) {
  function resize(value: number) {
    const next = Math.max(210, Math.min(440, value)); onResize(next);
    try { localStorage.setItem(`awalem-panel-${side}`, String(next)); } catch { /* Optional UI preference. */ }
  }
  return <div role="separator" aria-label={`Resize ${side} panel`} aria-orientation="vertical" aria-valuemin={210} aria-valuemax={440} aria-valuenow={width} tabIndex={0} className={`panel-divider ${side}`}
    onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.dataset.start = `${e.clientX},${width}`; }}
    onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; const [x, initial] = e.currentTarget.dataset.start!.split(',').map(Number); resize(initial + (e.clientX - x) * (side === 'left' ? 1 : -1)); }}
    onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
    onKeyDown={e => { if (['ArrowLeft','ArrowRight'].includes(e.key)) { e.preventDefault(); resize(width + (e.key === 'ArrowRight' ? 10 : -10) * (side === 'left' ? 1 : -1)); } }} />;
}
