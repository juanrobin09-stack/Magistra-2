import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';
import { LOCAL_NETWORK_ACCESS_ARGS } from './e2e/connector-harness/sites';
import { E2E_OUTPUT_DIRS, requestedProjects } from './e2e/outputDirs';

/** Tests du connecteur local : lancés par « connector » (Chromium de Playwright) et « connector-edge » (Microsoft Edge). */
const CONNECTOR_SPECS = /connector-.*\.spec\.ts/;

type WebServer = Exclude<NonNullable<PlaywrightTestConfig['webServer']>, readonly unknown[]>;

// Serveurs d'aperçu : seuls ceux dont les projets lancés ont besoin démarrent. « site » n'exige que dist-site/ (npm run
// build:site), les autres projets que dist/ (npm run build) : lancer l'un ne demande jamais le build de l'autre.
// Sans --project, tous les projets sont lancés, donc les deux serveurs.
const requested = requestedProjects(process.argv);
const webServers: WebServer[] = [];
if (!requested || requested.some(project => project !== 'site')) {
  webServers.push({
    command: 'npx vite preview --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  });
}
if (!requested || requested.includes('site')) {
  webServers.push({
    command: 'npx vite preview --config vite.site.config.ts --port 4174 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: true,
    timeout: 60_000,
  });
}

// Tests de bout en bout :
// - « web » : le site en mode démonstration (build de production servi par vite preview) ;
// - « site » : le site vitrine (build dédié, npm run build:site → dist-site/, servi par vite preview sur le port 4174) :
//   présentation, téléchargement de l'application Windows, pages légales, aucune application dans le navigateur ;
// - « electron » : l'application Windows réelle (Electron) pilotée par Playwright, avec un Ollama simulé ;
// - « connector » : le connecteur local de bout en bout — harnais du site (vrais composants, vrai client) dans Chromium
//   avec la protection « Local Network Access » active, face à l'application Windows réelle (e2e/connector-local.spec.ts) ;
// - « connector-edge » : les MÊMES tests dans Microsoft Edge installé sur la machine (canal « msedge », nom d'autorisation
//   « loopback-network » des versions récentes) ; ignorés proprement (« skipped ») si Edge n'est pas installé
//   (e2e/browsers.ts). La CI ne le lance pas : `xvfb-run -a npx playwright test --project=connector-edge` à la main.
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
      testMatch: CONNECTOR_SPECS,
      outputDir: E2E_OUTPUT_DIRS.connector,
      use: { ...devices['Desktop Chrome'], actionTimeout: 30_000, launchOptions: { args: [...LOCAL_NETWORK_ACCESS_ARGS] } },
    },
    {
      name: 'connector-edge',
      testMatch: CONNECTOR_SPECS,
      outputDir: E2E_OUTPUT_DIRS['connector-edge'],
      use: { ...devices['Desktop Edge'], channel: 'msedge', actionTimeout: 30_000, launchOptions: { args: [...LOCAL_NETWORK_ACCESS_ARGS] } },
    },
    {
      name: 'site',
      testMatch: /site-.*\.spec\.ts/,
      outputDir: E2E_OUTPUT_DIRS.site,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4174' },
    },
  ],
  webServer: webServers,
});
