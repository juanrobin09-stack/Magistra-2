// Gestion de l'IA locale (Ollama) : détection, démarrage automatique, installation et mise à jour du moteur,
// installation des modèles, état agrégé pour l'interface. L'enseignant n'ouvre JAMAIS de terminal.
//
// Règles :
// - aucun téléchargement silencieux : la taille et l'espace disque sont affichés avant, et l'installation
//   (ou la mise à jour) ne démarre qu'après un clic (ai:install-engine / ai:pull-model) ;
// - téléchargements reprenables (en-tête Range pour l'installateur, couches conservées par Ollama pour les modèles) ;
// - installateur officiel (release GitHub d'ollama/ollama), lancé UNIQUEMENT si son empreinte SHA-256 correspond à
//   celle publiée avec la même version (sha256sum.txt) : empreinte introuvable ou différente → aucune exécution ;
// - en cas d'échec ou hors Windows : page officielle https://ollama.com/download + détection automatique de la fin
//   de l'installation, sans redémarrer Magistra ;
// - version d'Ollama vérifiée (/api/version) : un moteur trop ancien pour les modèles Magistra (ministral-3 exige
//   0.13.1) est signalé (AIStatus.engine.outdated) AVANT tout téléchargement de modèle, avec une mise à jour en un
//   clic (installEngine({ update: true })) ou « demandez au service informatique » (Ollama dans Program Files) ;
// - Ollama est lancé sans fenêtre (« ollama app.exe » --hide --fast-startup, comme sa propre ligne de commande), avec
//   le proxy du système en HTTPS_PROXY : Ollama ignore le proxy de Windows. Aucun identifiant de proxy n'est journalisé.
//   Seul l'installateur officiel le lance à la fin de l'installation, sans ces arguments : sa fenêtre d'accueil peut
//   alors s'ouvrir ; l'interface l'annonce avant et pendant l'installation (ENGINE_WINDOW_NOTE, texts.ts) ;
// - si le moteur ne démarre pas, la cause probable est donnée (journal du moteur filtré, antivirus, port occupé).

import { createHash } from 'node:crypto';
import { createReadStream, promises as fsp } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { createProvider } from '../shared/ai/factory.js';
import {
  getTier, installedModelForTier, MODEL_TIERS, ollamaVersionStatus, recommendTier, tierForModel,
  type HardwareInfo, type TierId,
} from '../shared/ai/models.js';
import { OllamaClient, OllamaProvider, sameModel, type OllamaModel, type PullProgress } from '../shared/ai/ollama.js';
import { isOllamaCloudName, isRemoteOllamaModel, ollamaDestination, REMOTE_MODEL_REFUSED } from '../shared/ai/ollamaRemote.js';
import { providerInfoFor } from '../shared/ai/presets.js';
import type { AIProvider, ChatOptions, FetchLike, HealthStatus, PreloadOptions, PreloadResult, StreamEvent } from '../shared/ai/provider.js';
import { networkFailureKind } from '../shared/ai/streams.js';
import { MagistraError, isMagistraError } from '../shared/errors.js';
import {
  ENGINE_STARTING_MESSAGE, type AIConfigUpdate, type AIProgressEvent, type AIStatus, type EngineInstallOptions, type EngineState, type TierStatus,
} from '../shared/ipc.js';
import type { AINotice, PrivacyInfo, ProviderInfo } from '../shared/types.js';
import type { AIConfigStore } from './aiConfig.js';
import { isLoopbackUrl } from '../shared/ai/loopback.js';

export const OLLAMA_DOWNLOAD_PAGE = 'https://ollama.com/download';
export const OLLAMA_RELEASE_API = 'https://api.github.com/repos/ollama/ollama/releases/latest';
const RELEASE_DOWNLOAD_PREFIX = 'https://github.com/ollama/ollama/releases/download/';
const FALLBACK_SETUP_URL = 'https://github.com/ollama/ollama/releases/latest/download/OllamaSetup.exe';
const FALLBACK_SUMS_URL = 'https://github.com/ollama/ollama/releases/latest/download/sha256sum.txt';
export const INSTALLER_ARGS = ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-'];
/**
 * Arguments de « ollama app.exe » : sans eux, Ollama ouvre sa fenêtre d'accueil (qui propose de se connecter à un
 * compte ollama.com) par-dessus Magistra. Ce sont ceux de la ligne de commande officielle d'Ollama sous Windows
 * (cmd/start_windows.go) ; --fast-startup évite qu'une mise à jour en attente ne retarde le démarrage.
 */
export const OLLAMA_APP_ARGS: readonly string[] = ['--hide', '--fast-startup'];
/** Processus d'Ollama sous Windows (ceux que son installateur arrête lui-même avant une mise à jour). */
export const OLLAMA_PROCESS_NAMES: readonly string[] = ['ollama app.exe', 'ollama.exe'];
/** Adresse testée pour connaître le proxy du système (registre des modèles d'Ollama). */
export const PROXY_PROBE_URL = 'https://registry.ollama.ai';
/** Empreinte officielle indisponible : l'installateur n'est ni téléchargé, ni lancé (même déjà présent). */
export const INSTALLER_UNVERIFIABLE_MESSAGE =
  'Par sécurité, l’installation automatique n’a pas été lancée : l’empreinte SHA-256 officielle de l’installateur d’Ollama n’a pas pu être récupérée pour le vérifier (connexion Internet ou site de téléchargement indisponible). Réessayez plus tard, ou utilisez « Ouvrir la page officielle d’installation » : Magistra détectera l’installation automatiquement.';
/** Fichier différent de l'empreinte officielle : supprimé, jamais lancé. */
export const INSTALLER_MISMATCH_MESSAGE =
  'Par sécurité, l’installateur d’Ollama n’a pas été lancé : le fichier téléchargé ne correspond pas à l’empreinte SHA-256 officielle (fichier endommagé ou modifié) et a été supprimé. Réessayez, ou utilisez « Ouvrir la page officielle d’installation » : Magistra détectera l’installation automatiquement.';
/** Taille approximative de OllamaSetup.exe (1,6 Go pour v0.34.x), affichée si l'API GitHub ne répond pas. */
export const ENGINE_APPROX_SIZE_MB = 1700;
/** Espace nécessaire sur le disque de %LOCALAPPDATA% : installateur (1,6 Go) + binaires (au moins 4 Go) + marge. */
export const ENGINE_REQUIRED_DISK_GB = 7;
/** Espace nécessaire dans le dossier temporaire (%TEMP%), qui reçoit l'installateur seul. */
export const ENGINE_TEMP_REQUIRED_GB = 2;
/**
 * Message d'attente du démarrage du moteur (détection des cartes graphiques, analyse antivirus au premier lancement),
 * défini dans shared/ipc.ts car l'interface l'affiche aussi pendant « Démarrage… ».
 */
export { ENGINE_STARTING_MESSAGE };
/** Moteur absent (ou modèle absent, plus bas) : la carte « Activer l'IA » (tableau de bord, Générer, page de l'IA) l'installe en un clic. */
export const ENGINE_NOT_INSTALLED_MESSAGE = 'Le moteur d’IA locale (Ollama) n’est pas installé. Cliquez sur « Activer l’IA » pour l’installer.';
/** L'exécutable lancé a disparu : mise en quarantaine par un antivirus (faux positifs connus sur ollama.exe). */
export const ENGINE_VANISHED_MESSAGE =
  'Le moteur IA (Ollama) a disparu de cet ordinateur juste après son lancement : un antivirus l’a probablement mis en quarantaine (cela arrive avec ollama.exe). Rétablissez-le depuis votre antivirus, ou demandez au service informatique de l’autoriser, puis réinstallez le moteur IA.';
/**
 * Fin de la surveillance d'une installation manuelle, sans moteur détecté. Cite les boutons affichés sous une erreur
 * du moteur, dans la carte « Activer l'IA » comme dans le panneau du moteur des réglages : « Réessayer » (jamais
 * « Installer le moteur IA », libellé d'avant toute erreur, absent de la carte) et la page officielle.
 */
export const ENGINE_WATCH_TIMEOUT_MESSAGE =
  'Magistra a cessé d’attendre : l’installation du moteur IA (Ollama) n’a pas été détectée. Relancez-la : utilisez « Réessayer » ou « Ouvrir la page officielle d’installation ». Si Ollama est installé dans un autre dossier, démarrez-le vous-même : Magistra le détectera.';
/** Téléchargement de modèle en échec réseau alors qu'Ollama tourne sans le proxy de l'établissement. */
export const PROXY_RESTART_MESSAGE =
  'Le téléchargement du modèle n’a pas pu joindre Internet : votre ordinateur passe par un proxy (réseau d’établissement), mais le moteur IA (Ollama) a été démarré sans ce réglage, qu’il ne détecte pas seul. En cliquant sur « Reprendre le téléchargement », vous autorisez Magistra à relancer le moteur IA avec le proxy (il s’arrête quelques secondes) ; le téléchargement reprendra là où il s’est arrêté.';
