// Validation de bout en bout de l'application Windows (Electron) pilotée par Playwright, avec un Ollama simulé
// (scripts/mock-ollama.mjs) : premier démarrage, installation du modèle (annulation, reprise, rechargement),
// moteur absent / installé ensuite / arrêté, génération réelle par IPC, persistance, arrêt, erreurs précises,
// sécurité à l'exécution, export PDF et Markdown, réglages de l'IA.
//
// Prérequis : `npx vite build` (dist/) puis `node scripts/build-electron.mjs` (dist-electron/).
// Lancement (Linux sans écran) : `xvfb-run -a npx playwright test --project=electron`.
// Variables facultatives :
//   MAGISTRA_E2E_SCREENSHOTS  dossier des captures (par défaut test-results/electron/captures, dossier du projet
//                             « electron » : voir e2e/outputDirs.ts) ;
//   MAGISTRA_DIST_DIR         dossier dist/ figé, à l'abri d'une reconstruction en parallèle ;
//   MAGISTRA_E2E_LOGS=1       affiche les journaux du processus principal et les erreurs console de la fenêtre.
// Chaque test utilise un dossier de données neuf (MAGISTRA_USER_DATA_DIR) et son propre faux Ollama.

import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { E2E_SCREENSHOT_DIRS, fromRoot } from './outputDirs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.resolve(process.env.MAGISTRA_E2E_SCREENSHOTS ?? fromRoot(E2E_SCREENSHOT_DIRS.electron));
/** Les trois niveaux Magistra : le modèle recommandé est installé quelle que soit la machine de test. */
const ALL_TIER_MODELS = ['ministral-3:8b', 'ministral-3:14b', 'mistral-small3.2:24b'];
/** Détails techniques qui ne doivent jamais apparaître à l'écran. */
const TECHNICAL = /ECONNREFUSED|fetch failed|TypeError|Error:|stack|at \w+ \(|127\.0\.0\.1|localhost|not found|try pulling|GiB|requires more system memory|ministral|\bnull\b|undefined/i;

// ─── Faux Ollama ────────────────────────────────────────────────────────────

interface MockOptions {
  port?: number;
  models?: string[];
  /** Version annoncée par /api/version (défaut récent ; « 0.12.0 » = moteur trop ancien pour les modèles Magistra). */
  version?: string;
  missingModel?: boolean;
  oom?: boolean;
  unknownPull?: boolean;
  /** Le registre répond 412 (« requires a newer version of Ollama ») au téléchargement. */
  pull412?: boolean;
  pullMs?: number;
  chatDelayMs?: number;
}

interface MockOllama {
  port: number;
  url: string;
  state: { models: Set<string>; partial: Map<string, unknown>; requests: string[] };
  /** Options lues à chaque requête par le faux serveur : modifiables pendant le test. */
  options: MockOptions;
  close(): Promise<void>;
}

async function startMock(options: MockOptions): Promise<MockOllama> {
  const mod = (await import(pathToFileURL(path.join(root, 'scripts', 'mock-ollama.mjs')).href)) as {
    startMockOllama(o: MockOptions): Promise<Omit<MockOllama, 'options'>>;
  };
  const opts: MockOptions = { port: 0, pullMs: 400, chatDelayMs: 5, ...options };
  const server = await mod.startMockOllama(opts);
  return { ...server, options: opts };
}

/** Adresse locale sur laquelle rien n'écoute (moteur IA absent). */
async function unusedLocalUrl(): Promise<string> {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 9;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return `http://127.0.0.1:${port}`;
}

// ─── Application ────────────────────────────────────────────────────────────

interface Session {
  app: ElectronApplication;
  page: Page;
  /** Erreurs JavaScript non interceptées dans la fenêtre. */
  pageErrors: string[];
  /** Messages console.error de la fenêtre. */
  consoleErrors: string[];
  /** Journal du processus principal (sorties standard et d'erreur). */
  mainLog: string[];
}

/** Erreurs du processus principal qui signalent un défaut (et non un refus attendu ou du bruit de Chromium). */
const MAIN_PROCESS_FAILURE = /Erreur interne|Erreur fatale|Promesse rejetée non gérée|Erreur de génération|Processus d’affichage arrêté|uncaught/i;

function newUserDataDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'magistra-e2e-'));
}

/** Environnement de lancement : dossier de données et adresse d'Ollama propres au test. */
function appEnv(userDataDir: string, ollamaUrl: string, extraEnv: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  delete env.MAGISTRA_SMOKE_TEST;
  env.MAGISTRA_USER_DATA_DIR = userDataDir;
  env.MAGISTRA_OLLAMA_URL = ollamaUrl;
  // Linux sans locale UTF-8 (conteneurs) : Chromium ne peut pas écrire de nom de fichier accentué et
  // remplace le nom proposé par « download ». Un poste réel (Windows, bureau Linux) est en UTF-8.
  if (process.platform === 'linux' && !/utf-?8/i.test(env.LC_ALL || env.LC_CTYPE || env.LANG || '')) {
    env.LANG = 'C.UTF-8';
    env.LC_ALL = 'C.UTF-8';
  }
  return Object.assign(env, extraEnv);
}

function appArgs(): string[] {
  const args = [root];
  if (process.platform === 'linux') {
    // Conteneurs Linux en root et CI : le bac à sable de Chromium n'est pas disponible.
    if ((typeof process.getuid === 'function' && process.getuid() === 0) || process.env.CI) args.push('--no-sandbox');
    args.push('--disable-gpu');
  }
  return args;
}

async function launchApp(userDataDir: string, ollamaUrl: string, extraEnv: Record<string, string> = {}): Promise<Session> {
  const distDir = process.env.MAGISTRA_DIST_DIR ? path.resolve(process.env.MAGISTRA_DIST_DIR) : path.join(root, 'dist');
  for (const full of [path.join(distDir, 'index.html'), path.join(root, 'dist-electron/main.js'), path.join(root, 'dist-electron/preload.cjs')]) {
    if (!existsSync(full)) throw new Error(`${full} introuvable : lancez « npx vite build » puis « node scripts/build-electron.mjs ».`);
  }
  const app = await electron.launch({ args: appArgs(), cwd: root, env: appEnv(userDataDir, ollamaUrl, extraEnv), timeout: 60_000 });
  const mainLog: string[] = [];
  const collect = (chunk: Buffer | string) => {
    for (const line of String(chunk).split('\n')) if (line.trim()) mainLog.push(line);
  };
  app.process().stdout?.on('data', collect);
  app.process().stderr?.on('data', collect);
  const page = await app.firstWindow();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  return { app, page, pageErrors, consoleErrors, mainLog };
}

async function closeApp(session: Session | null): Promise<void> {
  if (!session) return;
  await session.app.close().catch(() => undefined);
}

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  // Laisse les animations d'apparition se terminer.
  await page.waitForTimeout(700);
  // Pages à défilement interne (application) : capture de la fenêtre ; pages longues (assistant) : page entière.
  const fullPage = !/\/app(\/|$)/.test(new URL(page.url()).pathname);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage }).catch(() => undefined);
}

