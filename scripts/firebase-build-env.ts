// Build tooling only. Never import credentials or Admin SDK code into the client.
export const requiredFirebaseEnv = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID'
] as const;

export function validateFirebaseBuildEnv(env: Record<string, string | undefined>) {
  const missing = requiredFirebaseEnv.filter(key => !env[key]?.trim() || /^(?:your[_ -]|<|replace[_ -]|TODO|CHANGEME)/i.test(env[key]!));
  if (missing.length) throw new Error(`Missing Firebase build configuration: ${missing.join(', ')}. Set public Web App values in .env.local or the build environment.`);
  if (env.VITE_FIREBASE_PROJECT_ID !== 'awalem-quest-studio') throw new Error('VITE_FIREBASE_PROJECT_ID must be awalem-quest-studio for this Hosting build.');
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('VITE_')) continue;
    if (/PRIVATE[_-]?KEY|SERVICE[_-]?ACCOUNT|SECRET|PASSWORD|ACCESS[_-]?TOKEN|ADMIN[_-]?TOKEN/i.test(key) ||
        /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----|["'](?:type["']\s*:\s*["']service_account|private_key["']\s*:)/i.test(value ?? '')) {
      throw new Error(`Unsafe frontend environment variable: ${key}. Keep private credentials outside VITE_ variables and the web application.`);
    }
  }
}
