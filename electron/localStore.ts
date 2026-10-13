// Données locales de l'enseignant, dans app.getPath('userData') (Windows : %APPDATA%\Magistra).
//
//   generations/<id>.json   une génération par fichier (historique illimité)
//   profile.json            profil enseignant
//   preferences.json        préférences locales (LocalPreferences)
//   ai-config.json          configuration de l'IA (géré par aiConfig.ts)
//   documents/<id>.json     texte extrait des documents (jamais le fichier original), si keepDocuments
//
// Aucun compte, aucun serveur : tout reste sur cet ordinateur. L'index de l'historique est reconstruit
// en mémoire au démarrage à partir des fichiers ; un fichier illisible est mis de côté (.corrupt-<date>).

import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { MagistraError } from '../shared/errors.js';
import { DEFAULT_PREFERENCES, type LocalPreferences, type StoredDocument } from '../shared/ipc.js';
import type { NewGenerationRecord } from '../shared/pipeline.js';
import type { GenerationRecord, GenerationSummary, HistoryPage, TeacherProfile, UsageStats } from '../shared/types.js';
import { cleanupTempFiles, readJsonFile, withFileLock, writeJsonAtomic } from './jsonFile.js';
import { isSafeId, parseStoredPreferences, parseStoredProfile, sanitizeStoredDocument, type ListQuery } from './validate.js';

export const EXCERPT_LENGTH = 240;
/** Début du contenu analysé pour fabriquer l'extrait (largement plus que les 240 caractères conservés). */
const EXCERPT_SOURCE_CHARS = 4_000;

export interface LocalStoreOptions {
  now?: () => Date;
  idFactory?: () => string;
  warn?: (message: string) => void;
}

interface IndexEntry {
  t: number;
  summary: GenerationSummary;
}

