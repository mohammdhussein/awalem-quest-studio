import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { validateFirebaseBuildEnv } from './scripts/firebase-build-env';

export default defineConfig({
  plugins: [react(), {
    name: 'firebase-production-config',
    apply: 'build',
    configResolved(config) {
      if (!config.isProduction) throw new Error('Hosting builds require NODE_ENV=production so administrator authentication is enforced.');
      validateFirebaseBuildEnv(loadEnv(config.mode, config.envDir, 'VITE_'));
      console.info('Firebase production configuration verified for awalem-quest-studio.');
    }
  }],
  build: { outDir: 'dist' }
});
