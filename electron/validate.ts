// Validation des arguments reçus de la fenêtre (données non fiables) et des fichiers relus sur le disque.
// Toute erreur devient MagistraError('INVALID_REQUEST') avec un message en français.

import { MODEL_TIERS, type TierId } from '../shared/ai/models.js';
import { isOllamaCloudName, REMOTE_MODEL_REFUSED } from '../shared/ai/ollamaRemote.js';
import { isMatiere } from '../shared/catalog.js';
import { MagistraError } from '../shared/errors.js';
import {
  DEFAULT_PREFERENCES, type AIConfigUpdate, type EngineInstallOptions, type EngineStartOptions, type LocalPreferences, type StoredDocument,
} from '../shared/ipc.js';
import { isNiveau } from '../shared/levels.js';
import { CONNECTOR_FORMATS } from '../shared/localConnector.js';
import { isResearchMode, type TeacherProfile } from '../shared/types.js';
import { validateLocatorLabels } from '../shared/validation.js';
import { hasControlChars, stripNul } from './security.js';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Identifiant utilisable comme nom de fichier (aucun séparateur, aucun « .. »). */
export function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value);
}

export function requireId(value: unknown, what = 'identifiant'): string {
  if (!isSafeId(value)) throw new MagistraError('INVALID_REQUEST', `Paramètre invalide : ${what}.`);
  return value;
}

export function requireBoolean(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw new MagistraError('INVALID_REQUEST', `Paramètre invalide : ${what}.`);
  return value;
}

/** Identifiant d'un navigateur autorisé à utiliser le connecteur local (16 octets en base64url, attribué par l'application). */
export function requireClientId(value: unknown): string {
  if (typeof value !== 'string' || !CONNECTOR_FORMATS.clientId.test(value)) {
    throw new MagistraError('INVALID_REQUEST', 'Paramètre invalide : navigateur autorisé.');
  }
  return value;
}

function optString(value: unknown, max: number, what: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new MagistraError('INVALID_REQUEST', `Champ « ${what} » invalide.`);
  const v = stripNul(value).trim();
  if (v.length > max) throw new MagistraError('INVALID_REQUEST', `Le champ « ${what} » est trop long (${max} caractères maximum).`);
  return v;
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

function requireHttpUrl(value: unknown, what: string): string {
  const v = optString(value, 500, what);
  if (!v || !isHttpUrl(v)) throw new MagistraError('INVALID_REQUEST', `Adresse invalide pour « ${what} » : indiquez une adresse commençant par http:// ou https://.`);
  return v.replace(/\/+$/, '');
}

// ─── Historique ─────────────────────────────────────────────────────────────

export interface ListQuery {
  favoritesOnly: boolean;
  cursor?: string;
  limit: number;
}

export function sanitizeListQuery(raw: unknown): ListQuery {
  const q = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const limitRaw = q.limit === undefined ? 30 : Number(q.limit);
  if (!Number.isFinite(limitRaw)) throw new MagistraError('INVALID_REQUEST', 'Paramètre invalide : limite.');
  const cursor = q.cursor === undefined || q.cursor === null || q.cursor === '' ? undefined : q.cursor;
  if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 200)) {
    throw new MagistraError('INVALID_REQUEST', 'Paramètre invalide : curseur.');
  }
  return {
    favoritesOnly: q.favoritesOnly === true,
    cursor: cursor as string | undefined,
    limit: Math.min(100, Math.max(1, Math.floor(limitRaw))),
  };
}

// ─── Profil ─────────────────────────────────────────────────────────────────

export function sanitizeProfile(raw: unknown): TeacherProfile | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new MagistraError('INVALID_REQUEST', 'Profil invalide.');
  const p = raw as Record<string, unknown>;
  const niveaux = Array.isArray(p.niveaux) ? p.niveaux.filter(isNiveau).slice(0, 40) : [];
  const profile: TeacherProfile = {
    displayName: optString(p.displayName, 120, 'nom') ?? '',
    etablissement: optString(p.etablissement, 200, 'établissement') ?? '',
    cycle: optString(p.cycle, 40, 'cycle') ?? '',
    niveaux: [...new Set(niveaux)],
    matierePrincipale: isMatiere(p.matierePrincipale) ? p.matierePrincipale : 'autre',
  };
  if (isMatiere(p.matiereSecondaire)) profile.matiereSecondaire = p.matiereSecondaire;
  const discipline = optString(p.discipline, 150, 'spécialité');
  if (discipline) profile.discipline = discipline;
  return profile;
}

