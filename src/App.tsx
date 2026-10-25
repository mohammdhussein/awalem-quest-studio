import { useEffect, useRef, useState } from 'react';
import type { SceneEntity, Shape } from './data/scene';
import { uploadSprite } from './lib/cloud';
import { requireStudioAdmin, useStudioAuth } from './lib/studioAuth';
import { acknowledgeSaves, cloudError, FirestoreProjectRepository } from './lib/repositories/firestore';
import { localDrafts } from './lib/repositories/local';
import SceneViewport from './components/SceneViewport';
import EntityInspector from './components/EntityInspector';
import FirebasePanel from './components/FirebasePanel';
import PanelDivider, { readPanelSize } from './components/PanelDivider';
import ProjectExplorer from './features/project/ProjectExplorer';
import ItemInspector from './features/project/ItemInspector';
import Dialog from './features/project/Dialog';
import Recovery from './features/project/Recovery';
import { downloadJson } from './features/project/export';
import { flushDraft, initializeProject, persistProjectState, replaceFromCloud, useProject } from './features/project/store';
import { addAsset, markChanged } from './features/project/commands';
import { isTrashed, volumeKey, type AssetRecord } from './features/project/model';
import AssetBrowser from './features/assets/AssetBrowser';
import { imageDimensions, missingReferences } from './features/assets/catalog';
import StudioAccess from './components/StudioAccess';

const availableShapes: Shape[] = ['fish', 'coral', 'bird', 'plant', 'rock', 'crystal', 'hotspot'];
const colors: Record<Shape, string> = { fish: '#ffd16f', coral: '#fc8d9e', bird: '#f6b968', plant: '#63c6a3', rock: '#94b0b5', crystal: '#bdeaff', hotspot: '#ffe5a3', image: '#c3e1ff' };
export default function App() {
  const auth = useStudioAuth();
  if (import.meta.env.PROD && (!auth.user || !auth.admin || auth.checking || auth.error)) return <StudioAccess auth={auth} />;
  return <StudioEditor auth={auth} />;
}