/** Relance du moteur impossible hors Windows (Ollama.app, service système…). */
export const RESTART_UNSUPPORTED_MESSAGE =
  'Magistra ne peut pas relancer le moteur IA sur ce système : quittez Ollama puis relancez-le vous-même (avec la variable HTTPS_PROXY si votre réseau utilise un proxy).';
const MB = 1024 * 1024;
const GB = 1024 ** 3;

/**
 * Note de confidentialité du moteur local. La page Générer ajoute déjà « Vos documents et générations restent
 * sur cet ordinateur. » : ce message dit autre chose (où le texte est rédigé), pour ne pas répéter la même phrase.
 */
export const PRIVACY_LOCAL_MESSAGE = 'IA locale : les contenus sont rédigés sur cet ordinateur, sans aucun service d’IA en ligne.';

/**
 * Modèles réellement exécutés par l'Ollama interrogé : les modèles « en ligne » (Ollama Cloud, hôte distant) sont
 * écartés partout (liste proposée, niveaux installés, modèle actif) : l'application n'utilise que des modèles de
 * cet ordinateur, comme elle l'annonce (voir shared/ai/ollamaRemote.ts).
 */
export function localModelsOnly(models: readonly OllamaModel[]): OllamaModel[] {
  return models.filter(m => !isRemoteOllamaModel(m.name, m.remoteHost));
}

/**
 * Windows : place le dossier d'Ollama en tête du PATH transmis au moteur, comme l'installateur officiel
 * (« set PATH={app};%PATH% ») : « ollama app.exe » ne trouve ollama.exe QUE par le PATH. Sans cela, un Ollama installé
 * pendant la session de Magistra (PATH de Magistra figé à son lancement) ou par un autre compte ne démarre pas.
 * La clé existante est modifiée quelle que soit sa casse (« Path » en général) : jamais de seconde clé « PATH ».
 */
export function prependOllamaDirs(env: NodeJS.ProcessEnv, exe: EngineExecutable): void {
  const p = path.win32;
  const dirs = [...new Set([exe.app, exe.cli].filter((f): f is string => typeof f === 'string' && f.length > 0).map(f => p.dirname(f)))];
  if (dirs.length === 0) return;
  const keys = Object.keys(env).filter(k => k.toUpperCase() === 'PATH');
  for (const key of keys.length > 0 ? keys : ['Path']) {
    const current = env[key] ?? '';
    env[key] = current ? `${dirs.join(p.delimiter)}${p.delimiter}${current}` : dirs.join(p.delimiter);
  }
}

/** Vrai si le modèle personnalisé choisi est un modèle en ligne (nom « cloud », ou relayé d'après la liste d'Ollama). */
function customModelIsRemote(model: string, all: readonly OllamaModel[]): boolean {
  return isOllamaCloudName(model) || all.some(m => sameModel(m.name, model) && isRemoteOllamaModel(m.name, m.remoteHost));
}
export function privacyRemoteMessage(label: string): string {
  return `Les données utilisées pour la génération seront transmises au serveur IA configuré (${label}).`;
}

/** Conseil adapté à l'application Windows quand un niveau plus lourd que « Léger » manque de mémoire. */
export const HEAVIER_OUT_OF_MEMORY_MESSAGE =
  'Mémoire insuffisante pour ce modèle. Essayez « Magistra Léger » ou fermez d’autres applications.';

/** Mémoire insuffisante alors que le niveau le plus léger est déjà utilisé : conseiller « Magistra Léger » n'aurait pas de sens. */
export const LIGHTEST_OUT_OF_MEMORY_MESSAGE =
  'Mémoire insuffisante pour faire fonctionner Magistra Léger sur cet ordinateur. Fermez les autres applications (navigateur, logiciels lourds) puis réessayez, ou utilisez un serveur d’IA distant (Réglages, options avancées).';

/** Ollama sur cet ordinateur, avec des messages d'erreur adaptés au niveau utilisé (génération ET préchargement). */
export class LocalOllamaProvider extends OllamaProvider {
  private readonly lightest: boolean;

  constructor(config: ConstructorParameters<typeof OllamaProvider>[0], lightest: boolean) {
    super(config);
    this.lightest = lightest;
  }

  private adapt(err: unknown): unknown {
    if (isMagistraError(err) && (err as MagistraError).code === 'OUT_OF_MEMORY') {
      return new MagistraError('OUT_OF_MEMORY', this.lightest ? LIGHTEST_OUT_OF_MEMORY_MESSAGE : HEAVIER_OUT_OF_MEMORY_MESSAGE, { cause: err });
    }
    return err;
  }

  override async *stream(options: ChatOptions): AsyncIterable<StreamEvent> {
    try {
      yield* super.stream(options);
    } catch (err) {
      throw this.adapt(err);
    }
  }

