// Gestion de l'IA locale (Ollama) : détection, démarrage automatique, installation du moteur,
// installation des modèles, état agrégé pour l'interface. L'enseignant n'ouvre JAMAIS de terminal.
//
// Règles :
// - aucun téléchargement silencieux : la taille et l'espace disque sont affichés avant, et l'installation
//   ne démarre qu'après un clic (ai:install-engine / ai:pull-model) ;
// - téléchargements reprenables (en-tête Range pour l'installateur, couches conservées par Ollama pour les modèles) ;
// - installateur officiel (release GitHub d'ollama/ollama), lancé UNIQUEMENT si son empreinte SHA-256 correspond à
//   celle publiée avec la même version (sha256sum.txt) : empreinte introuvable ou différente → aucune exécution ;
// - en cas d'échec ou hors Windows : page officielle https://ollama.com/download + détection automatique de la fin
//   de l'installation, sans redémarrer Magistra.

import { createHash } from 'node:crypto';
import { createReadStream, promises as fsp } from 'node:fs';
import path from 'node:path';
import { createProvider } from '../shared/ai/factory.js';
import { getTier, MODEL_TIERS, recommendTier, tierForModel, type HardwareInfo, type TierId } from '../shared/ai/models.js';
import { OllamaClient, OllamaProvider, sameModel, type OllamaModel, type PullProgress } from '../shared/ai/ollama.js';
import type { AIProvider, ChatOptions, FetchLike, HealthStatus, StreamEvent } from '../shared/ai/provider.js';
import { MagistraError, isMagistraError } from '../shared/errors.js';
import type { AIConfigUpdate, AIProgressEvent, AIStatus, EngineState, TierStatus } from '../shared/ipc.js';
import type { PrivacyInfo } from '../shared/types.js';
import type { AIConfigStore } from './aiConfig.js';
import { isLoopbackHost } from './security.js';

export const OLLAMA_DOWNLOAD_PAGE = 'https://ollama.com/download';
export const OLLAMA_RELEASE_API = 'https://api.github.com/repos/ollama/ollama/releases/latest';
const RELEASE_DOWNLOAD_PREFIX = 'https://github.com/ollama/ollama/releases/download/';
const FALLBACK_SETUP_URL = 'https://github.com/ollama/ollama/releases/latest/download/OllamaSetup.exe';
const FALLBACK_SUMS_URL = 'https://github.com/ollama/ollama/releases/latest/download/sha256sum.txt';
export const INSTALLER_ARGS = ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-'];
/** Empreinte officielle indisponible : l'installateur n'est ni téléchargé, ni lancé (même déjà présent). */
export const INSTALLER_UNVERIFIABLE_MESSAGE =
  'Par sécurité, l’installation automatique n’a pas été lancée : l’empreinte SHA-256 officielle de l’installateur d’Ollama n’a pas pu être récupérée pour le vérifier (connexion Internet ou site de téléchargement indisponible). Réessayez plus tard, ou utilisez « Ouvrir la page officielle d’installation » : Magistra détectera l’installation automatiquement.';
/** Fichier différent de l'empreinte officielle : supprimé, jamais lancé. */
export const INSTALLER_MISMATCH_MESSAGE =
  'Par sécurité, l’installateur d’Ollama n’a pas été lancé : le fichier téléchargé ne correspond pas à l’empreinte SHA-256 officielle (fichier endommagé ou modifié) et a été supprimé. Réessayez, ou utilisez « Ouvrir la page officielle d’installation » : Magistra détectera l’installation automatiquement.';
export const ENGINE_APPROX_SIZE_MB = 1200;
export const ENGINE_REQUIRED_DISK_GB = 5;
const MB = 1024 * 1024;
const GB = 1024 ** 3;

/**
 * Note de confidentialité du moteur local. La page Générer ajoute déjà « Vos documents et générations restent
 * sur cet ordinateur. » : ce message dit autre chose (où le texte est rédigé), pour ne pas répéter la même phrase.
 */
export const PRIVACY_LOCAL_MESSAGE = 'IA locale : les contenus sont rédigés sur cet ordinateur, sans aucun service d’IA en ligne.';
export function privacyRemoteMessage(label: string): string {
  return `Les données utilisées pour la génération seront transmises au serveur IA configuré (${label}).`;
}

/** Mémoire insuffisante alors que le niveau le plus léger est déjà utilisé : conseiller « Magistra Léger » n'aurait pas de sens. */
/** Conseil adapté à l'application Windows quand un niveau plus lourd que « Léger » manque de mémoire. */
export const HEAVIER_OUT_OF_MEMORY_MESSAGE =
  'Mémoire insuffisante pour ce modèle. Essayez « Magistra Léger » ou fermez d’autres applications.';

export const LIGHTEST_OUT_OF_MEMORY_MESSAGE =
  'Mémoire insuffisante pour faire fonctionner Magistra Léger sur cet ordinateur. Fermez les autres applications (navigateur, logiciels lourds) puis réessayez, ou utilisez un serveur d’IA distant (Réglages, options avancées).';

/** Ollama sur cet ordinateur, avec des messages d'erreur adaptés au niveau utilisé. */
export class LocalOllamaProvider extends OllamaProvider {
  private readonly lightest: boolean;

  constructor(config: ConstructorParameters<typeof OllamaProvider>[0], lightest: boolean) {
    super(config);
    this.lightest = lightest;
  }

  override async *stream(options: ChatOptions): AsyncIterable<StreamEvent> {
    try {
      yield* super.stream(options);
    } catch (err) {
      if (isMagistraError(err) && (err as MagistraError).code === 'OUT_OF_MEMORY') {
        throw new MagistraError('OUT_OF_MEMORY', this.lightest ? LIGHTEST_OUT_OF_MEMORY_MESSAGE : HEAVIER_OUT_OF_MEMORY_MESSAGE);
      }
      throw err;
    }
  }
}