function StudioEditor({ auth }: { auth: ReturnType<typeof useStudioAuth> }) {
  const { project, ready, localStatus, localError, notice, change, editEntity, select } = useProject();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shape, setShape] = useState<Shape>('fish');
  const [status, setStatus] = useState('Local drafts save automatically. Cloud save/load is explicit.');
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState<number | null>(null);
  const [confirmLoad, setConfirmLoad] = useState(false);
  const [leftWidth, setLeftWidth] = useState(() => readPanelSize('left', 280));
  const [rightWidth, setRightWidth] = useState(() => readPanelSize('right', 270));
  const fileInput = useRef<HTMLInputElement>(null);
  const active = project?.active_scene_key ? project.records[project.active_scene_key] : null;
  const sceneRecord = active?.kind === 'scene' && project && !isTrashed(project, active.key) ? active : null;
  const scene = sceneRecord?.scene;
  const selectedRecord = project?.selected_key ? project.records[project.selected_key] : null;
  const selected = scene?.entities.find(e => e.id === selectedId) ?? null;
  const context = selectedRecord?.volume_id ? selectedRecord : sceneRecord;
  const volume = project && context?.volume_id ? project.records[volumeKey(context.world_id, context.volume_id)] : null;
  const sceneWorld = project && sceneRecord ? project.records[`studio_worlds/${sceneRecord.world_id}`] : null;
  const sceneVolume = project && sceneRecord ? project.records[volumeKey(sceneRecord.world_id, sceneRecord.volume_id!)] : null;
  useEffect(() => { void initializeProject(); }, []);
  useEffect(() => { setSelectedId(null); }, [sceneRecord?.key]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (useProject.getState().localStatus !== 'saved') { event.preventDefault(); event.returnValue = ''; } };
    const flush = () => { void flushDraft().catch(() => {}); };
    window.addEventListener('beforeunload', warn); window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', flush);
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', flush); };
  }, []);
  async function withBusy(job: () => Promise<void>) {
    setBusy(true);
    try { await job(); } catch (error) { setStatus(cloudError(error)); }
    finally { setBusy(false); setProgress(null); }
  }
  function addEntity(newShape: Shape, extras: Partial<SceneEntity> = {}, target = sceneRecord?.key) {
    if (!target) { setStatus('Open a scene before adding an object.'); return; }
    const id = crypto.randomUUID();
    change(p => {
      const record = p.records[target];
      if (record?.kind !== 'scene' || isTrashed(p, target)) throw new Error('The target scene is unavailable.');
      record.scene.entities.push({ id, name: `${newShape === 'image' ? 'Sprite' : newShape} ${record.scene.entities.length + 1}`, shape: newShape,
        layer: 'playfield', x: 480, y: 375, scale: 1, rotation: 0, depth: 0, color: colors[newShape], interaction: { type: 'none' }, ...extras });
      markChanged(p, record);
      if (p.active_scene_key === target) p.selected_key = target;
    });
    if (useProject.getState().project?.active_scene_key === target) setSelectedId(id);
  }
  function useAsset(asset: AssetRecord, position?: { x: number; y: number }) {
    if (!sceneRecord || asset.world_id !== sceneRecord.world_id || asset.volume_id !== sceneRecord.volume_id) { setStatus('Open a scene in this asset’s volume before adding it.'); return; }
    addEntity('image', { name: asset.name, assetId: asset.id, assetUrl: asset.url, ...(asset.storage_path ? { assetPath: asset.storage_path } : {}), ...position });
  }
  async function saveCloud() {
    await withBusy(async () => {
      const services = await requireStudioAdmin(); await flushDraft();
      const result = await new FirestoreProjectRepository(services.db).save(structuredClone(useProject.getState().project!));
      const current = structuredClone(useProject.getState().project!);
      acknowledgeSaves(current, result.saved); persistProjectState(current); await flushDraft();
      setStatus(result.failures.length ? `Saved ${result.saved.length} records. Unsaved scopes: ${result.failures.map(f => `${f.scope}: ${f.message}`).join(' | ')}` :
        result.saved.length ? `Firebase confirmed ${result.saved.length} records. Acknowledged drafts are retained locally.` : 'No pending changes to save.');
    });
  }
  async function loadCloud() {
    setConfirmLoad(false);
    await withBusy(async () => {
      const requestMutation = useProject.getState().mutation;
      const services = await requireStudioAdmin();
      setStatus('Loading cloud project. Local drafts stay available until validation completes…');
      const loaded = await new FirestoreProjectRepository(services.db).load();
      await replaceFromCloud(loaded, requestMutation);
      setStatus('Cloud project loaded. Previous drafts are retained in browser recovery storage. Missing cloud content remains a local starter draft.');
    });
  }
  async function uploadImage(file?: File) {
    if (!file || !context?.volume_id) return;
    const targetWorld = context.world_id, targetVolume = context.volume_id;
    const targetScene = sceneRecord?.world_id === targetWorld && sceneRecord?.volume_id === targetVolume ? sceneRecord.key : null;
    const parent = selectedRecord && ['volume','mission','folder'].includes(selectedRecord.kind) && selectedRecord.volume_id === targetVolume && selectedRecord.world_id === targetWorld ? selectedRecord.key : volumeKey(targetWorld, targetVolume);
    await withBusy(async () => {
      await requireStudioAdmin();
      if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size >= 10 * 1024 * 1024) throw new Error('Choose a PNG, JPEG, or WebP smaller than 10MB.');
      const dimensions = await imageDimensions(file); setProgress(0);
      const uploaded = await uploadSprite(file, targetWorld, targetVolume, setProgress);
      let imported: AssetRecord | undefined;
      change(p => { imported = addAsset(p, parent, { name: file.name, url: uploaded.url, storage_path: uploaded.path, ...dimensions, size: file.size, mime: file.type }); });
      if (!imported) {
        downloadJson({ ...uploaded, ...dimensions, name: file.name, world_id: targetWorld, volume_id: targetVolume }, 'awalem-upload-recovery.json');
        throw new Error('File uploaded, but its destination is unavailable. A recovery receipt was exported; metadata was not saved.');
      }
      const current = useProject.getState().project!;
      if (targetScene && current.records[targetScene] && !isTrashed(current, targetScene)) addEntity('image', { name: file.name, assetId: imported.id, assetUrl: imported.url, assetPath: uploaded.path }, targetScene);
      await flushDraft();
      setStatus('Image file uploaded to Storage. Asset metadata and scene changes are local drafts; use Save to Firebase to save them.');
    });
  }
  if (!ready || !project) return <div className="loading-screen" role="status">Opening Awalem Quest Studio drafts…</div>;
  const missing = missingReferences(project);
  return <div className="app">
    <header className="topbar"><div className="brand"><div className="brand-mark">A</div><div><strong>Awalem Quest Studio</strong><small>2.5D world editor</small></div></div>
      <div className="header-actions"><span className={`save-state ${localStatus}`} role="status">{localStatus === 'saved' ? 'Draft saved locally' : localStatus === 'saving' ? 'Saving draft…' : 'Draft save failed'} · {project.dirty.length} pending cloud</span>
        <button className="soft-btn" type="button" disabled={!scene} onClick={() => scene && downloadJson(scene, `${scene.world_id}-${scene.volume_id}-${scene.scene_id}.scene.json`)}>Export scene</button>
        <button className="soft-btn" type="button" onClick={() => downloadJson({ format: 'awalem-project-backup', schema_version: 2, project }, 'awalem-project-backup.json')}>Backup project</button>
        <Recovery />
        <button className="gold-btn" type="button" disabled={!auth.admin || busy} onClick={() => void saveCloud()}>Save to Firebase</button></div>
    </header>
    {localError && <div className="error-banner" role="alert">{localError}<button type="button" onClick={() => void flushDraft().catch(() => {})}>Retry local save</button><button type="button" onClick={() => void localDrafts.read(false).then(raw => downloadJson(raw ?? {}, 'awalem-stored-recovery.json')).catch(error => setStatus(String(error)))}>Export stored data</button></div>}
    {!!missing.length && <div className="reference-banner" role="status">{missing.length} missing references: {missing.slice(0,3).map(r => r.message).join(' ')}{missing.length > 3 ? ' Inspect other scenes to resolve the remaining references.' : ''}</div>}
    <div className="workspace" style={{ gridTemplateColumns: `${leftWidth}px 5px minmax(260px,1fr) 5px ${rightWidth}px` }}>
      <aside className="left-panel"><ProjectExplorer /><div className="panel-heading section-heading"><span>SCENE OBJECTS</span><span>{scene?.entities.length ?? 0}</span></div>
        <div className="object-list">{scene?.entities.map(entity => <button type="button" key={entity.id} className={`object-button ${selectedId === entity.id ? 'active' : ''}`} onClick={() => { void select(sceneRecord!.key); setSelectedId(entity.id); }}><span className="object-glyph">◈</span><span>{entity.name}</span><span className="layer-tag">{entity.layer.slice(0,2).toUpperCase()}</span></button>)}</div></aside>
      <PanelDivider side="left" width={leftWidth} onResize={setLeftWidth} />
      <main className="center-panel"><div className="scene-toolbar"><div className="breadcrumbs">{sceneWorld?.name ?? 'Project'} <span>/</span> {sceneVolume?.name ?? 'Choose a volume'} <span>/</span> {sceneRecord?.name ?? 'No scene open'}</div><div className="mode-label">● LAYERED 2.5D</div></div>
        <div className="viewport-wrap" onDragOver={e => { if (e.dataTransfer.types.includes('application/x-awalem-asset')) e.preventDefault(); }} onDrop={e => {
          e.preventDefault(); const asset = project.records[e.dataTransfer.getData('application/x-awalem-asset')]; if (asset?.kind !== 'asset') return;
          const rect = e.currentTarget.getBoundingClientRect(), scale = Math.min(rect.width / 960, rect.height / 540);
          useAsset(asset, { x: Math.round(Math.max(0, Math.min(960, (e.clientX - rect.left - (rect.width - 960 * scale) / 2) / scale))), y: Math.round(Math.max(0, Math.min(540, (e.clientY - rect.top - (rect.height - 540 * scale) / 2) / scale))) });
        }}>
          {scene && sceneRecord ? <SceneViewport scene={scene} selectedId={selectedId} onSelect={id => { setSelectedId(id); if (project.selected_key !== sceneRecord.key) void select(sceneRecord.key); }} onMove={(id,x,y) => editEntity(sceneRecord.key,id,{x,y})} /> : <div className="viewport-empty"><h2>No scene open</h2><p>Create a scene in a volume, mission, or folder, or open one from the explorer.</p></div>}
          <span className="viewport-label">SCENE VIEW · 960 × 540</span><span className="viewport-help">Drag objects to reposition · Drop catalog assets here</span>
        </div>
        <section className="assets"><div className="asset-title"><strong>Asset browser {volume ? `· ${volume.name}` : ''}</strong><small>Original images are retained</small></div>
          <div className="asset-controls"><select aria-label="Choose placeholder type" value={shape} onChange={e => setShape(e.target.value as Shape)}>{availableShapes.map(s => <option key={s}>{s}</option>)}</select><button className="soft-btn" type="button" disabled={!scene} onClick={() => addEntity(shape)}>+ Add sample</button><button className="soft-btn" type="button" disabled={!auth.admin || busy || !context?.volume_id} onClick={() => fileInput.current?.click()}>Upload sprite</button><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { void uploadImage(e.target.files?.[0]); e.target.value = ''; }} />{progress !== null && <progress aria-label="Image upload progress" max={100} value={progress} />}</div>
          {context?.volume_id ? <AssetBrowser worldId={context.world_id} volumeId={context.volume_id} onAdd={useAsset} /> : <p className="hint">Choose a volume to browse reusable images.</p>}</section>
        <div className="status-line" role="status">{busy && <span className="working-indicator">Working… </span>}{notice || status}</div>
      </main>
      <PanelDivider side="right" width={rightWidth} onResize={setRightWidth} />
      <aside className="right-panel"><div className="panel-heading"><span>INSPECTOR</span><span>2.5D</span></div>
        {selectedRecord && selectedRecord.kind !== 'scene' ? <ItemInspector record={selectedRecord} /> : selected && sceneRecord ? <EntityInspector selected={selected} patch={patch => editEntity(sceneRecord.key,selected.id,patch)} remove={() => { change(p => { const record = p.records[sceneRecord.key]; if (record.kind === 'scene') { record.scene.entities = record.scene.entities.filter(e => e.id !== selectedId); markChanged(p, record); } }); setSelectedId(null); }} /> : <p className="hint">Select a scene object, mission, folder, or asset to inspect it.</p>}
        <div className="panel-heading section-heading"><span>FIREBASE</span></div><FirebasePanel auth={auth} busy={busy} run={withBusy} load={() => project.dirty.length ? setConfirmLoad(true) : void loadCloud()} />
      </aside>
    </div>
    {confirmLoad && <Dialog title="Load cloud project?" onClose={() => setConfirmLoad(false)}><p>This replaces the local project with cloud content. {project.dirty.length} records have pending local changes. A browser recovery copy will be retained before replacement.</p><p>Use Backup project first for a portable copy.</p><div className="dialog-actions"><button className="soft-btn" onClick={() => setConfirmLoad(false)}>Cancel</button><button className="gold-btn" onClick={() => void loadCloud()}>Load and keep recovery copy</button></div></Dialog>}
  </div>;
}
