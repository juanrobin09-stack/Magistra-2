// Stockage en fichiers JSON (MAGISTRA_STORE=file) : historique, favoris et profil conservés sur le disque du
// serveur, sans base de données. Mode par défaut du mode personnel (npm run dev, npm start sur le poste de
// l'enseignant) : l'historique survit au redémarrage. Même logique que le stockage de l'application Windows
// (electron/localStore.ts), avec un dossier par utilisateur :
//
//   <MAGISTRA_DATA_DIR>/users/<empreinte de l'identifiant>/generations/<uuid>.json   une génération par fichier
//   <MAGISTRA_DATA_DIR>/users/<empreinte de l'identifiant>/profile.json              profil de l'enseignant
//
//  - écritures atomiques : fichier temporaire + fsync + rename (jamais de fichier à moitié écrit), en 0600 sous Linux
//    et macOS (sous Windows, les modes POSIX sont sans effet : l'ACL du dossier est restreinte au démarrage, voir
//    restrictDataDirAcl dans personal.ts) ;
//  - écritures sérialisées par fichier ; fichier illisible mis de côté (« .corrupt-<date> »), jamais écrasé en silence ;
//  - l'identifiant de l'utilisateur n'apparaît jamais dans un nom de fichier (empreinte SHA-256) ;
//  - anti-abus (débit, générations en cours) : en mémoire, comme MemoryStore (un seul processus serveur).
// Ne convient pas à Vercel (système de fichiers éphémère) : utiliser Supabase.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { resolveMatiere } from '../shared/catalog.js';
import { MagistraError } from '../shared/errors.js';
import type { NewGenerationRecord } from '../shared/pipeline.js';
import type { GenerationRecord, GenerationSummary, HistoryPage, TeacherProfile, UsageStats } from '../shared/types.js';
import { isUuid, requireUserId, requireUuid } from './ids.js';
import { sanitizeProfile } from './profile.js';
import {
  contentBytes, decodeCursor, encodeCursor, excerptOf, exceedsStorage, HISTORY_LIMITS, MemoryStore, STORAGE_LIMITS, StorageFullError,
  type GenerationAdmission, type GenerationLimits, type GenerationStore, type HistoryQuery, type StorageLimits,
} from './store.js';
import { startOfDayInZone } from './time.js';

const WEEK_MS = 7 * 86_400_000;

// ─── Fichiers JSON fiables ──────────────────────────────────────────────────

const queues = new Map<string, Promise<unknown>>();

/** Exécute `task` après les opérations déjà en attente sur la même clé (verrou simple en mémoire). */
function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.then(() => undefined, () => undefined);
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  // Sous Windows, un antivirus peut verrouiller brièvement le fichier.
  const delays = [20, 50, 100, 200, 400];
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= delays.length || !(code === 'EPERM' || code === 'EACCES' || code === 'EBUSY')) throw err;
      await new Promise(r => setTimeout(r, delays[attempt]));
    }
  }
}

/** Écrit un JSON de façon atomique (le fichier cible est soit l'ancien, soit le nouveau, jamais un mélange). */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const data = `${JSON.stringify(value, null, 2)}\n`;
  await withLock(file, async () => {
    await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      const handle = await fsp.open(tmp, 'w', 0o600);
      try {
        await handle.writeFile(data, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await renameWithRetry(tmp, file);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  });
}

type ReadResult<T> = { status: 'ok'; value: T } | { status: 'missing' } | { status: 'corrupt' };

/** Lit un JSON ; un fichier illisible (ou refusé par `validate`) est renommé « .corrupt-<date> ». */
async function readJson<T>(file: string, validate: (raw: unknown) => T | null, warn: (m: string) => void): Promise<ReadResult<T>> {
  let text: string;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
    throw err;
  }
  let value: T | null;
  try {
    value = validate(JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text));
  } catch {
    value = null;
  }
  if (value !== null) return { status: 'ok', value };
  const movedTo = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await renameWithRetry(file, movedTo).catch(() => undefined);
  warn(`Fichier de l'historique illisible mis de côté : ${path.basename(movedTo)}`);
  return { status: 'corrupt' };
}

/** Relecture d'une génération enregistrée ; null si le fichier n'a pas la forme attendue. */
export function parseStoredGeneration(raw: unknown, expectedId: string): GenerationRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.id !== expectedId) return null;
  if (typeof r.createdAt !== 'string' || Number.isNaN(Date.parse(r.createdAt))) return null;
  if (typeof r.type !== 'string' || typeof r.contenu !== 'string' || typeof r.sujet !== 'string') return null;
  if (typeof r.niveau !== 'string' || typeof r.matiere !== 'string') return null;
  return {
    ...(r as unknown as GenerationRecord),
    isFavorite: r.isFavorite === true,
    sources: Array.isArray(r.sources) ? (r.sources as GenerationRecord['sources']) : [],
    params: r.params && typeof r.params === 'object' && !Array.isArray(r.params) ? (r.params as Record<string, unknown>) : {},
  };
}