/** Remplace shell.openExternal dans le processus principal : aucun navigateur n'est ouvert, les URL sont notées. */
async function stubOpenExternal(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { __openedUrls: string[] };
    g.__openedUrls = [];
    shell.openExternal = async (url: string) => {
      g.__openedUrls.push(url);
    };
  });
}

function openedUrls(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { __openedUrls?: string[] }).__openedUrls ?? []);
}

/** Fichiers d'un dossier (récursivement) contenant le texte donné. */
function filesContaining(dir: string, needle: string): string[] {
  const found: string[] = [];
  const bytes = Buffer.from(needle, 'utf8');
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && readFileSync(full).includes(bytes)) found.push(path.relative(dir, full));
    }
  };
  walk(dir);
  return found;
}

async function visibleText(locator: Locator): Promise<string> {
  return (await locator.innerText()).replace(/\s+/g, ' ').trim();
}

// ─── Parcours communs ───────────────────────────────────────────────────────

/** Onboarding : profil « Supérieur — Master 1 » (étapes facultatives passées). */
async function completeOnboarding(page: Page, name = 'Mme Durand'): Promise<void> {
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.locator('#onb-nom').fill(name);
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.getByRole('button', { name: /Supérieur/ }).click();
  await page.getByRole('button', { name: /^Master 1$/ }).click();
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.getByRole('button', { name: /Continuer/ }).click();
  await expect(page.getByText('Master 1').last()).toBeVisible();
  await page.getByRole('button', { name: /Commencer à générer/ }).click();
  await expect(page).toHaveURL(/\/app$/);
}

/** Premier démarrage avec une IA prête : assistant → « Commencer » → onboarding → tableau de bord. */
async function setupReadyApp(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: /Intelligence artificielle prête/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Commencer/ }).click();
  await completeOnboarding(page);
  await expect(aiBadge(page)).toContainText('IA prête');
}

function aiBadge(page: Page): Locator {
  return page.getByRole('link', { name: /État de l'intelligence artificielle/ });
}

async function openNav(page: Page, label: 'Tableau de bord' | 'Générer' | 'Historique' | 'Favoris' | 'Réglages'): Promise<void> {
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: label, exact: true }).click();
}

function resultSection(page: Page): Locator {
  return page.locator('section[aria-labelledby="gen-result-title"]');
}

/** Lance une génération « Cours » depuis la page Générer (formulaire déjà affiché). */
async function submitCours(page: Page, sujet: string): Promise<void> {
  await page.locator('#gen-sujet').fill(sujet);
  await page.getByRole('button', { name: /Générer : Cours/ }).click();
}