export interface ReleaseInfo {
  version: string;
  setupUrl: string;
  sizeBytes?: number;
  sumsUrl?: string;
}

export interface EngineExecutable {
  /** Application avec icône de notification (Windows : « ollama app.exe », macOS : Ollama.app). */
  app?: string;
  /** Exécutable en ligne de commande (`ollama serve`). */
  cli?: string;
}

export interface AIManagerDeps {
  config: AIConfigStore;
  /** fetch pour la boucle locale (Ollama sur cet ordinateur). */
  localFetch: FetchLike;
  /** fetch pour Internet (GitHub, serveur distant) : net.fetch d'Electron, qui respecte le proxy du système. */
  netFetch: FetchLike;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  homedir: string;
  tmpdir: string;
  fileExists: (p: string) => Promise<boolean>;
  /** Lance un processus détaché, sans fenêtre, qui survit à Magistra. */
  spawnDetached: (file: string, args: string[], env?: NodeJS.ProcessEnv) => void;
  /** Lance l'installateur et renvoie son code de sortie. */
  runInstaller: (file: string, args: string[], signal: AbortSignal) => Promise<number>;
  openExternal: (url: string) => Promise<void>;
  detectHardware: () => Promise<HardwareInfo>;
  freeDiskBytes: (dir: string) => Promise<number | undefined>;
  modelsDir: string;
  emit: (event: AIProgressEvent) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  /** Intervalles (ms), réglables pour les tests. */
  timings?: Partial<Timings>;
}

interface Timings {
  startPollMs: number;
  startTimeoutMs: number;
  installWaitMs: number;
  installPollMs: number;
  watchIntervalMs: number;
  watchTimeoutMs: number;
  progressThrottleMs: number;
  releaseCacheMs: number;
  /** Délai minimal entre deux nouvelles détections de la machine et de l'installateur par ai:refresh. */
  refreshMinIntervalMs: number;
}