function summarize(record: GenerationRecord): GenerationSummary {
  return {
    id: record.id,
    createdAt: record.createdAt,
    type: record.type,
    niveau: record.niveau,
    matiere: record.matiere,
    ...(record.discipline ? { discipline: record.discipline } : {}),
    sujet: record.sujet,
    isFavorite: record.isFavorite,
    excerpt: excerptOf(record.contenu),
  };
}

function compareSummaries(a: GenerationSummary, b: GenerationSummary): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function writeError(err: unknown, message?: string): MagistraError {
  return new MagistraError('STORAGE_ERROR', message, { cause: err });
}

function readError(err: unknown): MagistraError {
  return new MagistraError('STORAGE_ERROR', 'Historique momentanément inaccessible. Réessayez dans quelques instants.', { cause: err });
}

export interface FileStoreOptions {
  now?: () => Date;
  /** Journal des fichiers mis de côté (jamais de contenu). */
  warn?: (message: string) => void;
  /** Plafond de stockage par utilisateur (défaut : STORAGE_LIMITS, comme la base Supabase). */
  storageLimits?: StorageLimits;
}

export class FileStore implements GenerationStore {
  readonly kind = 'file' as const;
  readonly root: string;
  private readonly now: () => Date;
  private readonly warn: (message: string) => void;
  /** Anti-abus en mémoire (même sémantique que MemoryStore et que la fonction SQL). */
  private readonly limiter: MemoryStore;
  /** Index de l'historique par utilisateur (résumés), reconstruit depuis les fichiers au premier accès. */
  private readonly indexes = new Map<string, Promise<Map<string, GenerationSummary>>>();
  /** Volume (octets du contenu) de chaque génération, par utilisateur : alimenté avec l'index, pour le plafond. */
  private readonly sizes = new Map<string, Map<string, number>>();
  private readonly storageLimits: StorageLimits;

  constructor(root: string, options: FileStoreOptions = {}) {
    this.root = path.resolve(root);
    this.now = options.now ?? (() => new Date());
    this.warn = options.warn ?? (() => undefined);
    this.storageLimits = options.storageLimits ?? STORAGE_LIMITS;
    this.limiter = new MemoryStore({ now: this.now });
  }

  /** Dossier d'un utilisateur : empreinte de l'identifiant (aucun caractère interdit, rien de lisible). */
  private userDir(uid: string): string {
    return path.join(this.root, 'users', createHash('sha256').update(uid, 'utf8').digest('hex').slice(0, 40));
  }

  private generationsDir(uid: string): string {
    return path.join(this.userDir(uid), 'generations');
  }

  private recordFile(uid: string, id: string): string {
    return path.join(this.generationsDir(uid), `${id}.json`);
  }

  private index(uid: string): Promise<Map<string, GenerationSummary>> {
    let pending = this.indexes.get(uid);
    if (!pending) {
      pending = this.loadIndex(uid).catch(err => {
        this.indexes.delete(uid);
        throw readError(err);
      });
      this.indexes.set(uid, pending);
    }
    return pending;
  }

