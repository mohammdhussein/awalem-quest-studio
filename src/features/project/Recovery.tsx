import { useState } from 'react';
import { localDrafts, type RecoveryEntry } from '../../lib/repositories/local';
import Dialog from './Dialog';
import { downloadJson } from './export';
import { replaceFromCloud, useProject } from './store';
import { validateProject } from './validation';

/** Recovery uses the same validation and backup-before-replacement path as an explicit cloud load. */
export default function Recovery() {
  const [entries,setEntries] = useState<RecoveryEntry[] | null>(null);
  const [selected,setSelected] = useState<RecoveryEntry | null>(null);
  const [message,setMessage] = useState('');
  const [busy,setBusy] = useState(false);
  async function open() {
    try { setEntries(await localDrafts.recoveries()); setMessage(''); } catch (error) { useProject.setState({notice:String(error)}); }
  }
  async function restore() {
    if (!selected) return;
    setBusy(true);
    try {
      const project = validateProject(structuredClone(selected.project));
      await replaceFromCloud(project,useProject.getState().mutation);
      setSelected(null); setEntries(null); useProject.setState({notice:'Recovery snapshot restored. Previous drafts were backed up before replacement.'});
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Recovery failed. Current drafts were retained.'); }
    finally { setBusy(false); }
  }
  return <><button className="soft-btn" type="button" onClick={() => void open()}>Recovery</button>
    {entries && <Dialog title="Draft recovery" onClose={() => { if (!busy) { setEntries(null); setSelected(null); } }}>
      {selected ? <><p>Restore the snapshot from {new Date(selected.created_at).toLocaleString()}? This replaces the current project. A recovery copy of the current project will be saved first.</p><div className="dialog-actions"><button className="soft-btn" disabled={busy} onClick={() => setSelected(null)}>Cancel</button><button className="gold-btn" disabled={busy} onClick={() => void restore()}>Restore snapshot</button></div></> :
        <><p>Recovery copies are saved before cloud loads and snapshot restores. The newest 50 are listed; older records are retained.</p>{!entries.length && <p>No recovery snapshots yet. Use Backup project for a portable JSON copy.</p>}{entries.map(entry => <div className="recovery-row" key={entry.id}><span>{new Date(entry.created_at).toLocaleString()}<small>{entry.reason}</small></span><button className="soft-btn" onClick={() => downloadJson(entry.project,`awalem-recovery-${entry.id}.json`)}>Export</button><button className="soft-btn" onClick={() => { setMessage(''); setSelected(entry); }}>Restore…</button></div>)}</>}
      {message && <p role="alert" className="error-text">{message}</p>}
    </Dialog>}
  </>;
}