/** Document Word créé par programme, au contenu reconnaissable. */
async function makeDocx(): Promise<Buffer> {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const p = (text: string, style?: string) =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const body = [
    p('La photosynthèse', 'Heading1'),
    p('Code de vérification MAGISTRA-E2E-7731 : la photosynthèse convertit l’énergie lumineuse en énergie chimique.'),
    p('Elle se déroule dans les chloroplastes des cellules végétales, grâce à la chlorophylle.'),
    p('Le cycle de Calvin', 'Heading1'),
    p('Le dioxyde de carbone est fixé par la RuBisCO pour produire des sucres.'),
  ].join('');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test.describe('Application Windows (Electron) — IA locale simulée', () => {
  test.describe.configure({ timeout: 180_000 });
  let session: Session | null = null;
  let mock: MockOllama | null = null;
  let userData: string | null = null;

  test.afterEach(async () => {
    const testInfo = test.info();
    if (session && testInfo.status !== testInfo.expectedStatus) {
      await shot(session.page, `ECHEC-${testInfo.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}`);
    }
    if (session) {
      expect.soft(session.pageErrors, 'erreurs JavaScript non interceptées dans la fenêtre').toEqual([]);
      expect.soft(session.mainLog.filter(l => MAIN_PROCESS_FAILURE.test(l)), 'erreurs du processus principal').toEqual([]);
      if (process.env.MAGISTRA_E2E_LOGS) {
        console.log(`--- ${testInfo.title}\n[console.error] ${session.consoleErrors.join('\n[console.error] ')}\n[main] ${session.mainLog.filter(l => !/dbus|vaapi|viz_main|gpu_init|GLib/.test(l)).join('\n[main] ')}`);
      }
    }
    await closeApp(session);
    session = null;
    await mock?.close();
    mock = null;
    if (userData) rmSync(userData, { recursive: true, force: true });
    userData = null;
  });

  test('1. premier démarrage : moteur en marche + modèle recommandé installé → prête → onboarding → tableau de bord', async () => {
    mock = await startMock({ models: ALL_TIER_MODELS });
    userData = newUserDataDir();
    session = await launchApp(userData, mock.url);
    const { page } = session;

    await expect(page).toHaveURL(/^app:\/\/magistra\/setup/);
    await expect(page.getByRole('heading', { name: 'Vérification de votre ordinateur' })).toBeVisible();
    await shot(page, '01a-setup-verifications');
    await expect(page.getByText('Vérification terminée.')).toBeVisible();
    for (const label of ['Moteur IA installé', 'Moteur IA en marche', "Modèles d'IA disponibles", 'Modèle installé']) {
      await expect(page.getByRole('listitem').filter({ hasText: label })).toContainText(': oui');
    }
    await expect(page.getByRole('heading', { name: /Intelligence artificielle prête/ })).toBeVisible();
    await shot(page, '01b-setup-prete');
    await page.getByRole('button', { name: /Commencer/ }).click();

    await completeOnboarding(page);
    await expect(aiBadge(page)).toContainText('IA prête');
    await expect(page.getByText('Mme Durand').first()).toBeVisible();
    await shot(page, '01c-tableau-de-bord');

    // Isolation de la fenêtre : aucun accès à Node ni à Electron, seul le pont window.magistra.
    const isolation = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const bridge = w.magistra as Record<string, unknown> | undefined;
      return {
        require: typeof w.require,
        process: typeof w.process,
        electronAPI: typeof w.electronAPI,
        ipcRenderer: typeof w.ipcRenderer,
        module: typeof w.module,
        magistra: typeof bridge,
        isElectron: bridge?.isElectron === true,
        groups: bridge ? Object.keys(bridge).sort() : [],
      };
    });
    expect(isolation).toEqual({
      require: 'undefined',
      process: 'undefined',
      electronAPI: 'undefined',
      ipcRenderer: 'undefined',
      module: 'undefined',
      magistra: 'object',
      isElectron: true,
      groups: ['ai', 'app', 'connector', 'data', 'documents', 'generation', 'isElectron', 'prefs', 'profile'],
    });

    // Aucune fonction du pont ne renvoie de clé : ai.status ne contient aucun champ apiKey.
    const exposed = await page.evaluate(async () => {
      const m = (window as unknown as { magistra: import('../shared/ipc').MagistraBridge }).magistra;
      const results = {
        status: await m.ai.status(),
        refresh: await m.ai.refresh(),
        info: await m.app.info(),
        prefs: await m.prefs.get(),
        profile: await m.profile.get(),
        capabilities: await m.generation.capabilities(),
        history: await m.data.list({}),
        stats: await m.data.stats(),
        documents: await m.documents.list(),
      };
      // Serveur distant avec une clé : la clé n'est jamais renvoyée (ou l'enregistrement est refusé proprement).
      let remote: { ok: boolean; json?: string; error?: string };
      try {
        const s = await m.ai.setConfig({ remote: { kind: 'openai-compatible', baseUrl: 'https://ia.exemple.fr/v1', model: 'modele-test', apiKey: 'sk-SECRET-E2E-123' } });
        remote = { ok: true, json: JSON.stringify(s) + JSON.stringify(await m.ai.status()) };
      } catch (e) {
        remote = { ok: false, error: String((e as Error).message) };
      }
      await m.ai.setConfig({ remote: null, mode: 'local' });
      return { json: JSON.stringify(results), status: results.status, remote };
    });
    expect(exposed.json).not.toMatch(/apiKey"|api_key|sk-SECRET|apiKeyEnc|password|secret/i);
    expect(Object.keys(exposed.status)).not.toContain('apiKey');
    expect(Object.keys(exposed.status.config)).not.toContain('apiKey');
    expect(exposed.status.ready).toBe(true);
    if (exposed.remote.ok) {
      expect(exposed.remote.json).not.toContain('sk-SECRET-E2E-123');
      expect(exposed.remote.json).toContain('"hasApiKey":true');
    } else {
      // Linux sans trousseau : chiffrement indisponible → refus explicite, en français, sans détail technique.
      expect(exposed.remote.error).toMatch(/STORAGE_ERROR\|.*clé API ne peut pas être enregistrée/);
    }
    // La clé n'a été écrite en clair nulle part dans les données de l'application (configuration, stockage Chromium…).
    const withKey = filesContaining(userData, 'sk-SECRET-E2E-123');
    expect(withKey).toEqual([]);
  });

  test('2. modèle non installé → choix « Magistra Standard » → progression → annuler → reprendre → prête', async () => {
    mock = await startMock({ models: [], pullMs: 9_000 });
    userData = newUserDataDir();
    session = await launchApp(userData, mock.url);
    const { page } = session;

    await expect(page.getByRole('heading', { name: "Choisissez la version de l'IA" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('listitem').filter({ hasText: "Modèles d'IA disponibles" })).toContainText('aucun modèle installé');
    await expect(page.getByRole('listitem').filter({ hasText: 'Modèle recommandé installé' })).toContainText(': non');
    await page.locator('label[data-tier="standard"]').click();
    const install = page.getByRole('button', { name: 'Installer Magistra Standard' });
    await expect(install).toBeVisible();
    await expect(page.getByText(/Téléchargement de 9\sGo, une seule fois/)).toBeVisible();
    expect(mock.state.requests.filter(r => r === 'POST /api/pull')).toHaveLength(0);
    await shot(page, '02a-choix-standard');
    await install.click();

    // Machine trop modeste pour ce niveau : une confirmation est demandée (jamais d'installation surprise).
    const bar = page.getByRole('progressbar', { name: /Téléchargement de Magistra Standard/ });
    const confirm = page.getByRole('button', { name: 'Installer quand même' });
    await expect(bar.or(confirm)).toBeVisible();
    if (await confirm.isVisible()) {
      await shot(page, '02b-confirmation-niveau-deconseille');
      await confirm.click();
    }
    await expect(bar).toBeVisible();
    await expect(page.getByText('Téléchargement de Magistra Standard', { exact: true })).toBeVisible();
    await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow') ?? 0), { timeout: 20_000 }).toBeGreaterThanOrEqual(30);
    await expect(page.getByText(/^\d+ %$/).first()).toBeVisible();
    await shot(page, '02c-progression');

    // Annuler puis reprendre : le téléchargement repart là où il s'était arrêté.
    await page.getByRole('button', { name: 'Annuler le téléchargement' }).click();
    const interrupted = page.getByText(/Téléchargement de Magistra Standard interrompu/);
    await expect(interrupted).toBeVisible();
    const pausedAt = Number(/à (\d+) %/.exec(await interrupted.innerText())?.[1] ?? '0');
    expect(pausedAt).toBeGreaterThanOrEqual(30);
    await shot(page, '02d-interrompu');
    await page.getByRole('button', { name: 'Reprendre le téléchargement' }).click();
    await expect(bar).toBeVisible();
    let firstAfterResume = 0;
    await expect.poll(async () => {
      firstAfterResume = Number(await bar.getAttribute('aria-valuenow').catch(() => '0') ?? 0);
      return firstAfterResume;
    }, { timeout: 20_000 }).toBeGreaterThan(0);
    expect(firstAfterResume, 'reprise du téléchargement (pas de retour à zéro)').toBeGreaterThanOrEqual(pausedAt - 1);
    await shot(page, '02e-reprise');

    await expect(page.getByRole('heading', { name: /Intelligence artificielle prête/ })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Magistra utilise Magistra Standard/)).toBeVisible();
    expect(mock.state.requests.filter(r => r === 'POST /api/pull')).toHaveLength(2);
    expect(mock.state.models.has('ministral-3:14b')).toBe(true);
    await shot(page, '02f-prete');
    await page.getByRole('button', { name: /Commencer/ }).click();
    await completeOnboarding(page);
    await expect(aiBadge(page)).toContainText('IA prête');
  });

  test('2b. « Plus tard » pendant le téléchargement du modèle → la progression reste visible, puis « IA prête »', async () => {
    mock = await startMock({ models: [], pullMs: 8_000 });
    userData = newUserDataDir();
    session = await launchApp(userData, mock.url);
    const { page } = session;

    await expect(page.getByRole('heading', { name: "Choisissez la version de l'IA" })).toBeVisible({ timeout: 30_000 });
    // Version présélectionnée : celle recommandée pour cet ordinateur (aucune confirmation demandée).
    const install = page.getByRole('button', { name: /^Installer Magistra / });
    const label = (await install.innerText()).replace(/^Installer\s+/, '').trim();
    await install.click();
    await expect(page.getByRole('progressbar', { name: `Téléchargement de ${label}` })).toBeVisible();
    await expect(page.getByText('Le téléchargement en cours continue.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Plus tard' }).click();
    await completeOnboarding(page);
    await expect(aiBadge(page)).toContainText(/Installation de l’IA( : \d+ %|…)/);
    await shot(page, '02g-plus-tard-pendant-telechargement');
    await expect(aiBadge(page)).toContainText('IA prête', { timeout: 60_000 });
    const status = await page.evaluate(() => (window as unknown as { magistra: import('../shared/ipc').MagistraBridge }).magistra.ai.status());
    expect(status.ready).toBe(true);
    expect(status.activeLabel).toBe(label);
  });

  test('2c. rechargement de la fenêtre pendant le téléchargement du modèle → la progression reprend à l’écran', async () => {
    mock = await startMock({ models: [], pullMs: 10_000 });
    userData = newUserDataDir();
    session = await launchApp(userData, mock.url);
    const { page } = session;
    await expect(page.getByRole('heading', { name: "Choisissez la version de l'IA" })).toBeVisible({ timeout: 30_000 });
    const install = page.getByRole('button', { name: /^Installer Magistra / });
    const label = (await install.innerText()).replace(/^Installer\s+/, '').trim();
    await install.click();
    const bar = page.getByRole('progressbar', { name: `Téléchargement de ${label}` });
    await expect.poll(async () => Number(await bar.getAttribute('aria-valuenow') ?? 0), { timeout: 20_000 }).toBeGreaterThanOrEqual(20);

    await page.reload();
    // Le téléchargement continue dans le processus principal : l'assistant l'affiche de nouveau (pas de second bouton « Installer »).
    await expect(bar).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Annuler le téléchargement' })).toBeVisible();
    await shot(page, '02h-rechargement-pendant-telechargement');
    await expect(page.getByRole('heading', { name: /Intelligence artificielle prête/ })).toBeVisible({ timeout: 60_000 });
    expect(mock.state.requests.filter(r => r === 'POST /api/pull')).toHaveLength(1);
  });

  test('3. moteur absent → consentement avec la taille avant tout téléchargement → « Plus tard » → application utilisable', async () => {
    userData = newUserDataDir();
    session = await launchApp(userData, await unusedLocalUrl());
    const { app, page } = session;
    await stubOpenExternal(app);

    await expect(page.getByRole('heading', { name: 'Installer le moteur IA' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('listitem').filter({ hasText: 'Moteur IA installé' })).toContainText(': non');
    const consent = page.getByRole('region', { name: 'Avant de commencer' });
    await expect(consent).toContainText(/Téléchargement\s*environ\s1,7\sGo/);
    await expect(consent).toContainText(/Espace disque nécessaire\s*7\sGo/);
    await expect(consent).toContainText("site officiel d'Ollama");
    await expect(page.getByText("Rien n'est téléchargé tant que vous n'avez pas cliqué.")).toBeVisible();
    const status = await page.evaluate(() => (window as unknown as { magistra: import('../shared/ipc').MagistraBridge }).magistra.ai.status());
    expect(status.engine.state).toBe('not_installed');
    expect(status.headline).toBe('Moteur IA non installé');
    if (status.engineDownload.platformSupported) {
      await expect(page.getByRole('button', { name: 'Installer le moteur IA' })).toBeVisible();
    } else {
      await expect(page.getByText(/L'installation automatique n'est pas disponible sur ce système/)).toBeVisible();
    }
    const officialPage = page.getByRole('button', { name: "Ouvrir la page officielle d'installation" });
    await expect(officialPage).toBeVisible();
    await shot(page, '03a-moteur-absent-consentement');

    // Page officielle : ouverte dans le navigateur du système (simulé), puis attente de l'installation.
    await officialPage.click();
    await expect(page.getByRole('heading', { name: 'Installation depuis la page officielle' })).toBeVisible();
    expect(await openedUrls(app)).toEqual(['https://ollama.com/download']);
    await shot(page, '03b-attente-installation-manuelle');
    await page.getByRole('button', { name: 'Annuler', exact: true }).click();
    await expect(page.getByText('Installation annulée. Vous pouvez la relancer quand vous le souhaitez.')).toBeVisible();

    // « Plus tard » : l'application reste utilisable sans IA.
    await page.getByRole('button', { name: 'Plus tard' }).click();
    await completeOnboarding(page);
    await expect(aiBadge(page)).toContainText('IA non installée');
    await shot(page, '03c-tableau-de-bord-sans-ia');

    await openNav(page, 'Historique');
    await expect(page.getByText('Aucune génération pour le moment')).toBeVisible();

    await openNav(page, 'Générer');
    const card = page.getByRole('status').filter({ has: page.getByRole('heading', { name: "L'intelligence artificielle locale n'est pas prête" }) });
    await expect(card).toBeVisible();
    await expect(card).toContainText('Moteur IA non installé');
    await expect(card.getByRole('link', { name: "Configurer l'intelligence artificielle" })).toBeVisible();
    await submitCours(page, 'La photosynthèse');
    const alert = resultSection(page).getByRole('alert');
    await expect(alert).toContainText('Le moteur d’IA locale (Ollama) n’est pas installé.');
    expect(await visibleText(alert)).not.toMatch(TECHNICAL);
    await expect(alert.getByRole('link', { name: "Configurer l'intelligence artificielle" })).toBeVisible();
    await shot(page, '03d-generation-ia-non-prete');
    expect(await page.locator('#root').evaluate(el => el.childElementCount)).toBeGreaterThan(0);
  });

  test('3b. moteur installé depuis la page officielle → détecté automatiquement, sans redémarrer Magistra', async () => {
    const url = await unusedLocalUrl();
    userData = newUserDataDir();
    session = await launchApp(userData, url);
    const { app, page } = session;
    await stubOpenExternal(app);
    await expect(page.getByRole('heading', { name: 'Installer le moteur IA' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: "Ouvrir la page officielle d'installation" }).click();
    await expect(page.getByRole('heading', { name: 'Installation depuis la page officielle' })).toBeVisible();

    // L'enseignant installe Ollama : le moteur répond maintenant à l'adresse surveillée.
    mock = await startMock({ port: Number(new URL(url).port), models: ALL_TIER_MODELS });
    await expect(page.getByRole('heading', { name: /Intelligence artificielle prête/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('listitem').filter({ hasText: 'Moteur IA en marche' })).toContainText(': oui');
    await shot(page, '03e-moteur-detecte-automatiquement');
  });

  test('3c. moteur installé mais arrêté → démarré automatiquement au lancement de Magistra', async () => {
    test.skip(process.platform === 'win32', 'faux exécutable « ollama » : script shell (Linux, macOS)');
    const url = await unusedLocalUrl();
    const port = new URL(url).port;
    userData = newUserDataDir();
    // Faux « ollama » dans le PATH : « ollama serve » démarre le faux serveur sur OLLAMA_HOST.
    const binDir = path.join(userData, 'bin');
    mkdirSync(binDir, { recursive: true });
    const pidFile = path.join(userData, 'ollama.pid');
    const argsFile = path.join(userData, 'ollama.args');
    writeFileSync(path.join(binDir, 'ollama'), [
      '#!/bin/sh',
      `echo "$@ OLLAMA_HOST=$OLLAMA_HOST" > '${argsFile}'`,
      `echo $$ > '${pidFile}'`,
      `exec '${process.execPath}' '${path.join(root, 'scripts', 'mock-ollama.mjs')}' --port "\${OLLAMA_HOST##*:}" --models ${ALL_TIER_MODELS.join(',')}`,
      '',
    ].join('\n'));
    chmodSync(path.join(binDir, 'ollama'), 0o755);
    try {
      session = await launchApp(userData, url, { PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}` });
      const { page } = session;
      await expect(page.getByRole('heading', { name: /Intelligence artificielle prête/ })).toBeVisible({ timeout: 45_000 });
      expect(readFileSync(argsFile, 'utf8').trim()).toBe(`serve OLLAMA_HOST=127.0.0.1:${port}`);
      await shot(page, '03f-moteur-arrete-demarre-automatiquement');
    } finally {
      const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8').trim()) : 0;
      if (pid > 0) {
        try {
          process.kill(pid);
        } catch {
          /* déjà arrêté */
        }
      }
    }
  });

  test('3d. moteur trop ancien → « Mettre à jour le moteur IA » (aucun modèle téléchargé) → moteur à jour → modèle installé', async () => {
    mock = await startMock({ models: [], version: '0.12.0', pullMs: 1_500 });
    userData = newUserDataDir();
    session = await launchApp(userData, mock.url);
    const { page } = session;

    await expect(page.getByRole('heading', { name: 'Mettre à jour le moteur IA' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Le moteur IA installé \(version 0\.12\.0\) est trop ancien.*0\.13\.1 minimum/)).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Moteur IA à jour' })).toContainText(': non');
    const update = page.getByRole('button', { name: 'Mettre à jour le moteur IA' });
    await expect(update).toBeVisible();
    await expect(page.getByText("Rien n'est téléchargé tant que vous n'avez pas cliqué.")).toBeVisible();
    await shot(page, '03g-moteur-trop-ancien');

    // Même par le pont, aucun modèle ne part au registre avec un moteur trop ancien (il répondrait 412).
    const direct = await page.evaluate(async () => {
      const m = (window as unknown as { magistra: import('../shared/ipc').MagistraBridge }).magistra;
      try {
        await m.ai.pullModel({ tier: 'leger' });
        return 'ok';
      } catch (e) {
        return String((e as Error).message);
      }
    });
    expect(direct).toMatch(/ENGINE_OUTDATED\|Le moteur IA installé \(Ollama 0\.12\.0\) est trop ancien/);
    expect(mock.state.requests.filter(r => r === 'POST /api/pull')).toHaveLength(0);

    if (process.platform !== 'win32') {
      // Hors Windows, la mise à jour automatique n'existe pas : message clair, sans détail technique.
      await update.click();
      const error = page.getByText("La mise à jour du moteur IA n'a pas abouti.");
      await expect(error).toBeVisible();
      await expect(page.getByText(/disponible sous Windows/)).toBeVisible();
      await shot(page, '03h-mise-a-jour-hors-windows');
    }

    // Ollama mis à jour (installateur officiel, ou service informatique) : détecté au retour dans la fenêtre.
    // (L'interface ne revérifie pas plus d'une fois toutes les 3 s au retour dans la fenêtre.)
    mock.options.version = '0.34.4';
    const choose = page.getByRole('heading', { name: "Choisissez la version de l'IA" });
    await expect.poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      return choose.isVisible();
    }, { timeout: 30_000, intervals: [1_000] }).toBe(true);
    const install = page.getByRole('button', { name: /^Installer Magistra / });
    await install.click();
    const confirm = page.getByRole('button', { name: 'Installer quand même' });
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await expect(page.getByRole('heading', { name: /Intelligence artificielle prête/ })).toBeVisible({ timeout: 60_000 });
    expect(mock.state.requests.filter(r => r === 'POST /api/pull')).toHaveLength(1);
    await shot(page, '03i-moteur-a-jour-modele-installe');
  });

  test('3e. registre « requires a newer version of Ollama » (412) → mise à jour proposée, pas « Reprendre le téléchargement »', async () => {
    mock = await startMock({ models: [], pull412: true });
    userData = newUserDataDir();
    session = await launchApp(userData, mock.url);
    const { page } = session;
    await expect(page.getByRole('heading', { name: "Choisissez la version de l'IA" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /^Installer Magistra / }).click();
    const confirm = page.getByRole('button', { name: 'Installer quand même' });
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await expect(page.getByText("Le moteur IA doit d'abord être mis à jour.")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/nécessite une version plus récente du moteur IA/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mettre à jour le moteur IA' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reprendre le téléchargement' })).toHaveCount(0);
    expect(await visibleText(page.locator('#root'))).not.toMatch(/\b412\b|pull model manifest|ollama\.com\/download/);
    await shot(page, '03j-registre-412');
  });

  test('4. génération réelle par IPC avec un document → sources citées → historique → favori → suppression → persistance', async () => {
    mock = await startMock({ models: ALL_TIER_MODELS, chatDelayMs: 40 });
    userData = newUserDataDir();
    session = await launchApp(userData, mock.url);
    let { page } = session;
    await setupReadyApp(page);

    await openNav(page, 'Générer');
    await expect(page.getByRole('heading', { name: /Mme Durand, que souhaitez-vous/ })).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'notes-photosynthese.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: await makeDocx(),
    });
    const docItem = page.getByRole('list', { name: 'Documents ajoutés' }).getByRole('listitem').filter({ hasText: 'notes-photosynthese.docx' });
    await expect(docItem).toContainText('Analysé');
    await page.getByRole('button', { name: /Mes documents uniquement/ }).click();
    await expect(page.getByRole('button', { name: /Mes documents uniquement/ })).toHaveAttribute('aria-pressed', 'true');
    // Confidentialité : IA locale, sans répétition de la même phrase.
    const privacy = page.getByRole('note', { name: 'Confidentialité' });
    await expect(privacy).toContainText('IA locale');
    await expect(privacy).toContainText('Vos documents et générations restent sur cet ordinateur.');
    expect((await visibleText(privacy)).match(/restent sur cet ordinateur/g)).toHaveLength(1);
    await shot(page, '04a-formulaire-avec-document');
    await submitCours(page, 'La photosynthèse');

    // Texte progressif : le contenu grandit pendant que « Arrêter » est proposé.
    const result = resultSection(page);
    await expect(result.getByRole('button', { name: 'Arrêter' })).toBeVisible();
    await expect(result).toContainText('Cours : La photosynthèse', { timeout: 30_000 });
    const partial = (await visibleText(result)).length;
    await shot(page, '04b-texte-progressif');
    await expect(result.getByRole('heading', { name: 'Sources utilisées' })).toBeVisible({ timeout: 30_000 });
    expect((await visibleText(result)).length).toBeGreaterThan(partial);
    const sources = result.locator('h2:has-text("Sources utilisées") + ul');
    await expect(sources).toContainText('notes-photosynthese.docx');
    await expect(sources).toContainText(/section « (La photosynthèse|Le cycle de Calvin) »/);
    // Citations vérifiées : forme « [S1] » dans le texte et dans la liste construite par le code.
    await expect(result).toContainText('[S1]');
    await expect(sources).toContainText('[S1]');
    await expect(result.getByText("Enregistré dans l'historique")).toBeVisible();
    await expect(result.getByRole('button', { name: 'Recommencer' })).toBeVisible();
    await shot(page, '04c-resultat-final-sources');
    // Le document est réellement parti vers le modèle (passages localisés), sans le fichier original.
    expect(mock.state.requests).toContain('POST /api/chat');

    // Historique : l'élément est présent ; favori.
    await result.getByRole('link', { name: "Voir dans l'historique" }).click();
    await expect(page).toHaveURL(/\/app\/history\?id=/);
    const list = page.getByRole('region', { name: 'Liste : Historique' });
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list).toContainText('La photosynthèse');
    const favorite = page.getByRole('button', { name: 'Favori', exact: true });
    await expect(favorite).toHaveAttribute('aria-pressed', 'false');
    await favorite.click();
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Ajouté aux favoris.')).toBeVisible();
    await shot(page, '04d-historique-favori');

    // Deuxième contenu, puis suppression avec confirmation.
    await openNav(page, 'Générer');
    await submitCours(page, 'Le cycle de Calvin');
    await expect(resultSection(page).getByText("Enregistré dans l'historique")).toBeVisible({ timeout: 30_000 });
    await openNav(page, 'Historique');
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await list.getByRole('link', { name: /Le cycle de Calvin/ }).click();
    await page.getByRole('button', { name: 'Supprimer ce contenu' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Supprimer ce contenu ?' });
    await expect(dialog).toContainText('« Le cycle de Calvin » sera définitivement supprimé');
    await shot(page, '04e-confirmation-suppression');
    await dialog.getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(page.getByText('Contenu supprimé.')).toBeVisible();
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list).not.toContainText('Le cycle de Calvin');

    // Relance de l'application (même dossier de données) : historique, favori et profil conservés.
    // Un fichier d'historique abîmé (coupure de courant…) est mis de côté sans bloquer le démarrage.
    await closeApp(session);
    writeFileSync(path.join(userData, 'generations', 'fichier-abime.json'), '{"id": "fichier-abime", "contenu": ');
    session = await launchApp(userData, mock.url);
    page = session.page;
    await expect(page).toHaveURL(/^app:\/\/magistra\/app$/, { timeout: 30_000 });
    await expect(page.getByText('Mme Durand').first()).toBeVisible();
    await openNav(page, 'Historique');
    const listAfter = page.getByRole('region', { name: 'Liste : Historique' });
    await expect(listAfter.getByRole('listitem')).toHaveCount(1);
    await expect(listAfter).toContainText('La photosynthèse');
    await openNav(page, 'Favoris');
    const favList = page.getByRole('region', { name: 'Liste : Favoris' });
    await expect(favList.getByRole('listitem')).toHaveCount(1);
    await expect(favList).toContainText('La photosynthèse');
    await favList.getByRole('link', { name: /La photosynthèse/ }).click();
    await expect(page.getByRole('heading', { name: 'Sources utilisées' })).toBeVisible();
    await expect(page.getByText(/notes-photosynthese\.docx — section/).first()).toBeVisible();
    await shot(page, '04f-apres-relance-favoris');
    expect(readdirSync(path.join(userData, 'generations')).some(n => n.startsWith('fichier-abime.json.corrupt'))).toBe(true);
    const profile = await page.evaluate(() => (window as unknown as { magistra: import('../shared/ipc').MagistraBridge }).magistra.profile.get());
    expect(profile).toMatchObject({ displayName: 'Mme Durand', cycle: 'superieur', niveaux: ['master_1'] });
  });

  test('5. arrêt d’une génération lente → « Génération interrompue. »', async () => {
    mock = await startMock({ models: ALL_TIER_MODELS, chatDelayMs: 400 });
    userData = newUserDataDir();
    session = await launchApp(userData, mock.url);
    const { page } = session;
    await setupReadyApp(page);
    await openNav(page, 'Générer');
    await submitCours(page, 'Les fractions');

    const result = resultSection(page);
    await expect(result).toContainText('Cours : Les fractions', { timeout: 30_000 });
    await shot(page, '05a-generation-lente');
    await result.getByRole('button', { name: 'Arrêter' }).click();
    await expect(result.getByText(/^Génération interrompue\./)).toBeVisible();
    await expect(result).toContainText('Le texte déjà produit est conservé ci-dessous.');
    await expect(result.getByRole('button', { name: 'Recommencer' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Générer : Cours/ })).toBeEnabled();
    await shot(page, '05b-generation-interrompue');
    // Rien n'est enregistré pour un contenu interrompu.
    const history = await page.evaluate(() => (window as unknown as { magistra: import('../shared/ipc').MagistraBridge }).magistra.data.list({}));
    expect(history.items).toHaveLength(0);

    // Le moteur est libéré : une nouvelle génération démarre (pas de « génération déjà en cours »).
    await result.getByRole('button', { name: 'Recommencer' }).click();
    await expect(result.getByRole('button', { name: 'Arrêter' })).toBeVisible();
    await expect(result).toContainText('Cours : Les fractions', { timeout: 30_000 });

    // Lien externe suivi pendant la rédaction : navigation refusée, la génération continue et aboutit.
    // (Après une navigation refusée, Playwright attend une navigation qui n'aura jamais lieu : lecture directe du DOM.)
    await stubOpenExternal(session.app);
    await page.evaluate(() => {
      window.location.href = 'https://example.com/';
    });
    mock.options.chatDelayMs = 5;
    const bodyText = () => page.evaluate(() => document.body.innerText);
    await expect.poll(bodyText, { timeout: 30_000 }).toContain("Enregistré dans l'historique");
    expect(await bodyText()).not.toContain('Génération interrompue');
    expect(await openedUrls(session.app)).toEqual(['https://example.com/']);
    expect(page.url()).toMatch(/^app:\/\/magistra\/app\/generate/);
  });

  test('5b. rechargement de la fenêtre pendant une génération → une nouvelle génération reste possible', async () => {
    mock = await startMock({ models: ALL_TIER_MODELS, chatDelayMs: 400 });
    userData = newUserDataDir();
    session = await launchApp(userData, mock.url);
    const { page } = session;
    await setupReadyApp(page);
    await openNav(page, 'Générer');
    await submitCours(page, 'Les fractions');
    await expect(resultSection(page)).toContainText('Cours : Les fractions', { timeout: 30_000 });

    // Ctrl+R (ou redémarrage automatique de l'affichage) au milieu de la rédaction.
    await page.reload();
    await expect(page.getByRole('heading', { name: /que souhaitez-vous/ })).toBeVisible();
    mock.options.chatDelayMs = 5;
    await submitCours(page, 'Les pourcentages');
    const result = resultSection(page);
    await expect(result.getByText("Enregistré dans l'historique")).toBeVisible({ timeout: 30_000 });
    await expect(result.getByRole('alert')).toHaveCount(0);
    const history = await page.evaluate(() => (window as unknown as { magistra: import('../shared/ipc').MagistraBridge }).magistra.data.list({}));
    expect(history.items.map(i => i.sujet)).toEqual(['Les pourcentages']);
  });

  test('6. erreurs précises du moteur : modèle introuvable, mémoire insuffisante (sans détail technique)', async () => {
    mock = await startMock({ models: ALL_TIER_MODELS, missingModel: true });
    userData = newUserDataDir();
    session = await launchApp(userData, mock.url);
    const { page } = session;
    await setupReadyApp(page);
    await openNav(page, 'Générer');
    await submitCours(page, 'Les volcans');

    const alert = resultSection(page).getByRole('alert');
    await expect(alert).toContainText(/Le modèle Magistra (Léger|Standard|Qualité) n'est pas encore installé\./, { timeout: 30_000 });
    expect(await visibleText(alert)).not.toMatch(TECHNICAL);
    await expect(alert.getByRole('link', { name: "Configurer l'intelligence artificielle" })).toBeVisible();
    await shot(page, '06a-modele-introuvable');

    mock.options.missingModel = false;
    mock.options.oom = true;
    await resultSection(page).getByRole('button', { name: 'Recommencer' }).click();
    // Conseil adapté : « Essayez Magistra Léger » seulement si ce n'est pas déjà la version utilisée.
    const status = await page.evaluate(() => (window as unknown as { magistra: import('../shared/ipc').MagistraBridge }).magistra.ai.status());
    await expect(alert).toContainText(
      status.selectedTier === 'leger'
        ? 'Mémoire insuffisante pour faire fonctionner Magistra Léger sur cet ordinateur. Fermez les autres applications'
        : 'Mémoire insuffisante pour ce modèle. Essayez « Magistra Léger »',
      { timeout: 30_000 },
    );
    expect(await visibleText(alert)).not.toMatch(TECHNICAL);
    await expect(alert.getByRole('button', { name: 'Réessayer' })).toBeVisible();
    await shot(page, '06b-memoire-insuffisante');
    expect(await visibleText(page.locator('main'))).not.toMatch(/requires more system memory|GiB|not found/);
  });

  test('7. sécurité à l’exécution : navigation externe bloquée, fetch bloqué, rechargement sans écran blanc', async () => {
    mock = await startMock({ models: ALL_TIER_MODELS });
    userData = newUserDataDir();
    session = await launchApp(userData, mock.url);
    const { app, page } = session;
    await setupReadyApp(page);
    await stubOpenExternal(app);

    // La fenêtre ne contacte jamais le réseau directement : ni Internet, ni Ollama (tout passe par l'IPC).
    const fetches = await page.evaluate(async (ollama: string) => {
      const attempt = async (url: string) => {
        try {
          const res = await fetch(url);
          return `réponse ${res.status}`;
        } catch {
          return 'bloqué';
        }
      };
      return { internet: await attempt('https://example.com/'), ollama: await attempt(`${ollama}/api/version`) };
    }, mock.url);
    expect(fetches).toEqual({ internet: 'bloqué', ollama: 'bloqué' });

    // Session propre à la fenêtre : blocage sans condition, même pour une requête rattachée à aucune page
    // (SharedWorker, service worker) ; le réseau du processus principal (session par défaut) reste disponible.
    const sessions = await app.evaluate(async ({ BrowserWindow, session: electronSession }, ollama: string) => {
      const ses = BrowserWindow.getAllWindows()[0].webContents.session;
      const attempt = async (fetcher: (url: string) => Promise<Response>) => {
        try {
          return `réponse ${(await fetcher(`${ollama}/api/version`)).status}`;
        } catch {
          return 'bloqué';
        }
      };
      return {
        separate: ses !== electronSession.defaultSession,
        window: await attempt(url => ses.fetch(url)),
        main: await attempt(url => electronSession.defaultSession.fetch(url)),
      };
    }, mock.url);
    expect(sessions).toEqual({ separate: true, window: 'bloqué', main: 'réponse 200' });

    // Scripts (workers compris) servis avec la même CSP que la page.
    const scriptCsp = await page.evaluate(async () => {
      const src = document.querySelector<HTMLScriptElement>('script[src]')?.src ?? '';
      const res = await fetch(src);
      return { src: src.replace(/[^/]*$/, ''), csp: res.headers.get('content-security-policy') ?? '' };
    });
    expect(scriptCsp.src).toBe('app://magistra/assets/');
    expect(scriptCsp.csp).toContain("connect-src 'self'");

    // Protocole app:// : aucun fichier hors de l'application, 404 pour une ressource inconnue.
    const files = await page.evaluate(async () => {
      const passwd = await (await fetch('/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd')).text();
      const missing = await fetch('/assets/inexistant.js');
      return { leaked: passwd.includes('root:'), missing: missing.status };
    });
    expect(files).toEqual({ leaked: false, missing: 404 });

    // Seuls les liens http(s) peuvent être confiés au navigateur du système.
    const unsafe = await page.evaluate(async () => {
      const m = (window as unknown as { magistra: import('../shared/ipc').MagistraBridge }).magistra;
      return [await m.app.openExternal('file:///etc/passwd'), await m.app.openExternal('javascript:alert(1)')];
    });
    expect(unsafe).toEqual([false, false]);
    expect(await openedUrls(app)).toEqual([]);

    // Rechargement de /app/history : interface affichée, pas d'écran blanc.
    await openNav(page, 'Historique');
    await expect(page).toHaveURL(/\/app\/history$/);
    await page.reload();
    await expect(page).toHaveURL(/^app:\/\/magistra\/app\/history$/);
    await expect(page.getByRole('heading', { name: 'Historique', level: 1 })).toBeVisible();
    await expect(page.getByText('Aucune génération pour le moment')).toBeVisible();
    expect(await page.locator('#root').evaluate(el => el.childElementCount)).toBeGreaterThan(0);
    await shot(page, '07a-rechargement-historique');

    // Deuxième lancement (double-clic sur l'icône) : il se ferme aussitôt, la fenêtre existante reste la seule.
    const electronBinary = createRequire(import.meta.url)('electron') as string;
    const second = spawn(electronBinary, appArgs(), { cwd: root, env: appEnv(userData!, mock.url), stdio: 'ignore' });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        second.kill('SIGKILL');
        reject(new Error('le second lancement ne s’est pas fermé'));
      }, 20_000);
      second.once('exit', code => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    expect(exitCode).toBe(0);
    expect(app.windows()).toHaveLength(1);
    await expect(page.getByRole('heading', { name: 'Historique', level: 1 })).toBeVisible();

    // Nouvel onglet (lien target=_blank, window.open) : aucune nouvelle fenêtre, lien confié au système.
    await page.evaluate(() => {
      for (const [id, target] of [['e2e-link-self', ''], ['e2e-link-blank', '_blank']] as const) {
        const a = document.createElement('a');
        a.id = id;
        a.href = `https://example.org/${id}`;
        if (target) a.target = target;
        a.textContent = id;
        document.body.appendChild(a);
      }
    });
    await page.locator('#e2e-link-blank').click();
    const popup = await page.evaluate(() => window.open('https://example.net/popup'));
    expect(popup).toBeNull();

    // Même fenêtre (lien, window.location) : navigation annulée par le processus principal.
    // (Playwright attend ensuite une navigation qui n'aura jamais lieu : l'état réel est lu dans le processus principal.)
    await page.evaluate(() => {
      document.getElementById('e2e-link-self')?.click();
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      window.location.href = 'https://example.com/';
    });
    await expect.poll(async () => (await openedUrls(app)).length).toBe(4);
    const windowState = await app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      const wc = wins[0].webContents;
      return { windows: wins.length, url: wc.getURL(), loading: wc.isLoading() };
    });
    expect(windowState).toEqual({ windows: 1, url: 'app://magistra/app/history', loading: false });
    expect(await openedUrls(app)).toEqual([
      'https://example.org/e2e-link-blank',
      'https://example.net/popup',
      'https://example.org/e2e-link-self',
      'https://example.com/',
    ]);
    const stillThere = await page.evaluate(() => ({
      url: location.href,
      heading: document.querySelector('h1')?.textContent ?? '',
      root: document.getElementById('root')?.childElementCount ?? 0,
    }));
    expect(stillThere).toEqual({ url: 'app://magistra/app/history', heading: 'Historique', root: expect.any(Number) });
    expect(stillThere.root).toBeGreaterThan(0);
    await shot(page, '07b-navigation-externe-bloquee');
  });

  test('8. export PDF et Markdown depuis l’application : fichiers réellement écrits', async () => {
    mock = await startMock({ models: ALL_TIER_MODELS });
    userData = newUserDataDir();
    session = await launchApp(userData, mock.url);
    const { app, page } = session;
    await setupReadyApp(page);
    const downloadDir = path.join(userData, 'telechargements');
    mkdirSync(downloadDir, { recursive: true });
    // Pas de boîte « Enregistrer sous » en test : chemin d'enregistrement fixé dans le processus principal.
    // (Session de la fenêtre : partition dédiée, distincte de la session par défaut du processus principal.)
    await app.evaluate(({ BrowserWindow }, dir: string) => {
      const g = globalThis as unknown as { __downloads: { file: string; state: string; url: string }[] };
      g.__downloads = [];
      BrowserWindow.getAllWindows()[0].webContents.session.on('will-download', (event, item) => {
        if (event.defaultPrevented) return;
        const file = `${dir}/${item.getFilename()}`;
        item.setSavePath(file);
        item.once('done', (_e, state) => g.__downloads.push({ file, state, url: item.getURL().slice(0, 24) }));
      });
    }, downloadDir);

    await openNav(page, 'Générer');
    await submitCours(page, 'Les nombres premiers');
    const result = resultSection(page);
    await expect(result.getByText("Enregistré dans l'historique")).toBeVisible({ timeout: 30_000 });
    const actions = result.getByRole('group', { name: 'Actions sur le contenu' });
    await actions.getByRole('button', { name: 'PDF', exact: true }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __downloads: unknown[] }).__downloads.length), { timeout: 30_000 }).toBe(1);
    await actions.getByRole('button', { name: 'Markdown', exact: true }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { __downloads: unknown[] }).__downloads.length), { timeout: 30_000 }).toBe(2);
    await expect(result.getByRole('alert')).toHaveCount(0);

    const downloads = await app.evaluate(() => (globalThis as unknown as { __downloads: { file: string; state: string; url: string }[] }).__downloads);
    expect(downloads.map(d => d.state)).toEqual(['completed', 'completed']);
    expect(downloads.every(d => d.url.startsWith('blob:app://magistra/'))).toBe(true);
    const pdf = downloads.find(d => d.file.endsWith('.pdf'));
    const md = downloads.find(d => d.file.endsWith('.md'));
    expect(pdf && md, JSON.stringify(downloads)).toBeTruthy();
    // Nom proposé par l'application (titre du contenu, accents conservés), jamais « download ».
    expect(path.basename(pdf!.file)).toMatch(/Les nombres premiers\.pdf$/);
    expect(path.basename(md!.file)).toMatch(/Les nombres premiers\.md$/);
    const pdfBytes = readFileSync(pdf!.file);
    expect(pdfBytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdfBytes.length).toBeGreaterThan(2_000);
    expect(readFileSync(md!.file, 'utf8')).toContain('Les nombres premiers');
    expect(readdirSync(downloadDir).sort()).toEqual([path.basename(md!.file), path.basename(pdf!.file)].sort());
    await shot(page, '08-export-pdf');
  });
  test('9. réglages : changer de version, serveur Ollama distant, assistant depuis les réglages', async () => {
    mock = await startMock({ models: ALL_TIER_MODELS });
    const distant = await startMock({ models: ['ministral-3:8b'] });
    userData = newUserDataDir();
    try {
      session = await launchApp(userData, mock.url);
      const { page } = session;
      await setupReadyApp(page);
      await openNav(page, 'Réglages');
      await expect(page.getByText('● Prête')).toBeVisible();

      // Changer de version (déjà installée) : aucun téléchargement.
      const before = await page.evaluate(() => (window as unknown as { magistra: import('../shared/ipc').MagistraBridge }).magistra.ai.status());
      const other = before.tiers.find(t => t.id !== before.selectedTier)!;
      await page.locator(`label[data-tier="${other.id}"]`).click();
      await page.getByRole('button', { name: `Utiliser ${other.label}` }).click();
      const confirm = page.getByRole('button', { name: 'Utiliser quand même' });
      const done = page.getByText(`Magistra utilise maintenant ${other.label}.`);
      await expect(confirm.or(done)).toBeVisible();
      if (await confirm.isVisible()) await confirm.click();
      await expect(done).toBeVisible();
      await expect(aiBadge(page)).toContainText('IA prête');
      expect(mock.state.requests.filter(r => r === 'POST /api/pull')).toHaveLength(0);
      const after = await page.evaluate(() => (window as unknown as { magistra: import('../shared/ipc').MagistraBridge }).magistra.ai.status());
      expect(after.activeModel).toBe(other.model);
      await shot(page, '09a-reglages-changement-de-version');

      // Options avancées : serveur Ollama distant.
      await page.getByRole('button', { name: /Options avancées/ }).click();
      await page.getByRole('button', { name: 'Utiliser un serveur IA distant…' }).click();
      await page.getByLabel('Ollama distant').check();
      await page.getByLabel('Adresse du serveur', { exact: true }).fill(distant.url);
      await page.getByLabel('Modèle', { exact: true }).fill('ministral-3:8b');
      await page.getByLabel('Nom affiché (facultatif)').fill('Serveur du lycée');
      await page.getByRole('button', { name: 'Enregistrer et utiliser ce serveur' }).click();
      await expect(page.getByText('Serveur enregistré : il répond et Magistra l’utilise maintenant.')).toBeVisible();
      await expect(page.getByText('Magistra utilise actuellement le serveur distant « Serveur du lycée ».')).toBeVisible();
      await shot(page, '09b-serveur-distant');

      await openNav(page, 'Générer');
      await expect(page.getByRole('note', { name: 'Confidentialité' })).toContainText('Serveur du lycée');
      await submitCours(page, 'Les suites numériques');
      await expect(resultSection(page).getByText("Enregistré dans l'historique")).toBeVisible({ timeout: 30_000 });
      expect(distant.state.requests).toContain('POST /api/chat');
      expect(mock.state.requests).not.toContain('POST /api/chat');

      // Retour à l'IA locale, puis assistant de configuration ouvert depuis les réglages.
      await openNav(page, 'Réglages');
      await page.getByRole('button', { name: /Options avancées/ }).click();
      await page.getByRole('button', { name: "Revenir à l'IA locale" }).click();
      await expect(page.getByText("Magistra utilise de nouveau l'IA locale de cet ordinateur.")).toBeVisible();
      await page.getByRole('button', { name: 'Assistant de configuration' }).click();
      await expect(page.getByRole('heading', { name: 'Assistant de configuration de l’IA' })).toBeVisible();
      await expect(page.getByRole('heading', { name: /Intelligence artificielle prête/ })).toBeVisible();
      await page.getByRole('button', { name: /Commencer/ }).click();
      await expect(page).toHaveURL(/\/app\/settings$/);
    } finally {
      await distant.close();
    }
  });
});