  private async loadIndex(uid: string): Promise<Map<string, GenerationSummary>> {
    const dir = this.generationsDir(uid);
    let names: string[];
    try {
      names = await fsp.readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
      throw err;
    }
    // Écritures interrompues (coupure de courant…) : fichiers temporaires supprimés.
    await Promise.all(names.filter(n => n.endsWith('.tmp')).map(n => fsp.rm(path.join(dir, n), { force: true }).catch(() => undefined)));
    const index = new Map<string, GenerationSummary>();
    const sizes = new Map<string, number>();
    this.sizes.set(uid, sizes);
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -'.json'.length);
      if (!isUuid(id)) continue;
      const result = await readJson(path.join(dir, name), raw => parseStoredGeneration(raw, id), this.warn);
      if (result.status === 'ok') {
        index.set(id, summarize(result.value));
        sizes.set(id, contentBytes(result.value.contenu));
      }
    }
    return index;
  }

  private async readRecord(uid: string, id: string): Promise<GenerationRecord> {
    const index = await this.index(uid);
    if (!index.has(id)) throw new MagistraError('NOT_FOUND');
    let result: ReadResult<GenerationRecord>;
    try {
      result = await readJson(this.recordFile(uid, id), raw => parseStoredGeneration(raw, id), this.warn);
    } catch (err) {
      throw readError(err);
    }
    if (result.status !== 'ok') {
      index.delete(id);
      this.sizes.get(uid)?.delete(id);
      throw new MagistraError('NOT_FOUND');
    }
    return result.value;
  }

  async listGenerations(userId: string, query: HistoryQuery): Promise<HistoryPage> {
    const uid = requireUserId(userId);
    const limit = Number.isFinite(query.limit) ? Math.min(HISTORY_LIMITS.max, Math.max(1, Math.floor(query.limit))) : HISTORY_LIMITS.default;
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = [...(await this.index(uid)).values()]
      .sort(compareSummaries)
      .filter(r => !query.favoritesOnly || r.isFavorite)
      .filter(r => !cursor || r.createdAt < cursor.createdAt || (r.createdAt === cursor.createdAt && r.id < cursor.id));
    const page = rows.slice(0, limit).map(r => ({ ...r }));
    const last = page[page.length - 1];
    return rows.length > limit && last ? { items: page, nextCursor: encodeCursor({ createdAt: last.createdAt, id: last.id }) } : { items: page };
  }

  async getGeneration(userId: string, id: string): Promise<GenerationRecord> {
    return this.readRecord(requireUserId(userId), requireUuid(id));
  }

  async setFavorite(userId: string, id: string, value: boolean): Promise<void> {
    const uid = requireUserId(userId);
    const gid = requireUuid(id);
    await withLock(`record:${uid}:${gid}`, async () => {
      const record = await this.readRecord(uid, gid);
      if (record.isFavorite === value) return;
      try {
        await writeJsonAtomic(this.recordFile(uid, gid), { ...record, isFavorite: value });
      } catch (err) {
        throw writeError(err, 'Impossible de mettre à jour les favoris.');
      }
      const index = await this.index(uid);
      const summary = index.get(gid);
      if (summary) index.set(gid, { ...summary, isFavorite: value });
    });
  }

  async deleteGeneration(userId: string, id: string): Promise<void> {
    const uid = requireUserId(userId);
    const gid = requireUuid(id);
    await withLock(`record:${uid}:${gid}`, async () => {
      const index = await this.index(uid);
      if (!index.has(gid)) throw new MagistraError('NOT_FOUND');
      try {
        await fsp.rm(this.recordFile(uid, gid), { force: true });
      } catch (err) {
        throw writeError(err, 'Impossible de supprimer ce contenu.');
      }
      index.delete(gid);
      this.sizes.get(uid)?.delete(gid);
    });
  }

  async saveGeneration(userId: string, record: NewGenerationRecord): Promise<{ id: string }> {
    const uid = requireUserId(userId);
    // Contrôle du plafond et enregistrement dans la même section critique : deux enregistrements simultanés
    // ne peuvent pas dépasser ensemble le plafond.
    return withLock(`quota:${uid}`, async () => {
      const index = await this.index(uid);
      const sizes = this.sizes.get(uid) ?? new Map<string, number>();
      let bytes = 0;
      for (const n of sizes.values()) bytes += n;
      const addBytes = contentBytes(record.contenu);
      if (exceedsStorage(this.storageLimits, index.size, bytes, addBytes)) throw new StorageFullError();
      const id = randomUUID();
      const full: GenerationRecord = { ...structuredClone(record), id, createdAt: this.now().toISOString(), isFavorite: false };
      try {
        await writeJsonAtomic(this.recordFile(uid, id), full);
      } catch (err) {
        throw writeError(err);
      }
      index.set(id, summarize(full));
      sizes.set(id, addBytes);
      this.sizes.set(uid, sizes);
      return { id };
    });
  }

  async getStats(userId: string, timeZone: string): Promise<UsageStats> {
    const uid = requireUserId(userId);
    const now = this.now();
    const today = startOfDayInZone(now, timeZone).getTime();
    const weekAgo = now.getTime() - WEEK_MS;
    const counts = new Map<string, number>();
    const stats: UsageStats = { total: 0, favorites: 0, today: 0, week: 0 };
    for (const r of (await this.index(uid)).values()) {
      const t = new Date(r.createdAt).getTime();
      stats.total++;
      if (r.isFavorite) stats.favorites++;
      if (t >= today) stats.today++;
      if (t >= weekAgo) stats.week++;
      const raw = String(r.matiere ?? '');
      const m = raw ? resolveMatiere(raw) ?? raw : '';
      if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    if (top) stats.topMatiere = { matiere: top[0], count: top[1] };
    return stats;
  }

  async getProfile(userId: string): Promise<TeacherProfile | null> {
    const uid = requireUserId(userId);
    let result: ReadResult<TeacherProfile>;
    try {
      result = await readJson(path.join(this.userDir(uid), 'profile.json'), raw => sanitizeProfile(raw, false), this.warn);
    } catch (err) {
      throw readError(err);
    }
    return result.status === 'ok' ? result.value : null;
  }

  async saveProfile(userId: string, profile: TeacherProfile | null): Promise<void> {
    const uid = requireUserId(userId);
    const file = path.join(this.userDir(uid), 'profile.json');
    try {
      if (profile) await writeJsonAtomic(file, profile);
      else await withLock(file, () => fsp.rm(file, { force: true }));
    } catch (err) {
      throw writeError(err, "Impossible d'enregistrer le profil.");
    }
  }

  async deleteAccount(userId: string): Promise<void> {
    const uid = requireUserId(userId);
    try {
      await fsp.rm(this.userDir(uid), { recursive: true, force: true });
    } catch (err) {
      throw new MagistraError('STORAGE_ERROR', 'La suppression des données a échoué. Réessayez.', { cause: err });
    }
    this.indexes.delete(uid);
    this.sizes.delete(uid);
    await this.limiter.deleteAccount(uid);
  }

  beginGeneration(userId: string, limits: GenerationLimits): Promise<GenerationAdmission> {
    return this.limiter.beginGeneration(userId, limits);
  }

  endGeneration(userId: string, slotId: string): Promise<void> {
    return this.limiter.endGeneration(userId, slotId);
  }
}
