// Mode d'authentification du serveur, et mode PERSONNEL : Magistra sur l'ordinateur de l'enseignant,
// sans compte (npm run dev, npm start), avec une vraie IA.
//
// Garde-fous du mode personnel (tous obligatoires) :
//  - jamais sur Vercel, jamais si le serveur écoute ailleurs que sur la boucle locale (refus de démarrer) ;
//  - un JETON SECRET de 256 bits, généré au premier démarrage et conservé dans le dossier de données (réservé à son
//    propriétaire : droits 0600 / 0700 sous Linux et macOS, ACL du dossier sous Windows, voir restrictDataDirAcl ; le
//    serveur de développement refuse de servir ce dossier, voir viteDevApi.ts), exigé sur CHAQUE requête (« Authorization: Bearer … ») et comparé en
//    temps constant. L'adresse d'accès « http://localhost:PORT/#acces=<jeton> » est affichée dans le terminal :
//    le fragment « # » n'est jamais envoyé au serveur, ni journalisé, ni transmis dans l'en-tête Referer ;
//  - en complément (DNS rebinding, requêtes d'autres sites) : en-tête Host limité à localhost, 127.0.0.1 et
//    [::1] avec le port du serveur, Origin identique quand le navigateur l'envoie, connexion en boucle locale.
//  Un proxy inverse placé devant (nginx…) ne suffit donc pas à ouvrir l'accès : le jeton reste exigé.
// Un seul utilisateur, d'identifiant fixe. Les limites anti-abus s'appliquent comme ailleurs.

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AuthMode } from '../shared/apiContract.js';
import { hostAddressKind } from '../shared/ai/presets.js';
import { MagistraError } from '../shared/errors.js';
import type { TokenVerifier } from './auth.js';
import type { Env } from './config.js';

/** Identifiant (fixe) de l'unique utilisateur du mode personnel. */
export const PERSONAL_USER_ID = 'enseignant_local';
/** Nom du fichier du jeton d'accès, dans le dossier de données (MAGISTRA_DATA_DIR). */
export const ACCESS_TOKEN_FILE = 'access-token';
/** Nom du paramètre du fragment d'URL qui transmet le jeton à l'interface (« #acces=… »). */
export const ACCESS_FRAGMENT = 'acces';

const TOKEN_RE = /^[A-Za-z0-9_-]{43,256}$/;

export type AuthSetting = 'auto' | 'clerk' | 'personal';

/** Contexte d'écoute du serveur, pour décider si le mode personnel est possible. */
export interface ListenContext {
  /** Serveur de développement (npm run dev). */
  dev?: boolean;
  /**
   * Adresse d'écoute : chaîne (HOST du serveur autonome, hôte de Vite), null = toutes les interfaces,
   * undefined = inconnue (fonction Vercel, autre hébergeur) : le mode personnel y est impossible.
   */
  host?: string | null;
}

export interface AuthResolution {
  mode: AuthMode;
  /** Mode personnel demandé mais refusé : le serveur autonome ne démarre pas, l'API répond « mal configuré ». */
  refusal?: string;
  /** Explication destinée au journal (choix du mode automatique). */
  note?: string;
}

function clean(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

/** Vrai si l'adresse d'écoute est la boucle locale (localhost, 127.0.0.0/8, ::1). */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  return hostAddressKind(host) === 'loopback';
}

/** Des clés Clerk (secrète, publique PEM ou publiable) sont-elles renseignées ? */
export function clerkKeysPresent(env: Env): boolean {
  return Boolean(clean(env.CLERK_SECRET_KEY) || clean(env.CLERK_JWT_KEY) || clean(env.VITE_CLERK_PUBLISHABLE_KEY) || clean(env.CLERK_PUBLISHABLE_KEY));
}

/** Lit MAGISTRA_AUTH (auto par défaut). */
export function authSetting(env: Env, problems?: string[]): AuthSetting {
  const raw = clean(env.MAGISTRA_AUTH)?.toLowerCase();
  if (!raw || raw === 'auto') return 'auto';
  if (raw === 'clerk') return 'clerk';
  if (raw === 'personal' || raw === 'personnel') return 'personal';
  problems?.push('MAGISTRA_AUTH doit valoir « auto », « clerk » ou « personal » : « auto » utilisé.');
  return 'auto';
}