/** Relecture tolérante d'un profil enregistré : null si le contenu n'a pas la bonne forme. */
export function parseStoredProfile(raw: unknown): TeacherProfile | null {
  try {
    if (!raw || typeof raw !== 'object') return null;
    return sanitizeProfile(raw);
  } catch {
    return null;
  }
}

// ─── Préférences ────────────────────────────────────────────────────────────

/** Préférences booléennes (aiSetupRequested : activation de l'IA lancée par l'enseignant, à reprendre au lancement). */
const PREFERENCE_FLAGS = ['academicEnabled', 'wikipediaEnabled', 'keepDocuments', 'setupCompleted', 'aiSetupRequested'] as const;

/** Mise à jour partielle des préférences (champ par champ, types stricts). */
export function sanitizePreferencesUpdate(raw: unknown): Partial<LocalPreferences> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MagistraError('INVALID_REQUEST', 'Préférences invalides.');
  const u = raw as Record<string, unknown>;
  const out: Partial<LocalPreferences> = {};
  if ('defaultResearchMode' in u) {
    if (!isResearchMode(u.defaultResearchMode)) throw new MagistraError('INVALID_REQUEST', 'Mode de recherche inconnu.');
    out.defaultResearchMode = u.defaultResearchMode;
  }
  if ('searxngUrl' in u) {
    const v = u.searxngUrl;
    if (v === undefined || v === null || v === '') out.searxngUrl = undefined;
    else out.searxngUrl = requireHttpUrl(v, 'serveur de recherche SearXNG');
  }
  for (const key of PREFERENCE_FLAGS) {
    if (key in u) out[key] = requireBoolean(u[key], key);
  }
  return out;
}

/** Relecture tolérante : chaque champ invalide reprend sa valeur par défaut, les autres sont conservés. */
export function parseStoredPreferences(raw: unknown): LocalPreferences | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const u = raw as Record<string, unknown>;
  const prefs: LocalPreferences = { ...DEFAULT_PREFERENCES };
  if (isResearchMode(u.defaultResearchMode)) prefs.defaultResearchMode = u.defaultResearchMode;
  if (typeof u.searxngUrl === 'string' && isHttpUrl(u.searxngUrl)) prefs.searxngUrl = u.searxngUrl;
  for (const key of PREFERENCE_FLAGS) {
    if (typeof u[key] === 'boolean') prefs[key] = u[key] as boolean;
  }
  return prefs;
}

// ─── Documents (texte extrait uniquement) ───────────────────────────────────

export const DOCUMENT_LIMITS = { name: 200, description: 2_000, units: 20_000, unitChars: 200_000, totalChars: 5_000_000, warnings: 32, warningChars: 2_000 };
const DOC_KINDS: StoredDocument['kind'][] = ['pdf', 'docx', 'pptx', 'txt', 'md'];
const LOCATOR_TYPES: StoredDocument['units'][number]['locator']['type'][] = ['pages', 'slides', 'section', 'paragraphs', 'lines'];

/** Les avertissements sont optionnels pour relire les documents enregistrés avant leur conservation. */
function storedDocumentWarnings(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > DOCUMENT_LIMITS.warnings) {
    throw new MagistraError('INVALID_REQUEST', 'Document invalide : avertissements incorrects.');
  }
  const warnings: string[] = [];
  for (const message of raw) {
    if (typeof message !== 'string' || message.length > DOCUMENT_LIMITS.warningChars) {
      throw new MagistraError('INVALID_REQUEST', 'Document invalide : avertissement incorrect ou trop long.');
    }
    const warning = stripNul(message).trim();
    if (hasControlChars(warning)) throw new MagistraError('INVALID_REQUEST', 'Document invalide : avertissement incorrect.');
    if (warning && !warnings.includes(warning)) warnings.push(warning);
  }
  return warnings;
}