/** Extrait lisible (~240 caractères) d'un contenu Markdown, pour la liste de l'historique. */
export function excerptOf(markdown: string, max = EXCERPT_LENGTH): string {
  // Seul le début compte : borner l'entrée évite tout traitement coûteux sur un très long contenu (listes de crochets…).
  const text = markdown
    .slice(0, EXCERPT_SOURCE_CHARS)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, ' ')
    .replace(/[#*_`|~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function summarize(record: GenerationRecord): GenerationSummary {
  const summary: GenerationSummary = {
    id: record.id,
    createdAt: record.createdAt,
    type: record.type,
    niveau: record.niveau,
    matiere: record.matiere,
    sujet: record.sujet,
    isFavorite: record.isFavorite,
    excerpt: excerptOf(record.contenu),
  };
  if (record.discipline) summary.discipline = record.discipline;
  return summary;
}

/** Relecture d'une génération enregistrée ; null si le fichier n'a pas la forme attendue. */
export function parseStoredRecord(raw: unknown, expectedId: string): GenerationRecord | null {
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

function encodeCursor(entry: IndexEntry): string {
  return Buffer.from(`${entry.t}:${entry.summary.id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { t: number; id: string } {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  const m = /^(-?\d{1,16}):([A-Za-z0-9_-]{1,64})$/.exec(text);
  if (!m) throw new MagistraError('INVALID_REQUEST', 'Paramètre invalide : curseur.');
  return { t: Number(m[1]), id: m[2] };
}

/** Ordre de l'historique : le plus récent d'abord, puis identifiant décroissant (ordre total et stable). */
function compareEntries(a: IndexEntry, b: IndexEntry): number {
  if (a.t !== b.t) return b.t - a.t;
  return a.summary.id < b.summary.id ? 1 : a.summary.id > b.summary.id ? -1 : 0;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export class LocalStore {
  readonly root: string;
  readonly generationsDir: string;
  readonly documentsDir: string;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly warn: (message: string) => void;
  private index = new Map<string, IndexEntry>();
  private sorted: IndexEntry[] | null = null;
  private indexLoad: Promise<void> | null = null;
  private prefs: LocalPreferences | null = null;
  private docIndex: Map<string, Omit<StoredDocument, 'units'>> | null = null;

  constructor(root: string, options: LocalStoreOptions = {}) {
    this.root = root;
    this.generationsDir = path.join(root, 'generations');
    this.documentsDir = path.join(root, 'documents');
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => randomUUID());
    this.warn = options.warn ?? (message => console.warn(`[magistra] ${message}`));
  }

  file(name: string): string {
    return path.join(this.root, name);
  }

  /** Crée les dossiers, nettoie les écritures interrompues et reconstruit l'index de l'historique. */
  async init(): Promise<void> {
    await fsp.mkdir(this.generationsDir, { recursive: true });
    await fsp.mkdir(this.documentsDir, { recursive: true });
    await Promise.all([cleanupTempFiles(this.root), cleanupTempFiles(this.generationsDir), cleanupTempFiles(this.documentsDir)]);
    await this.ensureIndex();
  }

  private ensureIndex(): Promise<void> {
    if (!this.indexLoad) {
      this.indexLoad = this.loadIndex().catch(err => {
        this.indexLoad = null;
        throw new MagistraError('STORAGE_ERROR', "Impossible de lire l'historique local.", { cause: err });
      });
    }
    return this.indexLoad;
  }

  private async loadIndex(): Promise<void> {
    await fsp.mkdir(this.generationsDir, { recursive: true });
    const names = (await this.listJsonNames(this.generationsDir, 'L’historique')).filter(n => n.endsWith('.json'));
    const index = new Map<string, IndexEntry>();
    await mapLimit(names, 16, async name => {
      const id = name.slice(0, -'.json'.length);
      if (!isSafeId(id)) return;
      let result: Awaited<ReturnType<typeof readJsonFile<GenerationRecord>>>;
      try {
        result = await readJsonFile(path.join(this.generationsDir, name), raw => parseStoredRecord(raw, id));
      } catch {
        // Fichier verrouillé ou sans droits (antivirus, copie de sauvegarde) : il n'est pas corrompu, on ne le touche pas.
        // Un seul fichier inaccessible ne doit jamais empêcher Magistra de démarrer ; il réapparaîtra au prochain lancement.
        this.warn(`Génération inaccessible ignorée : ${name}`);
        return;
      }
      if (result.status === 'ok') {
        index.set(id, { t: Date.parse(result.value.createdAt), summary: summarize(result.value) });
      } else if (result.status === 'corrupt') {
        this.warn(`Génération illisible mise de côté : ${result.movedTo ?? name}`);
      }
    });
    this.index = index;
    this.sorted = null;
  }

  /** Contenu d'un dossier ; un dossier illisible donne une liste vide (la liste reste vide, l'application démarre). */
  private async listJsonNames(dir: string, what: string): Promise<string[]> {
    try {
      return await fsp.readdir(dir);
    } catch {
      this.warn(`${what} : dossier inaccessible, liste vide pour cette session.`);
      return [];
    }
  }

  private sortedEntries(): IndexEntry[] {
    if (!this.sorted) this.sorted = [...this.index.values()].sort(compareEntries);
    return this.sorted;
  }

  private recordPath(id: string): string {
    return path.join(this.generationsDir, `${id}.json`);
  }

  // ─── Historique ───────────────────────────────────────────────────────────

  async saveGeneration(record: NewGenerationRecord): Promise<{ id: string }> {
    await this.ensureIndex();
    const id = this.idFactory();
    if (!isSafeId(id)) throw new MagistraError('STORAGE_ERROR');
    const full: GenerationRecord = { ...record, id, createdAt: this.now().toISOString(), isFavorite: false };
    try {
      await writeJsonAtomic(this.recordPath(id), full);
    } catch (err) {
      throw new MagistraError('STORAGE_ERROR', undefined, { cause: err });
    }
    this.index.set(id, { t: Date.parse(full.createdAt), summary: summarize(full) });
    this.sorted = null;
    return { id };
  }

  async list(query: ListQuery): Promise<HistoryPage> {
    await this.ensureIndex();
    let entries = this.sortedEntries();
    if (query.favoritesOnly) entries = entries.filter(e => e.summary.isFavorite);
    let start = 0;
    if (query.cursor) {
      const c = decodeCursor(query.cursor);
      const pivot: IndexEntry = { t: c.t, summary: { id: c.id } as GenerationSummary };
      start = entries.findIndex(e => compareEntries(pivot, e) < 0);
      if (start < 0) start = entries.length;
    }
    const page = entries.slice(start, start + query.limit);
    const hasMore = start + query.limit < entries.length;
    return {
      items: page.map(e => ({ ...e.summary })),
      ...(hasMore && page.length ? { nextCursor: encodeCursor(page[page.length - 1]) } : {}),
    };
  }

  async get(id: string): Promise<GenerationRecord | null> {
    if (!isSafeId(id)) return null;
    await this.ensureIndex();
    const result = await readJsonFile(this.recordPath(id), raw => parseStoredRecord(raw, id));
    if (result.status === 'ok') return result.value;
    if (result.status === 'corrupt') {
      this.warn(`Génération illisible mise de côté : ${result.movedTo ?? id}`);
      this.index.delete(id);
      this.sorted = null;
    }
    return null;
  }

  async setFavorite(id: string, value: boolean): Promise<void> {
    await this.ensureIndex();
    const file = this.recordPath(id);
    await withFileLock(`record:${id}`, async () => {
      const record = await this.get(id);
      if (!record) throw new MagistraError('NOT_FOUND');
      if (record.isFavorite === value) return;
      try {
        await writeJsonAtomic(file, { ...record, isFavorite: value });
      } catch (err) {
        throw new MagistraError('STORAGE_ERROR', 'Impossible de mettre à jour les favoris.', { cause: err });
      }
      const entry = this.index.get(id);
      if (entry) entry.summary = { ...entry.summary, isFavorite: value };
    });
  }

  async delete(id: string): Promise<void> {
    await this.ensureIndex();
    await withFileLock(`record:${id}`, async () => {
      try {
        await fsp.rm(this.recordPath(id), { force: true });
      } catch (err) {
        throw new MagistraError('STORAGE_ERROR', 'Impossible de supprimer ce contenu.', { cause: err });
      }
      this.index.delete(id);
      this.sorted = null;
    });
  }

  /** Statistiques exactes, calculées selon l'heure locale de l'ordinateur. */
  async stats(): Promise<UsageStats> {
    await this.ensureIndex();
    const now = this.now();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    // « Cette semaine » = les 7 derniers jours calendaires, aujourd'hui compris (robuste aux changements d'heure).
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime();
    let today = 0;
    let week = 0;
    let favorites = 0;
    const counts = new Map<string, number>();
    for (const { t, summary } of this.index.values()) {
      if (t >= startOfToday) today++;
      if (t >= startOfWeek) week++;
      if (summary.isFavorite) favorites++;
      const m = String(summary.matiere ?? '');
      if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    let top: { matiere: string; count: number } | undefined;
    for (const [matiere, count] of counts) {
      if (!top || count > top.count || (count === top.count && matiere < top.matiere)) top = { matiere, count };
    }
    return { total: this.index.size, favorites, today, week, ...(top ? { topMatiere: top } : {}) };
  }

  /** Supprime l'historique, les favoris, le profil et les documents conservés (préférences et réglages IA gardés). */
  async clearAll(): Promise<void> {
    await this.ensureIndex().catch(() => undefined);
    try {
      await fsp.rm(this.generationsDir, { recursive: true, force: true });
      await fsp.mkdir(this.generationsDir, { recursive: true });
      await fsp.rm(this.file('profile.json'), { force: true });
      await this.clearDocuments();
    } catch (err) {
      throw new MagistraError('STORAGE_ERROR', 'Impossible de supprimer toutes les données.', { cause: err });
    }
    this.index = new Map();
    this.sorted = null;
  }

  // ─── Profil ───────────────────────────────────────────────────────────────

  async getProfile(): Promise<TeacherProfile | null> {
    const result = await readJsonFile(this.file('profile.json'), parseStoredProfile);
    if (result.status === 'corrupt') this.warn(`Profil illisible mis de côté : ${result.movedTo ?? 'profile.json'}`);
    return result.status === 'ok' ? result.value : null;
  }

  async setProfile(profile: TeacherProfile | null): Promise<void> {
    try {
      if (profile === null) await withFileLock(this.file('profile.json'), () => fsp.rm(this.file('profile.json'), { force: true }));
      else await writeJsonAtomic(this.file('profile.json'), profile);
    } catch (err) {
      throw new MagistraError('STORAGE_ERROR', "Impossible d'enregistrer le profil.", { cause: err });
    }
  }

  // ─── Préférences ──────────────────────────────────────────────────────────

  async getPreferences(): Promise<LocalPreferences> {
    return withFileLock(`preferences:${this.file('preferences.json')}`, () => this.loadPreferences());
  }

  /** Appelé sous le verrou des préférences : aucun chargement ancien ne peut remplacer un cache plus récent. */
  private async loadPreferences(): Promise<LocalPreferences> {
    if (this.prefs) return { ...this.prefs };
    const result = await readJsonFile(this.file('preferences.json'), parseStoredPreferences);
    if (result.status === 'corrupt') this.warn(`Préférences illisibles mises de côté : ${result.movedTo ?? 'preferences.json'}`);
    this.prefs = result.status === 'ok' ? result.value : { ...DEFAULT_PREFERENCES };
    return { ...this.prefs };
  }

  async setPreferences(update: Partial<LocalPreferences>): Promise<LocalPreferences> {
    const changes = { ...update };
    // Le verrou de writeJsonAtomic ne protège que l'écriture : il faut aussi sérialiser la lecture et la fusion.
    // Clé distincte du fichier pour ne pas réentrer dans le verrou de l'écriture atomique.
    return withFileLock(`preferences:${this.file('preferences.json')}`, async () => {
      const current = await this.loadPreferences();
      const next: LocalPreferences = { ...current, ...changes };
      if (next.searxngUrl === undefined) delete next.searxngUrl;
      try {
        await writeJsonAtomic(this.file('preferences.json'), next);
      } catch (err) {
        throw new MagistraError('STORAGE_ERROR', "Impossible d'enregistrer les préférences.", { cause: err });
      }
      this.prefs = next;
      // Désactiver la conservation des documents efface ceux déjà conservés (respect du choix de l'enseignant).
      if (current.keepDocuments && !next.keepDocuments) await this.clearDocuments().catch(() => undefined);
      return { ...next };
    });
  }

  // ─── Documents (texte extrait uniquement) ─────────────────────────────────

  private documentPath(id: string): string {
    return path.join(this.documentsDir, `${id}.json`);
  }

  private async ensureDocIndex(): Promise<Map<string, Omit<StoredDocument, 'units'>>> {
    if (this.docIndex) return this.docIndex;
    await fsp.mkdir(this.documentsDir, { recursive: true });
    const names = (await this.listJsonNames(this.documentsDir, 'Les documents conservés')).filter(n => n.endsWith('.json'));
    const index = new Map<string, Omit<StoredDocument, 'units'>>();
    await mapLimit(names, 8, async name => {
      const id = name.slice(0, -'.json'.length);
      if (!isSafeId(id)) return;
      try {
        const doc = await this.loadDocument(id);
        if (doc) index.set(id, metaOf(doc));
      } catch {
        this.warn(`Document inaccessible ignoré : ${name}`);
      }
    });
    this.docIndex = index;
    return index;
  }

  async listDocuments(): Promise<Omit<StoredDocument, 'units'>[]> {
    const index = await this.ensureDocIndex();
    return [...index.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt)).map(d => ({ ...d, ...(d.warnings ? { warnings: [...d.warnings] } : {}) }));
  }

  async loadDocument(id: string): Promise<StoredDocument | null> {
    if (!isSafeId(id)) return null;
    const result = await readJsonFile(this.documentPath(id), raw => {
      try {
        const doc = sanitizeStoredDocument(raw);
        return doc.id === id ? doc : null;
      } catch {
        return null;
      }
    });
    if (result.status === 'corrupt') {
      this.warn(`Document illisible mis de côté : ${result.movedTo ?? id}`);
      this.docIndex?.delete(id);
    }
    return result.status === 'ok' ? result.value : null;
  }

  /** Enregistre le texte extrait d'un document, uniquement si l'enseignant a choisi de les conserver. */
  async saveDocument(doc: StoredDocument): Promise<boolean> {
    const prefs = await this.getPreferences();
    if (!prefs.keepDocuments) return false;
    const index = await this.ensureDocIndex();
    try {
      await writeJsonAtomic(this.documentPath(doc.id), doc);
    } catch (err) {
      throw new MagistraError('STORAGE_ERROR', "Impossible d'enregistrer le document.", { cause: err });
    }
    index.set(doc.id, metaOf(doc));
    return true;
  }

  async deleteDocument(id: string): Promise<void> {
    await withFileLock(this.documentPath(id), () => fsp.rm(this.documentPath(id), { force: true }));
    this.docIndex?.delete(id);
  }

  async clearDocuments(): Promise<void> {
    await fsp.rm(this.documentsDir, { recursive: true, force: true });
    await fsp.mkdir(this.documentsDir, { recursive: true });
    this.docIndex = new Map();
  }
}

function metaOf(doc: StoredDocument): Omit<StoredDocument, 'units'> {
  return { id: doc.id, name: doc.name, kind: doc.kind, description: doc.description, savedAt: doc.savedAt, chars: doc.chars, ...(doc.warnings ? { warnings: [...doc.warnings] } : {}) };
}
