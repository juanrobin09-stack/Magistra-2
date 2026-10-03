// Récupération dynamique de connaissances : question → recherche → vraies sources → extraits → modèle.
// Aucun réentraînement : le modèle reçoit des extraits récents et vérifiables à chaque génération.

import { rankChunks, splitText } from '../documents/retrieve.js';
import type { LevelGroup } from '../levels.js';
import type { ResearchMode } from '../types.js';
import {
  NO_ABSTRACT_TEXT, readWikipediaPages, searchCrossref, searchHal, searchOpenAlex, searchSearxng, searchWikipediaPages, stripTags,
  wikipediaExternalLinks, type WikipediaPage,
} from './providers.js';
import { isTrustedHttpsUrl, selectTrustedLinks, trustedPriority, trustedSearchGroups, trustedSiteFor } from './trusted.js';
import type { FetchedPage, ResearchConfig, ResearchDeps, ResearchOutcome, ResearchSource, ResearchWarning } from './types.js';

export * from './types.js';

/** Aucun chemin vers les sites vérifiés (ni moteur de recherche web, ni Wikipédia avec récupération de pages). */
export const OFFICIAL_UNAVAILABLE_MESSAGE =
  'Sites officiels (Éduscol, UNESCO, ministères…) non consultés. Ajoutez vos documents officiels (programmes, textes) pour les utiliser.';
/** Un chemin a répondu, mais aucune page des sites vérifiés ne correspond au sujet. */
export const NO_OFFICIAL_FOUND_MESSAGE = 'Aucune source officielle trouvée pour ce sujet : à vérifier.';

const UNIVERSITY: LevelGroup[] = ['bts_but', 'cpge', 'licence', 'master', 'doctorat'];

export interface ResearchQuery {
  /** Texte de recherche (sujet, discipline, mots-clés). Les documents de l'enseignant ne sont jamais envoyés. */
  text: string;
  /**
   * Sujet seul, plus court (facultatif) : utilisé pour HAL et Wikipédia, dont la recherche exige
   * la présence de tous les mots. À défaut, `text` est utilisé.
   */
  topic?: string;
  mode: ResearchMode;
  group: LevelGroup;
}

export interface ResearchPlan {
  academic: boolean;
  institutional: boolean;
  web: boolean;
  wikipedia: boolean;
}

/**
 * Récupération d'une page, bornée dans le temps quoi qu'il arrive (défense en profondeur :
 * une page lente ou un flux bloqué ne peut jamais suspendre la génération).
 */
