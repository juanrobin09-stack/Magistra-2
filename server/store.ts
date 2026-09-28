// Stockage des données des enseignants (historique, favoris, profil, anti-abus).
//
// Règle absolue : chaque méthode reçoit l'identifiant de l'utilisateur AUTHENTIFIÉ (claim « sub »
// du jeton vérifié) et TOUTE requête est filtrée par cet identifiant. Un contenu qui n'appartient
// pas à l'utilisateur est indiscernable d'un contenu inexistant (NOT_FOUND).
//
//  - SupabaseStore : production (clé service_role, côté serveur uniquement) ;
//  - MemoryStore   : tests automatiques et développement local sans base de données.

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { resolveMatiere, type TypeContenu } from '../shared/catalog.js';
import { MagistraError } from '../shared/errors.js';
import type { NewGenerationRecord } from '../shared/pipeline.js';
import type { GenerationRecord, GenerationSummary, HistoryPage, SourceRef, TeacherProfile, UsageStats } from '../shared/types.js';
import { isUuid, requireUserId, requireUuid } from './ids.js';
import { sanitizeProfile } from './profile.js';
import { startOfDayInZone } from './time.js';

export interface HistoryQuery {
  favoritesOnly?: boolean;
  cursor?: string;
  limit: number;
}

/** Limites anti-abus vérifiées au début de chaque génération. */
export interface GenerationLimits {
  /** Contrôle de débit : au plus `maxRequests` demandes acceptées sur `windowSeconds` secondes (0 = désactivé). */
  windowSeconds: number;
  maxRequests: number;
  /** Au plus `maxGlobalRequests` demandes acceptées sur la même fenêtre pour tout le déploiement (0 = désactivé). */
  maxGlobalRequests: number;
  /** Générations en cours au plus pour l'utilisateur, toutes instances confondues (0 = pas de limite). */
  maxActive: number;
  /** Au-delà (secondes), une génération jamais marquée terminée ne compte plus comme « en cours ». */
  activeTtlSeconds: number;
}

export type GenerationAdmission =
  /** Acceptée ; `slotId` = place réservée, à libérer par endGeneration (null si maxActive = 0). */
  | { status: 'ok'; slotId: string | null }
  /** Refusée : l'utilisateur a déjà `maxActive` générations en cours. */
  | { status: 'busy' }
  /** Refusée : `maxRequests` demandes de l'utilisateur sur la fenêtre. */
  | { status: 'rate_limited' }
  /** Refusée : `maxGlobalRequests` demandes de l'ensemble des utilisateurs sur la fenêtre. */
  | { status: 'saturated' };

export interface GenerationStore {
  readonly kind: 'supabase' | 'memory';
  listGenerations(userId: string, query: HistoryQuery): Promise<HistoryPage>;
  getGeneration(userId: string, id: string): Promise<GenerationRecord>;
  setFavorite(userId: string, id: string, value: boolean): Promise<void>;
  deleteGeneration(userId: string, id: string): Promise<void>;
  saveGeneration(userId: string, record: NewGenerationRecord): Promise<{ id: string }>;
  getStats(userId: string, timeZone: string): Promise<UsageStats>;
  getProfile(userId: string): Promise<TeacherProfile | null>;
  saveProfile(userId: string, profile: TeacherProfile | null): Promise<void>;
  /** Supprime toutes les données de l'utilisateur (générations, profil, traces anti-abus). */
  deleteAccount(userId: string): Promise<void>;
  /**
   * Anti-abus technique, opération atomique (y compris entre plusieurs instances du serveur) :
   * refuse la demande si l'utilisateur a déjà `maxActive` générations en cours (busy) ou `maxRequests`
   * demandes sur la fenêtre (rate_limited), ou si le déploiement a déjà reçu `maxGlobalRequests`
   * demandes sur la fenêtre (saturated) ; sinon l'enregistre et réserve une place de génération.
   * Une demande refusée n'est pas comptée.
   */
  beginGeneration(userId: string, limits: GenerationLimits): Promise<GenerationAdmission>;
  /** Libère la place réservée par beginGeneration (sans effet si elle a déjà expiré). */
  endGeneration(userId: string, slotId: string): Promise<void>;
}

export const HISTORY_LIMITS = { default: 50, max: 200 } as const;
const WEEK_MS = 7 * 86_400_000;

// ─── Outils communs ─────────────────────────────────────────────────────────

