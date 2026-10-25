import { useState } from 'react';
import { getIdToken, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { firebase } from '../lib/firebase';
import type { useStudioAuth } from '../lib/studioAuth';

export default function FirebasePanel({ auth, busy, run, load }: { auth: ReturnType<typeof useStudioAuth>; busy: boolean; run: (job: () => Promise<void>) => Promise<void>; load?: () => void }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  if (!firebase) return <p className="hint">Firebase is not configured. Local drafts and backups are available.</p>;
  if (auth.user) return <div className="auth-controls"><p className="hint">{auth.user.email}<br />{auth.checking ? 'Verifying administrator access…' : auth.admin ? 'Studio administrator verified. Connectivity is checked on save/load.' : 'Cloud access denied: studioAdmin: true is required.'}{auth.error}</p>
    {load && <button className="soft-btn" type="button" disabled={!auth.admin || busy} onClick={load}>Load cloud project</button>}
    <button className="soft-btn" type="button" disabled={busy} onClick={() => void run(async () => { await getIdToken(auth.user!, true); })}>Refresh access</button>
    <button className="soft-btn" type="button" disabled={busy} onClick={() => void run(async () => { const services = firebase; if (services) await signOut(services.auth); })}>Sign out</button></div>;
  return <form className="auth-controls" onSubmit={e => { e.preventDefault(); void run(async () => { const services = firebase; if (!services) return; await signInWithEmailAndPassword(services.auth,email,password); setPassword(''); }); }}>
    <label>Staff email<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
    <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
    <button className="gold-btn" type="submit" disabled={busy || !email || !password}>Sign in</button>
  </form>;
}
