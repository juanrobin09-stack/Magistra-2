// Connecteurs de recherche : HAL, Crossref, SearXNG, Wikipédia.
// Chaque connecteur renvoie des sources réelles avec leurs métadonnées d'origine.

import type { ResearchDeps, ResearchSource } from './types.js';

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function getJson<T>(deps: ResearchDeps, url: string, signal: AbortSignal | undefined, timeoutMs: number): Promise<T> {
  const res = await deps.fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Magistra/2.0 (outil pedagogique open source)' },
    signal: withTimeout(signal, timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

function safeCodePoint(cp: number): string {
  try {
    return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : '';
  } catch {
    return '';
  }
}

/** Balises dont le contenu n'est jamais du texte utile (menus, scripts, formulaires…). */
const SKIP_CONTENT_TAGS = new Set(['script', 'style', 'noscript', 'svg', 'nav', 'footer', 'header', 'aside', 'form', 'template', 'iframe']);
/** Balises de fin de bloc remplacées par un retour à la ligne. */
const BLOCK_END_TAGS = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'section', 'article']);
/** Taille maximale de HTML traitée (au-delà, la fin est ignorée). */
export const MAX_HTML_CHARS = 2_000_000;

/**
 * Extrait le texte d'un fragment HTML, en temps linéaire quelle que soit l'entrée
 * (aucune expression régulière à retour arrière : une page piégée contenant des milliers de
 * balises <nav> jamais refermées ne peut pas bloquer le serveur).
 */