/** Extrait lisible d'un contenu Markdown (même règle que l'interface). */
export function excerptOf(markdown: string | null | undefined, max = 240): string {
  const text = (markdown ?? '')
    .replace(/^>.*$/gm, '')
    .replace(/[#*_`>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function clampLimit(limit: number): number {
  return Number.isFinite(limit) ? Math.min(HISTORY_LIMITS.max, Math.max(1, Math.floor(limit))) : HISTORY_LIMITS.default;
}

interface Cursor {
  createdAt: string;
  id: string;
}

// Horodatage PostgreSQL / ISO 8601 (précision jusqu'à la microseconde conservée telle quelle).
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  const invalid = () => new MagistraError('INVALID_REQUEST', 'Curseur de pagination invalide.');
  if (raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw invalid();
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const sep = decoded.lastIndexOf('|');
  if (sep < 0) throw invalid();
  const createdAt = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  if (!TIMESTAMP_PATTERN.test(createdAt)) throw invalid();
  try {
    return { createdAt, id: requireUuid(id) };
  } catch {
    throw invalid();
  }
}

function toIso(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

function asSources(value: unknown): SourceRef[] {
  return Array.isArray(value) ? (value.filter(v => v && typeof v === 'object') as SourceRef[]) : [];
}

function asParams(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readError(err?: unknown): MagistraError {
  return new MagistraError('STORAGE_ERROR', 'Historique momentanément inaccessible. Réessayez dans quelques instants.', { cause: err });
}

function writeError(err?: unknown): MagistraError {
  return new MagistraError('STORAGE_ERROR', undefined, { cause: err });
}

// ─── Stockage en mémoire (tests, développement) ─────────────────────────────

interface MemoryEntry {
  userId: string;
  record: GenerationRecord;
}

export class MemoryStore implements GenerationStore {
  readonly kind = 'memory' as const;
  private readonly generations = new Map<string, MemoryEntry>();
  private readonly profiles = new Map<string, TeacherProfile>();
  private readonly requests = new Map<string, number[]>();
  /** Générations en cours : utilisateur → (place → début, en ms). */
  private readonly active = new Map<string, Map<string, number>>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  /** Propriétaire d'un contenu (utilisé par les tests). */
  ownerOf(id: string): string | undefined {
    return this.generations.get(id)?.userId;
  }

  /** Nombre de requêtes anti-abus enregistrées pour un utilisateur (utilisé par les tests). */
  requestCount(userId: string): number {
    return this.requests.get(userId)?.length ?? 0;
  }

  /** Nombre de places de génération réservées et non libérées, expirées comprises (utilisé par les tests). */
  activeCount(userId: string): number {
    return this.active.get(userId)?.size ?? 0;
  }

  private owned(userId: string, id: string): MemoryEntry {
    const uid = requireUserId(userId);
    const entry = this.generations.get(requireUuid(id));
    if (!entry || entry.userId !== uid) throw new MagistraError('NOT_FOUND');
    return entry;
  }

  private sorted(userId: string): GenerationRecord[] {
    return [...this.generations.values()]
      .filter(e => e.userId === userId)
      .map(e => e.record)
      .sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1));
  }

  async listGenerations(userId: string, query: HistoryQuery): Promise<HistoryPage> {
    const uid = requireUserId(userId);
    const limit = clampLimit(query.limit);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = this.sorted(uid)
      .filter(r => !query.favoritesOnly || r.isFavorite)
      .filter(r => !cursor || r.createdAt < cursor.createdAt || (r.createdAt === cursor.createdAt && r.id < cursor.id));
    const page = rows.slice(0, limit);
    const items: GenerationSummary[] = page.map(r => ({
      id: r.id,
      createdAt: r.createdAt,
      type: r.type,
      niveau: r.niveau,
      matiere: r.matiere,
      ...(r.discipline ? { discipline: r.discipline } : {}),
      sujet: r.sujet,
      isFavorite: r.isFavorite,
      excerpt: excerptOf(r.contenu),
    }));
    const last = page[page.length - 1];
    return rows.length > limit && last ? { items, nextCursor: encodeCursor({ createdAt: last.createdAt, id: last.id }) } : { items };
  }

  async getGeneration(userId: string, id: string): Promise<GenerationRecord> {
    return structuredClone(this.owned(userId, id).record);
  }

  async setFavorite(userId: string, id: string, value: boolean): Promise<void> {
    this.owned(userId, id).record.isFavorite = value;
  }

  async deleteGeneration(userId: string, id: string): Promise<void> {
    const entry = this.owned(userId, id);
    this.generations.delete(entry.record.id);
  }

  async saveGeneration(userId: string, record: NewGenerationRecord): Promise<{ id: string }> {
    const uid = requireUserId(userId);
    const id = randomUUID();
    const full: GenerationRecord = {
      ...structuredClone(record),
      id,
      createdAt: this.now().toISOString(),
      isFavorite: false,
    };
    this.generations.set(id, { userId: uid, record: full });
    return { id };
  }

  async getStats(userId: string, timeZone: string): Promise<UsageStats> {
    const uid = requireUserId(userId);
    const now = this.now();
    const today = startOfDayInZone(now, timeZone).getTime();
    const weekAgo = now.getTime() - WEEK_MS;
    const counts = new Map<string, number>();
    const stats: UsageStats = { total: 0, favorites: 0, today: 0, week: 0 };
    for (const r of this.sorted(uid)) {
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
    const p = this.profiles.get(requireUserId(userId));
    return p ? structuredClone(p) : null;
  }

  async saveProfile(userId: string, profile: TeacherProfile | null): Promise<void> {
    const uid = requireUserId(userId);
    if (profile) this.profiles.set(uid, structuredClone(profile));
    else this.profiles.delete(uid);
  }

  async deleteAccount(userId: string): Promise<void> {
    const uid = requireUserId(userId);
    for (const [id, entry] of this.generations) if (entry.userId === uid) this.generations.delete(id);
    this.profiles.delete(uid);
    this.requests.delete(uid);
    this.active.delete(uid);
  }

  // Même sémantique que la fonction SQL magistra_begin_generation (voir supabase-schema.sql).
  async beginGeneration(userId: string, limits: GenerationLimits): Promise<GenerationAdmission> {
    const uid = requireUserId(userId);
    const now = this.now().getTime();
    const slots = this.active.get(uid) ?? new Map<string, number>();
    if (limits.maxActive > 0) {
      for (const [id, startedAt] of slots) {
        if (startedAt < now - limits.activeTtlSeconds * 1_000) slots.delete(id);
      }
      if (slots.size >= limits.maxActive) return { status: 'busy' };
    }
    if (limits.maxRequests > 0 || limits.maxGlobalRequests > 0) {
      const since = now - limits.windowSeconds * 1_000;
      const recent = (this.requests.get(uid) ?? []).filter(t => t > since);
      this.requests.set(uid, recent);
      if (limits.maxRequests > 0 && recent.length >= limits.maxRequests) return { status: 'rate_limited' };
      if (limits.maxGlobalRequests > 0) {
        let total = 0;
        for (const times of this.requests.values()) total += times.filter(t => t > since).length;
        if (total >= limits.maxGlobalRequests) return { status: 'saturated' };
      }
      recent.push(now);
    }
    if (limits.maxActive <= 0) return { status: 'ok', slotId: null };
    const slotId = randomUUID();
    slots.set(slotId, now);
    this.active.set(uid, slots);
    return { status: 'ok', slotId };
  }

  async endGeneration(userId: string, slotId: string): Promise<void> {
    const uid = requireUserId(userId);
    const slots = this.active.get(uid);
    slots?.delete(requireUuid(slotId));
    if (slots && slots.size === 0) this.active.delete(uid);
  }
}

// ─── Supabase (production) ──────────────────────────────────────────────────

interface GenerationRow {
  id: string;
  created_at: string;
  type: string;
  niveau: string | null;
  matiere: string | null;
  discipline: string | null;
  sujet: string | null;
  is_favorite: boolean | null;
  excerpt?: string | null;
  contenu?: string | null;
  sources?: unknown;
  params?: unknown;
  truncated?: boolean | null;
  internet_used?: boolean | null;
  model?: string | null;
}

/** Table inconnue : PostgREST ≥ 12 (cache de schéma) ou PostgreSQL. */
const MISSING_TABLE_CODES: ReadonlySet<string> = new Set(['PGRST205', '42P01']);

/** Matière la plus fréquente, anciens libellés et clés actuelles regroupés (voir resolveMatiere). */
export function topMatiereOf(raw: Record<string, unknown>): UsageStats['topMatiere'] {
  const counts = new Map<string, number>();
  for (const [value, count] of Object.entries(raw)) {
    const n = typeof count === 'number' ? count : Number(count);
    if (!value || !Number.isFinite(n) || n <= 0) continue;
    const key = resolveMatiere(value) ?? value;
    counts.set(key, (counts.get(key) ?? 0) + n);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  return top ? { matiere: top[0], count: top[1] } : undefined;
}

const SUMMARY_COLUMNS = 'id,created_at,type,niveau,matiere,discipline,sujet,is_favorite,excerpt';
const RECORD_COLUMNS = 'id,created_at,type,niveau,matiere,discipline,sujet,contenu,sources,params,is_favorite,truncated,internet_used,model';

/** Transport WebSocket factice : le serveur n'utilise pas le temps réel de Supabase. */
class NoRealtimeTransport {
  constructor() {
    throw new Error('Supabase Realtime n’est pas utilisé par le serveur Magistra.');
  }
}

export interface SupabaseStoreOptions {
  url: string;
  serviceRoleKey: string;
  /** fetch injectable (tests). */
  fetch?: typeof fetch;
  /** Délai maximal d'une requête à la base. */
  timeoutMs?: number;
}

export class SupabaseStore implements GenerationStore {
  readonly kind = 'supabase' as const;
  private readonly db: SupabaseClient;

  constructor(options: SupabaseStoreOptions) {
    const baseFetch = options.fetch ?? ((input: Parameters<typeof fetch>[0], init?: RequestInit) => fetch(input, init));
    const timeoutMs = options.timeoutMs ?? 10_000;
    const timedFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      return baseFetch(input, { ...init, signal });
    }) as typeof fetch;
    this.db = createClient(options.url, options.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: timedFetch, headers: { 'X-Client-Info': 'magistra-server' } },
      realtime: { transport: NoRealtimeTransport as never },
    });
  }

  async listGenerations(userId: string, query: HistoryQuery): Promise<HistoryPage> {
    const uid = requireUserId(userId);
    const limit = clampLimit(query.limit);
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    let q = this.db
      .from('generations')
      .select(SUMMARY_COLUMNS)
      .eq('user_id', uid);
    if (query.favoritesOnly) q = q.eq('is_favorite', true);
    if (cursor) {
      // Pagination par clé (created_at, id) : valeurs validées puis citées, jamais concaténées brutes.
      q = q.or(`created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`);
    }
    const { data, error } = await q
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);
    if (error || !Array.isArray(data)) throw readError(error);
    const rows = data as unknown as GenerationRow[];
    const page = rows.slice(0, limit);
    const items: GenerationSummary[] = page.map(r => ({
      id: r.id,
      createdAt: toIso(r.created_at),
      type: r.type as TypeContenu,
      niveau: r.niveau ?? '',
      matiere: r.matiere ?? '',
      ...(r.discipline ? { discipline: r.discipline } : {}),
      sujet: r.sujet ?? '',
      isFavorite: r.is_favorite === true,
      excerpt: excerptOf(r.excerpt),
    }));
    const last = page[page.length - 1];
    return rows.length > limit && last ? { items, nextCursor: encodeCursor({ createdAt: last.created_at, id: last.id }) } : { items };
  }

  async getGeneration(userId: string, id: string): Promise<GenerationRecord> {
    const uid = requireUserId(userId);
    const gid = requireUuid(id);
    const { data, error } = await this.db
      .from('generations')
      .select(RECORD_COLUMNS)
      .eq('user_id', uid)
      .eq('id', gid)
      .maybeSingle();
    if (error) throw readError(error);
    if (!data) throw new MagistraError('NOT_FOUND');
    const r = data as unknown as GenerationRow;
    return {
      id: r.id,
      createdAt: toIso(r.created_at),
      type: r.type as TypeContenu,
      niveau: r.niveau ?? '',
      matiere: r.matiere ?? '',
      ...(r.discipline ? { discipline: r.discipline } : {}),
      sujet: r.sujet ?? '',
      contenu: r.contenu ?? '',
      isFavorite: r.is_favorite === true,
      sources: asSources(r.sources),
      params: asParams(r.params),
      truncated: r.truncated === true,
      internetUsed: r.internet_used === true,
      ...(r.model ? { model: r.model } : {}),
    };
  }

  async setFavorite(userId: string, id: string, value: boolean): Promise<void> {
    const uid = requireUserId(userId);
    const gid = requireUuid(id);
    const { data, error } = await this.db
      .from('generations')
      .update({ is_favorite: value === true })
      .eq('user_id', uid)
      .eq('id', gid)
      .select('id');
    if (error) throw writeError(error);
    if (!Array.isArray(data) || data.length === 0) throw new MagistraError('NOT_FOUND');
  }

  async deleteGeneration(userId: string, id: string): Promise<void> {
    const uid = requireUserId(userId);
    const gid = requireUuid(id);
    const { data, error } = await this.db
      .from('generations')
      .delete()
      .eq('user_id', uid)
      .eq('id', gid)
      .select('id');
    if (error) throw writeError(error);
    if (!Array.isArray(data) || data.length === 0) throw new MagistraError('NOT_FOUND');
  }

  async saveGeneration(userId: string, record: NewGenerationRecord): Promise<{ id: string }> {
    const uid = requireUserId(userId);
    const { data, error } = await this.db
      .from('generations')
      .insert({
        user_id: uid,
        type: record.type,
        niveau: record.niveau,
        matiere: record.matiere,
        discipline: record.discipline ?? null,
        sujet: record.sujet,
        contenu: record.contenu,
        sources: record.sources ?? [],
        params: record.params ?? {},
        truncated: record.truncated === true,
        internet_used: record.internetUsed === true,
        model: record.model ?? null,
      })
      .select('id')
      .single();
    const id = (data as { id?: unknown } | null)?.id;
    if (error || typeof id !== 'string') throw writeError(error);
    return { id };
  }

  async getStats(userId: string, timeZone: string): Promise<UsageStats> {
    const uid = requireUserId(userId);
    const { data, error } = await this.db.rpc('magistra_stats', { p_user_id: uid, p_tz: timeZone });
    if (error || !data || typeof data !== 'object') throw readError(error);
    const d = data as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
    const stats: UsageStats = { total: n(d.total), favorites: n(d.favorites), today: n(d.today), week: n(d.week) };
    const counts = d.matiere_counts && typeof d.matiere_counts === 'object' ? topMatiereOf(d.matiere_counts as Record<string, unknown>) : undefined;
    if (counts) stats.topMatiere = counts;
    // Schéma antérieur (sans matiere_counts) : matière la plus fréquente telle que stockée.
    else if (typeof d.top_matiere === 'string' && d.top_matiere) stats.topMatiere = { matiere: d.top_matiere, count: n(d.top_count) };
    return stats;
  }

  async getProfile(userId: string): Promise<TeacherProfile | null> {
    const uid = requireUserId(userId);
    const { data, error } = await this.db.from('profiles').select('data').eq('id', uid).maybeSingle();
    if (error) throw readError(error);
    return sanitizeProfile((data as { data?: unknown } | null)?.data, false);
  }

  async saveProfile(userId: string, profile: TeacherProfile | null): Promise<void> {
    const uid = requireUserId(userId);
    const { error } = profile
      ? await this.db.from('profiles').upsert({ id: uid, data: profile }, { onConflict: 'id' })
      : await this.db.from('profiles').delete().eq('id', uid);
    if (error) throw writeError(error);
  }

  async deleteAccount(userId: string): Promise<void> {
    const uid = requireUserId(userId);
    const active = await this.db.from('active_generations').delete().eq('user_id', uid);
    const results = [
      await this.db.from('generations').delete().eq('user_id', uid),
      await this.db.from('profiles').delete().eq('id', uid),
      await this.db.from('api_requests').delete().eq('user_id', uid),
      // Table absente (supabase-schema.sql pas encore réappliqué) : rien à y supprimer.
      ...(active.error && MISSING_TABLE_CODES.has(active.error.code) ? [] : [active]),
    ];
    const failed = results.find(r => r.error);
    if (failed) throw new MagistraError('STORAGE_ERROR', 'La suppression des données a échoué. Réessayez.', { cause: failed.error });
  }

  async beginGeneration(userId: string, limits: GenerationLimits): Promise<GenerationAdmission> {
    const uid = requireUserId(userId);
    const { data, error } = await this.db.rpc('magistra_begin_generation', {
      p_user_id: uid,
      p_window_seconds: limits.windowSeconds,
      p_max_requests: limits.maxRequests,
      p_max_global_requests: limits.maxGlobalRequests,
      p_max_active: limits.maxActive,
      p_active_ttl_seconds: limits.activeTtlSeconds,
    });
    const result = data as { status?: unknown; id?: unknown } | null;
    if (error || !result || typeof result !== 'object') throw writeError(error);
    if (result.status === 'busy' || result.status === 'rate_limited' || result.status === 'saturated') return { status: result.status };
    if (result.status === 'ok' && (result.id === null || result.id === undefined)) return { status: 'ok', slotId: null };
    if (result.status === 'ok' && isUuid(result.id)) return { status: 'ok', slotId: result.id.toLowerCase() };
    throw writeError(new Error('Réponse inattendue de magistra_begin_generation.'));
  }

  async endGeneration(userId: string, slotId: string): Promise<void> {
    const uid = requireUserId(userId);
    const { error } = await this.db.rpc('magistra_end_generation', { p_user_id: uid, p_generation_id: requireUuid(slotId) });
    if (error) throw writeError(error);
  }
}