export function sanitizeStoredDocument(raw: unknown): StoredDocument {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MagistraError('INVALID_REQUEST', 'Document invalide.');
  const d = raw as Record<string, unknown>;
  const id = requireId(d.id, 'identifiant de document');
  const name = optString(d.name, DOCUMENT_LIMITS.name, 'nom du document') || 'Document';
  if (!DOC_KINDS.includes(d.kind as StoredDocument['kind'])) throw new MagistraError('DOCUMENT_UNSUPPORTED');
  const description = optString(d.description, DOCUMENT_LIMITS.description, 'description') ?? '';
  const warnings = storedDocumentWarnings(d.warnings);
  const savedAt = typeof d.savedAt === 'string' && !Number.isNaN(Date.parse(d.savedAt)) ? new Date(d.savedAt).toISOString() : new Date().toISOString();
  if (!Array.isArray(d.units)) throw new MagistraError('INVALID_REQUEST', 'Document invalide : contenu manquant.');
  if (d.units.length > DOCUMENT_LIMITS.units) throw new MagistraError('DOCUMENT_TOO_LARGE');
  let chars = 0;
  const units: StoredDocument['units'] = [];
  for (const rawUnit of d.units) {
    const unit = rawUnit as { locator?: Record<string, unknown>; text?: unknown };
    if (typeof unit?.text !== 'string') throw new MagistraError('INVALID_REQUEST', 'Document invalide : texte manquant.');
    if (unit.text.length > DOCUMENT_LIMITS.unitChars) throw new MagistraError('DOCUMENT_TOO_LARGE');
    chars += unit.text.length;
    if (chars > DOCUMENT_LIMITS.totalChars) throw new MagistraError('DOCUMENT_TOO_LARGE');
    const loc = unit.locator ?? {};
    const type = LOCATOR_TYPES.find(t => t === loc.type);
    const start = Number(loc.start);
    const end = Number(loc.end);
    if (!type || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > 1_000_000) {
      throw new MagistraError('INVALID_REQUEST', 'Document invalide : localisation incorrecte.');
    }
    const title = typeof loc.title === 'string' && loc.title.trim() ? loc.title.slice(0, 200) : undefined;
    const labels = type === 'pages' ? validateLocatorLabels(loc.labels) : undefined;
    units.push({ locator: { type, start, end, ...(title ? { title } : {}), ...(labels ? { labels } : {}) }, text: stripNul(unit.text) });
  }
  return { id, name, kind: d.kind as StoredDocument['kind'], description, savedAt, units, chars, ...(warnings !== undefined ? { warnings } : {}) };
}

// ─── Configuration de l'IA ──────────────────────────────────────────────────

const TIER_IDS = MODEL_TIERS.map(t => t.id);
const MODEL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/:]{0,199}$/;

export function isTierId(value: unknown): value is TierId {
  return typeof value === 'string' && (TIER_IDS as string[]).includes(value);
}

export function isValidModelName(value: unknown): value is string {
  return typeof value === 'string' && MODEL_NAME_RE.test(value) && !value.includes('..');
}

