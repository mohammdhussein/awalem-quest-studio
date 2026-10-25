import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { loadEnv } from 'vite';

const root = process.cwd();
const dist = resolve(root, 'dist');
const javascript = [];
const privateCredential = /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----|["'](?:type["']\s*:\s*["']service_account|private_key["']\s*:)/i;
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected link in Hosting output: ${relative(dist, path)}`);
    if (entry.isDirectory()) { await inspect(path); continue; }
    if (/^\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/i.test(entry.name) || /service[-_]?account/i.test(entry.name)) {
      throw new Error(`Credential file must not be hosted: ${relative(dist, path)}`);
    }
    const content = await readFile(path, 'utf8');
    if (privateCredential.test(content)) throw new Error(`Private credentials detected in Hosting output: ${relative(dist, path)}`);
    if (entry.name.endsWith('.js')) javascript.push(content);
  }
}
await readFile(resolve(dist, 'index.html'));
await inspect(dist);
const bundle = javascript.join('\n');
// Read the same production files and shell overrides as the deployment build.
const env = loadEnv('production', root, 'VITE_');
const required = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'];
const optional = ['VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_MEASUREMENT_ID'];
for (const key of [...required, ...optional.filter(key => env[key])]) {
  if (!env[key] || !bundle.includes(env[key])) throw new Error(`${key} was not found in the production JavaScript. Rebuild with the production Web App configuration.`);
}
console.info('Hosting output verified: Firebase Web App configuration is bundled; no private-key/service-account files or signatures found.');
