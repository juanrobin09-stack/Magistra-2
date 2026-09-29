// Connecteur local DE BOUT EN BOUT : un vrai navigateur (Chromium, protection « Local Network Access » ACTIVE) ouvre
// le harnais du site (VRAIS composants, VRAI contrôleur, VRAI client WebCrypto/IndexedDB, voir e2e/connector-harness)
// et dialogue avec la VRAIE application Windows (Electron, dist-electron) qui génère avec un Ollama simulé
// (scripts/mock-ollama.mjs) — ou avec un vrai Ollama (MAGISTRA_E2E_REAL_OLLAMA_URL).
//
//   navigateur (site) ──HTTP boucle locale, requêtes signées──▶ connecteur (application) ──▶ Ollama (simulé ou réel)
//
// Ce que le « système d'exploitation » fait normalement est joué par le test, et seulement cela :
//  - les URL magistra:// ouvertes par le site (window.__magistraE2EOpenUrl) sont remises à l'application comme le fait
//    Windows : évènement « second-instance » si elle tourne, sinon lancement avec l'URL en argument ;
//  - la boîte native « Autoriser … ? » reçoit la réponse de l'enseignant (dialog.showMessageBox remplacé dans le
//    processus principal : même message, mêmes boutons, vérifiés) ;
//  - Linux : un trousseau de clés privé (dbus + gnome-keyring) remplace DPAPI, pour que les autorisations soient
//    réellement chiffrées sur le disque et survivent au redémarrage de l'application (le « --password-store=basic »
//    imposé par le chargeur Electron de Playwright est retiré par e2e/electron-keyring-preload.cjs) ;
//  - l'autorisation « accès au réseau local » du navigateur est accordée ou refusée par le test, jamais par le site.
//
// Prérequis : `npx vite build` (dist/) puis `node scripts/build-electron.mjs` (dist-electron/). Le harnais est construit
// par ce fichier (test-results/connector/harness-dist, avec les captures dans test-results/connector/captures : dossier
// du projet « connector », que Playwright vide au début de chacun de ses lancements, voir e2e/outputDirs.ts).
// Lancement (Linux sans écran) : `xvfb-run -a npx playwright test --project=connector`.
// Variables facultatives : MAGISTRA_E2E_REAL_OLLAMA_URL (vrai Ollama : ministral-3:8b installé ou en alias),
// MAGISTRA_E2E_LOGS=1 (journaux du processus principal).

import { _electron as electron, expect, test, type BrowserContext, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createECDH, createHash, randomBytes } from 'node:crypto';
import { accessSync, constants as fsConstants, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http, { type IncomingHttpHeaders, type Server } from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultMessage } from '../shared/errors';
import type { MagistraBridge } from '../shared/ipc';
import { buildPairingUrl, parseAppUrl, type ConnectorAppStatus, type ConnectorStatus } from '../shared/localConnector';
import type { GenerationRecordDraft } from '../shared/types';
import { OTHER_SITE_ORIGIN, OTHER_SITE_PORT, SITE_ORIGIN, SITE_PORT } from './connector-harness/sites';
import { CONNECTOR_HARNESS_DIR, E2E_SCREENSHOT_DIRS, fromRoot } from './outputDirs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS_DIR = fromRoot(CONNECTOR_HARNESS_DIR);
const SHOTS = fromRoot(E2E_SCREENSHOT_DIRS.connector);
const REAL_OLLAMA_URL = process.env.MAGISTRA_E2E_REAL_OLLAMA_URL?.trim() || null;
/** Les trois niveaux Magistra : le modèle recommandé est installé quelle que soit la machine de test. */
const ALL_TIER_MODELS = ['ministral-3:8b', 'ministral-3:14b', 'mistral-small3.2:24b'];
/** Erreurs du processus principal qui signalent un défaut (et non un refus attendu). */
const MAIN_PROCESS_FAILURE = /Erreur interne|Erreur fatale|Promesse rejetée non gérée|Erreur de génération|Processus d’affichage arrêté|uncaught|erreur interne/i;

// Textes EXACTS attendus à l'écran (demande de l'enseignant, src/components/localEngine/texts.ts).
const T = {
  intro: 'Activez l’intelligence Magistra sur votre ordinateur.',
  searchExisting: "J'ai déjà Magistra : la rechercher",
  searching: 'Recherche de Magistra sur cet ordinateur…',
  notDetected: 'Magistra n’est pas encore détectée.',
  found: '✓ Magistra trouvée',
  connect: 'Connecter Magistra locale',
  pairing: 'Confirmez dans l’application Magistra…',
  justConnected: '✓ Intelligence locale connectée',
  connected: '✓ Magistra locale connectée',
  appClosed: 'L’application Magistra est fermée.',
  unrecognized:
    "Une application Magistra répond sur cet ordinateur, mais elle ne reconnaît pas ce navigateur (par exemple celle d'une autre session Windows). Ouvrez votre application Magistra ; si elle est déjà ouverte, reconnectez Magistra locale.",
  notAnswered:
    'Magistra n’a pas pu être recherchée : votre navigateur n’a pas reçu votre accord. Relancez la recherche, puis acceptez sa demande. S’il ne vous demande rien, vérifiez que l’application Magistra est ouverte.',
  openApp: 'Ouvrir Magistra',
  retry: 'Réessayer',
  needsPermission: 'Autorisation du navigateur nécessaire',
  searchWithPermission: 'Rechercher Magistra…',
  permissionExplanation:
    'Votre navigateur va vous demander l’autorisation d’accéder aux applications de cet appareil : acceptez-la. Elle permet uniquement à ce site de dialoguer avec l’application Magistra installée sur cet ordinateur.',
  permissionDenied: 'Votre navigateur bloque l’accès à l’application Magistra.',
  localBanner: 'IA locale — Vos contenus sont générés sur cet ordinateur.',
  notReadyTitle: 'Magistra locale n’est pas prête',
  useServer: 'Utiliser le serveur en ligne…',
  remoteConfirm:
    'Cette génération sera traitée par OVHcloud AI Endpoints (serveur distant). Vos demandes et les extraits de vos documents quitteront cet ordinateur.',
  saved: "Enregistré dans l'historique",
  installed: 'J’ai installé Magistra',
  detectNow: 'Détecter maintenant',
} as const;

/** Dernière version publiée annoncée par le faux GET /api/windows-release (même forme que le serveur). */
const RELEASE = {
  available: true,
  version: '2.1.0',
  fileName: 'Magistra-Setup-2.1.0.exe',
  downloadUrl: 'https://github.com/juanrobin09-stack/magistra-2/releases/download/v2.1.0/Magistra-Setup-2.1.0.exe',
  sizeBytes: 89_456_123,
  sha256: createHash('sha256').update('Magistra-Setup-2.1.0.exe').digest('hex'),
  publishedAt: '2026-09-15T08:30:00.000Z',
  releaseUrl: 'https://github.com/juanrobin09-stack/magistra-2/releases/tag/v2.1.0',
  requirements: 'Windows 10 ou 11 (64 bits)',
} as const;

// ─── Utilitaires ────────────────────────────────────────────────────────────

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

function commandExists(name: string): boolean {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    try {
      accessSync(path.join(dir, name), fsConstants.X_OK);
      return true;
    } catch {
      // dossier suivant
    }
  }
  return false;
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

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  // Laisse les animations d'apparition se terminer.
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }).catch(() => undefined);
}

/** Capture d'une section (fenêtre de l'application) : amenée à l'écran, animation d'apparition terminée. */
async function sectionShot(section: Locator, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  await section.scrollIntoViewIfNeeded();
  await section.page().waitForTimeout(600);
  await section.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => undefined);
}

/** URL magistra://pair valide (identifiant et défi aléatoires) pour l'origine donnée : ce que forgerait un autre site. */
function forgedPairingUrl(origin: string): string {
  const verifier = randomBytes(32);
  return buildPairingUrl({
    pairingId: randomBytes(16).toString('base64url'),
    challenge: createHash('sha256').update(verifier).digest('base64url'),
    origin,
  });
}

// ─── Requêtes directes au connecteur (hors navigateur : en-têtes libres) ───

