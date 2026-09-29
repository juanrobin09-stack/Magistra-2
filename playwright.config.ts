import { defineConfig, devices } from '@playwright/test';
import { LOCAL_NETWORK_ACCESS_ARGS } from './e2e/connector-harness/sites';
import { E2E_OUTPUT_DIRS } from './e2e/outputDirs';

// Tests de bout en bout :
// - « web » : le site en mode démonstration (build de production servi par vite preview) ;
// - « electron » : l'application Windows réelle (Electron) pilotée par Playwright, avec un Ollama simulé ;
// - « connector » : le connecteur local de bout en bout — harnais du site (vrais composants, vrai client) dans Chromium
//   avec la protection « Local Network Access » active, face à l'application Windows réelle (e2e/connector-local.spec.ts).
// Chaque projet a SON dossier de sortie (e2e/outputDirs.ts) : Playwright ne vide que ceux des projets lancés, donc
// « --project=connector » après « --project=electron » (même job de CI) garde les captures et traces de l'application.
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  projects: [
    {
      name: 'web',
      testMatch: /web-.*\.spec\.ts/,
      outputDir: E2E_OUTPUT_DIRS.web,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173' },
    },
    {
      name: 'electron',
      testMatch: /electron-.*\.spec\.ts/,
      outputDir: E2E_OUTPUT_DIRS.electron,
    },
    {
      name: 'connector',
      testMatch: /connector-.*\.spec\.ts/,
      outputDir: E2E_OUTPUT_DIRS.connector,
      use: { ...devices['Desktop Chrome'], actionTimeout: 30_000, launchOptions: { args: [...LOCAL_NETWORK_ACCESS_ARGS] } },
    },
  ],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
