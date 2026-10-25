import { useMemo, useState, type KeyboardEvent } from 'react';
import { createItem, deletionBlockers, duplicateScene, moveItem, renameItem, restoreItem, trashItem } from './commands';
import { branchKeys, breadcrumb, children, isTrashed, ordered, type ItemKind, type ProjectRecord } from './model';
import { useProject } from './store';
import Dialog from './Dialog';

const icons: Record<ItemKind, string> = { world: '◉', volume: '▣', mission: '⚑', folder: '▤', scene: '▧', asset: '▨' };
type Action = { type: 'create'|'rename'|'move'|'trash'; key: string | null };
export default function ProjectExplorer() {
  const { project: p, select, toggle, change } = useProject();
  const [search, setSearch] = useState('');
  const [trash, setTrash] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const [kind, setKind] = useState<ItemKind>('folder');
  const [name, setName] = useState('');
  const [parentKey, setParentKey] = useState('');
  const [error, setError] = useState('');
  const selected = p?.selected_key ? p.records[p.selected_key] : null;
  const available = useMemo(() => p ? ordered(Object.values(p.records).filter(r => !isTrashed(p, r.key))) : [], [p]);
  if (!p) return null;
  const item = action?.key ? p.records[action.key] : null;
  function open(type: Action['type'], target = selected?.key ?? null) {
    const source = target ? p!.records[target] : null;
    setError(''); setName(type === 'rename' ? source?.name ?? '' : '');
    const container = source && ['world','volume','mission','folder'].includes(source.kind) ? source : source?.parent_key ? p!.records[source.parent_key] : null;
    const defaultKind = container?.kind === 'world' ? 'volume' : container ? 'folder' : 'world';
    setKind(defaultKind); setParentKey(container?.key ?? '');
    setAction({ type, key: target }); setMenu(null);
  }
  const candidates = available.filter(r => {
    if (action?.type === 'move' && item) return ['volume','mission','folder'].includes(r.kind) && r.world_id === item.world_id && r.volume_id === item.volume_id &&
      !(item.kind === 'mission' && r.kind === 'mission') && !branchKeys(p, item.key).has(r.key);
    return kind === 'volume' ? r.kind === 'world' : ['volume','mission','folder'].includes(r.kind) && !(kind === 'mission' && r.kind === 'mission');
  });
  const resolvedParent = candidates.some(r => r.key === parentKey) ? parentKey : candidates[0]?.key ?? '';
  const blockers = action?.type === 'trash' && item ? deletionBlockers(p, item.key) : [];
  function submit() {
    try {
      // Validate on a copy here so a failed command keeps its dialog open.
      const copy = structuredClone(p!);
      if (action?.type === 'create') createItem(copy, kind, name, kind === 'world' ? null : resolvedParent);
      else if (item && action?.type === 'rename') renameItem(copy, item.key, name);
      else if (item && action?.type === 'move') moveItem(copy, item.key, resolvedParent);
      else if (item && action?.type === 'trash') trashItem(copy, item.key);
      change(project => Object.assign(project, copy)); setAction(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Action failed.'); }
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>, record: ProjectRecord) {
    if (event.key === 'F2') { event.preventDefault(); open('rename', record.key); }
    if (event.key === 'Delete') { event.preventDefault(); open('trash', record.key); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && record.kind === 'scene') {
      event.preventDefault(); change(project => { duplicateScene(project, record.key); });
    }
    if (event.key === 'ArrowRight') { event.preventDefault(); if (!p!.expanded.includes(record.key)) toggle(record.key); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); if (p!.expanded.includes(record.key)) toggle(record.key); }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void select(record.key); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const rows = Array.from(event.currentTarget.closest('[role=tree]')!.querySelectorAll<HTMLElement>('[role=treeitem]'));
      const index = rows.indexOf(event.currentTarget); rows[index + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
    }
  }
  const matches = (record: ProjectRecord): boolean => record.name.toLowerCase().includes(search.toLowerCase()) ||
    [...branchKeys(p, record.key)].some(key => p.records[key]?.name.toLowerCase().includes(search.toLowerCase()));
  function row(record: ProjectRecord, depth: number) {
    if (isTrashed(p!, record.key) || (search && !matches(record))) return null;
    const nested = children(p!, record.key).filter(r => !isTrashed(p!, r.key));
    const expanded = !!search || p!.expanded.includes(record.key);
    return <div key={record.key} role="none">
      <div role="treeitem" aria-label={record.name} aria-level={depth + 1} aria-expanded={nested.length ? expanded : undefined}
        aria-selected={p!.selected_key === record.key} tabIndex={0} className={`tree-row ${p!.selected_key === record.key ? 'active' : ''}`}
        style={{ paddingInlineStart: 7 + depth * 14 }} title={`${record.name} · ${record.kind}${p!.dirty.includes(record.key) ? ' · Local changes' : ''}`}
        onClick={() => void select(record.key)} onKeyDown={event => keyDown(event, record)}
        onContextMenu={event => { event.preventDefault(); setMenu({ key: record.key, x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 240) }); }}
        draggable={!['world','volume'].includes(record.kind)} onDragStart={event => { event.dataTransfer.setData('application/x-awalem-item', record.key); event.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={event => { if (['volume','mission','folder'].includes(record.kind)) event.preventDefault(); }}
        onDrop={event => { event.preventDefault(); event.stopPropagation(); const key = event.dataTransfer.getData('application/x-awalem-item'); if (key) change(project => moveItem(project, key, record.key)); }}>
        <button type="button" className="tree-expand" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${record.name}`} tabIndex={-1}
          onClick={event => { event.stopPropagation(); toggle(record.key); }}>{nested.length ? expanded ? '▾' : '▸' : '·'}</button>
        <span className={`item-icon ${record.kind}`}>{icons[record.kind]}</span><span className="tree-name">{record.name}</span>
        {p!.dirty.includes(record.key) && <span className="dirty-mark" aria-label="Local changes">•</span>}
        <button type="button" className="tree-menu" aria-label={`Actions for ${record.name}`} onClick={event => { event.stopPropagation(); setMenu({ key: record.key, x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 240) }); }}>⋯</button>
      </div>
      {expanded && <div role="group">{nested.map(child => row(child, depth + 1))}</div>}
    </div>;
  }
  return <section className="project-explorer">
    <div className="panel-heading"><span>PROJECT EXPLORER</span><button type="button" className="icon-button" title="Create world, volume, mission, folder, or scene" onClick={() => open('create')}>+ New</button></div>
    <input type="search" aria-label="Search project" placeholder="Search project…" value={search} onChange={e => setSearch(e.target.value)} />
    <div className="explorer-actions"><button type="button" onClick={() => setTrash(!trash)}>{trash ? 'Project' : 'Trash'}</button><button type="button" disabled={!selected || trash} onClick={() => open('rename')}>Rename</button><button type="button" disabled={!selected || trash || ['world','volume'].includes(selected.kind)} onClick={() => open('move')}>Move</button></div>
    {trash ? <div className="trash-list"><p className="hint">Deleted branches retain their records and uploaded files.</p>{Object.values(p.records).filter(r => r.deleted_at).map(record => <div key={record.key} className="trash-row"><span>{icons[record.kind]} {record.name}</span><button type="button" onClick={() => change(project => restoreItem(project, record.key))}>Restore</button></div>)}{!Object.values(p.records).some(r => r.deleted_at) && <p className="hint">Trash is empty.</p>}</div> :
      <div role="tree" aria-label="Project hierarchy" className="project-tree">{children(p, null).map(record => row(record, 0))}{!available.length && <p className="hint">Create a world to begin, or restore one from Trash.</p>}</div>}
    {menu && <><div className="menu-dismiss" onClick={() => setMenu(null)} onContextMenu={e => { e.preventDefault(); setMenu(null); }} /><div className="context-menu" role="menu" style={{ left: menu.x, top: menu.y }} onKeyDown={e => { if (e.key === 'Escape') setMenu(null); }}>
      <button autoFocus role="menuitem" onClick={() => open('create', menu.key)}>New…</button>
      <button role="menuitem" onClick={() => open('rename', menu.key)}>Rename <small>F2</small></button>
      {!['world','volume'].includes(p.records[menu.key].kind) && <button role="menuitem" onClick={() => open('move', menu.key)}>Move…</button>}
      {p.records[menu.key].kind === 'scene' && <button role="menuitem" onClick={() => { change(project => { duplicateScene(project, menu.key); }); setMenu(null); }}>Duplicate scene <small>Ctrl+D</small></button>}
      <button role="menuitem" className="danger-text" onClick={() => open('trash', menu.key)}>Move to Trash <small>Delete</small></button>
    </div></>}
    {action && <Dialog title={action.type === 'create' ? 'Create project item' : action.type === 'trash' ? 'Move to Trash' : `${action.type === 'rename' ? 'Rename' : 'Move'} ${item?.name ?? 'item'}`} onClose={() => setAction(null)}>
      <form onSubmit={e => { e.preventDefault(); submit(); }}>
        {action.type === 'create' && <label>Item type<select value={kind} onChange={e => setKind(e.target.value as ItemKind)}>{(['world','volume','mission','folder','scene'] as const).map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
        {['create','rename'].includes(action.type) && <label>Name<input autoFocus required maxLength={160} value={name} onChange={e => setName(e.target.value)} /></label>}
        {(action.type === 'move' || (action.type === 'create' && kind !== 'world')) && <label>Destination<select aria-label="Destination" value={resolvedParent} onChange={e => setParentKey(e.target.value)}>{candidates.map(r => <option value={r.key} key={r.key}>{breadcrumb(p,r.key)}</option>)}</select>{!candidates.length && <span className="error-text">Create a compatible parent first.</span>}</label>}
        {action.type === 'trash' && item && <><p>Move “{item.name}” and {branchKeys(p, item.key).size - 1} contained items to Trash? You can restore this branch later.</p>{blockers.length > 0 && <div className="error-text">Referenced content cannot be deleted:<ul>{blockers.map(b => <li key={b}>{b}</li>)}</ul></div>}</>}
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="dialog-actions"><button type="button" className="soft-btn" onClick={() => setAction(null)}>Cancel</button><button className={action.type === 'trash' ? 'danger-btn' : 'gold-btn'} type="submit" disabled={!!blockers.length || ((action.type === 'move' || (action.type === 'create' && kind !== 'world')) && !resolvedParent)}>{action.type === 'create' ? 'Create' : action.type === 'trash' ? 'Move to Trash' : 'Apply'}</button></div>
      </form>
    </Dialog>}
  </section>;
}