function boundedFetchPage(
  fetchPage: NonNullable<ResearchDeps['fetchPage']>,
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Awaited<ReturnType<NonNullable<ResearchDeps['fetchPage']>>>> {
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('recherche interrompue'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    fetchPage(url, combined).then(
      page => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(page);
      },
      err => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

/**
 * Sources consultées selon le mode et le niveau :
 * - « Mes documents » : aucune recherche (hors ligne) ;
 * - « Sources académiques » : HAL, Crossref et OpenAlex, puis les sites vérifiés ;
 * - « Internet » / « Documents + Internet » :
 *   - supérieur : HAL, Crossref et OpenAlex > sites vérifiés > Wikipédia ;
 *   - scolaire : sites vérifiés (Éduscol, UNESCO, ministères…) > Wikipédia.
 * Les sites vérifiés (`institutional`) sont interrogés par SearXNG (requêtes « site: ») ou, sans lui, par les références
 * de Wikipédia. `web` (web général) n'est consulté que si l'administrateur a levé la restriction `trustedOnly`.
 */
export function planResearch(mode: ResearchMode, group: LevelGroup): ResearchPlan {
  const university = UNIVERSITY.includes(group);
  if (mode === 'documents') return { academic: false, institutional: false, web: false, wikipedia: false };
  if (mode === 'academic') return { academic: true, institutional: true, web: false, wikipedia: false };
  // Internet (avec ou sans documents)
  return { academic: university, institutional: true, web: true, wikipedia: true };
}

/**
 * Chemin vers les sites vérifiés : SearXNG (requêtes « site: » sur tout le catalogue) ; à défaut, les références de
 * Wikipédia, dont les pages sont récupérées avec `fetchPage` (absente dans le navigateur) ; sinon aucun.
 */
export function officialSitesPath(
  config: Pick<ResearchConfig, 'searxngUrl' | 'wikipedia'>,
  deps: Pick<ResearchDeps, 'fetchPage'>,
): 'searxng' | 'wikipedia' | null {
  if (config.searxngUrl) return 'searxng';
  return config.wikipedia && deps.fetchPage ? 'wikipedia' : null;
}

/** Ne garde que les passages d'une source longue les plus pertinents pour la question. */
function focusText(text: string, query: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 0) return '';
  const chunks = splitText(text, 900, 1_300).map((t, i) => ({ docId: 'x', docName: 'x', kind: 'txt' as const, locator: { type: 'lines' as const, start: i, end: i }, text: t, order: i }));
  const ranked = rankChunks(chunks, query).sort((a, b) => b.score - a.score || a.order - b.order);
  const picked: typeof ranked = [];
  let used = 0;
  for (const c of ranked) {
    if (used + c.text.length > maxChars) continue;
    picked.push(c);
    used += c.text.length;
  }
  if (picked.length === 0) {
    // Aucun passage entier ne tient : début du passage le plus pertinent, coupé proprement.
    const best = ranked[0]?.text ?? text;
    const slice = best.slice(0, Math.max(0, maxChars - 2));
    const cut = slice.lastIndexOf('. ');
    return `${cut > maxChars * 0.5 ? slice.slice(0, cut + 1) : slice}…`;
  }
  return picked.sort((a, b) => a.order - b.order).map(c => c.text).join('\n[…]\n');
}

function normalizeTitle(title: string): string {
  return title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[#?].*$/, '').replace(/\/+$/, '');
}

/** Rang de lecture d'une adresse : éducation, organisations internationales, recherche, reste du catalogue ; 5 hors catalogue. */
function trustRank(url: string): number {
  const site = trustedSiteFor(url);
  return site ? trustedPriority(site) : 5;
}

/** Redirection hors du catalogue : sous la restriction aux sites vérifiés, l'adresse finale de la page doit en faire partie (https). */
function leftCatalogue(page: FetchedPage, trustedOnly: boolean): boolean {
  return trustedOnly && !isTrustedHttpsUrl(page.url);
}

/** Dédoublonne par DOI, URL ou titre : la première occurrence (la plus prioritaire) est conservée. */
function dedupe(sources: ResearchSource[]): ResearchSource[] {
  const seen = new Set<string>();
  return sources.filter(s => {
    const keys = [
      s.doi ? `doi:${s.doi.trim().toLowerCase()}` : null,
      s.url ? `url:${normalizeUrl(s.url)}` : null,
      normalizeTitle(s.title).length >= 12 ? `title:${normalizeTitle(s.title)}` : null,
    ].filter((k): k is string => k !== null);
    if (keys.some(k => seen.has(k))) return false;
    for (const k of keys) seen.add(k);
    return true;
  });
}

/** Les références avec résumé d'abord (plus utiles au modèle), sans changer l'ordre de priorité des connecteurs. */
function withAbstractsFirst(sources: ResearchSource[]): ResearchSource[] {
  const hasAbstract = (s: ResearchSource) => s.text !== NO_ABSTRACT_TEXT && s.text.length > 120;
  return [...sources.filter(hasAbstract), ...sources.filter(s => !hasAbstract(s))];
}

export async function runResearch(
  query: ResearchQuery,
  config: ResearchConfig,
  deps: ResearchDeps,
  options: { budgetChars: number; signal?: AbortSignal },
): Promise<ResearchOutcome> {
  const plan = planResearch(query.mode, query.group);
  const warnings: ResearchWarning[] = [];
  const q = query.text.replace(/\s+/g, ' ').trim().slice(0, 300);
  const topic = (query.topic ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || q;
  if (!q || (!plan.academic && !plan.web && !plan.institutional && !plan.wikipedia)) {
    return { sources: [], internetUsed: false, warnings };
  }
  const t = config.timeoutMs;
  // Bilan des appels réseau, pour un avertissement unique et clair quand Internet est inaccessible.
  let attempted = 0;
  let failed = 0;
  const track = async <T>(promise: Promise<T>): Promise<T> => {
    attempted++;
    try {
      return await promise;
    } catch (err) {
      failed++;
      throw err;
    }
  };

  // Sous la restriction aux sites vérifiés (défaut), rien d'autre que le catalogue n'est retenu.
  const trustedOnly = config.trustedOnly !== false;

  // 1. Académique : HAL, Crossref puis OpenAlex.
  const academicTask = plan.academic && config.academic
    ? Promise.allSettled([
        track(searchHal(topic, deps, { rows: 3, timeoutMs: t, signal: options.signal })),
        track(searchCrossref(q, deps, { rows: 3, timeoutMs: t, mailto: config.crossrefMailto, signal: options.signal })),
        track(searchOpenAlex(topic, deps, { rows: 3, timeoutMs: t, mailto: config.crossrefMailto, signal: options.signal })),
      ]).then(results => {
        if (results.every(r => r.status === 'rejected')) {
          warnings.push({ code: 'ACADEMIC_UNAVAILABLE', message: 'Recherche académique indisponible (HAL, Crossref et OpenAlex injoignables).' });
        }
        return results.flatMap(r => (r.status === 'fulfilled' ? withAbstractsFirst(r.value) : []));
      })
    : Promise.resolve<ResearchSource[]>([]);
  if (plan.academic && !config.academic) {
    warnings.push({ code: 'ACADEMIC_UNAVAILABLE', message: 'Recherche académique désactivée dans les réglages.' });
  }

  // 2. Sites vérifiés : par SearXNG (requêtes « site: » sur tout le catalogue) ou, sans lui, par les références de Wikipédia.
  const officialPath = officialSitesPath(config, deps);
  const viaSearx = officialPath === 'searxng';
  const viaWikipedia = officialPath === 'wikipedia';
  if (plan.institutional && !officialPath) {
    warnings.push({ code: 'INSTITUTIONAL_UNAVAILABLE', message: OFFICIAL_UNAVAILABLE_MESSAGE });
  }
  // Vrai dès qu'un chemin vers les sites vérifiés a répondu : « aucune source officielle » n'a de sens qu'alors.
  let officialResponded = false;

  let webTask: Promise<ResearchSource[]> = Promise.resolve([]);
  if (viaSearx && (plan.institutional || (plan.web && !trustedOnly))) {
    const base = config.searxngUrl!;
    webTask = (async (): Promise<ResearchSource[]> => {
      const queries = [
        ...(plan.institutional ? trustedSearchGroups().map(group => `${q} (${group.map(domain => `site:${domain}`).join(' OR ')})`) : []),
        // Le web général n'est jamais interrogé sous la restriction aux sites vérifiés.
        ...(plan.web && !trustedOnly ? [q] : []),
      ];
      const settled = await Promise.allSettled(queries.map(qq => track(searchSearxng(base, qq, deps, { max: 4, timeoutMs: t, signal: options.signal }))));
      if (settled.every(r => r.status === 'rejected')) {
        warnings.push({ code: 'RESEARCH_UNAVAILABLE', message: 'Recherche Internet indisponible (serveur SearXNG injoignable).' });
        return [];
      }
      officialResponded = true;
      const results = settled.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
      // Sites vérifiés d'abord (éducation, organisations internationales, recherche, le reste), puis le reste ; dédoublonnage par URL.
      const seen = new Set<string>();
      const ordered = results
        .filter(r => !trustedOnly || isTrustedHttpsUrl(r.url!))
        .sort((a, b) => trustRank(a.url!) - trustRank(b.url!))
        .filter(r => {
          const key = normalizeUrl(r.url!);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 4);
      const pages = await Promise.all(ordered.map(async (r): Promise<ResearchSource | null> => {
        let text = stripTags(r.content ?? '');
        let title = (r.title ?? '').trim() || r.url!;
        if (deps.fetchPage) {
          try {
            const page = await boundedFetchPage(deps.fetchPage, r.url!, config.timeoutMs * 2, options.signal);
            // Redirection hors du catalogue : la page est écartée.
            if (page && leftCatalogue(page, trustedOnly)) return null;
            if (page?.text && page.text.length > text.length) {
              text = page.text;
              title = (r.title ?? '').trim() || page.title || title;
            }
          } catch {
            // on garde l'extrait fourni par le moteur de recherche
          }
        }
        // Officielle seulement si le site est du catalogue ET servi en https ; sinon « web » (restriction levée).
        const site = isTrustedHttpsUrl(r.url!) ? trustedSiteFor(r.url!) : null;
        return { kind: site ? 'institutional' : 'web', title, ...(site ? { venue: site.label } : {}), url: r.url, text };
      }));
      return pages.filter((p): p is ResearchSource => p !== null && p.text.trim().length > 40);
    })();
  }

  // 3. Wikipédia : encyclopédie (complément signalé) et, sans SearXNG, références vers les sites vérifiés.
  const wikiPagesTask: Promise<WikipediaPage[] | null> = config.wikipedia && (plan.wikipedia || (plan.institutional && viaWikipedia))
    ? track(searchWikipediaPages(topic, deps, { max: 2, timeoutMs: t, signal: options.signal })).catch(() => {
        warnings.push({
          code: 'RESEARCH_UNAVAILABLE',
          message: plan.wikipedia ? 'Wikipédia injoignable.' : 'Sites officiels non consultés : Wikipédia, qui indique où les trouver, est injoignable.',
        });
        return null;
      })
    : Promise.resolve(null);
  const wikiTask = plan.wikipedia && config.wikipedia
    ? wikiPagesTask.then(pages => (pages ? readWikipediaPages(pages, deps, { timeoutMs: t, signal: options.signal }) : []))
    : Promise.resolve<ResearchSource[]>([]);
  const officialViaWikipediaTask = plan.institutional && viaWikipedia
    ? wikiPagesTask.then(async (pages): Promise<ResearchSource[]> => {
        if (!pages) return [];
        officialResponded = true;
        // Liens externes des pages trouvées (une requête par page), puis au plus 3 pages des sites vérifiés.
        const linkSets = await Promise.allSettled(pages.map(page => track(wikipediaExternalLinks(page.pageId, deps, { timeoutMs: t, signal: options.signal }))));
        const links = selectTrustedLinks(linkSets.flatMap(r => (r.status === 'fulfilled' ? r.value : [])), 3);
        const found = await Promise.all(links.map(async ({ url }): Promise<ResearchSource | null> => {
          try {
            const page = await boundedFetchPage(deps.fetchPage!, url, config.timeoutMs * 2, options.signal);
            if (!page || page.text.trim().length <= 40 || leftCatalogue(page, trustedOnly)) return null;
            const site = isTrustedHttpsUrl(page.url) ? trustedSiteFor(page.url) : null;
            return { kind: site ? 'institutional' : 'web', title: page.title?.trim() || new URL(page.url).hostname, ...(site ? { venue: site.label } : {}), url: page.url, text: page.text };
          } catch {
            return null;
          }
        }));
        return found.filter((s): s is ResearchSource => s !== null);
      })
    : Promise.resolve<ResearchSource[]>([]);

  // Ordre de priorité : académique > sites vérifiés > Wikipédia.
  const [academic, web, official, wiki] = await Promise.all([academicTask, webTask.catch(() => []), officialViaWikipediaTask.catch(() => []), wikiTask]);
  const officialFound = [...web, ...official].some(s => s.kind === 'institutional');
  let sources = dedupe([...academic, ...web, ...official, ...wiki]).filter(s => s.text.trim().length > 0);

  // Répartition du budget : chaque source reçoit une part, recentrée sur la question.
  if (sources.length) {
    const budget = Math.max(0, options.budgetChars);
    const perSource = Math.max(Math.min(600, budget), Math.floor(budget / sources.length));
    sources = sources.map(s => ({ ...s, text: focusText(s.text, q, perSource) }));
    let used = 0;
    sources = sources.filter(s => {
      const cost = s.text.length;
      if (cost === 0 || used + cost > budget) return false;
      used += cost;
      return true;
    });
  }

  if (plan.institutional && officialResponded && !officialFound) {
    warnings.push({ code: 'INSTITUTIONAL_UNAVAILABLE', message: NO_OFFICIAL_FOUND_MESSAGE });
  }
  if (attempted > 0 && failed === attempted) {
    // Aucun appel réseau n'a abouti : un seul message clair, la génération continue.
    const keep = warnings.filter(w => w.code === 'INSTITUTIONAL_UNAVAILABLE' || w.message.includes('désactivée'));
    warnings.length = 0;
    warnings.push(...keep, {
      code: 'RESEARCH_UNAVAILABLE',
      message: 'Pas de connexion Internet (ou services de recherche injoignables) : la génération continue à partir de vos documents et des connaissances générales du modèle.',
    });
  } else if (sources.length === 0 && (plan.web || plan.academic) && !warnings.some(w => w.code === 'RESEARCH_UNAVAILABLE' || w.code === 'ACADEMIC_UNAVAILABLE')) {
    warnings.push({ code: 'RESEARCH_UNAVAILABLE', message: 'Aucune source en ligne pertinente trouvée : génération à partir des autres sources.' });
  }
  return { sources, internetUsed: sources.length > 0, warnings };
}
