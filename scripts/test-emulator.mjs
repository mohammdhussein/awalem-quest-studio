import { spawn } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';
import { createServer } from 'node:net';

// Always use a demo project. Never inherit debug-mode environment dumps into test output.
const env = { ...process.env, DEBUG: '' };
// Own the server process tree so Windows Java children cannot be left on the test ports.
for (const port of [8086,9198,4400]) await new Promise((resolve,reject) => {
  const probe = createServer(); probe.once('error',() => reject(new Error(`Test port ${port} is busy. Stop the existing emulator before retrying.`)));
  probe.listen(port,'127.0.0.1',() => probe.close(resolve));
});
const server = spawn(process.execPath,[resolvePath('node_modules/firebase-tools/lib/bin/firebase.js'),
  'emulators:start','--config','firebase.emulators.json','--project','demo-awalem-studio','--only','firestore,storage'],
{env,stdio:'inherit',windowsHide:true,detached:process.platform !== 'win32'});
let failure;
server.once('error',error => { failure = error; });
server.once('exit',code => { failure ??= new Error(`Emulators stopped before tests finished (${code}).`); });
try {
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (failure) throw failure;
    try {
      const hub = await (await fetch('http://127.0.0.1:4400/emulators')).json();
      if (hub.firestore?.port === 8086 && hub.storage?.port === 9198) {
        await Promise.all([fetch('http://127.0.0.1:8086/'),fetch('http://127.0.0.1:9198/')]); ready = true; break;
      }
    } catch { /* Wait for both local services. */ }
    await new Promise(resolve => setTimeout(resolve,1000));
  }
  if (!ready) throw new Error('Local Firebase emulators did not become ready within 90 seconds.');
  process.exitCode = await new Promise((resolve,reject) => {
    const tests = spawn(process.execPath,[resolvePath('node_modules/vitest/vitest.mjs'),'run','--config','vitest.emulator.config.ts'],
      {env:{...env,GCLOUD_PROJECT:'demo-awalem-studio',FIREBASE_EMULATOR_HUB:'127.0.0.1:4400',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8086',FIREBASE_STORAGE_EMULATOR_HOST:'127.0.0.1:9198'},stdio:'inherit',windowsHide:true});
    tests.once('error',reject); tests.once('exit',code => resolve(code ?? 1));
  });
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  if (process.platform === 'win32') await new Promise(resolve => {
    const cleanup = spawn('taskkill.exe',['/PID',String(server.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
    cleanup.once('exit',resolve); cleanup.once('error',resolve);
  });
  else try { process.kill(-server.pid,'SIGTERM'); } catch { /* Server already exited. */ }
}
