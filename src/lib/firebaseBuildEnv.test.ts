import { describe, expect, it } from 'vitest';
import { validateFirebaseBuildEnv } from '../../scripts/firebase-build-env';

const config = {
  VITE_FIREBASE_API_KEY: 'public-web-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'awalem-quest-studio.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'awalem-quest-studio',
  VITE_FIREBASE_APP_ID: 'public-web-app-id'
};
describe('Hosting build environment', () => {
  it('accepts public Firebase Web App configuration without optional Analytics or Storage', () => {
    expect(() => validateFirebaseBuildEnv(config)).not.toThrow();
  });
  it('rejects missing and placeholder values without printing values', () => {
    expect(() => validateFirebaseBuildEnv({ ...config, VITE_FIREBASE_AUTH_DOMAIN: ' ' })).toThrow('VITE_FIREBASE_AUTH_DOMAIN');
    expect(() => validateFirebaseBuildEnv({ ...config, VITE_FIREBASE_APP_ID: 'your_app_id' })).toThrow('VITE_FIREBASE_APP_ID');
  });
  it('rejects the wrong project', () => {
    expect(() => validateFirebaseBuildEnv({ ...config, VITE_FIREBASE_PROJECT_ID: 'another-project' })).toThrow('must be awalem-quest-studio');
  });
  it.each([
    ['VITE_SERVICE_ACCOUNT', 'hidden'],
    ['VITE_PRIVATE_KEY', 'hidden'],
    ['VITE_STAFF_PASSWORD', 'hidden'],
    ['VITE_CUSTOM_VALUE', '-----BEGIN PRIVATE KEY-----'],
    ['VITE_CUSTOM_VALUE', '{"type":"service_account"}'],
    ['VITE_CUSTOM_VALUE', '{"private_key":"hidden"}']
  ])('rejects private credentials in %s', (key, value) => {
    expect(() => validateFirebaseBuildEnv({ ...config, [key]: value })).toThrow(`Unsafe frontend environment variable: ${key}.`);
  });
});
