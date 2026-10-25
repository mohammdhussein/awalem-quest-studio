import type { Layer, SceneEntity } from '../data/scene';

export default function EntityInspector({ selected, patch, remove }: { selected: SceneEntity; patch: (value: Partial<SceneEntity>) => void; remove: () => void }) {
  return <div className="inspector-form">
    <label>Name<input value={selected.name} onChange={e => patch({ name: e.target.value })} /></label>
    <div className="grid-inputs"><label>X<input type="number" value={selected.x} onChange={e => patch({ x: Number(e.target.value) })} /></label><label>Y<input type="number" value={selected.y} onChange={e => patch({ y: Number(e.target.value) })} /></label></div>
    <div className="grid-inputs"><label>Scale<input type="number" step="0.1" min="0.1" max="4" value={selected.scale} onChange={e => patch({ scale: Math.max(.1, Math.min(4, Number(e.target.value))) })} /></label><label>Rotation°<input type="number" value={selected.rotation} onChange={e => patch({ rotation: Number(e.target.value) })} /></label></div>
    <label>Layer<select value={selected.layer} onChange={e => patch({ layer: e.target.value as Layer })}><option value="background">Background</option><option value="playfield">Playfield</option><option value="foreground">Foreground</option></select></label>
    <label>Depth offset<input type="number" value={selected.depth} onChange={e => patch({ depth: Number(e.target.value) })} /></label>
    <label>Color<input type="color" value={selected.color} onChange={e => patch({ color: e.target.value })} /></label>
    <div className="section-heading panel-heading">INTERACTION</div>
    <label>On click<select value={selected.interaction?.type ?? 'none'} onChange={e => patch({ interaction: { type: e.target.value as 'none'|'show_fact'|'play_audio' } })}><option value="none">None</option><option value="show_fact">Show fact (definition)</option><option value="play_audio">Play sound (definition)</option></select></label>
    <p className="hint">Interaction definitions are saved as data. Gameplay execution is a later phase.</p>
    <button className="danger-btn" type="button" onClick={remove}>Delete object</button>
  </div>;
}
