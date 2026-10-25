import { useState } from 'react';
import { firebase } from '../lib/firebase';
import { cloudError } from '../lib/repositories/firestore';
import type { useStudioAuth } from '../lib/studioAuth';
import FirebasePanel from './FirebasePanel';

export default function StudioAccess({ auth }: { auth: ReturnType<typeof useStudioAuth> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(job: () => Promise<void>) {
    setBusy(true); setError('');
    try { await job(); } catch (cause) { setError(cloudError(cause)); }
    finally { setBusy(false); }
  }
  return <main className="studio-access"><section className="studio-access-card" aria-labelledby="studio-access-title">
    <h1 id="studio-access-title">Awalem Quest Studio</h1>
    <p>Sign in with an authorized studio administrator account to open the editor.</p>
    {!firebase ? <p role="alert">Firebase is not configured. Contact your studio administrator.</p> :
      auth.checking ? <p role="status">Verifying administrator access…</p> : <FirebasePanel auth={auth} busy={busy} run={run} />}
    {error && <p role="alert">{error}</p>}
  </section></main>;
}
