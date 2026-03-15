import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Electron plugin is only loaded when BUILD_TARGET=electron
// This keeps the standard web build (for Vercel) unchanged.
const isElectron = process.env.BUILD_TARGET === 'electron'

async function getPlugins() {
  if (!isElectron) return []
  const { default: electron } = await import('vite-plugin-electron/simple')
  return [
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          resolve: { alias: { '@': path.resolve(__dirname, './src') } },
          build: {
            outDir: 'dist-electron',
            rollupOptions: { external: ['electron'] },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: { outDir: 'dist-electron' },
        },
      },
    }),
  ]
}

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss(), ...(await getPlugins())],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      // In Electron dev mode, the main process runs an API server on 3721.
      // This proxy lets the Vite dev server forward /api/* calls to it.
      '/api': {
        target: 'http://127.0.0.1:3721',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
}))
