import { defineConfig, devices } from '@playwright/test';

// Tests de bout en bout :
// - « web » : le site en mode démonstration (build de production servi par vite preview) ;
// - « electron » : l'application Windows réelle (Electron) pilotée par Playwright, avec un Ollama simulé.
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
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173' },
    },
    {
      name: 'electron',
      testMatch: /electron-.*\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
