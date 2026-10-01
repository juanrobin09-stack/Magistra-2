// Découpage intelligent + recherche des passages utiles (BM25), sans base vectorielle.
// Tout est éphémère : rien n'est stocké, les passages retenus sont transmis au modèle
// avec leur localisation exacte.

import type { DocumentPassage, Locator } from '../types.js';
import { REQUEST_LIMITS } from '../validation.js';
import { QUERY_STOPWORDS, tokenize } from './text.js';
import type { Chunk, ExtractedDocument } from './types.js';

const TARGET_CHUNK = 1_200;
const MAX_CHUNK = 1_800;
/** Séparateur inséré entre deux morceaux fusionnés en un seul passage. */
const SEPARATOR = '\n\n';
/**
 * Taille maximale d'un passage fusionné : assez petit pour qu'une citation désigne 1 à 3 pages (ou quelques
 * diapositives) que l'enseignant peut relire, assez grand pour ne pas multiplier les sources numérotées.
 */
export const MAX_MERGED_PASSAGE_CHARS = 3_000;
/** Ancienne taille, gardée en repli quand le découpage fin dépasserait le nombre d'extraits accepté par le serveur. */
const COARSE_MERGED_PASSAGE_CHARS = 10_000;

/** Découpe un texte en morceaux d'environ TARGET_CHUNK caractères, aux frontières de paragraphes puis de phrases. */
export function splitText(text: string, target = TARGET_CHUNK, max = MAX_CHUNK): string[] {
  if (text.length <= max) return [text];
  const paragraphs = text.split(/\n{2,}|\n(?=[-•*]\s|\d+[.)]\s)/);
  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= max) {
      pieces.push(p);
      continue;
    }
    const sentences = p.match(/[^.!?…]+[.!?…]+[\])"»]*\s*|[^.!?…]+$/g) ?? [p];
    let buf = '';
    for (const s of sentences) {
      if (buf.length + s.length > max && buf) {
        pieces.push(buf.trim());
        buf = '';
      }
      if (s.length > max) {
        for (let i = 0; i < s.length; i += max) pieces.push(s.slice(i, i + max).trim());
      } else {
        buf += s;
      }
    }
    if (buf.trim()) pieces.push(buf.trim());
  }
  const chunks: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (!piece.trim()) continue;
    if (current && current.length + piece.length + 2 > target) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export function chunkDocument(doc: ExtractedDocument): Chunk[] {
  const chunks: Chunk[] = [];
  let order = 0;
  for (const unit of doc.units) {
    for (const text of splitText(unit.text)) {
      chunks.push({ docId: doc.id, docName: doc.name, kind: doc.kind, locator: { ...unit.locator }, text, order: order++ });
    }
  }
  return chunks;
}

// ─── BM25 ──────────────────────────────────────────────────────────────────

export interface ScoredChunk extends Chunk {
  score: number;
}

/** Morceau de requête avec son poids : le sujet compte plus que les consignes générales. */
export interface QueryPart {
  text: string;
  weight: number;
}

export interface RankOptions {
  /**
   * Ignorer dans la requête les mots pédagogiques génériques (« élèves », « savoir », « expliquer »…) : pour la
   * sélection des passages d'après une demande d'enseignant. Désactivé par défaut (recherche web, pipeline).
   */
  dropGenericQueryWords?: boolean;
}

/**
 * Classement BM25. `query` est un texte (tous les termes pèsent 1, comportement historique du pipeline et de la
 * recherche web) ou une liste de morceaux pondérés ; un terme présent dans plusieurs morceaux garde le plus fort poids.
 */
export function rankChunks(chunks: Chunk[], query: string | readonly QueryPart[], k1 = 1.4, b = 0.75, options: RankOptions = {}): ScoredChunk[] {
  const parts: readonly QueryPart[] = typeof query === 'string' ? [{ text: query, weight: 1 }] : query;
  const tokenized = parts.map(part => ({ tokens: tokenize(part.text), weight: part.weight }));
  // Mots génériques retirés, sauf si la requête n'est faite que de cela (sujet « Les exercices »).
  const dropGeneric = options.dropGenericQueryWords === true && tokenized.some(p => p.tokens.some(t => !QUERY_STOPWORDS.has(t)));
  const qWeights = new Map<string, number>();
  for (const { tokens, weight } of tokenized) {
    for (const t of tokens) {
      if (!(dropGeneric && QUERY_STOPWORDS.has(t))) qWeights.set(t, Math.max(qWeights.get(t) ?? 0, weight));
    }
  }
  const docsTokens = chunks.map(c => tokenize(c.text));
  const avgLen = docsTokens.reduce((n, t) => n + t.length, 0) / Math.max(1, docsTokens.length);
  const df = new Map<string, number>();
  for (const tokens of docsTokens) {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = chunks.length;
  return chunks.map((chunk, i) => {
    const tokens = docsTokens[i];
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const [q, weight] of qWeights) {
      const f = tf.get(q) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(q) ?? 0) + 0.5) / ((df.get(q) ?? 0) + 0.5));
      score += weight * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * tokens.length) / Math.max(1, avgLen))));
    }
    return { ...chunk, score };
  });
}

