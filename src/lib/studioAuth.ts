import { useEffect, useState } from 'react';
import { getIdTokenResult, onIdTokenChanged, type User } from 'firebase/auth';
import { firebase } from './firebase';

export function useStudioAuth() {
  const [state, setState] = useState<{ user: User | null; admin: boolean; checking: boolean; error: string }>({ user: null, admin: false, checking: !!firebase, error: '' });
  useEffect(() => {
    if (!firebase) return;
    let sequence = 0;
    const unsubscribe = onIdTokenChanged(firebase.auth, async user => {
      const request = ++sequence;
      setState({ user, admin: false, checking: !!user, error: '' });
      if (!user) return;
      try {
        const token = await getIdTokenResult(user);
        if (request === sequence) setState({ user, admin: token.claims.studioAdmin === true, checking: false, error: '' });
      } catch (error) {
        if (request === sequence) setState({ user, admin: false, checking: false, error: error instanceof Error ? error.message : 'Could not verify administrator access.' });
      }
    });
    return () => { sequence++; unsubscribe(); };
  }, []);
  return state;
}
export async function requireStudioAdmin() {
  if (!firebase) throw new Error('Firebase is not configured. Local editing remains available.');
  const user = firebase.auth.currentUser;
  if (!user) throw new Error('Sign in with a Studio administrator account.');
  if ((await getIdTokenResult(user)).claims.studioAdmin !== true) throw new Error('Cloud access requires studioAdmin: true. Refresh your sign-in after a trusted administrator grants access.');
  return firebase;
}