export function sanitizeAIConfigUpdate(raw: unknown): AIConfigUpdate {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MagistraError('INVALID_REQUEST', 'Configuration invalide.');
  const u = raw as Record<string, unknown>;
  const out: AIConfigUpdate = {};
  if ('mode' in u && u.mode !== undefined) {
    if (u.mode !== 'local' && u.mode !== 'remote') throw new MagistraError('INVALID_REQUEST', 'Mode d’IA inconnu.');
    out.mode = u.mode;
  }
  if ('tier' in u && u.tier !== undefined) {
    if (!isTierId(u.tier)) throw new MagistraError('INVALID_REQUEST', 'Niveau de modèle inconnu.');
    out.tier = u.tier;
  }
  if ('customModel' in u && u.customModel !== undefined) {
    if (u.customModel === null || u.customModel === '') out.customModel = null;
    else if (!isValidModelName(u.customModel)) throw new MagistraError('INVALID_REQUEST', 'Nom de modèle invalide.');
    // Modèle « cloud » d'Ollama : les textes partiraient sur Internet alors que l'application annonce une IA locale.
    else if (isOllamaCloudName(u.customModel)) throw new MagistraError('INVALID_REQUEST', REMOTE_MODEL_REFUSED);
    else out.customModel = u.customModel;
  }
  if ('ollamaUrl' in u && u.ollamaUrl !== undefined) out.ollamaUrl = requireHttpUrl(u.ollamaUrl, 'adresse d’Ollama');
  if ('remote' in u && u.remote !== undefined) {
    if (u.remote === null) {
      out.remote = null;
    } else {
      if (typeof u.remote !== 'object' || Array.isArray(u.remote)) throw new MagistraError('INVALID_REQUEST', 'Serveur distant invalide.');
      const r = u.remote as Record<string, unknown>;
      if (r.kind !== 'openai-compatible' && r.kind !== 'ollama' && r.kind !== 'anthropic') throw new MagistraError('INVALID_REQUEST', 'Type de serveur distant inconnu.');
      const baseUrl = requireHttpUrl(r.baseUrl, 'adresse du serveur');
      if (!isValidModelName(r.model)) throw new MagistraError('INVALID_REQUEST', 'Nom de modèle invalide.');
      const apiKey = r.apiKey === undefined || r.apiKey === null ? undefined : r.apiKey;
      if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length > 1_000 || hasControlChars(apiKey) || /\s/.test(apiKey))) {
        throw new MagistraError('INVALID_REQUEST', 'Clé API invalide.');
      }
      const label = optString(r.label, 100, 'nom du serveur') || undefined;
      out.remote = { kind: r.kind, baseUrl, model: r.model, ...(apiKey !== undefined ? { apiKey: apiKey as string } : {}), ...(label ? { label } : {}) };
    }
  }
  return out;
}

export function sanitizePullTarget(raw: unknown): { tier?: TierId; model?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new MagistraError('INVALID_REQUEST', 'Modèle à installer invalide.');
  const t = raw as Record<string, unknown>;
  const out: { tier?: TierId; model?: string } = {};
  if (t.tier !== undefined) {
    if (!isTierId(t.tier)) throw new MagistraError('INVALID_REQUEST', 'Niveau de modèle inconnu.');
    out.tier = t.tier;
  }
  if (t.model !== undefined) {
    if (!isValidModelName(t.model)) throw new MagistraError('INVALID_REQUEST', 'Nom de modèle invalide.');
    if (isOllamaCloudName(t.model)) throw new MagistraError('INVALID_REQUEST', REMOTE_MODEL_REFUSED);
    out.model = t.model;
  }
  if (!out.tier && !out.model) throw new MagistraError('INVALID_REQUEST', 'Indiquez le modèle à installer.');
  return out;
}

/**
 * Options booléennes d'une action du moteur (argument facultatif venant de la fenêtre) : absent → {} ;
 * sinon un objet ne contenant QUE la clé attendue, booléenne. Tout autre contenu est refusé.
 */
function booleanOption<K extends string>(raw: unknown, key: K, what: string): Partial<Record<K, true>> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new MagistraError('INVALID_REQUEST', `Options invalides : ${what}.`);
  const o = raw as Record<string, unknown>;
  if (Object.keys(o).some(k => k !== key) || (o[key] !== undefined && typeof o[key] !== 'boolean')) {
    throw new MagistraError('INVALID_REQUEST', `Options invalides : ${what}.`);
  }
  return o[key] === true ? ({ [key]: true } as Partial<Record<K, true>>) : {};
}

/** Options de ai:install-engine : { update?: boolean } (mise à jour d'un moteur trop ancien). */
export function sanitizeEngineInstallOptions(raw: unknown): EngineInstallOptions {
  return booleanOption(raw, 'update', 'installation du moteur IA');
}

/** Options de ai:start-engine : { restart?: boolean } (relance avec le proxy du système). */
export function sanitizeEngineStartOptions(raw: unknown): EngineStartOptions {
  return booleanOption(raw, 'restart', 'démarrage du moteur IA');
}