/**
 * Choisit le mode d'authentification :
 *  - MAGISTRA_AUTH=clerk : comptes Clerk ;
 *  - MAGISTRA_AUTH=personal : mode personnel, REFUSÉ sur Vercel, hors de npm run dev / npm start, ou si le serveur
 *    n'écoute pas sur la boucle locale ;
 *  - auto (défaut) : Clerk si des clés Clerk existent ; sinon mode personnel avec npm run dev (hôte local) ou avec
 *    le serveur autonome si HOST est une adresse de boucle locale ; jamais sur Vercel ; sinon aucun (démonstration).
 *    Une clé PUBLIABLE seule (sans CLERK_SECRET_KEY ni CLERK_JWT_KEY : fichier .env d'une ancienne version, modèle non
 *    rempli) ne peut vérifier aucune session : sur la boucle locale, elle est ignorée (mode personnel, signalé au
 *    journal) au lieu de laisser un site où chaque requête échoue ; ailleurs, Clerk reste choisi (erreur explicite).
 */
export function resolveAuth(env: Env, ctx: ListenContext = {}, problems?: string[]): AuthResolution {
  const setting = authSetting(env, problems);
  const vercel = env.VERCEL === '1';
  if (setting === 'clerk') return { mode: 'clerk' };
  if (setting === 'personal') {
    if (vercel) {
      return { mode: 'none', refusal: 'MAGISTRA_AUTH=personal est interdit sur Vercel (site public) : utilisez des comptes Clerk.' };
    }
    if (ctx.host === undefined) {
      return { mode: 'none', refusal: 'Le mode personnel (MAGISTRA_AUTH=personal) est réservé à « npm run dev » et au serveur autonome (« npm start »).' };
    }
    if (!isLoopbackHost(ctx.host)) {
      const where = ctx.host ? `« ${ctx.host.slice(0, 60)} »` : 'toutes les interfaces réseau';
      return {
        mode: 'none',
        refusal: `Mode personnel refusé : le serveur écouterait sur ${where}. Réglez HOST=127.0.0.1 (ou lancez Vite sans --host) : `
          + "le mode personnel n'est accessible que depuis cet ordinateur. Pour un accès depuis le réseau, utilisez des comptes Clerk.",
      };
    }
    return { mode: 'personal' };
  }
  const loopback = ctx.host !== undefined && isLoopbackHost(ctx.host);
  const clerkSecret = Boolean(clean(env.CLERK_SECRET_KEY) || clean(env.CLERK_JWT_KEY));
  if (clerkKeysPresent(env) && !clerkSecret && !vercel && loopback) {
    return {
      mode: 'personal',
      note: 'Clé publiable Clerk sans CLERK_SECRET_KEY ni CLERK_JWT_KEY : elle est ignorée, mode personnel (un seul utilisateur, '
        + 'accès réservé à cet ordinateur). Pour des comptes Clerk, renseignez CLERK_SECRET_KEY (ou MAGISTRA_AUTH=clerk).',
    };
  }
  if (clerkKeysPresent(env)) return { mode: 'clerk' };
  if (vercel) return { mode: 'none', note: "Aucune clé Clerk : le site reste en démonstration (aucune IA n'est utilisée)." };
  if (loopback) {
    return { mode: 'personal', note: 'Aucune clé Clerk : mode personnel (un seul utilisateur, accès réservé à cet ordinateur).' };
  }
  if (ctx.host !== undefined) {
    return {
      mode: 'none',
      note: ctx.dev
        ? "Aucune clé Clerk et serveur de développement ouvert au réseau : l'interface reste en démonstration."
        : "Aucune clé Clerk : l'interface reste en démonstration. Pour utiliser Magistra seul sur cet ordinateur avec une vraie IA, "
          + 'démarrez avec HOST=127.0.0.1 (mode personnel) ; pour un accès depuis le réseau, configurez Clerk.',
    };
  }
  return { mode: 'none' };
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Compare deux secrets en temps constant (empreintes SHA-256 de même longueur, quelle que soit l'entrée). */
export function sameSecret(candidate: string, expected: string): boolean {
  return timingSafeEqual(sha256(candidate), sha256(expected));
}

function readToken(file: string): string | null {
  try {
    const text = fs.readFileSync(file, 'utf8').trim();
    return TOKEN_RE.test(text) ? text : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Fichier lisible par son seul propriétaire (droits POSIX). Sous Windows, les modes POSIX sont sans effet : la
 * protection vient de l'ACL du dossier de données (restrictDataDirAcl) et de son emplacement par défaut dans le profil.
 */
function restrictPermissions(file: string): void {
  if (process.platform === 'win32') return;
  try {
    if ((fs.statSync(file).mode & 0o077) !== 0) fs.chmodSync(file, 0o600);
  } catch {
    // Système de fichiers sans droits POSIX : rien à faire.
  }
}

/**
 * Jeton d'accès du mode personnel : lu dans <dossier>/access-token, ou créé au premier démarrage
 * (256 bits aléatoires, fichier en 0600 sous Linux et macOS ; sous Windows, voir restrictDataDirAcl). Création atomique : deux serveurs lancés en même temps
 * retiennent le même jeton. Lève une erreur système si le dossier n'est pas accessible en écriture.
 */
export function loadOrCreateAccessToken(dataDir: string): { token: string; created: boolean; file: string } {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, ACCESS_TOKEN_FILE);
  const existing = readToken(file);
  if (existing) {
    restrictPermissions(file);
    return { token: existing, created: false, file };
  }
  const token = randomBytes(32).toString('base64url');
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${token}\n`, { mode: 0o600, flag: 'wx' });
  try {
    try {
      // Lien physique : échoue si le fichier existe déjà (création exclusive, contenu complet).
      fs.linkSync(tmp, file);
      return { token, created: true, file };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        const raced = readToken(file);
        if (raced) return { token: raced, created: false, file };
      } else if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EXDEV') {
        throw err;
      }
      // Fichier illisible (vide, abîmé) ou liens non pris en charge : remplacement atomique.
      fs.renameSync(tmp, file);
      return { token, created: true, file };
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Lanceur de programme (tests) : chemin ABSOLU, arguments, sans shell ; renvoie la sortie, lève en cas d'échec. */
export type RunProgram = (file: string, args: readonly string[]) => string;

export interface DataDirAclOptions {
  platform?: NodeJS.Platform;
  env?: Env;
  run?: RunProgram;
}

/** Avertissement quand l'ACL du dossier de données n'a pas pu être restreinte (sans chemin ni trace technique). */
export const DATA_DIR_ACL_WARNING =
  "Sous Windows, les droits du dossier des données de Magistra (jeton d'accès, historique) n'ont pas pu être restreints : "
  + "il peut être lisible par les autres comptes de cet ordinateur. Placez Magistra dans votre dossier personnel, ou réglez "
  + 'MAGISTRA_DATA_DIR sur un dossier de votre profil.';

/** SID d'un compte (« S-1-5-21-… », « S-1-12-1-… » pour Entra ID) dans la sortie de « whoami /user /fo csv /nh ». */
export function parseWhoamiSid(output: string): string | undefined {
  const last = output.trim().split(/\r?\n/).pop()?.split(',').pop()?.replace(/"/g, '').trim();
  return last && /^S-1-\d+(-\d+)+$/.test(last) ? last : undefined;
}

const defaultRun: RunProgram = (file, args) =>
  execFileSync(file, [...args], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 });

/**
 * Windows : réserve le dossier de données à l'utilisateur courant (avec SYSTEM et Administrateurs) par son ACL :
 * héritage coupé, droits remplacés ; les fichiers existants et futurs en héritent. Sans cela, un dossier placé hors
 * du profil (C:\Magistra\.magistra-data) hérite des droits de C:\ (lecture pour tous les comptes de l'ordinateur).
 * Programmes appelés par leur chemin absolu dans System32 (jamais par le dossier courant ni par un shell), SID lu
 * avec whoami (plus fiable que %USERNAME% pour les comptes de domaine, les espaces ou les accents).
 * Renvoie DATA_DIR_ACL_WARNING si la restriction échoue (le démarrage continue) ; ne fait rien hors de Windows.
 */
export function restrictDataDirAcl(dataDir: string, options: DataDirAclOptions = {}): string | undefined {
  if ((options.platform ?? process.platform) !== 'win32') return undefined;
  const env = options.env ?? process.env;
  const systemRoot = clean(env.SystemRoot) ?? clean(env.SYSTEMROOT) ?? 'C:\\Windows';
  const system32 = path.win32.join(systemRoot, 'System32');
  const run = options.run ?? defaultRun;
  try {
    const sid = parseWhoamiSid(run(path.win32.join(system32, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh']));
    if (!sid) return DATA_DIR_ACL_WARNING;
    run(path.win32.join(system32, 'icacls.exe'), [
      dataDir, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '/Q',
    ]);
    return undefined;
  } catch {
    return DATA_DIR_ACL_WARNING;
  }
}

/** Crée au besoin le dossier de données, puis le protège (Windows : ACL). Renvoie un avertissement éventuel. */
export function protectDataDir(dataDir: string, options: DataDirAclOptions = {}): string | undefined {
  if ((options.platform ?? process.platform) !== 'win32') return undefined;
  try {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  } catch {
    return DATA_DIR_ACL_WARNING;
  }
  return restrictDataDirAcl(dataDir, options);
}

type Headers = Record<string, string | string[] | undefined>;

function header(headers: Headers, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** Nom d'hôte et port d'un en-tête Host (« localhost:5173 », « [::1]:3000 ») ; null si illisible. */
export function parseHostHeader(value: string | undefined): { hostname: string; port?: number } | null {
  if (!value || value.length > 300) return null;
  try {
    const url = new URL(`http://${value.trim()}`);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    const hostname = url.hostname.toLowerCase();
    return { hostname, ...(url.port ? { port: Number(url.port) } : {}) };
  } catch {
    return null;
  }
}

const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLoopbackAddress(address: string): boolean {
  const a = address.replace(/^::ffff:/i, '');
  return a === '::1' || /^127\./.test(a);
}

export interface PersonalRequest {
  method: string;
  headers: Headers;
  /** Adresse de la connexion (req.socket.remoteAddress), si l'hébergeur la fournit. */
  remoteAddress?: string;
}

export class PersonalAccess {
  readonly userId = PERSONAL_USER_ID;
  private readonly digest: Buffer;
  private readonly token: string;
  private port?: number;

  constructor(token: string, options: { port?: number } = {}) {
    if (!TOKEN_RE.test(token)) throw new Error('Jeton d’accès du mode personnel invalide.');
    this.token = token;
    this.digest = sha256(token);
    this.port = options.port;
  }

  /** Port d'écoute réel (connu après le démarrage) : seul ce port est accepté dans l'en-tête Host. */
  setPort(port: number | undefined): void {
    this.port = port && Number.isInteger(port) && port > 0 ? port : undefined;
  }

  get listeningPort(): number | undefined {
    return this.port;
  }

  /** Vérificateur de jeton (même rôle que celui de Clerk) : comparaison en temps constant. */
  readonly verifier: TokenVerifier = async candidate => {
    if (!timingSafeEqual(sha256(candidate), this.digest)) throw personalUnauthenticated();
    return PERSONAL_USER_ID;
  };

  /**
   * Contrôles complémentaires, avant l'authentification (lève FORBIDDEN) :
   * connexion en boucle locale, en-tête Host local (avec le bon port), Origin identique s'il est présent.
   */
  checkRequest(req: PersonalRequest): void {
    if (req.remoteAddress && !isLoopbackAddress(req.remoteAddress)) {
      throw new MagistraError('FORBIDDEN', 'Accès refusé : en mode personnel, Magistra n’est accessible que depuis cet ordinateur.');
    }
    const host = parseHostHeader(header(req.headers, 'host'));
    if (!host || !ALLOWED_HOSTNAMES.has(host.hostname) || (this.port !== undefined && (host.port ?? 80) !== this.port)) {
      throw new MagistraError('FORBIDDEN', 'Accès refusé : adresse inattendue. Ouvrez Magistra à l’adresse affichée dans le terminal (http://localhost:…).');
    }
    const origin = header(req.headers, 'origin');
    if (origin !== undefined) {
      let sameOrigin: boolean;
      try {
        const o = new URL(origin);
        sameOrigin = o.protocol === 'http:' && o.host.toLowerCase() === `${host.hostname}${host.port !== undefined ? `:${host.port}` : ''}`;
      } catch {
        sameOrigin = false;
      }
      if (!sameOrigin) throw new MagistraError('FORBIDDEN', 'Accès refusé : requête provenant d’un autre site.');
    }
  }

  /** Adresse d'accès à ouvrir dans le navigateur (contient le jeton : à n'afficher que dans le terminal). */
  accessUrl(port: number | undefined = this.port): string {
    return `http://localhost${port ? `:${port}` : ''}/#${ACCESS_FRAGMENT}=${this.token}`;
  }
}

export function personalUnauthenticated(): MagistraError {
  return new MagistraError(
    'UNAUTHENTICATED',
    "Clé d'accès absente ou incorrecte : ouvrez Magistra avec l'adresse complète affichée dans le terminal du serveur (elle se termine par « #acces=… »).",
  );
}