export function stripTags(input: string): string {
  const html = input.length > MAX_HTML_CHARS ? input.slice(0, MAX_HTML_CHARS) : input;
  const lower = html.toLowerCase();
  const nameRe = /[a-z][a-z0-9-]*/y;
  const out: string[] = [];

  // Caches : les positions demandées sont croissantes, chaque recherche reprend là où la précédente s'est arrêtée.
  let gtFrom = -1;
  let gtAt = -1;
  const nextGt = (from: number): number => {
    if (gtFrom !== -1 && from >= gtFrom && (gtAt === -1 || from <= gtAt)) return gtAt;
    gtFrom = from;
    gtAt = html.indexOf('>', from);
    return gtAt;
  };
  const closeCache = new Map<string, { from: number; at: number }>();
  const nextClose = (name: string, from: number): number => {
    const cached = closeCache.get(name);
    if (cached && from >= cached.from && (cached.at === -1 || from <= cached.at)) return cached.at;
    let at = lower.indexOf(`</${name}`, from);
    // « </navbar » ne ferme pas « <nav> ».
    while (at !== -1 && /[a-z0-9-]/.test(lower[at + 2 + name.length] ?? '')) at = lower.indexOf(`</${name}`, at + 1);
    closeCache.set(name, { from, at });
    return at;
  };

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      out.push(html.slice(i));
      break;
    }
    if (lt > i) out.push(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      if (end === -1) break; // commentaire jamais refermé : le reste est ignoré
      out.push(' ');
      i = end + 3;
      continue;
    }
    const next = html[lt + 1] ?? '';
    const closing = next === '/';
    nameRe.lastIndex = lt + (closing ? 2 : 1);
    const match = nameRe.exec(lower);
    if (!match && next !== '!' && next !== '?') {
      // « a < b » : un chevron isolé est du texte.
      out.push('<');
      i = lt + 1;
      continue;
    }
    const gt = nextGt(lt + 1);
    if (gt === -1) break; // balise tronquée en fin de document
    const name = match?.[0] ?? '';
    i = gt + 1;
    if (!closing && SKIP_CONTENT_TAGS.has(name) && html[gt - 1] !== '/') {
      const close = nextClose(name, i);
      if (close !== -1) {
        const closeGt = nextGt(close);
        i = closeGt === -1 ? html.length : closeGt + 1;
        out.push(' ');
        continue;
      }
    }
    out.push(name === 'br' || (closing && BLOCK_END_TAGS.has(name)) ? '\n' : ' ');
  }

  return out.join('')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]{1,8});/gi, (_, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d{1,10});/g, (_, d: string) => safeCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&')
    .replace(/[ \t\u00a0]+/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function first<T>(value: T | T[] | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Texte transmis au modèle pour une référence dont seul le signalement bibliographique est connu. */
export const NO_ABSTRACT_TEXT =
  'Résumé non disponible : seules les métadonnées bibliographiques (titre, auteurs, année, revue) sont connues. '
  + "N'attribue à cette publication aucun contenu précis ; mentionne-la seulement comme lecture complémentaire.";

/**
 * Neutralise la syntaxe de requête Solr (HAL) : une apostrophe, un « : » ou un « C++ » dans le sujet
 * ne doivent pas provoquer d'erreur de syntaxe côté serveur.
 */
export function toPlainQuery(query: string): string {
  return query
    .replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ')
    .replace(/\b(AND|OR|NOT|TO)\b/g, m => m.toLowerCase())
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── HAL (archive ouverte française) ────────────────────────────────────────

interface HalDoc {
  title_s?: string[] | string;
  authFullName_s?: string[];
  producedDateY_i?: number;
  doiId_s?: string;
  uri_s?: string;
  abstract_s?: string[] | string;
  journalTitle_s?: string;
  bookTitle_s?: string;
}

export async function searchHal(query: string, deps: ResearchDeps, opts: { rows: number; timeoutMs: number; signal?: AbortSignal }): Promise<ResearchSource[]> {
  const params = new URLSearchParams({
    q: toPlainQuery(query) || '*',
    wt: 'json',
    rows: String(opts.rows),
    fl: 'title_s,authFullName_s,producedDateY_i,doiId_s,uri_s,abstract_s,journalTitle_s,bookTitle_s',
    fq: 'docType_s:(ART OR COUV OR OUV OR THESE OR COMM OR DOUV)',
  });
  const data = await getJson<{ response?: { docs?: HalDoc[] } }>(deps, `https://api.archives-ouvertes.fr/search/?${params}`, opts.signal, opts.timeoutMs);
  const docs = data.response?.docs;
  return (Array.isArray(docs) ? docs : [])
    .map((d): ResearchSource | null => {
      const title = first(d.title_s);
      if (!title) return null;
      const abstract = first(d.abstract_s);
      return {
        kind: 'hal',
        title: stripTags(title),
        authors: Array.isArray(d.authFullName_s) ? d.authFullName_s.slice(0, 8) : undefined,
        year: typeof d.producedDateY_i === 'number' ? d.producedDateY_i : undefined,
        venue: d.journalTitle_s ?? d.bookTitle_s,
        doi: d.doiId_s || undefined,
        url: d.uri_s,
        text: abstract ? clip(stripTags(abstract), 2_000) : NO_ABSTRACT_TEXT,
      };
    })
    .filter((s): s is ResearchSource => s !== null);
}

// ─── Crossref ───────────────────────────────────────────────────────────────

interface CrossrefItem {
  DOI?: string;
  title?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  issued?: { 'date-parts'?: number[][] };
  'container-title'?: string[];
  abstract?: string;
  URL?: string;
}

export async function searchCrossref(
  query: string,
  deps: ResearchDeps,
  opts: { rows: number; timeoutMs: number; mailto?: string; signal?: AbortSignal },
): Promise<ResearchSource[]> {
  const params = new URLSearchParams({
    'query.bibliographic': query,
    rows: String(opts.rows),
    select: 'DOI,title,author,issued,container-title,abstract,URL',
    filter: 'type:journal-article,type:book-chapter,type:book,type:proceedings-article',
  });
  if (opts.mailto) params.set('mailto', opts.mailto);
  const data = await getJson<{ message?: { items?: CrossrefItem[] } }>(deps, `https://api.crossref.org/works?${params}`, opts.signal, opts.timeoutMs);
  const items = data.message?.items;
  return (Array.isArray(items) ? items : [])
    .map((it): ResearchSource | null => {
      const title = first(it.title);
      if (!title || !it.DOI) return null;
      const authors = (it.author ?? [])
        .map(a => a.name ?? [a.given, a.family].filter(Boolean).join(' '))
        .filter(Boolean)
        .slice(0, 8);
      const year = it.issued?.['date-parts']?.[0]?.[0];
      return {
        kind: 'crossref',
        title: stripTags(title),
        authors,
        year: typeof year === 'number' && Number.isFinite(year) ? year : undefined,
        venue: first(it['container-title']),
        doi: it.DOI,
        url: it.URL ?? `https://doi.org/${it.DOI}`,
        text: it.abstract ? clip(stripTags(it.abstract), 2_000) : NO_ABSTRACT_TEXT,
      };
    })
    .filter((s): s is ResearchSource => s !== null);
}

// ─── SearXNG (recherche web configurable) ───────────────────────────────────

interface SearxResult {
  url?: string;
  title?: string;
  content?: string;
}

export async function searchSearxng(
  baseUrl: string,
  query: string,
  deps: ResearchDeps,
  opts: { max: number; timeoutMs: number; signal?: AbortSignal },
): Promise<SearxResult[]> {
  const params = new URLSearchParams({ q: query, format: 'json', language: 'fr', safesearch: '1' });
  const data = await getJson<{ results?: SearxResult[] }>(deps, `${baseUrl.replace(/\/+$/, '')}/search?${params}`, opts.signal, opts.timeoutMs);
  const results = Array.isArray(data.results) ? data.results : [];
  return results
    .filter(r => typeof r?.url === 'string' && /^https?:\/\//i.test(r.url) && typeof r.title === 'string' && r.title.trim())
    .slice(0, opts.max);
}

// ─── Wikipédia (français) ───────────────────────────────────────────────────

export async function searchWikipedia(query: string, deps: ResearchDeps, opts: { max: number; timeoutMs: number; signal?: AbortSignal }): Promise<ResearchSource[]> {
  const search = new URLSearchParams({
    action: 'query', list: 'search', srsearch: query, srlimit: String(opts.max), format: 'json', origin: '*',
  });
  const found = await getJson<{ query?: { search?: { pageid: number; title: string }[] } }>(
    deps, `https://fr.wikipedia.org/w/api.php?${search}`, opts.signal, opts.timeoutMs,
  );
  const hits = found.query?.search;
  const pages = Array.isArray(hits) ? hits.filter(h => typeof h?.pageid === 'number') : [];
  const out: ResearchSource[] = [];
  for (const page of pages) {
    const params = new URLSearchParams({
      action: 'query', prop: 'extracts|info', inprop: 'url', explaintext: '1', exsectionformat: 'plain',
      pageids: String(page.pageid), format: 'json', origin: '*',
    });
    try {
      const data = await getJson<{ query?: { pages?: Record<string, { title?: string; extract?: string; fullurl?: string }> } }>(
        deps, `https://fr.wikipedia.org/w/api.php?${params}`, opts.signal, opts.timeoutMs,
      );
      const p = data.query?.pages?.[String(page.pageid)];
      if (typeof p?.extract === 'string' && p.extract.trim()) {
        out.push({
          kind: 'wikipedia',
          title: p.title ?? page.title,
          venue: 'Wikipédia',
          url: p.fullurl ?? `https://fr.wikipedia.org/?curid=${page.pageid}`,
          text: p.extract.slice(0, 60_000),
        });
      }
    } catch {
      // une page en échec n'empêche pas les autres
    }
  }
  return out;
}

export const INSTITUTIONAL_SITES = ['eduscol.education.fr', 'education.gouv.fr'];

export function isInstitutionalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return INSTITUTIONAL_SITES.some(site => host === site || host.endsWith(`.${site}`)) || host.endsWith('.gouv.fr');
  } catch {
    return false;
  }
}
