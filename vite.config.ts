import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { magistraDevApi } from './server/viteDevApi';
import { pdfAssets } from './scripts/pdfAssets';
import { ocrAssets } from './scripts/ocrAssets';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // Variables serveur (AI_BASE_URL, CLERK_SECRET_KEY…) : lues côté Node uniquement,
  // jamais exposées au navigateur (seules les variables VITE_* le sont).
  const env = loadEnv(mode, root, '');
  return {
    base: '/',
    plugins: [react(), tailwindcss(), pdfAssets(), ocrAssets(), magistraDevApi(env)],
    resolve: {
      alias: {
        '@': path.resolve(root, 'src'),
        '@shared': path.resolve(root, 'shared'),
      },
    },
    // server.fs.deny est complété par magistraDevApi : le dossier de données du mode personnel (.magistra-data ou
    // MAGISTRA_DATA_DIR : jeton d'accès secret, historique, profil) n'est jamais servi par Vite.
    server: { port: 5173 },
    worker: { format: 'es' },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      chunkSizeWarningLimit: 700,
    },
  };
});
