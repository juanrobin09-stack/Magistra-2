// Construction du harnais E2E du connecteur local (e2e/connector-harness) : page de test qui monte les VRAIS
// composants du site (carte Magistra locale, réglages du moteur, section Windows, page Générer) avec le VRAI
// contrôleur et le VRAI client du connecteur. Configuration distincte de celle du site (vite.config.ts) : le harnais
// n'entre jamais dans le build de production (dist/) ; il sort dans test-results/connector-harness-dist.
//
// Construit par e2e/connector-local.spec.ts avant les tests :
//   npx vite build --config e2e/connector-harness/vite.config.ts

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');

/** Dossier de sortie (dans test-results/, jamais publié ; Playwright le vide au début de chaque lancement). */
export const HARNESS_OUT_DIR = path.join(root, 'test-results', 'connector-harness-dist');

export default defineConfig({
  root: here,
  base: '/',
  // Aucune variable d'environnement du projet (.env*) n'est lue : le harnais n'en a pas besoin.
  envDir: here,
  plugins: [react(), tailwindcss()],
  resolve: {
    // Mêmes alias que le site (vite.config.ts).
    alias: {
      '@': path.resolve(root, 'src'),
      '@shared': path.resolve(root, 'shared'),
    },
  },
  worker: { format: 'es' },
  build: {
    outDir: HARNESS_OUT_DIR,
    emptyOutDir: true,
    chunkSizeWarningLimit: 5_000,
    reportCompressedSize: false,
  },
});