interface RawReply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/** Requête HTTP au connecteur ; null si rien n'écoute (connexion refusée). */
function connectorRequest(port: number, init: { method?: string; path?: string; origin?: string | null; host?: string; body?: string; headers?: Record<string, string> } = {}): Promise<RawReply | null> {
  return new Promise(resolve => {
    const headers: Record<string, string> = { host: init.host ?? `127.0.0.1:${port}`, ...init.headers };
    if (init.origin !== null) headers.origin = init.origin ?? SITE_ORIGIN;
    if (init.body !== undefined) {
      headers['content-type'] ??= 'application/json';
      headers['content-length'] = String(Buffer.byteLength(init.body));
    }
    const req = http.request({ host: '127.0.0.1', port, method: init.method ?? 'GET', path: init.path ?? '/v1/hello', headers, agent: false, setHost: false, timeout: 5_000 });
    req.on('response', res => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end(init.body);
  });
}

/** Attend que le connecteur de l'application réponde sur l'un des ports ; renvoie ce port. */
async function waitForConnector(ports: readonly number[], timeoutMs = 45_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const port of ports) {
      const reply = await connectorRequest(port);
      if (reply?.status === 200) return port;
    }
    if (Date.now() > deadline) throw new Error('Le connecteur local de l’application ne répond pas.');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

interface Impostor {
  /** Requêtes reçues (pré-vérifications CORS comprises), dans l'ordre. */
  received: { method: string; path: string; body: string }[];
  close(): Promise<void>;
}

/**
 * Programme qui occupe un port dédié AVANT l'application (autre session Windows d'un PC partagé ou d'un serveur de
 * bureaux à distance : les ports de la boucle locale sont communs à toutes les sessions). Il se présente comme Magistra,
 * répond à toutes les pré-vérifications CORS et accepte tout : accord immédiat, accusé de réception inventé (il n'a
 * jamais reçu l'URL magistra://, donc jamais le défi), appairage « réussi » avec sa propre clé. Il note tout.
 */
async function startImpostor(port: number): Promise<Impostor> {
  const received: Impostor['received'] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      received.push({ method: req.method ?? '', path: req.url ?? '', body });
      const cors: Record<string, string> = {
        'Access-Control-Allow-Origin': req.headers.origin ?? '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? 'Content-Type',
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Expose-Headers': 'X-Magistra-Proof, X-Magistra-Job',
      };
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        res.end();
        return;
      }
      let reply: unknown = { ok: true };
      if (req.url === '/v1/hello') reply = { app: 'magistra', protocol: 2, version: '9.9.9' };
      if (req.url === '/v1/pair' && req.method === 'POST') {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(body) as Record<string, unknown>;
        } catch {
          // corps illisible : accepté quand même
        }
        const ack = randomBytes(32).toString('base64url');
        reply = 'verifier' in input
          ? { status: 'approved', clientId: randomBytes(16).toString('base64url'), connectorPublicKey: createECDH('prime256v1').generateKeys().toString('base64url'), version: '9.9.9', ack }
          : { status: 'consented', ack };
      }
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return {
    received,
    close: () => new Promise<void>(resolve => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

async function waitForConnectorClosed(ports: readonly number[], timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const replies = await Promise.all(ports.map(port => connectorRequest(port)));
    if (replies.every(r => r === null)) return;
    if (Date.now() > deadline) throw new Error('Le connecteur local écoute encore après la fermeture de l’application.');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

// ─── Harnais : construction et « sites » ────────────────────────────────────

async function buildHarness(): Promise<void> {
  const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [vite, 'build', '--config', path.join('e2e', 'connector-harness', 'vite.config.ts'), '--logLevel', 'warn'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production' },
  });
  const output: string[] = [];
  child.stdout?.on('data', d => output.push(String(d)));
  child.stderr?.on('data', d => output.push(String(d)));
  const code = await new Promise<number | null>(resolve => child.on('close', resolve));
  if (code !== 0 || !existsSync(path.join(HARNESS_DIR, 'index.html'))) {
    throw new Error(`Construction du harnais impossible (code ${code}) :\n${output.join('')}`);
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

interface SiteServer {
  server: Server;
  /** Requêtes reçues sur /api/* (seule /api/windows-release existe ici). */
  apiRequests: string[];
}

/** Sert le harnais construit (et un faux GET /api/windows-release) sur 127.0.0.1:<port>. */
async function serveHarness(port: number): Promise<SiteServer> {
  const apiRequests: string[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (url.pathname.startsWith('/api/')) {
      apiRequests.push(`${req.method} ${url.pathname}`);
      const release = req.method === 'GET' && url.pathname === '/api/windows-release';
      const body = JSON.stringify(release ? RELEASE : { error: { code: 'NOT_FOUND', message: 'Introuvable.', retryable: false } });
      res.writeHead(release ? 200 : 404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body);
      return;
    }
    // Fichier du harnais (jamais hors du dossier construit), sinon la page (routes de l'application).
    let file = path.resolve(HARNESS_DIR, `.${decodeURIComponent(url.pathname)}`);
    const relative = path.relative(HARNESS_DIR, file);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !existsSync(file) || !statSync(file).isFile()) {
      file = path.join(HARNESS_DIR, 'index.html');
    }
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return { server, apiRequests };
}

// ─── Trousseau de clés privé (Linux) ────────────────────────────────────────

interface Keyring {
  /** Variables et options données à l'application pour utiliser ce trousseau (chiffrement safeStorage réel). */
  env: Record<string, string>;
  /** Placées AVANT le dossier de l'application (préchargement « -r », voir e2e/electron-keyring-preload.cjs). */
  args: string[];
  stop(): void;
}

/**
 * Linux : bus de session dbus et gnome-keyring privés, déverrouillés, pour que safeStorage chiffre réellement les
 * autorisations (comme DPAPI sous Windows). Absent (paquets non installés) : null, les autorisations de l'application
 * restent alors en mémoire (persistent: false), comportement vérifié tel quel.
 */
async function startKeyring(): Promise<Keyring | null> {
  if (process.platform !== 'linux' || !commandExists('dbus-daemon') || !commandExists('gnome-keyring-daemon')) return null;
  const dir = mkdtempSync(path.join(os.tmpdir(), 'magistra-keyring-'));
  const socket = path.join(dir, 'bus');
  const address = `unix:path=${socket}`;
  const processes: ChildProcess[] = [];
  const stop = () => {
    for (const p of processes) p.kill();
    rmSync(dir, { recursive: true, force: true });
  };
  processes.push(spawn('dbus-daemon', ['--session', `--address=${address}`, '--nofork', '--nopidfile', '--nosyslog'], { stdio: 'ignore' }));
  for (let i = 0; i < 100 && !existsSync(socket); i++) await new Promise(resolve => setTimeout(resolve, 20));
  if (!existsSync(socket)) {
    stop();
    return null;
  }
  const env = { DBUS_SESSION_BUS_ADDRESS: address };
  const keyring = spawn('gnome-keyring-daemon', ['--unlock', '--components=secrets', '--foreground'], {
    env: { ...process.env, ...env, HOME: dir, XDG_RUNTIME_DIR: dir, XDG_DATA_HOME: path.join(dir, 'data') },
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  processes.push(keyring);
  keyring.stdin?.end('magistra-e2e');
  await new Promise(resolve => setTimeout(resolve, 800));
  if (keyring.exitCode !== null) {
    stop();
    return null;
  }
  // Le chargeur de Playwright impose « --password-store=basic » : le préchargement rétablit celui-ci (et lui seul).
  return { env, args: ['-r', path.join(root, 'e2e', 'electron-keyring-preload.cjs'), '--password-store=gnome-libsecret'], stop };
}

// ─── Faux Ollama ────────────────────────────────────────────────────────────

interface MockOptions {
  models?: string[];
  chatDelayMs?: number;
}

interface MockOllama {
  url: string;
  state: { models: Set<string>; chats: unknown[] };
  options: MockOptions;
  close(): Promise<void>;
}

async function startMock(options: MockOptions): Promise<MockOllama> {
  const mod = (await import(pathToFileURL(path.join(root, 'scripts', 'mock-ollama.mjs')).href)) as {
    startMockOllama(o: MockOptions & { port: number }): Promise<Omit<MockOllama, 'options'>>;
  };
  const opts: MockOptions & { port: number } = { port: 0, chatDelayMs: 40, ...options };
  const server = await mod.startMockOllama(opts);
  return { ...server, options: opts };
}

// ─── Application Windows RÉELLE ─────────────────────────────────────────────

interface ConsentCall {
  type?: string;
  title?: string;
  message?: string;
  detail?: string;
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
}

interface AppSession {
  app: ElectronApplication;
  window: Page;
  port: number;
}

type Bridge = { magistra: MagistraBridge };

/**
 * L'application Magistra de cet ordinateur, et ce que le système fait pour elle (lancement, URL magistra://).
 * Chaque lancement utilise le même dossier de données : un redémarrage relit donc les autorisations enregistrées.
 */
class Desktop {
  session: AppSession | null = null;
  /** URL magistra:// reçues par le « système », dans l'ordre. */
  readonly urls: string[] = [];
  /** Journal du processus principal (tous les lancements). */
  readonly log: string[] = [];
  /** Réponse automatique à la boîte « Autoriser … ? » (null : le test répond lui-même). */
  consentAuto: boolean | null = null;
  private launching: Promise<AppSession> | null = null;

  constructor(readonly options: { userData: string; ollamaUrl: string; ports: number[]; keyring: Keyring | null }) {}

  async launch(url?: string): Promise<AppSession> {
    const distDir = path.join(root, 'dist');
    for (const full of [path.join(distDir, 'index.html'), path.join(root, 'dist-electron/main.js'), path.join(root, 'dist-electron/preload.cjs')]) {
      if (!existsSync(full)) throw new Error(`${full} introuvable : lancez « npx vite build » puis « node scripts/build-electron.mjs ».`);
    }
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
    for (const k of ['ELECTRON_RUN_AS_NODE', 'VITE_DEV_SERVER_URL', 'MAGISTRA_SMOKE_TEST', 'MAGISTRA_CONNECTOR_DISABLED', 'MAGISTRA_DIST_DIR']) delete env[k];
    Object.assign(env, {
      MAGISTRA_USER_DATA_DIR: this.options.userData,
      MAGISTRA_OLLAMA_URL: this.options.ollamaUrl,
      MAGISTRA_CONNECTOR_PORTS: this.options.ports.join(','),
      // Seule origine de développement autorisée : le « site officiel » du harnais (jamais l'autre site).
      MAGISTRA_CONNECTOR_DEV_ORIGINS: SITE_ORIGIN,
      ...this.options.keyring?.env,
    });
    if (process.platform === 'linux' && !/utf-?8/i.test(env.LC_ALL || env.LC_CTYPE || env.LANG || '')) {
      env.LANG = 'C.UTF-8';
      env.LC_ALL = 'C.UTF-8';
    }
    const args = [...(this.options.keyring?.args ?? []), root, ...(url ? [url] : [])];
    if (process.platform === 'linux') {
      if ((typeof process.getuid === 'function' && process.getuid() === 0) || process.env.CI) args.push('--no-sandbox');
      args.push('--disable-gpu');
    }
    const app = await electron.launch({ args, cwd: root, env, timeout: 60_000 });
    const collect = (chunk: Buffer | string) => {
      for (const line of String(chunk).split('\n')) if (line.trim()) this.log.push(line);
    };
    app.process().stdout?.on('data', collect);
    app.process().stderr?.on('data', collect);
    await this.installConsent(app);
    const window = await app.firstWindow();
    const port = await waitForConnector(this.options.ports);
    this.session = { app, window, port };
    return this.session;
  }

  /** Fermeture de l'application (comme l'enseignant) : le connecteur cesse d'écouter. */
  async close(): Promise<void> {
    const session = this.session;
    this.session = null;
    if (!session) return;
    const child = session.app.process();
    await Promise.race([session.app.close(), new Promise(resolve => setTimeout(resolve, 15_000))]).catch(() => undefined);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await waitForConnectorClosed(this.options.ports);
  }

  /**
   * Le système reçoit une URL magistra:// ouverte par le navigateur : application en cours → deuxième instance
   * (comme Windows) ; sinon lancement avec l'URL en argument (« open »), ou lancement puis remise de l'URL.
   */
  openUrl(url: string): Promise<void> {
    this.urls.push(url);
    if (this.launching) return this.launching.then(() => this.deliver(url));
    if (this.session) return this.deliver(url);
    // Appairage : la boîte de consentement est remplacée AVANT que l'URL n'arrive (jamais de vraie boîte native).
    const open = parseAppUrl(url)?.kind === 'open';
    this.launching = this.launch(open ? url : undefined).finally(() => {
      this.launching = null;
    });
    return this.launching.then(() => (open ? undefined : this.deliver(url)));
  }

  /** Lancement en cours (URL reçue alors que l'application était fermée). */
  async whenLaunched(): Promise<AppSession> {
    if (this.launching) return this.launching;
    if (this.session) return this.session;
    throw new Error('Application non lancée.');
  }

  private async deliver(url: string): Promise<void> {
    const session = this.session;
    if (!session) return;
    await session.app.evaluate(({ app }, value) => {
      app.emit('second-instance', { preventDefault() {} }, [process.execPath, value], process.cwd(), {});
    }, url);
  }

  /** Boîte « Autoriser … ? » : même appel que l'application, réponse donnée par le test (ou automatique). */
  private async installConsent(app: ElectronApplication): Promise<void> {
    const auto = this.consentAuto === null ? null : this.consentAuto ? 0 : 1;
    await app.evaluate(({ dialog }, answer) => {
      type Reply = { response: number; checkboxChecked: boolean };
      type Options = { type?: string; title?: string; message?: string; detail?: string; buttons?: string[]; defaultId?: number; cancelId?: number; signal?: AbortSignal };
      const state = { calls: [] as object[], waiting: [] as ((reply: Reply) => void)[], auto: answer as number | null };
      (globalThis as unknown as { __magistraE2EConsent: typeof state }).__magistraE2EConsent = state;
      const original = dialog.showMessageBox.bind(dialog) as unknown as (...args: unknown[]) => Promise<Reply>;
      const replacement = (...args: unknown[]): Promise<Reply> => {
        const options = (args.length > 1 ? args[1] : args[0]) as Options | undefined;
        if (!options || options.type !== 'question' || !String(options.message ?? '').startsWith('Autoriser ')) return original(...args);
        const { type, title, message, detail, buttons, defaultId, cancelId } = options;
        state.calls.push({ type, title, message, detail, buttons, defaultId, cancelId });
        return new Promise<Reply>(resolve => {
          if (state.auto !== null) {
            resolve({ response: state.auto, checkboxChecked: false });
            return;
          }
          const reply = (value: Reply) => resolve(value);
          state.waiting.push(reply);
          // Demande remplacée ou expirée : la boîte se ferme (réponse « Refuser », sans effet).
          options.signal?.addEventListener('abort', () => {
            const i = state.waiting.indexOf(reply);
            if (i >= 0) state.waiting.splice(i, 1);
            resolve({ response: cancelId ?? 1, checkboxChecked: false });
          }, { once: true });
        });
      };
      (dialog as unknown as { showMessageBox: typeof replacement }).showMessageBox = replacement;
    }, auto);
  }

  async consentCalls(): Promise<ConsentCall[]> {
    const session = this.session ?? (await this.whenLaunched());
    return session.app.evaluate(() => (globalThis as unknown as { __magistraE2EConsent?: { calls: ConsentCall[] } }).__magistraE2EConsent?.calls ?? []);
  }

  /** L'enseignant répond dans la boîte affichée (attend qu'elle le soit). */
  async answerConsent(allow: boolean): Promise<void> {
    const session = this.session ?? (await this.whenLaunched());
    await expect.poll(() => session.app.evaluate(() => (globalThis as unknown as { __magistraE2EConsent?: { waiting: unknown[] } }).__magistraE2EConsent?.waiting.length ?? 0), {
      message: 'boîte « Autoriser … ? » affichée par l’application',
    }).toBeGreaterThan(0);
    await session.app.evaluate((_electron, response) => {
      const state = (globalThis as unknown as { __magistraE2EConsent: { waiting: ((reply: { response: number; checkboxChecked: boolean }) => void)[] } }).__magistraE2EConsent;
      state.waiting.shift()?.({ response, checkboxChecked: false });
    }, allow ? 0 : 1);
  }

  /** État du connecteur vu par les réglages de l'application (pont IPC réel de la fenêtre). */
  async connectorStatus(): Promise<ConnectorAppStatus> {
    const session = this.session ?? (await this.whenLaunched());
    return session.window.evaluate(() => (window as unknown as Bridge).magistra.connector.status());
  }

  failures(): string[] {
    return this.log.filter(line => MAIN_PROCESS_FAILURE.test(line));
  }
}

/**
 * Fenêtre de l'application prête sur « Réglages » (profil déjà créé, comme chez un enseignant équipé). Aucun assistant
 * n'est plus imposé au premier lancement : le profil suffit pour ouvrir l'espace. L'animation d'ouverture, jouée au
 * lancement, n'est pas rejouée par ce changement de page (même fenêtre) ; elle est attendue si elle est encore affichée.
 */
async function openAppSettings(window: Page): Promise<void> {
  await window.evaluate(async () => {
    const m = (window as unknown as Bridge).magistra;
    await m.profile.set({ displayName: 'Mme Durand', etablissement: 'Collège Jean Moulin', cycle: 'college', niveaux: ['6eme'], matierePrincipale: 'francais' });
  });
  await window.goto('app://magistra/app/settings');
  await expect(websiteSettings(window)).toBeVisible({ timeout: 20_000 });
  await expect(window.getByTestId('app-intro')).toHaveCount(0, { timeout: 10_000 });
}

/** Réglages de l'application, section « Site web Magistra » (navigateurs autorisés). */
function websiteSettings(window: Page): Locator {
  return window.getByRole('region', { name: 'Site web Magistra' });
}

// ─── Harnais : page du site ─────────────────────────────────────────────────

interface Probe {
  drafts: GenerationRecordDraft[];
  serverGenerations: number;
  openedUrls: string[];
}

type HarnessWindow = { __magistraE2E: Probe & { connectorStatus(): Promise<ConnectorStatus> } };

async function openHarness(page: Page, desktop: Desktop, options: { origin?: string; view?: 'dashboard' | 'settings' | 'generate' } = {}): Promise<void> {
  await page.exposeFunction('__magistraE2EOpenUrl', (url: string) => desktop.openUrl(url));
  const query = new URLSearchParams({ ports: desktop.options.ports.join(','), view: options.view ?? 'dashboard' });
  await page.goto(`${options.origin ?? SITE_ORIGIN}/?${query}`);
}

function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const p = (window as unknown as HarnessWindow).__magistraE2E;
    return { drafts: p.drafts, serverGenerations: p.serverGenerations, openedUrls: p.openedUrls };
  });
}

function siteStatus(page: Page): Promise<ConnectorStatus> {
  return page.evaluate(() => (window as unknown as HarnessWindow).__magistraE2E.connectorStatus());
}

async function nav(page: Page, label: 'Tableau de bord' | 'Générer' | 'Réglages'): Promise<void> {
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: label, exact: true }).click();
}

function card(page: Page): Locator {
  return page.getByTestId('local-engine-card');
}

function result(page: Page): Locator {
  return page.locator('section[aria-labelledby="gen-result-title"]');
}

/** Aucune adresse, aucun port, aucun nom de moteur à l'écran du site (barre d'adresse exclue). */
async function expectNoTechnicalText(page: Page, ports: readonly number[]): Promise<void> {
  const text = await page.locator('body').innerText();
  const forbidden = new RegExp(['127\\.0\\.0\\.1', 'localhost', 'ollama', ...[...ports, SITE_PORT, OTHER_SITE_PORT].map(p => `\\b${p}\\b`)].join('|'), 'i');
  expect(text, 'texte technique visible dans la page du site').not.toMatch(forbidden);
}

/**
 * Lance la génération (formulaire de la page Générer) et suit le texte affiché pendant le flux : longueurs
 * successives du résultat tant que la génération est en cours.
 */
async function generateAndWatch(
  page: Page, sujet: string, until: Locator, timeoutMs = 60_000, onProgress?: (lengths: number[]) => Promise<void>,
  options: { consignes?: string; pollMs?: number } = {},
): Promise<number[]> {
  await page.locator('#gen-sujet').fill(sujet);
  if (options.consignes) await page.locator('#gen-consignes').fill(options.consignes);
  await page.getByRole('button', { name: /^Générer : / }).click();
  const output = result(page).locator('[aria-busy]');
  const lengths: number[] = [];
  const deadline = Date.now() + timeoutMs;
  let reported = false;
  while (!(await until.isVisible().catch(() => false))) {
    if (Date.now() > deadline) throw new Error('Génération trop longue.');
    if ((await output.getAttribute('aria-busy').catch(() => null)) === 'true') {
      const length = (await output.innerText().catch(() => '')).length;
      if (length > 0 && length !== lengths.at(-1)) lengths.push(length);
      if (!reported && lengths.length >= 3 && onProgress) {
        reported = true;
        await onProgress(lengths);
      }
    }
    await page.waitForTimeout(options.pollMs ?? 80);
  }
  return lengths;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test.describe('Connecteur local : site web ⇄ application Windows réelle', () => {
  test.describe.configure({ timeout: 300_000 });

  let keyring: Keyring | null = null;
  const sites: SiteServer[] = [];
  let site: SiteServer;
  let otherSite: SiteServer;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    await buildHarness();
    // Le harnais n'entre jamais dans le site publié : aucun de ses marqueurs dans dist/.
    expect(existsSync(path.join(root, 'dist', 'index.html')), 'dist/ construit (npx vite build)').toBe(true);
    expect(filesContaining(path.join(root, 'dist'), '__magistraE2E')).toEqual([]);
    site = await serveHarness(SITE_PORT);
    otherSite = await serveHarness(OTHER_SITE_PORT);
    sites.push(site, otherSite);
    keyring = await startKeyring();
  });

  test.afterAll(async () => {
    await Promise.all(sites.map(s => new Promise<void>(resolve => {
      s.server.closeAllConnections();
      s.server.close(() => resolve());
    })));
    keyring?.stop();
  });

  let desktop: Desktop | null = null;
  let mock: MockOllama | null = null;
  let userData: string | null = null;
  let pageErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));
    userData = mkdtempSync(path.join(os.tmpdir(), 'magistra-e2e-connector-'));
  });

  test.afterEach(async ({ page }) => {
    const info = test.info();
    if (info.status !== info.expectedStatus) {
      await shot(page, `ECHEC-${info.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}`);
      if (desktop?.session) await desktop.session.window.screenshot({ path: path.join(SHOTS, `ECHEC-application-${info.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.png`) }).catch(() => undefined);
    }
    expect.soft(pageErrors, 'erreurs JavaScript non interceptées dans la page du site').toEqual([]);
    if (desktop) {
      expect.soft(desktop.failures(), 'erreurs du processus principal').toEqual([]);
      if (process.env.MAGISTRA_E2E_LOGS) console.log(`--- ${info.title}\n[main] ${desktop.log.filter(l => !/dbus|vaapi|viz_main|gpu_init|GLib/.test(l)).join('\n[main] ')}`);
      await desktop.close().catch(() => undefined);
    }
    desktop = null;
    await mock?.close();
    mock = null;
    if (userData) rmSync(userData, { recursive: true, force: true });
    userData = null;
  });

  async function newDesktop(ollamaUrl: string): Promise<Desktop> {
    const ports = [await freePort(), await freePort()];
    desktop = new Desktop({ userData: userData!, ollamaUrl, ports, keyring });
    return desktop;
  }

  async function grant(context: BrowserContext, origin = SITE_ORIGIN): Promise<void> {
    await context.grantPermissions(['local-network-access'], { origin });
  }

  test('parcours complet : absente → trouvée → refus → accord → génération en flux → arrêt → fermeture → relance sans nouvel appairage → autorisation retirée', async ({ page, context }) => {
    mock = await startMock({ models: ALL_TIER_MODELS, chatDelayMs: 40 });
    const d = await newDesktop(mock.url);
    const ports = d.options.ports;
    await grant(context);
    await openHarness(page, d);

    await test.step('application absente : « Magistra n’est pas encore détectée. »', async () => {
      await expect(card(page).getByText(T.intro)).toBeVisible();
      await expect(card(page).getByRole('link', { name: 'Télécharger Magistra pour Windows' })).toHaveAttribute('href', RELEASE.downloadUrl);
      // Comme partout où l'on télécharge : taille de l'installateur et trois étapes (avertissement SmartScreen).
      await expect(card(page).getByTestId('windows-installer-facts')).toContainText(/^Installateur : 85,3\sMo · version 2\.1\.0/);
      await expect(card(page).getByRole('list', { name: 'Installation en trois étapes' }).getByRole('listitem')).toHaveCount(3);
      await shot(page, '01-accueil-magistra-locale');
      await card(page).getByRole('button', { name: T.searchExisting }).click();
      await expect(card(page).getByText(T.notDetected)).toBeVisible();
      await expect(card(page).getByRole('button', { name: T.retry })).toBeVisible();
      await expect(card(page).getByRole('link', { name: 'Télécharger Magistra', exact: true })).toHaveAttribute('href', RELEASE.downloadUrl);
      await expect(card(page).getByText(/elle s’installe en quelques secondes, sans droits d’administrateur/)).toBeVisible();
      await expectNoTechnicalText(page, ports);
      await shot(page, '02-non-detectee');
    });

    await test.step('application lancée : « ✓ Magistra trouvée »', async () => {
      await d.launch();
      await card(page).getByRole('button', { name: T.retry }).click();
      await expect(card(page).getByText(T.found)).toBeVisible();
      await expect(card(page).getByRole('button', { name: T.connect })).toBeVisible();
      await expectNoTechnicalText(page, ports);
      await shot(page, '03-trouvee');
    });

    await test.step('appairage refusé dans l’application', async () => {
      await card(page).getByRole('button', { name: T.connect }).click();
      await expect(card(page).getByText(T.pairing)).toBeVisible();
      await expect(card(page).getByRole('button', { name: 'Annuler' })).toBeVisible();
      // Boîte native de l'application : message exact, « Refuser » par défaut.
      await expect.poll(async () => (await d.consentCalls()).length).toBe(1);
      const [call] = await d.consentCalls();
      expect(call).toMatchObject({
        type: 'question', title: 'Magistra', buttons: ['Autoriser', 'Refuser'], defaultId: 1, cancelId: 1,
        message: `Autoriser 127.0.0.1:${SITE_PORT} à utiliser l’intelligence locale de cet ordinateur ?`,
      });
      expect(call.detail).toContain('Il n’aura aucun accès à vos fichiers, à vos autres applications ni aux réglages de Magistra.');
      expect(call.detail).toContain('Magistra → Réglages → « Site web Magistra »');
      // Code de vérification : celui que le site affiche est celui de la boîte (demande liée à cet onglet).
      const code = await card(page).getByTestId('pairing-code').locator('strong').innerText();
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{3}$/);
      expect(call.detail).toContain(`Code de vérification : ${code}.`);
      // L'URL magistra://pair ne contient ni vérificateur ni clé : identifiant, défi et origine seulement.
      const pairUrl = d.urls.at(-1)!;
      expect([...new URL(pairUrl).searchParams.keys()].sort()).toEqual(['challenge', 'id', 'origin', 'v']);
      expect(parseAppUrl(pairUrl)).toMatchObject({ kind: 'pair', origin: SITE_ORIGIN });
      await shot(page, '04-appairage-en-attente');
      await d.answerConsent(false);
      await expect(card(page).getByText(T.found)).toBeVisible();
      await expect(card(page).getByText(defaultMessage('CONNECTOR_PAIRING_REFUSED'))).toBeVisible();
      expect((await d.connectorStatus()).clients).toEqual([]);
      await shot(page, '05-appairage-refuse');
    });

    let clientId = '';
    await test.step('appairage accepté : « ✓ Intelligence locale connectée »', async () => {
      await card(page).getByRole('button', { name: T.connect }).click();
      await expect(card(page).getByText(T.pairing)).toBeVisible();
      await d.answerConsent(true);
      await expect(card(page).getByText(T.justConnected)).toBeVisible();
      await expect(card(page).getByText(/^Modèle : Magistra /)).toBeVisible();
      await expectNoTechnicalText(page, ports);
      await shot(page, '06-intelligence-locale-connectee');
      // L'application connaît ce navigateur ; la clé n'est jamais écrite en clair sur le disque.
      const status = await d.connectorStatus();
      expect(status.clients).toHaveLength(1);
      expect(status.clients[0]).toMatchObject({ site: `127.0.0.1:${SITE_PORT}`, browser: 'Google Chrome' });
      expect(status.persistent).toBe(process.platform !== 'linux' || keyring !== null);
      clientId = status.clients[0].clientId;
      const file = JSON.parse(readFileSync(path.join(userData!, 'local-connector.json'), 'utf8')) as { clients: Record<string, unknown>[] };
      if (status.persistent) {
        expect(file.clients).toHaveLength(1);
        expect(Object.keys(file.clients[0]).sort()).toEqual(['browser', 'clientId', 'keyEnc', 'lastUsedAt', 'origin', 'pairedAt']);
      } else {
        expect(file.clients).toEqual([]);
      }
    });

    await test.step('génération en flux par Magistra locale, résultat enregistré par le site', async () => {
      await nav(page, 'Générer');
      await expect(page.getByTestId('engine-banner')).toHaveText(new RegExp(T.localBanner));
      const chatsBefore = mock!.state.chats.length;
      const lengths = await generateAndWatch(page, 'La photosynthèse', result(page).getByText(T.saved), 60_000, async () => {
        await shot(page, '07-generation-en-flux');
      });
      // Le texte est arrivé progressivement : plusieurs affichages successifs pendant le flux (la mise en forme
      // Markdown peut raccourcir un instant le texte visible, par exemple quand « **gras** » se referme).
      expect(lengths.length, `longueurs successives : ${lengths.join(', ')}`).toBeGreaterThanOrEqual(3);
      expect(Math.max(...lengths)).toBeGreaterThan(lengths[0] * 3);
      await expect(result(page).getByRole('heading', { name: 'Cours : La photosynthèse' })).toBeVisible();
      expect(mock!.state.chats.length).toBeGreaterThan(chatsBefore);
      const { drafts, serverGenerations } = await probe(page);
      expect(serverGenerations).toBe(0);
      expect(drafts).toHaveLength(1);
      expect(drafts[0]).toMatchObject({ type: 'cours', niveau: '6eme', matiere: 'francais', sujet: 'La photosynthèse' });
      expect(drafts[0].contenu).toContain('# Cours : La photosynthèse');
      expect(drafts[0]).not.toHaveProperty('id');
      // Le site n'a rien demandé au serveur en ligne : ni génération, ni enregistrement direct.
      expect(site.apiRequests.filter(r => !r.endsWith('/api/windows-release'))).toEqual([]);
      await expectNoTechnicalText(page, ports);
      await shot(page, '08-generation-enregistree');
    });

    await test.step('arrêt par l’enseignant : génération interrompue, créneau de l’application libéré', async () => {
      mock!.options.chatDelayMs = 300;
      await page.locator('#gen-sujet').fill('Les volcans');
      await page.getByRole('button', { name: /^Générer : / }).click();
      const output = result(page).locator('[aria-busy="true"]');
      await expect.poll(async () => (await output.innerText().catch(() => '')).length, { timeout: 30_000 }).toBeGreaterThan(0);
      await result(page).getByRole('button', { name: 'Arrêter' }).click();
      await expect(result(page).getByText(/^Génération interrompue\./)).toBeVisible();
      await shot(page, '09-generation-arretee');
      await expect.poll(async () => (await siteStatus(page)).busy, { message: 'génération arrêtée dans l’application' }).toBe(false);
      expect((await probe(page)).drafts).toHaveLength(1);
      mock!.options.chatDelayMs = 5;
      await result(page).getByRole('button', { name: 'Recommencer' }).click();
      await expect(result(page).getByText(T.saved)).toBeVisible({ timeout: 60_000 });
      const { drafts } = await probe(page);
      expect(drafts).toHaveLength(2);
      expect(drafts[1].sujet).toBe('Les volcans');
    });

    await test.step('application fermée : « Ouvrir Magistra », jamais de repli vers le serveur en ligne', async () => {
      const before = (await d.connectorStatus()).clients.map(c => c.clientId);
      expect(before).toEqual([clientId]);
      await d.close();
      await nav(page, 'Réglages');
      await nav(page, 'Générer');
      const panel = page.getByTestId('local-not-ready');
      await expect(panel.getByRole('heading', { name: T.notReadyTitle })).toBeVisible();
      await expect(panel.getByText(defaultMessage('CONNECTOR_UNREACHABLE'))).toBeVisible();
      await expect(panel.getByRole('button', { name: T.openApp })).toBeVisible();
      await expect(page.getByTestId('engine-banner')).toHaveText(new RegExp(T.localBanner));
      // Passer au serveur en ligne n'est possible qu'après une confirmation qui nomme le prestataire.
      await panel.getByRole('button', { name: T.useServer }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText(T.remoteConfirm)).toBeVisible();
      await shot(page, '10-confirmation-serveur-en-ligne');
      await dialog.getByRole('button', { name: 'Rester sur Magistra locale' }).click();
      // Envoi malgré tout : erreur de Magistra locale, rien n'est envoyé au serveur en ligne.
      await page.locator('#gen-sujet').fill('Le cycle de l’eau');
      await page.getByRole('button', { name: /^Générer : / }).click();
      await expect(result(page).getByRole('alert')).toContainText('Magistra n\'est pas joignable sur cet ordinateur');
      expect((await probe(page)).serverGenerations).toBe(0);
      await expectNoTechnicalText(page, ports);
      await shot(page, '11-generer-application-fermee');
      await nav(page, 'Tableau de bord');
      await expect(card(page).getByText(T.appClosed)).toBeVisible();
      await expect(card(page).getByRole('button', { name: T.openApp })).toBeVisible();
      await expect(card(page).getByRole('button', { name: T.retry })).toBeVisible();
      await shot(page, '12-application-fermee');
    });

    await test.step('« Ouvrir Magistra » : l’application redémarre et se reconnecte SANS nouvel appairage', async () => {
      await card(page).getByRole('button', { name: T.openApp }).click();
      await expect(card(page).getByText(T.searching)).toBeVisible();
      // Le « système » reçoit magistra://open et lance l'application avec cette URL en argument.
      await expect.poll(() => d.urls.at(-1)).toBe('magistra://open');
      await d.whenLaunched();
      if (keyring !== null || process.platform !== 'linux') {
        await expect(card(page).getByText(T.connected)).toBeVisible({ timeout: 60_000 });
        expect(await d.consentCalls()).toEqual([]);
        expect((await d.connectorStatus()).clients.map(c => c.clientId)).toEqual([clientId]);
        await shot(page, '13-reconnectee-apres-redemarrage');
      } else {
        // Sans trousseau du système : autorisation gardée en mémoire seulement, perdue au redémarrage (documenté).
        // L'application ne reconnaît plus ce navigateur sans l'avoir retiré (aucune marque de retrait) : le site garde
        // son appairage, dit la cause et propose de reconnecter.
        test.info().annotations.push({ type: 'limite', description: 'gnome-keyring indisponible : autorisation non conservée au redémarrage' });
        await expect(card(page).getByText(T.unrecognized)).toBeVisible({ timeout: 60_000 });
        d.consentAuto = true;
        await d.session!.app.evaluate(() => {
          (globalThis as unknown as { __magistraE2EConsent: { auto: number | null } }).__magistraE2EConsent.auto = 0;
        });
        await card(page).getByRole('button', { name: T.connect }).click();
        await expect(card(page).getByText(T.justConnected)).toBeVisible();
        clientId = (await d.connectorStatus()).clients[0].clientId;
      }
    });

    await test.step('autorisation retirée dans l’application : le site le détecte, reste sur Magistra locale', async () => {
      const window = d.session!.window;
      await openAppSettings(window);
      const section = websiteSettings(window);
      await expect(section.getByText(`127.0.0.1:${SITE_PORT}`)).toBeVisible();
      await expect(section.getByText(/Google Chrome/)).toBeVisible();
      await sectionShot(section, '14-application-navigateurs-autorises');
      await section.getByRole('button', { name: /Retirer l’autorisation de Google Chrome/ }).click();
      const confirm = window.getByRole('alertdialog', { name: 'Retirer cette autorisation ?' });
      await expect(confirm).toContainText('Une génération en cours depuis ce navigateur sera arrêtée.');
      await confirm.getByRole('button', { name: 'Retirer', exact: true }).click();
      await expect(section.getByText('Aucun navigateur autorisé.', { exact: false })).toBeVisible();
      await sectionShot(section, '15-application-autorisation-retiree');
      expect((await d.connectorStatus()).clients).toEqual([]);

      // Le site le découvre à la vérification suivante : cause expliquée, Magistra locale reste le moteur choisi.
      await nav(page, 'Générer');
      const panel = page.getByTestId('local-not-ready');
      await expect(panel.getByText(defaultMessage('CONNECTOR_UNPAIRED'))).toBeVisible();
      await expect(page.getByTestId('engine-banner')).toHaveText(new RegExp(T.localBanner));
      await shot(page, '16-generer-autorisation-retiree');
      await nav(page, 'Tableau de bord');
      await expect(card(page).getByText(T.found)).toBeVisible();
      await expect(card(page).getByText(defaultMessage('CONNECTOR_UNPAIRED'))).toBeVisible();
      await expect(card(page).getByRole('button', { name: T.connect })).toBeVisible();
      await expectNoTechnicalText(page, ports);
      await shot(page, '17-autorisation-retiree');
      expect((await probe(page)).serverGenerations).toBe(0);
    });
  });

  test('moteur non prêt (modèle absent) : message précis ; modèle installé : prête — et section « Magistra pour Windows »', async ({ page, context }) => {
    mock = await startMock({ models: [] });
    const d = await newDesktop(mock.url);
    d.consentAuto = true;
    await d.launch();
    await grant(context);
    // Le téléchargement direct de l'installateur ne quitte pas la page (fichier servi par le test, pas par GitHub).
    await page.route('https://github.com/**', route => route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${RELEASE.fileName}"` },
      body: 'MZ',
    }));
    await openHarness(page, d, { view: 'settings' });

    const windows = page.getByTestId('windows-download');
    await expect(windows.getByTestId('windows-version')).toHaveText(RELEASE.version);
    await expect(windows.getByTestId('windows-size')).toHaveText('85,3 Mo');
    await expect(windows.getByTestId('windows-date')).toHaveText('15 septembre 2026');
    await windows.getByText('Empreinte SHA-256').click();
    await expect(windows.getByTestId('windows-sha256')).toHaveText(RELEASE.sha256);
    await expect(windows.getByText(RELEASE.requirements).first()).toBeVisible();
    const download = page.waitForEvent('download');
    await windows.getByRole('link', { name: 'Télécharger Magistra pour Windows' }).click();
    expect((await download).suggestedFilename()).toBe(RELEASE.fileName);
    const installed = page.getByTestId('windows-installed');
    await expect(installed.getByText(T.installed)).toBeVisible();
    await installed.getByRole('button', { name: T.detectNow }).click();
    await expect(installed.getByText(T.found)).toBeVisible();
    await expectNoTechnicalText(page, d.options.ports);
    await shot(page, '20-windows-detecter-maintenant');
    await installed.getByRole('button', { name: T.connect }).click();
    await expect(installed.getByText(T.justConnected)).toBeVisible();

    await nav(page, 'Tableau de bord');
    await expect(card(page).getByText(T.connected)).toBeVisible();
    // Cause précise, par le texte neutre du site (jamais le message de la fenêtre de l'application).
    await expect(card(page).getByText('Le modèle d’IA choisi n’est pas encore installé : ouvrez l’application Magistra pour le télécharger.')).toBeVisible();
    await expect(card(page).getByRole('button', { name: T.openApp })).toBeVisible();
    await expectNoTechnicalText(page, d.options.ports);
    await shot(page, '21-modele-absent');
    await nav(page, 'Générer');
    await expect(page.getByTestId('local-not-ready').getByText('Le modèle d’IA choisi n’est pas encore installé : ouvrez l’application Magistra pour le télécharger.')).toBeVisible();

    for (const model of ALL_TIER_MODELS) mock.state.models.add(model);
    await nav(page, 'Tableau de bord');
    await card(page).getByRole('button', { name: T.retry }).click();
    await expect(card(page).getByText(T.connected)).toBeVisible();
    await expect(card(page).getByText(/^Modèle : Magistra /)).toBeVisible();
    await expect(card(page).getByText(/n’est pas encore installé/)).toHaveCount(0);
    await expect(card(page).getByRole('button')).toHaveCount(0);
    await shot(page, '22-modele-pret');
    expect((await siteStatus(page)).engine).toMatchObject({ ready: true, local: true });

    // Déconnexion depuis les réglages du site : autorisation retirée dans l'application aussi (DELETE /v1/pair signé).
    await nav(page, 'Réglages');
    await page.getByRole('button', { name: 'Déconnecter Magistra locale' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Déconnecter Magistra locale ?' });
    await confirm.getByRole('button', { name: 'Déconnecter', exact: true }).click();
    await expect.poll(async () => (await d.connectorStatus()).clients).toEqual([]);
    const settings = page.getByRole('region', { name: 'Intelligence artificielle' });
    await expect(settings.getByText(T.found)).toBeVisible();
    // Magistra locale reste le moteur choisi : rien ne part vers le serveur en ligne sans l'accord de l'enseignant.
    await expect(settings.getByRole('radio', { name: /Magistra locale \(recommandé\)/ })).toBeChecked();
    await expectNoTechnicalText(page, d.options.ports);
    await shot(page, '23-deconnectee-depuis-le-site');
  });

  test('autre site : aucune réponse lisible du connecteur, aucun appairage possible (même avec l’accord de l’enseignant)', async ({ page, context }) => {
    mock = await startMock({ models: ALL_TIER_MODELS });
    const d = await newDesktop(mock.url);
    const port = (await d.launch()).port;
    // L'autre site a lui aussi l'autorisation du navigateur : seul le connecteur le refuse.
    await grant(context, OTHER_SITE_ORIGIN);
    await openHarness(page, d, { origin: OTHER_SITE_ORIGIN });

    await expect(card(page).getByText(T.intro)).toBeVisible();
    await card(page).getByRole('button', { name: T.searchExisting }).click();
    await expect(card(page).getByText(T.notDetected)).toBeVisible();
    await shot(page, '30-autre-site-rien-de-lisible');

    // Depuis l'autre site, le navigateur ne laisse rien lire : CORS refusé, réponses opaques.
    const attempts = await page.evaluate(async connectorPort => {
      const base = `http://127.0.0.1:${connectorPort}`;
      const outcome = (p: Promise<Response>) => p.then(r => `${r.type}:${r.status}`, (e: Error) => e.name);
      return {
        hello: await outcome(fetch(`${base}/v1/hello`)),
        opaque: await outcome(fetch(`${base}/v1/hello`, { mode: 'no-cors' })),
        pair: await outcome(fetch(`${base}/v1/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })),
        status: await outcome(fetch(`${base}/v1/status`, { headers: { 'X-Magistra-Client': 'x' } })),
      };
    }, port);
    expect(attempts).toEqual({ hello: 'TypeError', opaque: 'opaque:0', pair: 'TypeError', status: 'TypeError' });

    // Vu du connecteur : 403 sans aucun en-tête CORS pour l'autre origine (et pour un autre nom d'hôte).
    for (const reply of [
      await connectorRequest(port, { origin: OTHER_SITE_ORIGIN }),
      await connectorRequest(port, { origin: OTHER_SITE_ORIGIN, method: 'OPTIONS', headers: { 'access-control-request-method': 'GET' } }),
      await connectorRequest(port, { host: `localhost:${port}` }),
      await connectorRequest(port, { origin: null }),
    ]) {
      expect(reply?.status).toBe(403);
      expect(reply?.headers['access-control-allow-origin']).toBeUndefined();
      expect(JSON.parse(reply!.body)).toEqual({ error: { code: 'FORBIDDEN', message: defaultMessage('FORBIDDEN'), retryable: false } });
    }
    const official = await connectorRequest(port, { origin: SITE_ORIGIN });
    expect(official?.status).toBe(200);
    expect(official?.headers['access-control-allow-origin']).toBe(SITE_ORIGIN);

    // Demande d'appairage au nom de l'autre site : ignorée par l'application (aucune boîte).
    await d.openUrl(forgedPairingUrl(OTHER_SITE_ORIGIN));
    await expect.poll(() => d.log.some(l => l.includes(`Demande de connexion ignorée : site non autorisé (127.0.0.1:${OTHER_SITE_PORT})`))).toBe(true);
    expect(await d.consentCalls()).toEqual([]);

    // L'autre site se fait passer pour le site officiel dans l'URL, et l'enseignant accepte : l'appairage reste
    // impossible, car la fin d'appairage doit venir de l'origine officielle (en-tête Origin fixé par le navigateur).
    await d.session!.app.evaluate(() => {
      (globalThis as unknown as { __magistraE2EConsent: { auto: number | null } }).__magistraE2EConsent.auto = 0;
    });
    const verifier = randomBytes(32);
    const pairingId = randomBytes(16).toString('base64url');
    await d.openUrl(buildPairingUrl({ pairingId, challenge: createHash('sha256').update(verifier).digest('base64url'), origin: SITE_ORIGIN }));
    await expect.poll(async () => (await d.consentCalls()).length).toBe(1);
    const body = JSON.stringify({ pairingId, verifier: verifier.toString('base64url'), clientPublicKey: Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString('base64url') });
    const fromPage = await page.evaluate(async ({ connectorPort, payload }) => {
      try {
        const res = await fetch(`http://127.0.0.1:${connectorPort}/v1/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
        return `${res.status}`;
      } catch (e) {
        return (e as Error).name;
      }
    }, { connectorPort: port, payload: body });
    expect(fromPage).toBe('TypeError');
    const forged = await connectorRequest(port, { method: 'POST', path: '/v1/pair', origin: OTHER_SITE_ORIGIN, body });
    expect(forged?.status).toBe(403);
    expect(forged?.headers['access-control-allow-origin']).toBeUndefined();
    expect((await d.connectorStatus()).clients).toEqual([]);
    await expectNoTechnicalText(page, d.options.ports);
  });

  test('programme qui occupe le premier port dédié et accepte tout : jamais de vérificateur pour lui, appairage avec l’application réelle sur le port suivant', async ({ page, context }) => {
    mock = await startMock({ models: ALL_TIER_MODELS });
    const d = await newDesktop(mock.url);
    const [first, second] = d.options.ports;
    const impostor = await startImpostor(first);
    try {
      d.consentAuto = true;
      await d.launch();
      // Le premier port est pris : l'application écoute sur le suivant (l'imposteur répond « 9.9.9 » sur le premier).
      await expect.poll(async () => {
        const reply = await connectorRequest(second);
        return reply?.status === 200 ? (JSON.parse(reply.body) as { version?: string }).version : null;
      }).not.toBe('9.9.9');
      expect((await connectorRequest(second))?.status).toBe(200);
      await grant(context);
      await openHarness(page, d);
      await expect(card(page).getByText(T.found)).toBeVisible();
      await card(page).getByRole('button', { name: T.connect }).click();
      await expect(card(page).getByText(T.justConnected)).toBeVisible();
      await expectNoTechnicalText(page, d.options.ports);
      await shot(page, '50-appairage-malgre-un-imposteur');

      // L'application a bien autorisé CE navigateur, avec l'accord de l'enseignant.
      expect((await d.connectorStatus()).clients).toHaveLength(1);
      expect(await d.consentCalls()).toHaveLength(1);
      const request = parseAppUrl(d.urls.at(-1));
      if (!request || request.kind !== 'pair') throw new Error('URL magistra://pair attendue');

      // L'imposteur n'a reçu que des requêtes sans secret : présence et premier temps de l'appairage (identifiant
      // seul). Jamais le vérificateur, la clé publique ni le défi ; aucune requête signée, aucun contenu.
      const pairs = impostor.received.filter(r => r.method === 'POST' && r.path === '/v1/pair');
      expect(pairs.length).toBeGreaterThan(0);
      for (const r of pairs) expect(JSON.parse(r.body)).toEqual({ pairingId: request.pairingId });
      for (const r of impostor.received) {
        expect(['/v1/hello', '/v1/pair']).toContain(r.path);
        expect(r.body).not.toContain(request.challenge);
        expect(r.body).not.toMatch(/verifier|clientPublicKey/);
      }
      // Le site dialogue désormais avec l'application réelle (preuve de la clé à chaque réponse).
      expect((await siteStatus(page)).version).not.toBe('9.9.9');
    } finally {
      await impostor.close();
    }
  });

  test('Local Network Access (protection réelle de Chromium) : explication avant la demande, refus expliqué, accord → connexion', async ({ page, context }) => {
    mock = await startMock({ models: ALL_TIER_MODELS });
    const d = await newDesktop(mock.url);
    d.consentAuto = true;
    await d.launch();
    const connectorUrls = d.options.ports.map(p => `http://127.0.0.1:${p}/`);
    const requests: string[] = [];
    const failures: string[] = [];
    page.on('request', r => {
      if (connectorUrls.some(u => r.url().startsWith(u))) requests.push(`${r.method()} ${r.url()}`);
    });
    page.on('requestfailed', r => {
      if (connectorUrls.some(u => r.url().startsWith(u))) failures.push(r.failure()?.errorText ?? '');
    });
    const permissionState = () => page.evaluate(async () => (await navigator.permissions.query({ name: 'local-network-access' as PermissionName })).state);

    await openHarness(page, d);
    expect(await permissionState()).toBe('prompt');
    // Vérification automatique : aucune requête vers l'ordinateur tant que l'enseignant n'a rien demandé.
    await expect(card(page).getByText(T.intro)).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(requests).toEqual([]);

    // L'enseignant cherche Magistra : l'explication d'abord, et toujours aucune requête.
    await card(page).getByRole('button', { name: T.searchExisting }).click();
    const explainer = card(page).getByRole('group', { name: 'Autorisation du navigateur' });
    await expect(explainer.getByText(T.permissionExplanation)).toBeVisible();
    expect(requests).toEqual([]);
    await shot(page, '40-explication-avant-demande');
    // « Continuer » : le navigateur demande l'autorisation (refusée d'office sans écran) → requêtes bloquées.
    await explainer.getByRole('button', { name: 'Continuer' }).click();
    await expect(card(page).getByText(T.notDetected)).toBeVisible();
    // Demande restée sans réponse : la cause est dite (jamais « téléchargez-la » seul).
    await expect(card(page).getByText(T.notAnswered)).toBeVisible();
    expect(requests.length).toBeGreaterThan(0);
    expect(failures.length).toBe(requests.length);
    await shot(page, '41-demande-non-accordee');

    // L'enseignant a refusé l'autorisation dans le navigateur : comment l'accorder.
    const cdp = await context.newCDPSession(page);
    const { targetInfo } = await cdp.send('Target.getTargetInfo');
    await cdp.send('Browser.setPermission', {
      permission: { name: 'local-network-access' }, setting: 'denied', origin: SITE_ORIGIN, browserContextId: targetInfo.browserContextId,
    });
    expect(await permissionState()).toBe('denied');
    await card(page).getByRole('button', { name: T.retry }).click();
    const again = card(page).getByRole('group', { name: 'Autorisation du navigateur' });
    if (await again.isVisible().catch(() => false)) await again.getByRole('button', { name: 'Continuer' }).click();
    await expect(card(page).getByText(T.permissionDenied)).toBeVisible();
    await expect(card(page).getByText("à la ligne « Applications sur l'appareil » (ou « Réseau local »), choisissez « Autoriser » ;")).toBeVisible();
    await expectNoTechnicalText(page, d.options.ports);
    await shot(page, '42-autorisation-refusee');

    // Autorisation accordée : Magistra est trouvée, puis connectée.
    await grant(context);
    expect(await permissionState()).toBe('granted');
    await card(page).getByRole('button', { name: T.retry }).click();
    await expect(card(page).getByText(T.found)).toBeVisible();
    await shot(page, '43-autorisation-accordee-trouvee');
    await card(page).getByRole('button', { name: T.connect }).click();
    await expect(card(page).getByText(T.justConnected)).toBeVisible();

    // Autorisation à redemander (réglages du navigateur réinitialisés) : explication, aucune requête automatique.
    await context.clearPermissions();
    requests.length = 0;
    await page.reload();
    await expect(card(page).getByText(T.needsPermission)).toBeVisible();
    await expect(card(page).getByText(T.permissionExplanation)).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(requests).toEqual([]);
    await nav(page, 'Générer');
    await expect(page.getByText('Autorisez d’abord votre navigateur à joindre Magistra : bouton « Rechercher Magistra… » ci-dessus.').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Générer : / })).toBeDisabled();
    await shot(page, '44-autorisation-a-redemander');
    await nav(page, 'Tableau de bord');
    await grant(context);
    await card(page).getByRole('button', { name: T.searchWithPermission }).click();
    await expect(card(page).getByText(T.connected)).toBeVisible();
    expect((await probe(page)).serverGenerations).toBe(0);
  });

  test('vraie IA : appairage puis génération d’un cours en français, en flux, par site → connecteur → application → Ollama', async ({ page, context }) => {
    test.skip(!REAL_OLLAMA_URL, 'MAGISTRA_E2E_REAL_OLLAMA_URL non défini (vrai Ollama avec ministral-3:8b)');
    test.setTimeout(30 * 60_000);
    // Niveau « Léger » (ministral-3:8b) choisi dans l'application : c'est le modèle servi par ce vrai Ollama.
    writeFileSync(path.join(userData!, 'ai-config.json'), JSON.stringify({ version: 1, mode: 'local', tier: 'leger', tierChosen: true, ollamaUrl: REAL_OLLAMA_URL }));
    const d = await newDesktop(REAL_OLLAMA_URL!);
    d.consentAuto = true;
    await d.launch();
    await grant(context);
    await openHarness(page, d);
    // Application déjà ouverte et autorisation du navigateur accordée : trouvée dès la vérification automatique.
    await expect(card(page).getByText(T.found)).toBeVisible();
    await card(page).getByRole('button', { name: T.connect }).click();
    await expect(card(page).getByText(T.justConnected)).toBeVisible({ timeout: 60_000 });
    await expect(card(page).getByText(/^Modèle : Magistra /)).toBeVisible();
    await nav(page, 'Générer');
    await expect(page.getByTestId('engine-banner')).toHaveText(new RegExp(T.localBanner));
    // Cours court (consigne de l'enseignant) : un modèle sur processeur seul rédige lentement (quelques mots/s).
    const lengths = await generateAndWatch(page, 'Le cycle de l’eau', result(page).getByText(T.saved), 25 * 60_000, async () => {
      await shot(page, '50-vraie-ia-en-flux');
    }, { consignes: 'Cours court pour des élèves de 6e : 200 mots au maximum.', pollMs: 500 });
    expect(lengths.length, `longueurs successives : ${lengths.join(', ')}`).toBeGreaterThanOrEqual(5);
    expect(Math.max(...lengths)).toBeGreaterThan(lengths[0] * 3);
    const text = await result(page).locator('[aria-busy]').innerText();
    expect(text.length).toBeGreaterThan(300);
    // Un vrai cours en français : mots courants du français, et le sujet traité.
    expect(text).toMatch(/\b(le|la|les|des|est|une)\b/i);
    expect(text).toMatch(/eau/i);
    const { drafts, serverGenerations } = await probe(page);
    expect(serverGenerations).toBe(0);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].contenu.length).toBeGreaterThan(300);
    expect(drafts[0].model).toMatch(/ministral-3/);
    await expectNoTechnicalText(page, d.options.ports);
    await shot(page, '51-vraie-ia-cours-genere');
    test.info().annotations.push({ type: 'vraie IA', description: `${drafts[0].model} — ${drafts[0].contenu.length} caractères, ${lengths.length} étapes d'affichage` });
  });
});
