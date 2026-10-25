// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { User } from 'firebase/auth';
import App from './App';
import { initializeProject, useProject } from './features/project/store';

const access = vi.hoisted(() => ({
  state: { user: null as User | null, admin: false, checking: false, error: '' },
  configured: true
}));
vi.mock('./lib/firebase', () => ({ get firebase() { return access.configured ? { auth: {}, db: {}, storage: null } : null; } }));
vi.mock('./lib/studioAuth', () => ({ useStudioAuth: () => access.state, requireStudioAdmin: vi.fn() }));
vi.mock('./features/project/store', async importOriginal => ({
  ...await importOriginal<typeof import('./features/project/store')>(), initializeProject: vi.fn()
}));
vi.mock('./components/SceneViewport', () => ({ default: () => <div>Editor viewport</div> }));

beforeEach(() => {
  vi.stubEnv('PROD', true);
  vi.mocked(initializeProject).mockClear();
  access.state = { user: null, admin: false, checking: false, error: '' };
  access.configured = true;
  useProject.setState({ project: null, ready: false });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

describe('production editor access', () => {
  it('requires sign-in before mounting the editor or opening drafts', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByText('Editor viewport')).toBeNull();
    expect(initializeProject).not.toHaveBeenCalled();
  });
  it('denies a signed-in user without the studioAdmin claim', () => {
    access.state.user = { email: 'staff@example.test' } as User;
    render(<App />);
    expect(screen.getByText(/Cloud access denied/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load cloud project' })).toBeNull();
    expect(initializeProject).not.toHaveBeenCalled();
  });
  it('keeps the editor closed while permissions are being checked', () => {
    access.state = { user: { email: 'admin@example.test' } as User, admin: true, checking: true, error: '' };
    render(<App />);
    expect(screen.getByRole('status').textContent).toContain('Verifying administrator');
    expect(initializeProject).not.toHaveBeenCalled();
  });
  it('opens the editor for a verified administrator and closes it if access changes', () => {
    access.state = { user: { email: 'admin@example.test' } as User, admin: true, checking: false, error: '' };
    const view = render(<App />);
    expect(initializeProject).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toContain('Opening Awalem Quest Studio drafts');
    access.state.admin = false;
    view.rerender(<App />);
    expect(screen.getByText(/Cloud access denied/)).toBeTruthy();
    access.state.user = null;
    view.rerender(<App />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
  });
  it('fails closed when Firebase is unavailable or token verification fails', () => {
    access.configured = false;
    const view = render(<App />);
    expect(screen.getByRole('alert').textContent).toContain('Firebase is not configured');
    access.configured = true;
    access.state = { user: { email: 'admin@example.test' } as User, admin: false, checking: false, error: 'Token verification failed' };
    view.rerender(<App />);
    expect(screen.getByText(/Token verification failed/)).toBeTruthy();
    expect(initializeProject).not.toHaveBeenCalled();
  });
});