// ─── Sélection sous contrainte de taille ──────────────────────────────────

export interface SelectOptions {
  /** Nombre maximal de caractères de documents transmis au modèle. */
  budgetChars: number;
}

/**
 * Sélectionne les passages les plus utiles.
 * - Si tout tient dans le budget : les documents sont transmis intégralement (dans l'ordre).
 * - Sinon : meilleurs passages BM25, avec au moins un passage par document, puis regroupement
 *   des passages contigus (jusqu'à MAX_MERGED_PASSAGE_CHARS) pour produire des citations lisibles (« pages 14 à 15 »).
 */
export function selectPassages(docs: ExtractedDocument[], query: string | readonly QueryPart[], options: SelectOptions): DocumentPassage[] {
  const chunks = docs.flatMap(chunkDocument);
  if (chunks.length === 0) return [];
  // Chaque morceau coûte sa longueur + le séparateur « \n\n » éventuellement ajouté à la fusion :
  // la somme des passages renvoyés ne dépasse donc jamais le budget.
  const cost = (c: Chunk) => c.text.length + SEPARATOR.length;
  const total = chunks.reduce((n, c) => n + cost(c), 0) - SEPARATOR.length;
  let selected: Chunk[];

  if (total <= options.budgetChars) {
    selected = chunks;
  } else {
    const ranked = rankChunks(chunks, query, undefined, undefined, { dropGenericQueryWords: true }).sort((a, b) => b.score - a.score || a.order - b.order);
    const chosen = new Set<string>();
    const keyOf = (c: Chunk) => `${c.docId}\u0000${c.order}`;
    let used = 0;
    // 1) Le meilleur passage de chaque document (couverture).
    for (const doc of docs) {
      const best = ranked.find(c => c.docId === doc.id);
      if (best && used + cost(best) <= options.budgetChars) {
        chosen.add(keyOf(best));
        used += cost(best);
      }
    }
    // 2) Puis les meilleurs passages restants ; à score nul, l'ordre de lecture fait foi.
    for (const c of ranked) {
      if (chosen.has(keyOf(c))) continue;
      if (used + cost(c) > options.budgetChars) continue;
      chosen.add(keyOf(c));
      used += cost(c);
    }
    selected = chunks.filter(c => chosen.has(keyOf(c)));
  }

  // Citations précises d'abord ; si cela faisait plus d'extraits que le serveur n'en accepte (le surplus serait
  // écarté), on revient à des passages plus larges : rien du texte sélectionné n'est perdu.
  const fine = mergeAdjacent(selected);
  return fine.length <= REQUEST_LIMITS.maxPassages ? fine : mergeAdjacent(selected, COARSE_MERGED_PASSAGE_CHARS);
}

function contiguous(a: Locator, b: Locator): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'section') return a.start === b.start;
  return b.start <= a.end + 1;
}

/** Étend une localisation à la suivante (pages contiguës), numéros imprimés compris. */
function mergeLocators(a: Locator, b: Locator): Locator {
  if (b.end <= a.end) return a;
  const merged: Locator = { ...a, end: b.end };
  if (a.labels || b.labels) {
    merged.labels = { start: a.labels?.start ?? String(a.start), end: b.labels?.end ?? String(b.end) };
  }
  return merged;
}

/** Regroupe les morceaux voisins d'un même document en un seul passage citable. */
export function mergeAdjacent(chunks: Chunk[], maxChars = MAX_MERGED_PASSAGE_CHARS): DocumentPassage[] {
  // Les documents gardent l'ordre dans lequel ils ont été fournis ; dans un document, l'ordre de lecture.
  const rank = new Map<string, number>();
  for (const c of chunks) if (!rank.has(c.docId)) rank.set(c.docId, rank.size);
  const sorted = [...chunks].sort((a, b) => (a.docId === b.docId ? a.order - b.order : rank.get(a.docId)! - rank.get(b.docId)!));
  const passages: (DocumentPassage & { lastOrder: number })[] = [];
  for (const c of sorted) {
    const last = passages[passages.length - 1];
    if (last && last.docId === c.docId && c.order === last.lastOrder + 1 && contiguous(last.locator, c.locator) && last.text.length + SEPARATOR.length + c.text.length <= maxChars) {
      last.text += `${SEPARATOR}${c.text}`;
      last.locator = mergeLocators(last.locator, c.locator);
      last.lastOrder = c.order;
    } else {
      passages.push({ docId: c.docId, docName: c.docName, kind: c.kind, locator: { ...c.locator }, text: c.text, lastOrder: c.order });
    }
  }
  return passages.map(({ lastOrder: _lastOrder, ...p }) => p);
}