const DEFAULT_TIMINGS: Timings = {
  startPollMs: 750,
  startTimeoutMs: 30_000,
  installWaitMs: 180_000,
  installPollMs: 1_500,
  watchIntervalMs: 3_000,
  watchTimeoutMs: 30 * 60_000,
  progressThrottleMs: 250,
  releaseCacheMs: 60 * 60_000,
  refreshMinIntervalMs: 60_000,
};

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new MagistraError('GENERATION_ABORTED'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new MagistraError('GENERATION_ABORTED'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isLoopbackUrl(url: string): boolean {
  try {
    return isLoopbackHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

function hostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function roundGB(bytes: number): number {
  return Math.round((bytes / 1e9) * 10) / 10;
}

function formatGo(value: number): string {
  return `${Math.round(value * 10) / 10}`.replace('.', ',') + ' Go';
}

/** Ajoute l'en-tête d'autorisation (serveur Ollama distant protégé par un proxy). */
/**
 * Aucune redirection n'est suivie vers un serveur d'IA distant : une redirection pourrait emmener
 * la clé d'accès (en-tête Authorization) vers une autre origine, voire en HTTP clair.
 */
/** Attend `promise`, sauf si `signal` est annulé avant : GENERATION_ABORTED immédiatement. */
export function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new MagistraError('GENERATION_ABORTED'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new MagistraError('GENERATION_ABORTED'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

export function noRedirects(fetchImpl: FetchLike, label: string): FetchLike {
  return async (input, init = {}) => {
    const res = await fetchImpl(input, { ...init, redirect: 'manual' });
    if ((res.status >= 300 && res.status < 400) || res.type === 'opaqueredirect') {
      try {
        await res.body?.cancel();
      } catch {
        // corps déjà fermé
      }
      throw new MagistraError(
        'AI_SERVER_UNAVAILABLE',
        `${label} redirige vers une autre adresse : vérifiez l’adresse du serveur dans les réglages (options avancées).`,
      );
    }
    return res;
  };
}

function withBearer(fetchImpl: FetchLike, apiKey: string): FetchLike {
  return (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${apiKey}`);
    return fetchImpl(input, { ...init, headers });
  };
}

// ─── Progression du téléchargement d'un modèle ─────────────────────────────

export function pullStatusLabel(status: string): string {
  const s = status.toLowerCase();
  if (s === 'pulling manifest') return 'Préparation du téléchargement…';
  if (s.startsWith('pulling ') || s.startsWith('downloading')) return 'Téléchargement du modèle…';
  if (s.startsWith('verifying')) return 'Vérification de l’intégrité…';
  if (s.startsWith('writing manifest')) return 'Finalisation de l’installation…';
  if (s.startsWith('removing')) return 'Nettoyage…';
  if (s === 'success') return 'Modèle installé';
  return 'Installation du modèle…';
}

/** Agrège la progression des différentes couches d'un modèle en une progression globale (monotone). */
export class PullAggregator {
  private readonly layers = new Map<string, { total: number; completed: number }>();
  private lastPercent = 0;

  update(p: PullProgress): { status: string; completedMB?: number; totalMB?: number; percent?: number } {
    if (p.digest && typeof p.total === 'number' && p.total > 0) {
      const layer = this.layers.get(p.digest) ?? { total: p.total, completed: 0 };
      layer.total = p.total;
      if (typeof p.completed === 'number') layer.completed = Math.min(p.total, Math.max(layer.completed, p.completed));
      this.layers.set(p.digest, layer);
    }
    const status = pullStatusLabel(p.status);
    let total = 0;
    let completed = 0;
    for (const l of this.layers.values()) {
      total += l.total;
      completed += l.completed;
    }
    if (p.status === 'success') {
      this.lastPercent = 100;
      return { status, ...(total ? { completedMB: Math.round(total / MB), totalMB: Math.round(total / MB) } : {}), percent: 100 };
    }
    if (total === 0) return { status };
    const raw = Math.floor((completed / total) * 1000) / 10;
    this.lastPercent = Math.min(99.9, Math.max(this.lastPercent, raw));
    return { status, completedMB: Math.round(completed / MB), totalMB: Math.round(total / MB), percent: this.lastPercent };
  }
}

/** Analyse un fichier sha256sum.txt (« <empreinte>  ./OllamaSetup.exe »). */
export function parseSha256Sums(text: string, fileName: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const m = /^([a-f0-9]{64})\s+\*?(?:\.\/)?(\S.*?)\s*$/i.exec(line.trim());
    if (m && path.posix.basename(m[2]) === fileName) return m[1].toLowerCase();
  }
  return undefined;
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve());
  });
  return hash.digest('hex');
}

// ─── Gestionnaire ──────────────────────────────────────────────────────────

export class AIManager {
  private readonly deps: AIManagerDeps;
  private readonly t: Timings;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly now: () => number;
  private hardware: Promise<HardwareInfo> | null = null;
  private hardwareAt = 0;
  private release: { at: number; info: ReleaseInfo | null } | null = null;
  private installAbort: AbortController | null = null;
  private pullAbort: AbortController | null = null;
  private watchAbort: AbortController | null = null;
  private starting: Promise<boolean> | null = null;
  /** Modèles dont le téléchargement a été interrompu (le prochain essai reprendra). */
  private readonly interruptedPulls = new Set<string>();

  constructor(deps: AIManagerDeps) {
    this.deps = deps;
    this.t = { ...DEFAULT_TIMINGS, ...deps.timings };
    this.sleep = deps.sleep ?? defaultSleep;
    this.now = deps.now ?? (() => Date.now());
  }

  private fetchFor(url: string): FetchLike {
    return isLoopbackUrl(url) ? this.deps.localFetch : this.deps.netFetch;
  }

  private client(url = this.deps.config.get().ollamaUrl): OllamaClient {
    return new OllamaClient(url, this.fetchFor(url));
  }

  private get pathApi(): typeof path.posix {
    return this.deps.platform === 'win32' ? path.win32 : path.posix;
  }

  // ─── Machine ────────────────────────────────────────────────────────────

  getHardware(force = false): Promise<HardwareInfo> {
    if (force || !this.hardware) {
      this.hardwareAt = this.now();
      this.hardware = this.deps.detectHardware().catch(err => {
        this.hardware = null;
        throw err;
      });
    }
    return this.hardware;
  }

  // ─── Moteur ─────────────────────────────────────────────────────────────

  private async searchPath(names: string[]): Promise<string | undefined> {
    const p = this.pathApi;
    const raw = this.deps.env.PATH ?? this.deps.env.Path ?? '';
    for (const dir of raw.split(p.delimiter).map(d => d.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean)) {
      for (const name of names) {
        const candidate = p.join(dir, name);
        if (await this.deps.fileExists(candidate)) return candidate;
      }
    }
    return undefined;
  }

  private async firstExisting(candidates: string[]): Promise<string | undefined> {
    for (const c of candidates) if (await this.deps.fileExists(c)) return c;
    return undefined;
  }

  /** Recherche l'installation d'Ollama (emplacements standard puis PATH). */
  async detectExecutable(): Promise<EngineExecutable | null> {
    const { env, homedir, platform } = this.deps;
    const p = this.pathApi;
    let found: EngineExecutable;
    if (platform === 'win32') {
      const localAppData = env.LOCALAPPDATA || p.join(homedir, 'AppData', 'Local');
      const dirs = [p.join(localAppData, 'Programs', 'Ollama')];
      if (env.ProgramFiles) dirs.push(p.join(env.ProgramFiles, 'Ollama'));
      found = {
        app: await this.firstExisting(dirs.map(d => p.join(d, 'ollama app.exe'))),
        cli: (await this.firstExisting(dirs.map(d => p.join(d, 'ollama.exe')))) ?? (await this.searchPath(['ollama.exe'])),
      };
    } else if (platform === 'darwin') {
      const bundles = ['/Applications/Ollama.app', p.join(homedir, 'Applications', 'Ollama.app')];
      const app = await this.firstExisting(bundles);
      found = {
        app,
        cli: (await this.firstExisting([
          ...(app ? [p.join(app, 'Contents', 'Resources', 'ollama')] : []),
          '/usr/local/bin/ollama',
          '/opt/homebrew/bin/ollama',
        ])) ?? (await this.searchPath(['ollama'])),
      };
    } else {
      found = { cli: (await this.searchPath(['ollama'])) ?? (await this.firstExisting(['/usr/local/bin/ollama', '/usr/bin/ollama'])) };
    }
    if (!found.app) delete found.app;
    if (!found.cli) delete found.cli;
    return found.app || found.cli ? found : null;
  }

  async engineState(): Promise<{ state: EngineState; version?: string; executable?: string }> {
    const url = this.deps.config.get().ollamaUrl;
    const version = await this.client(url).version();
    const loopback = isLoopbackUrl(url);
    const exe = loopback ? await this.detectExecutable() : null;
    const executable = exe?.app ?? exe?.cli;
    if (version) return { state: 'running', version, ...(executable ? { executable } : {}) };
    if (!loopback) return { state: 'unknown' };
    if (executable) return { state: 'installed_stopped', executable };
    return { state: 'not_installed' };
  }

  /** Démarre Ollama s'il est installé et arrêté. Renvoie vrai si le moteur répond. */
  startEngine(): Promise<boolean> {
    if (!this.starting) {
      this.starting = this.doStartEngine().finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  private async doStartEngine(): Promise<boolean> {
    const url = this.deps.config.get().ollamaUrl;
    const client = this.client(url);
    if (await client.version()) return true;
    if (!isLoopbackUrl(url)) return false;
    const exe = await this.detectExecutable();
    if (!exe) return false;
    const env: NodeJS.ProcessEnv = { ...this.deps.env };
    try {
      const u = new URL(url);
      if (u.port && u.port !== '11434') env.OLLAMA_HOST = `127.0.0.1:${u.port}`;
    } catch {
      /* adresse déjà validée */
    }
    try {
      if (this.deps.platform === 'win32' && exe.app) this.deps.spawnDetached(exe.app, [], env);
      else if (exe.cli) this.deps.spawnDetached(exe.cli, ['serve'], env);
      else if (exe.app) this.deps.spawnDetached('open', ['-a', exe.app], env);
    } catch (err) {
      console.warn('[magistra] Démarrage du moteur IA impossible :', err);
      return false;
    }
    const deadline = this.now() + this.t.startTimeoutMs;
    while (this.now() < deadline) {
      await this.sleep(this.t.startPollMs);
      if (await client.version()) return true;
    }
    return false;
  }

  /** Au lancement de Magistra : démarre le moteur installé mais arrêté (mode local uniquement). */
  async autoStart(): Promise<void> {
    const cfg = this.deps.config.get();
    if (cfg.mode !== 'local' || !isLoopbackUrl(cfg.ollamaUrl)) return;
    const { state } = await this.engineState();
    if (state === 'installed_stopped') await this.startEngine();
  }

  // ─── Installation du moteur (Windows) ───────────────────────────────────

  /** Informations sur la dernière version de l'installateur (mise en cache 1 h). */
  async releaseInfo(force = false): Promise<ReleaseInfo | null> {
    if (!force && this.release && this.now() - this.release.at < this.t.releaseCacheMs) return this.release.info;
    let info: ReleaseInfo | null = null;
    try {
      const res = await this.deps.netFetch(OLLAMA_RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Magistra (outil pedagogique open source)' },
        signal: AbortSignal.timeout(6_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { tag_name?: string; assets?: { name?: string; size?: number; browser_download_url?: string }[] };
        const assets = Array.isArray(data.assets) ? data.assets : [];
        const setup = assets.find(a => a.name === 'OllamaSetup.exe');
        const sums = assets.find(a => a.name === 'sha256sum.txt');
        if (setup?.browser_download_url?.startsWith(RELEASE_DOWNLOAD_PREFIX)) {
          info = {
            version: typeof data.tag_name === 'string' ? data.tag_name.slice(0, 40) : 'latest',
            setupUrl: setup.browser_download_url,
            ...(typeof setup.size === 'number' && setup.size > 0 ? { sizeBytes: setup.size } : {}),
            ...(sums?.browser_download_url?.startsWith(RELEASE_DOWNLOAD_PREFIX) ? { sumsUrl: sums.browser_download_url } : {}),
          };
        }
      }
    } catch {
      info = null;
    }
    this.release = { at: this.now(), info };
    return info;
  }

  private assertFree(freeBytes: number | undefined, requiredGB: number, what: string): void {
    if (freeBytes !== undefined && freeBytes < requiredGB * GB) {
      throw new MagistraError(
        'STORAGE_ERROR',
        `Espace disque insuffisant pour ${what} : environ ${formatGo(requiredGB)} nécessaires, ${formatGo(freeBytes / GB)} disponibles. Libérez de l’espace puis réessayez.`,
      );
    }
  }

  /**
   * Télécharge et installe Ollama (Windows), après clic de l'enseignant.
   * Progression : engine-download → engine-install → engine-waiting → engine-ready (ou engine-error).
   */
  async installEngine(): Promise<void> {
    if (this.installAbort) throw new MagistraError('AI_BUSY', 'L’installation du moteur IA est déjà en cours.');
    if (this.deps.platform !== 'win32') {
      throw new MagistraError('ENGINE_NOT_INSTALLED', 'L’installation automatique est disponible sous Windows. Utilisez « Ouvrir la page officielle d’installation » : Magistra détectera l’installation automatiquement.');
    }
    const controller = new AbortController();
    this.installAbort = controller;
    const signal = controller.signal;
    try {
      const current = await this.engineState();
      // Déjà installé : inutile de retélécharger, il suffit (au besoin) de le démarrer.
      if (current.state === 'running' || (current.state === 'installed_stopped' && (await this.startEngine()))) {
        const version = (await this.client().version()) ?? 'inconnue';
        this.deps.emit({ kind: 'engine-ready', version });
        return;
      }
      const p = this.pathApi;
      const localAppData = this.deps.env.LOCALAPPDATA || p.join(this.deps.homedir, 'AppData', 'Local');
      this.assertFree(await this.deps.freeDiskBytes(localAppData), ENGINE_REQUIRED_DISK_GB, 'installer le moteur IA');

      const release = (await this.releaseInfo(true)) ?? { version: 'latest', setupUrl: FALLBACK_SETUP_URL, sumsUrl: FALLBACK_SUMS_URL };
      const installer = await this.downloadInstaller(release, signal);

      this.deps.emit({ kind: 'engine-install', message: 'Installation du moteur IA en cours… (cela peut prendre quelques minutes)' });
      let code: number;
      try {
        code = await this.deps.runInstaller(installer, INSTALLER_ARGS, signal);
      } catch (err) {
        if (signal.aborted) throw new MagistraError('GENERATION_ABORTED', 'Installation annulée.');
        throw new MagistraError('ENGINE_NOT_INSTALLED', 'L’installateur n’a pas pu être lancé. Utilisez « Ouvrir la page officielle d’installation » : Magistra détectera l’installation automatiquement.', { cause: err });
      }
      if (code !== 0) {
        throw new MagistraError('ENGINE_NOT_INSTALLED', 'L’installation automatique n’a pas abouti. Utilisez « Ouvrir la page officielle d’installation » : Magistra détectera l’installation automatiquement.');
      }
      await fsp.rm(installer, { force: true }).catch(() => undefined);

      this.deps.emit({ kind: 'engine-waiting', message: 'Démarrage du moteur IA…' });
      const version = await this.waitForEngine(signal, this.t.installWaitMs);
      if (!version) throw new MagistraError('ENGINE_NOT_RUNNING', 'Le moteur IA est installé mais ne répond pas. Redémarrez l’ordinateur puis relancez Magistra.');
      this.deps.emit({ kind: 'engine-ready', version });
    } catch (err) {
      const e = signal.aborted
        ? new MagistraError('GENERATION_ABORTED', 'Installation annulée. Vous pourrez la relancer : le téléchargement reprendra où il s’est arrêté.')
        : isMagistraError(err) ? (err as MagistraError) : new MagistraError('ENGINE_NOT_INSTALLED', 'L’installation automatique a échoué. Utilisez « Ouvrir la page officielle d’installation » : Magistra détectera l’installation automatiquement.', { cause: err });
      this.deps.emit({ kind: 'engine-error', message: e.message });
      throw e;
    } finally {
      if (this.installAbort === controller) this.installAbort = null;
    }
  }

  private async waitForEngine(signal: AbortSignal, timeoutMs: number): Promise<string | null> {
    const client = this.client();
    const deadline = this.now() + timeoutMs;
    let startTried = false;
    const startedAt = this.now();
    while (this.now() < deadline) {
      const version = await client.version();
      if (version) return version;
      // L'installateur lance normalement Ollama ; sinon, on le démarre nous-mêmes.
      if (!startTried && this.now() - startedAt >= 5_000) {
        startTried = true;
        if (await this.startEngine()) return (await client.version()) ?? 'inconnue';
      }
      await this.sleep(this.t.installPollMs, signal);
    }
    return null;
  }

  /**
   * Empreinte SHA-256 officielle de OllamaSetup.exe (sha256sum.txt publié avec la même version).
   * Obligatoire : sans elle (fichier absent de la version, injoignable ou illisible), l'installation est refusée.
   */
  private async expectedInstallerSha(release: ReleaseInfo, signal: AbortSignal): Promise<string> {
    let expected: string | undefined;
    if (release.sumsUrl) {
      try {
        const res = await this.deps.netFetch(release.sumsUrl, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
        if (res.ok) expected = parseSha256Sums(await res.text(), 'OllamaSetup.exe');
        else await res.body?.cancel().catch(() => undefined);
      } catch {
        if (signal.aborted) throw new MagistraError('GENERATION_ABORTED');
      }
    }
    if (!expected) throw new MagistraError('ENGINE_NOT_INSTALLED', INSTALLER_UNVERIFIABLE_MESSAGE);
    return expected;
  }

  /**
   * Téléchargement de OllamaSetup.exe dans le dossier temporaire, avec reprise. Le fichier renvoyé (téléchargé ou
   * réutilisé) correspond TOUJOURS à l'empreinte SHA-256 officielle ; sinon, erreur et rien n'est lancé.
   */
  private async downloadInstaller(release: ReleaseInfo, signal: AbortSignal): Promise<string> {
    // Empreinte d'abord : sans elle, inutile de télécharger (ni de réutiliser) quoi que ce soit.
    const expectedSha = await this.expectedInstallerSha(release, signal);
    const dir = path.join(this.deps.tmpdir, 'magistra-ollama');
    await fsp.mkdir(dir, { recursive: true });
    const safeVersion = release.version.replace(/[^A-Za-z0-9._-]/g, '') || 'latest';
    const finalPath = path.join(dir, `OllamaSetup-${safeVersion}.exe`);
    const partPath = `${finalPath}.part`;
    // Fichiers d'une version précédente : inutiles (la reprise ne vaut que pour la même version).
    for (const name of await fsp.readdir(dir).catch(() => [] as string[])) {
      const full = path.join(dir, name);
      if (name.startsWith('OllamaSetup-') && full !== finalPath && full !== partPath) await fsp.rm(full, { force: true }).catch(() => undefined);
    }

    // Fichier déjà complet (téléchargement précédent) : réutilisé seulement s'il correspond à l'empreinte officielle.
    const existing = await fsp.stat(finalPath).catch(() => null);
    if (existing?.isFile()) {
      if ((await sha256File(finalPath)) === expectedSha) {
        const mb = Math.round(existing.size / MB);
        this.deps.emit({ kind: 'engine-download', receivedMB: mb, totalMB: mb });
        return finalPath;
      }
      await fsp.rm(finalPath, { force: true });
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const start = (await fsp.stat(partPath).catch(() => null))?.size ?? 0;
      const headers: Record<string, string> = { 'User-Agent': 'Magistra (outil pedagogique open source)' };
      if (start > 0) headers.Range = `bytes=${start}-`;
      let res: Response;
      try {
        res = await this.deps.netFetch(release.setupUrl, { headers, signal });
      } catch (err) {
        if (signal.aborted) throw new MagistraError('GENERATION_ABORTED');
        throw new MagistraError('NETWORK_ERROR', 'Téléchargement du moteur IA impossible : vérifiez votre connexion Internet. Il reprendra où il s’est arrêté.', { cause: err });
      }
      if (res.status === 416 && start > 0) {
        // Le fichier partiel est déjà complet (ou incohérent) : on le vérifie plus bas, sinon on recommence.
        await res.body?.cancel().catch(() => undefined);
        if (!release.sizeBytes || start === release.sizeBytes) break;
        await fsp.rm(partPath, { force: true });
        continue;
      }
      if (!res.ok || !res.body) {
        await res.body?.cancel().catch(() => undefined);
        throw new MagistraError('NETWORK_ERROR', 'Le serveur de téléchargement d’Ollama ne répond pas correctement. Réessayez plus tard ou utilisez « Ouvrir la page officielle d’installation ».');
      }
      const resumed = res.status === 206 && start > 0 && (res.headers.get('content-range') ?? '').startsWith(`bytes ${start}-`);
      let received = resumed ? start : 0;
      const length = Number(res.headers.get('content-length'));
      const total = Number.isFinite(length) && length > 0 ? received + length : release.sizeBytes;
      const totalMB = total ? Math.round(total / MB) : undefined;
      const handle = await fsp.open(partPath, resumed ? 'a' : 'w');
      let lastEmit = 0;
      const reader = res.body.getReader();
      const onAbort = () => void reader.cancel().catch(() => undefined);
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        this.deps.emit({ kind: 'engine-download', receivedMB: Math.round(received / MB), ...(totalMB ? { totalMB } : {}) });
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (signal.aborted) throw new MagistraError('GENERATION_ABORTED');
          await handle.write(value);
          received += value.byteLength;
          const now = this.now();
          if (now - lastEmit >= this.t.progressThrottleMs) {
            lastEmit = now;
            this.deps.emit({ kind: 'engine-download', receivedMB: Math.round(received / MB), ...(totalMB ? { totalMB } : {}) });
          }
        }
      } catch (err) {
        if (signal.aborted) throw new MagistraError('GENERATION_ABORTED');
        throw new MagistraError('NETWORK_ERROR', 'Le téléchargement du moteur IA a été interrompu. Relancez-le : il reprendra où il s’est arrêté.', { cause: err });
      } finally {
        signal.removeEventListener('abort', onAbort);
        await handle.close();
      }
      if (signal.aborted) throw new MagistraError('GENERATION_ABORTED');
      if (total && received < total) {
        throw new MagistraError('NETWORK_ERROR', 'Le téléchargement du moteur IA a été interrompu. Relancez-le : il reprendra où il s’est arrêté.');
      }
      this.deps.emit({ kind: 'engine-download', receivedMB: Math.round(received / MB), totalMB: Math.round(received / MB) });
      break;
    }

    if ((await sha256File(partPath)) !== expectedSha) {
      await fsp.rm(partPath, { force: true });
      throw new MagistraError('ENGINE_NOT_INSTALLED', INSTALLER_MISMATCH_MESSAGE);
    }
    await fsp.rename(partPath, finalPath);
    return finalPath;
  }

  cancelEngineInstall(): void {
    this.installAbort?.abort();
    this.watchAbort?.abort();
  }

  /**
   * Ouvre la page officielle de téléchargement puis surveille la fin de l'installation
   * (toutes les 3 s, jusqu'à 30 min) : la configuration reprend sans redémarrer Magistra.
   */
  async openEngineDownload(): Promise<void> {
    await this.deps.openExternal(OLLAMA_DOWNLOAD_PAGE);
    if (this.watchAbort) return;
    const controller = new AbortController();
    this.watchAbort = controller;
    this.deps.emit({ kind: 'engine-waiting', message: 'En attente de l’installation d’Ollama… Magistra la détectera automatiquement.' });
    void this.watchInstallation(controller.signal).finally(() => {
      if (this.watchAbort === controller) this.watchAbort = null;
    });
  }

  private async watchInstallation(signal: AbortSignal): Promise<void> {
    const deadline = this.now() + this.t.watchTimeoutMs;
    let startAttempted = false;
    try {
      while (this.now() < deadline && !signal.aborted) {
        const version = await this.client().version();
        if (version) {
          this.deps.emit({ kind: 'engine-ready', version });
          return;
        }
        if (!startAttempted && (await this.detectExecutable())) {
          startAttempted = true;
          this.deps.emit({ kind: 'engine-waiting', message: 'Installation détectée : démarrage du moteur IA…' });
          if (await this.startEngine()) {
            this.deps.emit({ kind: 'engine-ready', version: (await this.client().version()) ?? 'inconnue' });
            return;
          }
        }
        await this.sleep(this.t.watchIntervalMs, signal);
      }
    } catch {
      return; // annulé
    }
  }

  // ─── Modèles ────────────────────────────────────────────────────────────

  /**
   * Télécharge un modèle (niveau Magistra ou nom avancé) avec progression agrégée.
   * Relancer un téléchargement interrompu reprend là où il s'était arrêté.
   */
  async pullModel(target: { tier?: TierId; model?: string }): Promise<void> {
    if (this.pullAbort) throw new MagistraError('AI_BUSY', 'Un téléchargement de modèle est déjà en cours.');
    const tier = target.model ? tierForModel(target.model) : getTier(target.tier);
    const model = target.model ?? tier!.model;
    const tierId = tier?.id;
    const label = tier?.label ?? model;
    const controller = new AbortController();
    this.pullAbort = controller;
    const emitError = (message: string) => this.deps.emit({ kind: 'model-error', model, message });
    try {
      const client = this.client();
      if (!(await client.version())) {
        const started = isLoopbackUrl(client.baseUrl) && (await this.startEngine());
        if (!started) throw new MagistraError('ENGINE_NOT_RUNNING', 'Le moteur IA n’est pas démarré : installez-le ou démarrez-le avant de télécharger un modèle.');
      }
      if (isLoopbackUrl(client.baseUrl)) {
        const free = await this.deps.freeDiskBytes(this.deps.modelsDir);
        this.assertFree(free, tier ? tier.downloadGB + 1 : 2, `installer ${label}`);
      }
      const resuming = this.interruptedPulls.has(model);
      const aggregator = new PullAggregator();
      let lastEmit = 0;
      let lastStatus = '';
      this.deps.emit({
        kind: 'model-pull',
        ...(tierId ? { tier: tierId } : {}),
        model,
        status: resuming ? 'Reprise du téléchargement…' : 'Préparation du téléchargement…',
        percent: 0,
      });
      await client.pull(model, progress => {
        const agg = aggregator.update(progress);
        const now = this.now();
        const important = agg.status !== lastStatus || progress.status === 'success';
        if (!important && now - lastEmit < this.t.progressThrottleMs) return;
        lastEmit = now;
        lastStatus = agg.status;
        this.deps.emit({ kind: 'model-pull', ...(tierId ? { tier: tierId } : {}), model, ...agg });
      }, controller.signal);
      this.interruptedPulls.delete(model);
      this.deps.emit({ kind: 'model-ready', model });
    } catch (err) {
      let e: MagistraError;
      if (controller.signal.aborted) {
        this.interruptedPulls.add(model);
        e = new MagistraError('GENERATION_ABORTED', 'Téléchargement mis en pause. Relancez-le : il reprendra où il s’était arrêté.');
      } else if (isMagistraError(err)) {
        e = err as MagistraError;
        if (e.code === 'NETWORK_ERROR' || e.code === 'AI_BAD_RESPONSE' || e.code === 'AI_TIMEOUT') this.interruptedPulls.add(model);
      } else {
        this.interruptedPulls.add(model);
        e = new MagistraError('AI_BAD_RESPONSE', 'Le téléchargement du modèle a échoué. Relancez-le : il reprendra où il s’est arrêté.', { cause: err });
      }
      emitError(e.message);
      throw e;
    } finally {
      if (this.pullAbort === controller) this.pullAbort = null;
    }
  }

  cancelPull(): void {
    this.pullAbort?.abort();
  }

  // ─── Configuration et état ──────────────────────────────────────────────

  async setConfig(update: AIConfigUpdate): Promise<AIStatus> {
    await this.deps.config.update(update);
    return this.status();
  }

  private remoteProvider(): AIProvider {
    const cfg = this.deps.config.get();
    const remote = cfg.remote;
    if (!remote) throw new MagistraError('AI_NOT_CONFIGURED', 'Aucun serveur d’IA distant n’est configuré.');
    const apiKey = this.deps.config.getApiKey();
    const label = remote.label || hostLabel(remote.baseUrl);
    const base = noRedirects(this.fetchFor(remote.baseUrl), label);
    if (remote.kind === 'ollama') {
      return createProvider({ kind: 'ollama', baseUrl: remote.baseUrl, model: remote.model, label }, apiKey ? withBearer(base, apiKey) : base);
    }
    return createProvider(
      { kind: 'openai-compatible', baseUrl: remote.baseUrl, model: remote.model, apiKey, label, local: isLoopbackUrl(remote.baseUrl) },
      base,
    );
  }

  /**
   * Fournisseur prêt à générer. En mode local : démarre le moteur si besoin et vérifie que le modèle est installé,
   * pour afficher un message clair plutôt qu'une erreur au milieu de la génération.
   */
  async resolveProvider(signal?: AbortSignal, onStatus?: (message: string) => void): Promise<AIProvider> {
    if (signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
    const cfg = this.deps.config.get();
    if (cfg.mode === 'remote') return this.remoteProvider();
    const url = cfg.ollamaUrl;
    const client = this.client(url);
    const active = this.deps.config.activeLocalModel();
    if (!(await client.version())) {
      if (!isLoopbackUrl(url)) throw new MagistraError('AI_SERVER_UNAVAILABLE', `Serveur Ollama injoignable (${hostLabel(url)}).`);
      if (!(await this.detectExecutable())) {
        throw new MagistraError('ENGINE_NOT_INSTALLED', 'Le moteur d’IA locale (Ollama) n’est pas installé. Ouvrez l’assistant de configuration pour l’installer.');
      }
      onStatus?.('Démarrage du moteur IA…');
      // « Arrêter » libère aussitôt la génération ; le démarrage du moteur, lui, se poursuit en arrière-plan
      // (la génération suivante en profitera).
      if (!(await untilAborted(this.startEngine(), signal))) {
        throw new MagistraError('ENGINE_NOT_RUNNING', 'Le moteur IA ne démarre pas. Redémarrez l’ordinateur puis relancez Magistra.');
      }
    }
    if (signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
    const models = await client.listModels(signal);
    if (!models.some(m => sameModel(m.name, active.model))) {
      throw new MagistraError('MODEL_NOT_INSTALLED', `Le modèle ${active.label} n’est pas encore installé. Installez-le depuis l’assistant de configuration.`);
    }
    return new LocalOllamaProvider(
      { baseUrl: url, model: active.model, label: active.label, contextTokens: active.contextTokens, fetch: this.fetchFor(url) },
      !active.custom && active.tier === 'leger',
    );
  }

  /** Résumé du moteur actif (capacités de génération). */
  async describeActive(): Promise<{ label: string; contextTokens: number; privacy: PrivacyInfo; ready: boolean }> {
    const cfg = this.deps.config.get();
    if (cfg.mode === 'remote' && cfg.remote) {
      const label = cfg.remote.label || hostLabel(cfg.remote.baseUrl);
      let ready: boolean;
      let contextTokens = cfg.remote.kind === 'ollama' ? 12_288 : 32_768;
      try {
        const provider = this.remoteProvider();
        contextTokens = provider.contextTokens;
        ready = (await provider.health(AbortSignal.timeout(5_000))).ok;
      } catch {
        ready = false;
      }
      return { label, contextTokens, ready, privacy: { level: 'remote', message: privacyRemoteMessage(label) } };
    }
    const active = this.deps.config.activeLocalModel();
    const client = this.client(cfg.ollamaUrl);
    let ready = false;
    if (await client.version()) {
      try {
        ready = (await client.listModels()).some(m => sameModel(m.name, active.model));
      } catch {
        ready = false;
      }
    }
    const privacy: PrivacyInfo = isLoopbackUrl(cfg.ollamaUrl)
      ? { level: 'local', message: PRIVACY_LOCAL_MESSAGE }
      : { level: 'remote', message: privacyRemoteMessage(`Ollama — ${hostLabel(cfg.ollamaUrl)}`) };
    return { label: active.label, contextTokens: active.contextTokens, ready, privacy };
  }

  /** État complet affiché par l'assistant de configuration et les réglages. */
  async status(): Promise<AIStatus> {
    const hardware = await this.getHardware();
    const recommendation = recommendTier(hardware);
    if (this.deps.config.isFirstRun) await this.deps.config.applyRecommendedTier(recommendation.tier).catch(() => undefined);
    const cfg = this.deps.config.get();
    const engine = await this.engineState();

    let installed: OllamaModel[] = [];
    if (engine.state === 'running') {
      try {
        installed = await this.client(cfg.ollamaUrl).listModels();
      } catch {
        installed = [];
      }
    }
    const tiers: TierStatus[] = MODEL_TIERS.map(t => {
      const assessment = recommendation.tiers.find(a => a.id === t.id)!;
      return {
        id: t.id,
        label: t.label,
        description: t.description,
        model: t.model,
        modelDisplayName: t.modelDisplayName,
        license: t.license,
        downloadGB: t.downloadGB,
        installed: installed.some(m => sameModel(m.name, t.model)),
        fit: assessment.fit,
        note: assessment.note,
      };
    });

    const active = this.deps.config.activeLocalModel();
    let activeModel = active.model;
    let activeLabel = active.label;
    let ready: boolean;
    let headline: string;
    if (cfg.mode === 'remote' && cfg.remote) {
      activeModel = cfg.remote.model;
      activeLabel = cfg.remote.label || hostLabel(cfg.remote.baseUrl);
      let health: HealthStatus;
      try {
        health = await this.remoteProvider().health(AbortSignal.timeout(5_000));
      } catch (err) {
        const e = isMagistraError(err) ? (err as MagistraError) : new MagistraError('AI_SERVER_UNAVAILABLE');
        health = { ok: false, error: { code: e.code, message: e.message } };
      }
      ready = health.ok;
      headline = ready ? 'Prête'
        : health.error?.code === 'MODEL_NOT_INSTALLED' ? `Modèle ${activeModel} indisponible sur le serveur distant`
          : health.error?.code === 'AI_AUTH_FAILED' ? 'Accès refusé par le serveur IA distant'
            : 'Serveur IA distant injoignable';
    } else {
      const modelInstalled = installed.some(m => sameModel(m.name, active.model));
      ready = engine.state === 'running' && modelInstalled;
      headline = ready ? 'Prête'
        : engine.state === 'not_installed' ? 'Moteur IA non installé'
          : engine.state === 'installed_stopped' ? 'Moteur IA arrêté'
            : engine.state === 'unknown' ? 'Serveur Ollama injoignable'
              : `Modèle ${active.label} non installé`;
    }

    const platformSupported = this.deps.platform === 'win32';
    let sizeMB: number | undefined;
    if (platformSupported && engine.state === 'not_installed') {
      // Taille réelle de l'installateur si GitHub répond vite ; sinon l'approximation suffit (réseau filtré…).
      const info = await Promise.race([this.releaseInfo(), new Promise<null>(resolve => setTimeout(() => resolve(null), 1_500))]);
      const known = info ?? this.release?.info;
      if (known?.sizeBytes) sizeMB = Math.round(known.sizeBytes / MB);
    }

    return {
      engine: {
        state: engine.state,
        url: cfg.ollamaUrl,
        ...(engine.version ? { version: engine.version } : {}),
        ...(engine.executable ? { executable: engine.executable } : {}),
      },
      installedModels: installed.map(m => ({ name: m.name, sizeGB: roundGB(m.size) })),
      tiers,
      selectedTier: cfg.tier,
      activeModel,
      activeLabel,
      ready,
      headline,
      hardware,
      recommendation,
      config: this.deps.config.publicConfig(),
      engineDownload: {
        ...(sizeMB ? { sizeMB } : {}),
        approxSizeMB: ENGINE_APPROX_SIZE_MB,
        requiredDiskGB: ENGINE_REQUIRED_DISK_GB,
        platformSupported,
      },
    };
  }

  /**
   * Nouvelle vérification complète. Le moteur et les modèles sont toujours relus ; la machine (carte graphique,
   * nvidia-smi) et la version de l'installateur (API GitHub) au plus une fois par minute : l'interface rafraîchit
   * l'état après chaque action, à chaque retour dans la fenêtre et toutes les 5 s pendant une installation.
   */
  async refresh(): Promise<AIStatus> {
    const now = this.now();
    if (now - this.hardwareAt >= this.t.refreshMinIntervalMs) this.hardware = null;
    if (this.release && now - this.release.at >= this.t.refreshMinIntervalMs) this.release = null;
    return this.status();
  }

  dispose(): void {
    this.installAbort?.abort();
    this.pullAbort?.abort();
    this.watchAbort?.abort();
  }
}