  override async preload(options?: PreloadOptions): Promise<PreloadResult | void> {
    try {
      return await super.preload(options);
    } catch (err) {
      throw this.adapt(err);
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

/** État du moteur (sous-ensemble de AIStatus.engine). */
export interface EngineInfo {
  state: EngineState;
  version?: string;
  executable?: string;
  /** Version inférieure au minimum des modèles Magistra (présent seulement si vrai). */
  outdated?: boolean;
  /** Version minimale exigée (présente quand le moteur répond). */
  minVersion?: string;
  /** Mise à jour impossible depuis Magistra : Ollama dans Program Files, ou serveur sur un autre ordinateur. */
  managedByAdmin?: boolean;
}

/** Moteur actif pour la génération (capacités). */
export interface ActiveEngine {
  label: string;
  contextTokens: number;
  privacy: PrivacyInfo;
  ready: boolean;
  /** Cause précise quand `ready` est faux. */
  notReady?: AINotice;
  /** Avertissement non bloquant (état non vérifié…). */
  aiWarning?: AINotice;
  /** Serveur distant : prestataire qui reçoit les textes (annoncé dans l'interface). */
  providerInfo?: ProviderInfo;
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
  /** Lance l'installateur (avec l'environnement donné, proxy compris) et renvoie son code de sortie. */
  runInstaller: (file: string, args: string[], signal: AbortSignal, env?: NodeJS.ProcessEnv) => Promise<number>;
  openExternal: (url: string) => Promise<void>;
  detectHardware: () => Promise<HardwareInfo>;
  freeDiskBytes: (dir: string) => Promise<number | undefined>;
  modelsDir: string;
  emit: (event: AIProgressEvent) => void;
  /**
   * Proxy du système pour une adresse : session.defaultSession.resolveProxy d'Electron (« DIRECT »,
   * « PROXY hôte:port; DIRECT »…). Absent : aucun proxy transmis à Ollama.
   */
  resolveProxy?: (url: string) => Promise<string>;
  /** Arrête des processus par nom d'image (Windows : taskkill /f /t /im). Absent : relance du moteur impossible. */
  killProcesses?: (imageNames: readonly string[]) => Promise<void>;
  /** Fin d'un fichier texte (journal du moteur), au plus `maxBytes` octets ; undefined s'il est illisible. */
  readFileTail?: (file: string, maxBytes: number) => Promise<string | undefined>;
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
  /** Après une mise à jour : attente d'une version suffisante quand l'ancienne répond encore. */
  outdatedGraceMs: number;
  /** Relance du moteur : attente de l'arrêt effectif des processus. */
  stopTimeoutMs: number;
  /** Délai accordé au système pour indiquer son proxy. */
  proxyResolveMs: number;
  /**
   * Installation manuelle détectée (Windows) : temps laissé à l'installateur officiel pour finir de copier ollama.exe et
   * ses bibliothèques puis lancer Ollama lui-même, avant que Magistra ne le démarre.
   */
  installSettleMs: number;
}

const DEFAULT_TIMINGS: Timings = {
  startPollMs: 750,
  // Premier lancement : détection des cartes graphiques (le port accepte les connexions sans répondre) et analyse
  // antivirus des nouveaux binaires. 30 s ne suffisaient pas toujours.
  startTimeoutMs: 120_000,
  installWaitMs: 180_000,
  installPollMs: 1_500,
  watchIntervalMs: 3_000,
  watchTimeoutMs: 30 * 60_000,
  progressThrottleMs: 250,
  releaseCacheMs: 60 * 60_000,
  refreshMinIntervalMs: 60_000,
  outdatedGraceMs: 20_000,
  stopTimeoutMs: 15_000,
  proxyResolveMs: 5_000,
  installSettleMs: 90_000,
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

/** Lecture de la fin d'un fichier (journal du moteur), sans jamais lever. */
async function defaultReadFileTail(file: string, maxBytes: number): Promise<string | undefined> {
  let handle: FileHandle | undefined;
  try {
    handle = await fsp.open(file, 'r');
    const { size } = await handle.stat();
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return buffer.toString('utf8');
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function hostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Modèle choisi absent. « Activer l'IA » n'installe qu'une version Magistra, sur cet ordinateur : un modèle
 * personnalisé (options avancées) ou un moteur réglé sur un autre ordinateur renvoient aux réglages de l'IA, jamais à
 * un bouton qui ne le téléchargerait pas (ou remplacerait le modèle choisi sans le dire).
 */
export function modelMissingMessage(active: { label: string; custom: boolean }, url: string): string {
  if (active.custom) {
    return `Le modèle personnalisé ${active.label} n’est pas installé sur le moteur IA. Pour revenir à une version de Magistra, choisissez « Aucun » dans les options avancées de l’IA (Réglages).`;
  }
  if (!isLoopbackUrl(url)) {
    return `Le modèle ${active.label} n’est pas installé sur le serveur Ollama (${hostLabel(url)}) : installez-le depuis les réglages de l’IA.`;
  }
  return `Le modèle ${active.label} n’est pas encore installé. Cliquez sur « Activer l’IA » pour le télécharger.`;
}

function portOf(url: string): string {
  try {
    return new URL(url).port || '11434';
  } catch {
    return '11434';
  }
}

function roundGB(bytes: number): number {
  return Math.round((bytes / 1e9) * 10) / 10;
}

function formatGo(value: number): string {
  return `${Math.round(value * 10) / 10}`.replace('.', ',') + ' Go';
}

/** Version renvoyée par /api/version, réduite à des caractères sûrs pour un message. */
function displayVersion(version: string): string {
  return version.replace(/[^0-9A-Za-z.+-]/g, '').slice(0, 40) || 'inconnue';
}

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

/**
 * Aucune redirection n'est suivie vers un serveur d'IA distant : une redirection pourrait emmener
 * la clé d'accès (en-tête Authorization) vers une autre origine, voire en HTTP clair.
 */
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

/** Ajoute l'en-tête d'autorisation (serveur Ollama distant protégé par un proxy). */
function withBearer(fetchImpl: FetchLike, apiKey: string): FetchLike {
  return (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${apiKey}`);
    return fetchImpl(input, { ...init, headers });
  };
}

// ─── Proxy du système ──────────────────────────────────────────────────────

/** Proxy déjà défini dans l'environnement (Ollama, écrit en Go, lit HTTPS_PROXY en majuscules ou minuscules). */
export function envProxy(env: NodeJS.ProcessEnv): string | undefined {
  return (env.HTTPS_PROXY || env.https_proxy)?.trim() || undefined;
}

/**
 * Traduit la réponse de session.resolveProxy (règles PAC de Chromium : « PROXY hôte:port; DIRECT ») en adresse
 * pour HTTPS_PROXY : http://hôte:port (PROXY), https://hôte:port (HTTPS) ou socks5://hôte:port (SOCKS5).
 * null : connexion directe (« DIRECT » en premier), réponse illisible, ou type de proxy que Go ne gère pas (SOCKS4).
 * Chromium ne met jamais d'identifiants dans cette réponse.
 */
export function proxyUrlFromRules(rules: string | null | undefined): string | null {
  if (typeof rules !== 'string') return null;
  for (const raw of rules.split(';')) {
    const entry = raw.trim();
    if (!entry) continue;
    if (/^DIRECT$/i.test(entry)) return null;
    const m = /^(PROXY|HTTPS|SOCKS5)\s+(\S+)$/i.exec(entry);
    if (!m || !/^(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?):\d{1,5}$/i.test(m[2])) continue;
    const kind = m[1].toUpperCase();
    return `${kind === 'PROXY' ? 'http' : kind === 'HTTPS' ? 'https' : 'socks5'}://${m[2]}`;
  }
  return null;
}

// ─── Journal du moteur (diagnostic d'un démarrage raté) ────────────────────

/** Journal du serveur Ollama : %LOCALAPPDATA%\Ollama\server.log sous Windows, ~/.ollama/logs/server.log ailleurs. */
export function ollamaServerLogPath(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, homedir: string): string {
  if (platform === 'win32') {
    const p = path.win32;
    return p.join(env.LOCALAPPDATA || p.join(homedir, 'AppData', 'Local'), 'Ollama', 'server.log');
  }
  return path.posix.join(homedir, '.ollama', 'logs', 'server.log');
}

/**
 * Dossier des modèles du moteur EN MARCHE, d'après la dernière ligne « server config » de son journal (Ollama y écrit
 * sa configuration à chaque démarrage : env="map[… OLLAMA_MODELS:D:\\ollama\\mes modèles OLLAMA_NOHISTORY:false …]").
 * L'application Ollama peut déplacer les modèles (réglage « Model location ») sans que Magistra voie OLLAMA_MODELS dans
 * son propre environnement : l'espace libre doit être mesuré là où le moteur écrit réellement. undefined si illisible.
 */
export function modelsDirFromServerLog(text: string): string | undefined {
  const line = text.split(/\r?\n/).filter(l => l.includes('msg="server config"')).at(-1);
  if (!line) return undefined;
  const m = /\benv="((?:[^"\\]|\\.)*)"/.exec(line);
  if (!m) return undefined;
  let env: string;
  try {
    env = JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return undefined;
  }
  const v = /(?:^map\[|\s)OLLAMA_MODELS:(.*?)(?=\s[A-Z][A-Z0-9_]*:|\]$)/.exec(env);
  return v?.[1]?.trim() || undefined;
}

const LOG_ERROR_RE = /\blevel=(?:ERROR|FATAL)\b|^\s*Error:|^\s*panic:|\bfatal error\b/i;
const PORT_BUSY_RE = /\bbind\b|address already in use|only one usage of each socket address/i;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Retire d'un extrait de journal tout ce qui est personnel : identifiants dans une adresse (proxy), dossier
 * personnel, nom de l'utilisateur (Windows : C:\Users\<nom>, Unix : /home/<nom>).
 */
export function sanitizeLogText(text: string, homedir?: string): string {
  let t = text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@"']+@/gi, '$1…@');
  const home = homedir?.replace(/[\\/]+$/, '');
  if (home && home.length > 3) {
    const pattern = escapeRegExp(home).replace(/\\\\|\//g, '[\\\\/]');
    t = t.replace(new RegExp(pattern, 'gi'), '~');
  }
  t = t.replace(/([\\/])(Users|home)[\\/][^\\/"'\n]+/gi, '$1$2$1…');
  const user = home?.split(/[\\/]/).filter(Boolean).pop();
  if (user && user.length >= 3) t = t.replace(new RegExp(`\\b${escapeRegExp(user)}\\b`, 'gi'), '…');
  return t;
}

/** Message utile d'une ligne de journal : « msg: error » pour le format slog d'Ollama, la ligne sinon. */
function logMessage(line: string): string {
  const fields = new Map<string, string>();
  for (const m of line.matchAll(/(\w+)=("(?:[^"\\]|\\.)*"|\S+)/g)) {
    fields.set(m[1], m[2].startsWith('"') ? m[2].slice(1, -1).replace(/\\"/g, '"') : m[2]);
  }
  const msg = fields.get('msg');
  if (!msg) return line.trim();
  const error = fields.get('error') ?? fields.get('err');
  return error ? `${msg} : ${error}` : msg;
}

/** Dernières erreurs du journal d'Ollama (au plus deux), filtrées et abrégées ; undefined s'il n'y en a aucune. */
export function serverLogExcerpt(text: string | undefined, homedir?: string): string | undefined {
  if (!text) return undefined;
  const lines = text.split(/\r?\n/).filter(l => LOG_ERROR_RE.test(l));
  if (lines.length === 0) return undefined;
  const messages = [...new Set(lines.slice(-2).map(l => sanitizeLogText(logMessage(l), homedir).replace(/\s+/g, ' ').trim()))]
    .filter(Boolean);
  const excerpt = messages.join(' / ');
  if (!excerpt) return undefined;
  return excerpt.length > 300 ? `${excerpt.slice(0, 299)}…` : excerpt;
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
  private readonly readFileTail: (file: string, maxBytes: number) => Promise<string | undefined>;
  private hardware: Promise<HardwareInfo> | null = null;
  private hardwareAt = 0;
  private release: { at: number; info: ReleaseInfo | null } | null = null;
  private installAbort: AbortController | null = null;
  /** Nature de l'installation en cours (AIStatus.engine.installing) : installation ou mise à jour du moteur. */
  private installKind: 'install' | 'update' = 'install';
  private pullAbort: AbortController | null = null;
  private watchAbort: AbortController | null = null;
  private starting: Promise<boolean> | null = null;
  private restarting: Promise<true> | null = null;
  /** Modèles dont le téléchargement a été interrompu (le prochain essai reprendra). */
  private readonly interruptedPulls = new Set<string>();
  /**
   * Proxy transmis au moteur quand Magistra l'a lancé lui-même pendant cette session (null : aucun) ;
   * undefined : moteur lancé par quelqu'un d'autre (ouverture de session Windows…), proxy inconnu.
   */
  private engineProxy: string | null | undefined = undefined;
  /** Dernier exécutable lancé (pour reconnaître une mise en quarantaine par un antivirus). */
  private lastLaunched: string | undefined;
  /** Échec réseau d'un téléchargement de modèle attribué au proxy manquant : relance proposée. */
  private proxyRestartSuggested = false;
  /** Version d'un Ollama trop ancien que Magistra n'a pas pu arrêter (service Windows, autre session). */
  private foreignOutdatedVersion: string | undefined;

  constructor(deps: AIManagerDeps) {
    this.deps = deps;
    this.t = { ...DEFAULT_TIMINGS, ...deps.timings };
    this.sleep = deps.sleep ?? defaultSleep;
    this.now = deps.now ?? (() => Date.now());
    this.readFileTail = deps.readFileTail ?? defaultReadFileTail;
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

  private get localAppData(): string {
    return this.deps.env.LOCALAPPDATA || this.pathApi.join(this.deps.homedir, 'AppData', 'Local');
  }

  // ─── Machine ────────────────────────────────────────────────────────────

  getHardware(force = false): Promise<HardwareInfo> {
    if (force || !this.hardware) {
      this.hardwareAt = this.now();
      this.hardware = this.deps.detectHardware()
        .then(info => this.withModelsDiskSpace(info))
        .catch(err => {
          this.hardware = null;
          throw err;
        });
    }
    return this.hardware;
  }

  /**
   * Dossier où le moteur de CET ordinateur écrit les modèles : celui de son journal (emplacement choisi dans
   * l'application Ollama), sinon OLLAMA_MODELS ou ~/.ollama/models (deps.modelsDir).
   */
  private async modelsDirInUse(): Promise<string> {
    if (!isLoopbackUrl(this.deps.config.get().ollamaUrl)) return this.deps.modelsDir;
    const log = await this.readFileTail(ollamaServerLogPath(this.deps.platform, this.deps.env, this.deps.homedir), 512 * 1024).catch(() => undefined);
    return (log && modelsDirFromServerLog(log)) || this.deps.modelsDir;
  }

  /** Espace libre de la machine mesuré sur le disque des modèles du moteur (s'il diffère du dossier par défaut). */
  private async withModelsDiskSpace(info: HardwareInfo): Promise<HardwareInfo> {
    const dir = await this.modelsDirInUse().catch(() => this.deps.modelsDir);
    if (dir === this.deps.modelsDir) return info;
    const free = await this.deps.freeDiskBytes(dir).catch(() => undefined);
    return typeof free === 'number' && Number.isFinite(free) ? { ...info, freeDiskGB: Math.round((free / GB) * 10) / 10 } : info;
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
      const dirs = [p.join(this.localAppData, 'Programs', 'Ollama')];
      if (env.ProgramFiles) dirs.push(p.join(env.ProgramFiles, 'Ollama'));
      const cli = (await this.firstExisting(dirs.map(d => p.join(d, 'ollama.exe')))) ?? (await this.searchPath(['ollama.exe']));
      found = {
        app: await this.firstExisting([...dirs, ...(cli ? [p.dirname(cli)] : [])].map(d => p.join(d, 'ollama app.exe'))),
        cli,
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

  /**
   * Ollama installé pour toute la machine (dossier Program Files, droits administrateur) : l'enseignant ne peut ni le
   * mettre à jour ni le réinstaller lui-même.
   */
  isManagedByAdmin(executable: string | undefined): boolean {
    if (this.deps.platform !== 'win32' || !executable) return false;
    const p = path.win32;
    const exe = p.normalize(executable).toLowerCase();
    const env = this.deps.env;
    return [env.ProgramFiles, env.ProgramW6432, env['ProgramFiles(x86)']]
      .filter((r): r is string => typeof r === 'string' && r.trim().length > 0)
      .some(root => exe.startsWith(`${p.normalize(root).replace(/\\+$/, '').toLowerCase()}\\`));
  }

  /**
   * Mise à jour en un clic impossible : serveur distant, Program Files, ou (Windows) Ollama sans « ollama app.exe »
   * (version zip lancée comme service, autre session) ou déjà vu résister à une mise à jour.
   */
  private cannotSelfUpdate(exe: EngineExecutable | null, version: string | null, loopback: boolean): boolean {
    if (!loopback) return true;
    if (this.isManagedByAdmin(exe?.app ?? exe?.cli)) return true;
    if (this.deps.platform !== 'win32') return false;
    return !exe?.app || (version !== null && version === this.foreignOutdatedVersion);
  }

  /** Version minimale d'Ollama pour le modèle choisi (niveau du catalogue ; 0.13.1 pour les modèles Magistra). */
  requiredEngineVersion(): string {
    const active = this.deps.config.activeLocalModel();
    return tierForModel(active.model)?.minOllama ?? getTier(active.tier).minOllama;
  }

  async engineState(): Promise<EngineInfo> {
    const url = this.deps.config.get().ollamaUrl;
    const version = await this.client(url).version();
    const loopback = isLoopbackUrl(url);
    const exe = loopback ? await this.detectExecutable() : null;
    const executable = exe?.app ?? exe?.cli;
    // Serveur sur un autre ordinateur : sa mise à jour relève de son administrateur, jamais de Magistra.
    const managed = loopback ? this.isManagedByAdmin(executable) : true;
    if (version) {
      const selfUpdateBlocked = this.cannotSelfUpdate(exe, version, loopback);
      const minVersion = this.requiredEngineVersion();
      const outdated = ollamaVersionStatus(version, minVersion) === 'outdated';
      return {
        state: 'running',
        version,
        ...(executable ? { executable } : {}),
        minVersion,
        ...(outdated ? { outdated: true } : {}),
        ...(managed || (outdated && selfUpdateBlocked) ? { managedByAdmin: true } : {}),
      };
    }
    if (!loopback) return { state: 'unknown' };
    if (executable) return { state: 'installed_stopped', executable, ...(managed ? { managedByAdmin: true } : {}) };
    return { state: 'not_installed' };
  }

  /** Proxy du système pour le registre des modèles (null : connexion directe ou proxy inconnu). */
  private async systemProxy(): Promise<string | null> {
    if (!this.deps.resolveProxy) return null;
    try {
      const rules = await Promise.race([
        this.deps.resolveProxy(PROXY_PROBE_URL),
        new Promise<null>(resolve => setTimeout(() => resolve(null), this.t.proxyResolveMs).unref?.()),
      ]);
      return proxyUrlFromRules(rules);
    } catch {
      return null;
    }
  }

  /**
   * Environnement de lancement d'Ollama (ou de son installateur, qui le démarre) : port de l'adresse configurée,
   * proxy du système en HTTPS_PROXY (sauf si l'environnement en définit déjà un), OLLAMA_NO_CLOUD et, sous Windows avec
   * l'exécutable `exe`, le dossier d'Ollama en tête du PATH (prependOllamaDirs). `proxy` : celui qu'aura le moteur.
   */
  private async launchEnv(url = this.deps.config.get().ollamaUrl, exe?: EngineExecutable): Promise<{ env: NodeJS.ProcessEnv; proxy: string | null }> {
    const env: NodeJS.ProcessEnv = { ...this.deps.env };
    if (this.deps.platform === 'win32' && exe) prependOllamaDirs(env, exe);
    try {
      const u = new URL(url);
      if (u.port && u.port !== '11434') env.OLLAMA_HOST = `127.0.0.1:${u.port}`;
    } catch {
      /* adresse déjà validée */
    }
    // Défense en profondeur : un Ollama démarré par Magistra refuse les modèles en ligne (Ollama Cloud, hôtes distants),
    // sauf choix contraire déjà exprimé dans l'environnement (clé comparée sans tenir compte de la casse, comme Windows).
    if (!Object.keys(env).some(k => k.toUpperCase() === 'OLLAMA_NO_CLOUD')) env.OLLAMA_NO_CLOUD = '1';
    const inherited = envProxy(this.deps.env);
    if (inherited) return { env, proxy: inherited };
    const proxy = await this.systemProxy();
    if (proxy) env.HTTPS_PROXY = proxy;
    return { env, proxy };
  }

  /**
   * Vrai si le moteur de cet ordinateur tourne probablement SANS le proxy du système : un proxy existe, il n'est
   * pas dans l'environnement (qu'Ollama aurait hérité à l'ouverture de session) et Magistra ne l'a pas transmis.
   */
  private async engineMissesProxy(): Promise<boolean> {
    if (envProxy(this.deps.env)) return false;
    const proxy = await this.systemProxy();
    return proxy !== null && this.engineProxy !== proxy;
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

  /**
   * Démarrage demandé par l'enseignant : vrai, ou une erreur qui explique la cause probable. Refusé (AI_BUSY) pendant
   * une installation du moteur : l'installateur officiel arrête l'ancien moteur et remplace ses fichiers — le relancer
   * en parallèle (fenêtre rechargée qui croit le moteur « arrêté ») ferait échouer l'installation ou garderait
   * l'ancienne version. L'installateur démarre lui-même le nouveau moteur à la fin.
   */
  async startEngineOrExplain(): Promise<true> {
    if (this.installAbort) {
      throw new MagistraError('AI_BUSY', this.installKind === 'update' ? 'La mise à jour du moteur IA est déjà en cours.' : 'L’installation du moteur IA est déjà en cours.');
    }
    if (await this.startEngine()) return true;
    throw await this.startFailure();
  }

  private async doStartEngine(): Promise<boolean> {
    const url = this.deps.config.get().ollamaUrl;
    const client = this.client(url);
    if (await client.version()) return true;
    if (!isLoopbackUrl(url)) return false;
    const exe = await this.detectExecutable();
    if (!exe) return false;
    const { env, proxy } = await this.launchEnv(url, exe);
    try {
      // Windows : l'application (icône de notification), qui lance « ollama serve » avec cet environnement.
      if (this.deps.platform === 'win32' && exe.app) {
        this.lastLaunched = exe.app;
        this.deps.spawnDetached(exe.app, [...OLLAMA_APP_ARGS], env);
      } else if (exe.cli) {
        this.lastLaunched = exe.cli;
        this.deps.spawnDetached(exe.cli, ['serve'], env);
      } else if (exe.app) {
        this.lastLaunched = exe.app;
        this.deps.spawnDetached('open', ['-a', exe.app], env);
      }
    } catch (err) {
      console.warn('[magistra] Démarrage du moteur IA impossible :', (err as Error)?.message ?? 'erreur inconnue');
      return false;
    }
    this.engineProxy = proxy;
    const deadline = this.now() + this.t.startTimeoutMs;
    while (this.now() < deadline) {
      await this.sleep(this.t.startPollMs);
      if (await client.version()) return true;
    }
    return false;
  }

  /** État du port du moteur : 'open' (connexion acceptée sans réponse HTTP), 'closed' (refusée) ou 'unknown'. */
  private async probePort(url: string): Promise<'open' | 'closed' | 'unknown'> {
    try {
      const res = await this.deps.localFetch(`${url.replace(/\/+$/, '')}/api/version`, { signal: AbortSignal.timeout(3_000) });
      await res.body?.cancel().catch(() => undefined);
      return 'open';
    } catch (err) {
      if (networkFailureKind(err) === 'refused') return 'closed';
      const name = (err as { name?: unknown } | null)?.name;
      return name === 'TimeoutError' || name === 'AbortError' ? 'open' : 'unknown';
    }
  }

  /**
   * Cause probable d'un démarrage raté (jamais « Redémarrez l'ordinateur » en premier conseil) :
   * exécutable disparu (antivirus), port occupé ou dernière erreur du journal d'Ollama (filtrée), moteur encore en
   * cours de démarrage (port ouvert), sinon antivirus.
   */
  async startFailure(): Promise<MagistraError> {
    const url = this.deps.config.get().ollamaUrl;
    if (!isLoopbackUrl(url)) return new MagistraError('AI_SERVER_UNAVAILABLE', `Serveur Ollama injoignable (${hostLabel(url)}).`);
    const exe = await this.detectExecutable();
    const launched = this.lastLaunched;
    if (launched && !(await this.deps.fileExists(launched))) return new MagistraError('ENGINE_NOT_INSTALLED', ENGINE_VANISHED_MESSAGE);
    if (!exe) return new MagistraError('ENGINE_NOT_INSTALLED', ENGINE_NOT_INSTALLED_MESSAGE);
    const [port, log] = await Promise.all([
      this.probePort(url),
      this.readFileTail(ollamaServerLogPath(this.deps.platform, this.deps.env, this.deps.homedir), 64 * 1024).catch(() => undefined),
    ]);
    const excerpt = serverLogExcerpt(log, this.deps.homedir);
    const detail = excerpt ? ` Dernière erreur signalée par le moteur : « ${excerpt} ».` : '';
    if (excerpt && PORT_BUSY_RE.test(excerpt)) {
      return new MagistraError(
        'ENGINE_NOT_RUNNING',
        `Le moteur IA ne peut pas démarrer : le port ${portOf(url)} est déjà utilisé par un autre programme (peut-être un autre Ollama). Fermez ce programme, puis réessayez.${detail}`,
      );
    }
    if (port === 'open') {
      return new MagistraError(
        'ENGINE_NOT_RUNNING',
        `Le moteur IA démarre encore (première détection de la carte graphique, vérification par l’antivirus…) : patientez une minute, puis réessayez.${detail}`,
      );
    }
    return new MagistraError(
      'ENGINE_NOT_RUNNING',
      `Le moteur IA ne démarre pas.${detail} Un antivirus bloque peut-être Ollama (ollama.exe) : vérifiez sa quarantaine ou demandez au service informatique de l’autoriser, puis réessayez. En dernier recours, redémarrez l’ordinateur.`,
    );
  }

  /**
   * Arrête puis relance le moteur de cet ordinateur avec le proxy du système (HTTPS_PROXY), après accord de
   * l'enseignant (bouton « Relancer le moteur IA », ou reprise d'un téléchargement après PROXY_RESTART_MESSAGE).
   * Windows uniquement : « ollama app.exe » et ollama.exe sont arrêtés comme le fait l'installateur officiel.
   */
  restartEngine(): Promise<true> {
    if (!this.restarting) {
      this.restarting = this.doRestartEngine().finally(() => {
        this.restarting = null;
      });
    }
    return this.restarting;
  }

  private async doRestartEngine(): Promise<true> {
    const url = this.deps.config.get().ollamaUrl;
    if (!isLoopbackUrl(url)) {
      throw new MagistraError('AI_SERVER_UNAVAILABLE', `Le moteur IA est sur un autre ordinateur (${hostLabel(url)}) : Magistra ne peut pas le relancer.`);
    }
    if (this.deps.platform !== 'win32' || !this.deps.killProcesses) throw new MagistraError('ENGINE_NOT_RUNNING', RESTART_UNSUPPORTED_MESSAGE);
    if (!(await this.detectExecutable())) throw new MagistraError('ENGINE_NOT_INSTALLED', ENGINE_NOT_INSTALLED_MESSAGE);
    const client = this.client(url);
    try {
      await this.deps.killProcesses(OLLAMA_PROCESS_NAMES);
    } catch {
      // Vérifié ci-dessous : le moteur doit avoir cessé de répondre.
    }
    const deadline = this.now() + this.t.stopTimeoutMs;
    let stopped = !(await client.version());
    while (!stopped && this.now() < deadline) {
      await this.sleep(this.t.startPollMs);
      stopped = !(await client.version());
    }
    if (!stopped) {
      throw new MagistraError(
        'ENGINE_NOT_RUNNING',
        'Magistra n’a pas pu arrêter le moteur IA pour le relancer avec le proxy de l’établissement : il a peut-être été démarré par le service informatique. Demandez-lui de définir la variable HTTPS_PROXY pour Ollama, ou quittez Ollama (icône près de l’horloge) puis réessayez.',
      );
    }
    this.engineProxy = undefined;
    if (!(await this.startEngine())) throw await this.startFailure();
    this.proxyRestartSuggested = false;
    return true;
  }

  /** Au lancement de Magistra : démarre le moteur installé mais arrêté (mode local uniquement). */
  async autoStart(): Promise<void> {
    const cfg = this.deps.config.get();
    if (cfg.mode !== 'local' || !isLoopbackUrl(cfg.ollamaUrl)) return;
    const { state } = await this.engineState();
    if (state === 'installed_stopped') await this.startEngine();
  }

  // ─── Installation et mise à jour du moteur (Windows) ────────────────────

  /** Informations sur la dernière version de l'installateur (mise en cache 1 h). */
  async releaseInfo(force = false): Promise<ReleaseInfo | null> {
    if (!force && this.release && this.now() - this.release.at < this.t.releaseCacheMs) return this.release.info;
    let info: ReleaseInfo | null = null;
    try {
      const res = await this.deps.netFetch(OLLAMA_RELEASE_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Magistra (outil pedagogique)' },
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

  /** Mise à jour impossible depuis Magistra (Program Files, serveur distant) : message pour l'enseignant. */
  private async managedUpdateMessage(minVersion: string): Promise<string> {
    const url = this.deps.config.get().ollamaUrl;
    if (!isLoopbackUrl(url)) {
      return `Le moteur IA est sur un autre ordinateur (${hostLabel(url)}) : Magistra ne peut pas le mettre à jour. Demandez à son administrateur d’installer Ollama ${minVersion} ou une version plus récente.`;
    }
    const exe = await this.detectExecutable();
    if (!this.isManagedByAdmin(exe?.app ?? exe?.cli)) {
      return `Le moteur IA qui répond sur cet ordinateur n’a pas été installé avec l’installateur habituel d’Ollama (service Windows mis en place par le service informatique, ou Ollama ouvert dans une autre session Windows) : Magistra ne peut pas le mettre à jour. Demandez au service informatique de le mettre à jour (version ${minVersion} minimum).`;
    }
    return `Ollama a été installé pour tous les utilisateurs de cet ordinateur (dossier Program Files) : Magistra ne peut pas le mettre à jour. Demandez au service informatique de le mettre à jour (version ${minVersion} minimum).`;
  }

  /** Moteur trop ancien pour un modèle : mise à jour en un clic, ou service informatique. */
  private async outdatedMessage(version: string, minVersion: string, what: string): Promise<string> {
    const engine = `Le moteur IA installé (Ollama ${displayVersion(version)}) est trop ancien pour ${what} (version ${minVersion} minimum)`;
    const url = this.deps.config.get().ollamaUrl;
    const exe = isLoopbackUrl(url) ? await this.detectExecutable() : null;
    if (this.cannotSelfUpdate(exe, version, isLoopbackUrl(url))) return `${engine}. ${await this.managedUpdateMessage(minVersion)}`;
    return `${engine} : utilisez « Mettre à jour le moteur IA », puis relancez l’installation du modèle.`;
  }

  /**
   * Télécharge et installe Ollama (Windows), après clic de l'enseignant. Avec `{ update: true }`, met à jour un moteur
   * déjà installé (trop ancien) : pas de retour anticipé « moteur déjà en marche », l'installateur officiel arrêtant
   * lui-même « ollama app.exe » et ollama.exe ; même vérification SHA-256 ; version contrôlée à la fin.
   * Progression : engine-download → engine-install → engine-waiting → engine-ready (ou engine-error).
   */
  async installEngine(options: EngineInstallOptions = {}): Promise<void> {
    const update = options.update === true;
    if (this.installAbort) {
      throw new MagistraError('AI_BUSY', update ? 'La mise à jour du moteur IA est déjà en cours.' : 'L’installation du moteur IA est déjà en cours.');
    }
    if (this.deps.platform !== 'win32') {
      throw update
        ? new MagistraError('ENGINE_OUTDATED', 'La mise à jour automatique du moteur IA est disponible sous Windows. Sur ce système, installez la dernière version d’Ollama depuis sa page officielle (ollama.com/download) : Magistra la détectera automatiquement.')
        : new MagistraError('ENGINE_NOT_INSTALLED', 'L’installation automatique est disponible sous Windows. Utilisez « Ouvrir la page officielle d’installation » : Magistra détectera l’installation automatiquement.');
    }
    const controller = new AbortController();
    this.installAbort = controller;
    this.installKind = update ? 'update' : 'install';
    const signal = controller.signal;
    const minVersion = this.requiredEngineVersion();
    try {
      const current = await this.engineState();
      if (update) {
        if (current.managedByAdmin || !isLoopbackUrl(this.deps.config.get().ollamaUrl)) {
          throw new MagistraError('ENGINE_OUTDATED', await this.managedUpdateMessage(minVersion));
        }
        // Pas de retour anticipé : l'installateur arrête lui-même l'ancien moteur avant de le remplacer.
      } else if (current.state === 'running' || (current.state === 'installed_stopped' && (await this.startEngine()))) {
        // Déjà installé : inutile de retélécharger, il suffit (au besoin) de le démarrer.
        const version = (await this.client().version()) ?? 'inconnue';
        this.deps.emit({ kind: 'engine-ready', version });
        return;
      }
      // Installateur (1,6 Go) dans %TEMP%, binaires (au moins 4 Go) dans %LOCALAPPDATA% : deux disques possibles.
      this.assertFree(await this.deps.freeDiskBytes(this.localAppData), ENGINE_REQUIRED_DISK_GB, update ? 'mettre à jour le moteur IA' : 'installer le moteur IA');
      this.assertFree(await this.deps.freeDiskBytes(this.deps.tmpdir), ENGINE_TEMP_REQUIRED_GB, 'télécharger l’installateur du moteur IA (dossier temporaire)');

      const release = (await this.releaseInfo(true)) ?? { version: 'latest', setupUrl: FALLBACK_SETUP_URL, sumsUrl: FALLBACK_SUMS_URL };
      const installer = await this.downloadInstaller(release, signal);

      this.deps.emit({
        kind: 'engine-install',
        message: update
          ? 'Mise à jour du moteur IA en cours… (Ollama s’arrête quelques instants ; vos modèles sont conservés)'
          : 'Installation du moteur IA en cours… (cela peut prendre quelques minutes)',
      });
      // L'installateur lance Ollama à la fin : il lui transmet cet environnement (proxy du système compris).
      const { env, proxy } = await this.launchEnv();
      let code: number;
      try {
        code = await this.deps.runInstaller(installer, INSTALLER_ARGS, signal, env);
      } catch (err) {
        if (signal.aborted) throw new MagistraError('GENERATION_ABORTED', 'Installation annulée.');
        throw new MagistraError('ENGINE_NOT_INSTALLED', 'L’installateur n’a pas pu être lancé. Utilisez « Ouvrir la page officielle d’installation » : Magistra détectera l’installation automatiquement.', { cause: err });
      }
      if (code !== 0) {
        throw new MagistraError('ENGINE_NOT_INSTALLED', 'L’installation automatique n’a pas abouti. Utilisez « Ouvrir la page officielle d’installation » : Magistra détectera l’installation automatiquement.');
      }
      await fsp.rm(installer, { force: true }).catch(() => undefined);
      this.engineProxy = proxy;
      this.lastLaunched = undefined;

      this.deps.emit({ kind: 'engine-waiting', message: ENGINE_STARTING_MESSAGE });
      const version = await this.waitForEngine(signal, this.t.installWaitMs, minVersion);
      if (!version) throw await this.startFailure();
      if (ollamaVersionStatus(version, minVersion) === 'outdated') {
        const replaced = await this.stopForeignOutdated(minVersion);
        if (replaced) {
          this.deps.emit({ kind: 'engine-ready', version: replaced });
          return;
        }
        throw new MagistraError(
          'ENGINE_OUTDATED',
          `Le moteur IA en service (Ollama ${displayVersion(version)}) est toujours trop ancien (version ${minVersion} minimum) : la mise à jour n’a pas pu le remplacer. Quittez Ollama (icône près de l’horloge), puis réessayez.`,
        );
      }
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

  /**
   * Après une mise à jour, l'ancienne version répond encore : Magistra tente de l'arrêter (comme l'installateur).
   * Toujours là : un Ollama que l'utilisateur ne peut pas arrêter (service Windows, autre session) garde le port →
   * message dédié, et plus de mise à jour en un clic tant que cette version répond. Arrêté : démarre la nouvelle copie.
   */
  private async stopForeignOutdated(minVersion: string): Promise<string | null> {
    if (!this.deps.killProcesses) return null;
    const client = this.client();
    await this.deps.killProcesses(OLLAMA_PROCESS_NAMES).catch(() => undefined);
    const deadline = this.now() + this.t.stopTimeoutMs;
    let still = await client.version();
    while (still && this.now() < deadline) {
      await this.sleep(this.t.startPollMs);
      still = await client.version();
    }
    if (still) {
      this.foreignOutdatedVersion = still;
      throw new MagistraError(
        'ENGINE_OUTDATED',
        `La mise à jour a été installée, mais un autre Ollama (version ${displayVersion(still)}), probablement un service mis en place par le service informatique ou ouvert dans une autre session Windows, occupe toujours le moteur IA de cet ordinateur et Magistra ne peut pas l’arrêter. Demandez au service informatique de le mettre à jour (version ${minVersion} minimum) ou de l’arrêter.`,
      );
    }
    if (!(await this.startEngine())) return null;
    const now = await client.version();
    return now && ollamaVersionStatus(now, minVersion) !== 'outdated' ? now : null;
  }

  /**
   * Attend que le moteur réponde (en le démarrant au besoin). Avec `minVersion` (mise à jour) : une version trop
   * ancienne qui répond encore (ancien moteur pas encore remplacé) est ignorée pendant outdatedGraceMs.
   */
  private async waitForEngine(signal: AbortSignal, timeoutMs: number, minVersion?: string): Promise<string | null> {
    const client = this.client();
    const deadline = this.now() + timeoutMs;
    let startTried = false;
    const startedAt = this.now();
    let outdatedSince: number | null = null;
    let last: string | null = null;
    const acceptable = (version: string) => {
      if (!minVersion || ollamaVersionStatus(version, minVersion) !== 'outdated') return true;
      outdatedSince ??= this.now();
      return this.now() - outdatedSince >= this.t.outdatedGraceMs;
    };
    while (this.now() < deadline) {
      const version = await client.version();
      if (version) {
        last = version;
        if (acceptable(version)) return version;
      } else if (!startTried && this.now() - startedAt >= 5_000) {
        // L'installateur lance normalement Ollama ; sinon, on le démarre nous-mêmes.
        startTried = true;
        if (await this.startEngine()) {
          const started = (await client.version()) ?? 'inconnue';
          last = started;
          if (acceptable(started)) return started;
        }
      }
      await this.sleep(this.t.installPollMs, signal);
    }
    return last;
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
      const headers: Record<string, string> = { 'User-Agent': 'Magistra (outil pedagogique)' };
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
   * À l'échéance, une erreur claire est émise (engine-error) : l'écran d'attente ne reste jamais affiché sans fin.
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
    let detectedAt: number | undefined;
    try {
      while (this.now() < deadline && !signal.aborted) {
        const version = await this.client().version();
        if (version) {
          this.deps.emit({ kind: 'engine-ready', version });
          return;
        }
        if (!startAttempted) {
          const exe = await this.detectExecutable();
          // Windows : l'installateur officiel copie « ollama app.exe » AVANT ollama.exe et ses bibliothèques, puis lance
          // Ollama lui-même (avec le bon PATH). Démarrer l'application trop tôt la rendait unique instance sans serveur :
          // le lancement final de l'installateur se fermait aussitôt et le moteur ne démarrait jamais. Magistra attend
          // donc ollama.exe, puis laisse à l'installateur le temps de finir (installSettleMs) avant de démarrer Ollama.
          const windows = this.deps.platform === 'win32';
          if (exe && (!windows || exe.cli)) {
            if (detectedAt === undefined) {
              detectedAt = this.now();
              if (windows && this.t.installSettleMs > 0) {
                this.deps.emit({
                  kind: 'engine-waiting',
                  message: 'Installation détectée : Magistra attend la fin de l’installation d’Ollama (cliquez sur « Terminer » dans son installateur si besoin)…',
                });
              }
            }
            if (!windows || this.now() - detectedAt >= this.t.installSettleMs) {
              startAttempted = true;
              this.deps.emit({ kind: 'engine-waiting', message: `Installation détectée. ${ENGINE_STARTING_MESSAGE}` });
              if (await this.startEngine()) {
                this.deps.emit({ kind: 'engine-ready', version: (await this.client().version()) ?? 'inconnue' });
                return;
              }
            }
          }
        }
        await this.sleep(this.t.watchIntervalMs, signal);
      }
    } catch {
      return; // annulé
    }
    if (signal.aborted) return;
    // Échéance : installé mais arrêté (cause probable du démarrage raté), ou rien de détecté.
    const e = (await this.detectExecutable()) ? await this.startFailure() : new MagistraError('ENGINE_NOT_INSTALLED', ENGINE_WATCH_TIMEOUT_MESSAGE);
    if (!signal.aborted) this.deps.emit({ kind: 'engine-error', message: e.message });
  }

  // ─── Modèles ────────────────────────────────────────────────────────────

  /**
   * Télécharge un modèle (niveau Magistra ou nom avancé) avec progression agrégée.
   * Relancer un téléchargement interrompu reprend là où il s'était arrêté.
   * - Moteur trop ancien pour ce modèle : ENGINE_OUTDATED AVANT tout appel au registre (jamais « à reprendre ») ;
   * - niveau déjà présent sous un autre nom (ministral-3:latest pour Léger) : aucun téléchargement ;
   * - échec réseau alors qu'Ollama tourne sans le proxy du système : PROXY_RESTART_MESSAGE, et la reprise relance
   *   d'abord le moteur avec le proxy.
   */
  async pullModel(target: { tier?: TierId; model?: string }): Promise<void> {
    if (this.pullAbort) throw new MagistraError('AI_BUSY', 'Un téléchargement de modèle est déjà en cours.');
    if (target.model && isOllamaCloudName(target.model)) throw new MagistraError('INVALID_REQUEST', REMOTE_MODEL_REFUSED);
    const tier = target.model ? tierForModel(target.model) : getTier(target.tier);
    const model = target.model ?? tier!.model;
    const tierId = tier?.id;
    const label = tier?.label ?? model;
    const controller = new AbortController();
    this.pullAbort = controller;
    const emitError = (message: string) => this.deps.emit({ kind: 'model-error', model, message });
    let loopback = false;
    try {
      const client = this.client();
      loopback = isLoopbackUrl(client.baseUrl);
      let version = await client.version();
      if (!version) {
        const started = loopback && (await this.startEngine());
        if (!started) throw new MagistraError('ENGINE_NOT_RUNNING', 'Le moteur IA n’est pas démarré : installez-le ou démarrez-le avant de télécharger un modèle.');
        version = await client.version();
      }
      // Moteur trop ancien : le registre refuserait (412) ; inutile de télécharger quoi que ce soit.
      if (tier && version && ollamaVersionStatus(version, tier.minOllama) === 'outdated') {
        throw new MagistraError('ENGINE_OUTDATED', await this.outdatedMessage(version, tier.minOllama, label));
      }
      // Niveau déjà installé, éventuellement sous un autre nom : rien à télécharger.
      if (tier) {
        const present = await client.listModels(controller.signal).then(list => installedModelForTier(tier, localModelsOnly(list)), () => undefined);
        if (present) {
          this.interruptedPulls.delete(model);
          this.deps.emit({ kind: 'model-ready', model });
          return;
        }
      }
      // Échec précédent dû au proxy : l'enseignant a accepté la relance du moteur en reprenant le téléchargement.
      if (loopback && this.proxyRestartSuggested) {
        if (await this.engineMissesProxy()) {
          this.deps.emit({ kind: 'model-pull', ...(tierId ? { tier: tierId } : {}), model, status: 'Relance du moteur IA avec le proxy de l’établissement…', percent: 0 });
          await this.restartEngine();
        }
        this.proxyRestartSuggested = false;
      }
      if (loopback) {
        // Disque où le moteur écrira réellement (emplacement des modèles réglé dans l'application Ollama compris).
        const free = await this.deps.freeDiskBytes(await this.modelsDirInUse());
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
        // ENGINE_OUTDATED n'en fait pas partie : reprendre ne servirait à rien avant la mise à jour du moteur.
        if (e.code === 'NETWORK_ERROR' || e.code === 'AI_BAD_RESPONSE' || e.code === 'AI_TIMEOUT') this.interruptedPulls.add(model);
      } else {
        this.interruptedPulls.add(model);
        e = new MagistraError('AI_BAD_RESPONSE', 'Le téléchargement du modèle a échoué. Relancez-le : il reprendra où il s’est arrêté.', { cause: err });
      }
      // Internet fonctionne pour Magistra (proxy du système) mais pas pour Ollama, lancé sans ce proxy.
      if (loopback && (e.code === 'NETWORK_ERROR' || e.code === 'AI_TIMEOUT') && (await this.engineMissesProxy())) {
        this.proxyRestartSuggested = true;
        e = new MagistraError('NETWORK_ERROR', PROXY_RESTART_MESSAGE, { cause: e });
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
   * Niveau retenu automatiquement (niveau recommandé au premier démarrage, jamais choisi par l'enseignant) mais non
   * installé, alors qu'un autre niveau l'est (par exemple Magistra Léger, sous son nom ou l'alias
   * « ministral-3:latest », installé avant Magistra) : Magistra utilise le niveau installé plutôt que d'imposer un
   * téléchargement de plusieurs Go. Parmi plusieurs, le mieux adapté à l'ordinateur (recommandé, puis correct,
   * puis lent ; à adéquation égale, le plus riche) ; un niveau « déconseillé » n'est jamais retenu d'office.
   * Renvoie vrai si la configuration a changé.
   */
  private async adoptInstalledTier(installed: readonly OllamaModel[]): Promise<boolean> {
    const cfg = this.deps.config.get();
    if (cfg.mode !== 'local' || cfg.customModel || cfg.tierChosen || !installed.length) return false;
    if (installedModelForTier(cfg.tier, installed) !== undefined) return false;
    const candidates = MODEL_TIERS.filter(t => installedModelForTier(t, installed) !== undefined);
    if (!candidates.length) return false;
    const fits = recommendTier(await this.getHardware()).tiers;
    const rank = { recommended: 0, ok: 1, slow: 2, not_recommended: 3 } as const;
    const best = candidates
      .map((tier, index) => ({ tier, index, fit: fits.find(f => f.id === tier.id)?.fit ?? 'slow' }))
      .filter(c => c.fit !== 'not_recommended')
      .sort((a, b) => rank[a.fit] - rank[b.fit] || b.index - a.index)[0];
    if (!best) return false;
    return this.deps.config.adoptInstalledTier(best.tier.id).catch(() => false);
  }

  /**
   * Nom RÉELLEMENT installé du modèle actif (niveau : nom du catalogue ou alias, comme « ministral-3:latest » ;
   * modèle personnalisé : nom exact), à passer à /api/chat. undefined s'il n'est pas installé.
   */
  private installedActiveModel(active: ReturnType<AIConfigStore['activeLocalModel']>, installed: readonly OllamaModel[]): string | undefined {
    if (active.custom) return installed.some(m => sameModel(m.name, active.model)) ? active.model : undefined;
    return installedModelForTier(active.tier, installed);
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
    let active = this.deps.config.activeLocalModel();
    if (!(await client.version())) {
      if (!isLoopbackUrl(url)) throw new MagistraError('AI_SERVER_UNAVAILABLE', `Serveur Ollama injoignable (${hostLabel(url)}).`);
      if (!(await this.detectExecutable())) throw new MagistraError('ENGINE_NOT_INSTALLED', ENGINE_NOT_INSTALLED_MESSAGE);
      onStatus?.(ENGINE_STARTING_MESSAGE);
      // « Arrêter » libère aussitôt la génération ; le démarrage du moteur, lui, se poursuit en arrière-plan
      // (la génération suivante en profitera).
      if (!(await untilAborted(this.startEngine(), signal))) {
        if (signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
        throw await this.startFailure();
      }
    }
    if (signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
    const all = await client.listModels(signal);
    if (active.custom && customModelIsRemote(active.model, all)) throw new MagistraError('MODEL_NOT_INSTALLED', REMOTE_MODEL_REFUSED);
    const installed = localModelsOnly(all);
    let model = this.installedActiveModel(active, installed);
    if (!model && (await this.adoptInstalledTier(installed))) {
      active = this.deps.config.activeLocalModel();
      model = this.installedActiveModel(active, installed);
    }
    if (!model) throw new MagistraError('MODEL_NOT_INSTALLED', modelMissingMessage(active, url));
    // Délai du premier mot : adapté à la taille du prompt (aucun délai fixe transmis), après préchargement du modèle.
    return new LocalOllamaProvider(
      { baseUrl: url, model, label: active.label, modelLabel: active.label, contextTokens: active.contextTokens, fetch: this.fetchFor(url) },
      !active.custom && active.tier === 'leger',
    );
  }

  /** Résumé du moteur actif (capacités de génération). */
  async describeActive(): Promise<ActiveEngine> {
    const cfg = this.deps.config.get();
    if (cfg.mode === 'remote' && cfg.remote) {
      const label = cfg.remote.label || hostLabel(cfg.remote.baseUrl);
      let health: HealthStatus;
      let contextTokens = cfg.remote.kind === 'ollama' ? 12_288 : 32_768;
      try {
        const provider = this.remoteProvider();
        contextTokens = provider.contextTokens;
        health = await provider.health(AbortSignal.timeout(5_000));
      } catch (err) {
        const e = isMagistraError(err) ? (err as MagistraError) : new MagistraError('AI_SERVER_UNAVAILABLE');
        health = { ok: false, error: { code: e.code, message: e.message } };
      }
      return {
        label,
        contextTokens,
        ready: health.ok,
        privacy: { level: 'remote', message: privacyRemoteMessage(label) },
        ...(!health.ok && health.error ? { notReady: { code: health.error.code, message: health.error.message } } : {}),
        ...(health.ok && health.warning ? { aiWarning: { code: health.warning.code, message: health.warning.message } } : {}),
        // Serveur Ollama distant avec un modèle « cloud » : les textes partent en réalité chez Ollama Cloud.
        providerInfo: (cfg.remote.kind === 'ollama' ? ollamaDestination(cfg.remote.model, undefined, cfg.remote.label) : undefined)
          ?? providerInfoFor(cfg.remote.baseUrl, cfg.remote.label),
      };
    }
    const active = this.deps.config.activeLocalModel();
    const client = this.client(cfg.ollamaUrl);
    const loopback = isLoopbackUrl(cfg.ollamaUrl);
    let ready = false;
    let notReady: AINotice | undefined;
    const version = await client.version();
    if (version) {
      let remoteModel = active.custom && isOllamaCloudName(active.model);
      try {
        const all = await client.listModels();
        remoteModel ||= active.custom && customModelIsRemote(active.model, all);
        ready = !remoteModel && this.installedActiveModel(active, localModelsOnly(all)) !== undefined;
      } catch {
        ready = false;
      }
      if (remoteModel) {
        notReady = { code: 'MODEL_NOT_INSTALLED', message: REMOTE_MODEL_REFUSED };
      } else if (!ready) {
        const minVersion = this.requiredEngineVersion();
        notReady = ollamaVersionStatus(version, minVersion) === 'outdated'
          ? { code: 'ENGINE_OUTDATED', message: await this.outdatedMessage(version, minVersion, active.label) }
          : { code: 'MODEL_NOT_INSTALLED', message: modelMissingMessage(active, cfg.ollamaUrl) };
      }
    } else if (!loopback) {
      notReady = { code: 'AI_SERVER_UNAVAILABLE', message: `Serveur Ollama injoignable (${hostLabel(cfg.ollamaUrl)}).` };
    } else {
      notReady = (await this.detectExecutable())
        ? { code: 'ENGINE_NOT_RUNNING', message: 'Le moteur IA est installé mais arrêté : Magistra le démarrera au lancement de la génération.' }
        : { code: 'ENGINE_NOT_INSTALLED', message: ENGINE_NOT_INSTALLED_MESSAGE };
    }
    const privacy: PrivacyInfo = loopback
      ? { level: 'local', message: PRIVACY_LOCAL_MESSAGE }
      : { level: 'remote', message: privacyRemoteMessage(`Ollama — ${hostLabel(cfg.ollamaUrl)}`) };
    return {
      label: active.label,
      contextTokens: active.contextTokens,
      ready,
      privacy,
      ...(notReady ? { notReady } : {}),
      ...(loopback ? {} : { providerInfo: providerInfoFor(cfg.ollamaUrl, `Ollama — ${hostLabel(cfg.ollamaUrl)}`) }),
    };
  }

  /** État complet affiché par l'assistant de configuration et les réglages. */
  async status(): Promise<AIStatus> {
    const hardware = await this.getHardware();
    const recommendation = recommendTier(hardware);
    if (this.deps.config.isFirstRun) await this.deps.config.applyRecommendedTier(recommendation.tier).catch(() => undefined);
    let cfg = this.deps.config.get();
    const engine = await this.engineState();

    let installed: OllamaModel[] = [];
    let customRemote = false;
    if (engine.state === 'running') {
      try {
        const all = await this.client(cfg.ollamaUrl).listModels();
        customRemote = Boolean(cfg.customModel && customModelIsRemote(cfg.customModel, all));
        // Modèles en ligne jamais proposés ni retenus (voir localModelsOnly).
        installed = localModelsOnly(all);
      } catch {
        installed = [];
      }
    }
    // Niveau recommandé absent mais un autre déjà installé : celui-ci est utilisé (aucun téléchargement imposé).
    if (await this.adoptInstalledTier(installed)) cfg = this.deps.config.get();
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
        // Installé sous le nom du catalogue OU sous un alias du même fichier (ministral-3:latest…).
        installed: installedModelForTier(t, installed) !== undefined,
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
      const modelInstalled = this.installedActiveModel(active, installed) !== undefined;
      ready = engine.state === 'running' && modelInstalled;
      headline = ready ? 'Prête'
        : engine.state === 'not_installed' ? 'Moteur IA non installé'
          : engine.state === 'installed_stopped' ? 'Moteur IA arrêté'
            : engine.state === 'unknown' ? 'Serveur Ollama injoignable'
              : engine.outdated ? 'Moteur IA à mettre à jour'
                : customRemote || (active.custom && isOllamaCloudName(active.model)) ? `Modèle ${active.label} en ligne : non utilisé`
                  : `Modèle ${active.label} non installé`;
    }

    const platformSupported = this.deps.platform === 'win32';
    let sizeMB: number | undefined;
    if (platformSupported && (engine.state === 'not_installed' || (engine.outdated && !engine.managedByAdmin))) {
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
        minVersion: engine.minVersion ?? this.requiredEngineVersion(),
        ...(engine.outdated ? { outdated: true } : {}),
        ...(engine.managedByAdmin ? { managedByAdmin: true } : {}),
        ...(this.proxyRestartSuggested ? { proxyRestart: true } : {}),
        ...(this.installAbort ? { installing: this.installKind } : {}),
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
