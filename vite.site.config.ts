import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/** Page d'entrée du site : site/index.html, publiée à la racine du dossier de sortie (dist-site/index.html). */
const SITE_ENTRY = 'site/index.html';

function publishEntryAtRoot(): Plugin {
  return {
    name: 'magistra-site-entry',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const page = bundle[SITE_ENTRY];
      if (!page) throw new Error(`${SITE_ENTRY} absente du résultat de la construction du site.`);
      delete bundle[SITE_ENTRY];
      page.fileName = 'index.html';
      bundle['index.html'] = page;
    },
  };
}

// Construction du SITE VITRINE (npm run build:site → dist-site/) : présentation, téléchargement de l'application
// Windows, pages légales. Mêmes plugins et mêmes alias que l'application (vite.config.ts), mais ni l'API de
// développement (magistraDevApi), ni le service de connexion, ni le connecteur local, ni le code de l'application :
// le point d'entrée est src/site/main.tsx. Le build de l'application (dist/, utilisé par Electron) est inchangé.
// scripts/verify-site.mjs contrôle le résultat.
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss(), publishEntryAtRoot()],
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
      '@shared': path.resolve(root, 'shared'),
    },
  },
  // Seules les variables d'identité publiques (VITE_LEGAL_*, VITE_AUTHOR_*) atteignent le code du site : jamais une clé
  // de connexion (VITE_CLERK_PUBLISHABLE_KEY), même présente dans l'environnement du build.
  envPrefix: ['VITE_LEGAL_', 'VITE_AUTHOR_'],
  build: {
    outDir: 'dist-site',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: path.resolve(root, SITE_ENTRY) },
    chunkSizeWarningLimit: 700,
  },
});
