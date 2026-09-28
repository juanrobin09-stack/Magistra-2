// Récupération dynamique de connaissances : question → recherche → vraies sources → extraits → modèle.
// Aucun réentraînement : le modèle reçoit des extraits récents et vérifiables à chaque génération.

import { rankChunks, splitText } from '../documents/retrieve.js';
import type { LevelGroup } from '../levels.js';
import type { ResearchMode } from '../types.js';
import {
  INSTITUTIONAL_SITES, isInstitutionalUrl, NO_ABSTRACT_TEXT, searchCrossref, searchHal, searchSearxng, searchWikipedia, stripTags,
} from './providers.js';
import type { ResearchConfig, ResearchDeps, ResearchOutcome, ResearchSource, ResearchWarning } from './types.js';

export * from './types.js';

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
 * Sources consultées selon le mode et le niveau :
 * - « Mes documents » : aucune recherche (hors ligne) ;
 * - « Sources académiques » : HAL puis Crossref ;
 * - « Internet » / « Documents + Internet » :
 *   - supérieur : HAL > Crossref > web (SearXNG) > Wikipédia ;
 *   - scolaire : sources institutionnelles (Éduscol, education.gouv.fr via SearXNG) > web > Wikipédia.
 */
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

export function planResearch(mode: ResearchMode, group: LevelGroup): ResearchPlan {
  const university = UNIVERSITY.includes(group);
  if (mode === 'documents') return { academic: false, institutional: false, web: false, wikipedia: false };
  if (mode === 'academic') return { academic: true, institutional: false, web: false, wikipedia: false };
  // Internet (avec ou sans documents)
  return university
    ? { academic: true, institutional: false, web: true, wikipedia: true }
    : { academic: false, institutional: true, web: true, wikipedia: true };
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

  // 1. Académique : HAL puis Crossref (priorité université).
  const academicTask = plan.academic && config.academic
    ? Promise.allSettled([
        track(searchHal(topic, deps, { rows: 4, timeoutMs: t, signal: options.signal })),
        track(searchCrossref(q, deps, { rows: 4, timeoutMs: t, mailto: config.crossrefMailto, signal: options.signal })),
      ]).then(([hal, crossref]) => {
        const ok = [hal, crossref].filter((r): r is PromiseFulfilledResult<ResearchSource[]> => r.status === 'fulfilled');
        if (ok.length === 0) warnings.push({ code: 'ACADEMIC_UNAVAILABLE', message: 'Recherche académique indisponible (HAL et Crossref injoignables).' });
        const halSources = hal.status === 'fulfilled' ? withAbstractsFirst(hal.value) : [];
        const crossrefSources = crossref.status === 'fulfilled' ? withAbstractsFirst(crossref.value) : [];
        return [...halSources, ...crossrefSources];
      })
    : Promise.resolve<ResearchSource[]>([]);
  if (plan.academic && !config.academic) {
    warnings.push({ code: 'ACADEMIC_UNAVAILABLE', message: 'Recherche académique désactivée dans les réglages.' });
  }

  // 2. Sources institutionnelles (scolaire) et web général, via SearXNG si configuré.
  let webTask: Promise<ResearchSource[]> = Promise.resolve([]);
  if (plan.institutional || plan.web) {
    if (!config.searxngUrl) {
      if (plan.institutional) {
        warnings.push({ code: 'INSTITUTIONAL_UNAVAILABLE', message: 'Sources institutionnelles (Éduscol, BO) indisponibles : aucun serveur de recherche web (SearXNG) configuré.' });
      }
    } else {
      const base = config.searxngUrl;
      webTask = (async (): Promise<ResearchSource[]> => {
        const queries = [
          ...(plan.institutional ? INSTITUTIONAL_SITES.map(site => `${q} site:${site}`) : []),
          ...(plan.web ? [q] : []),
        ];
        const settled = await Promise.allSettled(queries.map(qq => track(searchSearxng(base, qq, deps, { max: 4, timeoutMs: t, signal: options.signal }))));
        if (settled.every(r => r.status === 'rejected')) {
          warnings.push({ code: 'RESEARCH_UNAVAILABLE', message: 'Recherche Internet indisponible (serveur SearXNG injoignable).' });
          return [];
        }
        const results = settled.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
        // Institutionnel d'abord, puis le reste ; dédoublonnage par URL.
        const seen = new Set<string>();
        const ordered = [...results.filter(r => isInstitutionalUrl(r.url!)), ...results.filter(r => !isInstitutionalUrl(r.url!))]
          .filter(r => {
            const key = normalizeUrl(r.url!);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 4);
        const pages = await Promise.all(ordered.map(async r => {
          let text = stripTags(r.content ?? '');
          let title = (r.title ?? '').trim() || r.url!;
          if (deps.fetchPage) {
            try {
              const page = await boundedFetchPage(deps.fetchPage, r.url!, config.timeoutMs * 2, options.signal);
              if (page?.text && page.text.length > text.length) {
                text = page.text;
                title = (r.title ?? '').trim() || page.title || title;
              }
            } catch {
              // on garde l'extrait fourni par le moteur de recherche
            }
          }
          const source: ResearchSource = {
            kind: isInstitutionalUrl(r.url!) ? 'institutional' : 'web',
            title,
            url: r.url,
            text,
          };
          return source;
        }));
        return pages.filter(p => p.text.trim().length > 40);
      })();
    }
  }

  // 3. Wikipédia (complément général, sans configuration).
  const wikiTask = plan.wikipedia && config.wikipedia
    ? track(searchWikipedia(topic, deps, { max: 2, timeoutMs: t, signal: options.signal })).catch(() => {
        warnings.push({ code: 'RESEARCH_UNAVAILABLE', message: 'Wikipédia injoignable.' });
        return [] as ResearchSource[];
      })
    : Promise.resolve<ResearchSource[]>([]);

  // Ordre de priorité : académique > institutionnel / web > Wikipédia.
  const [academic, web, wiki] = await Promise.all([academicTask, webTask.catch(() => []), wikiTask]);
  let sources = dedupe([...academic, ...web, ...wiki]).filter(s => s.text.trim().length > 0);

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
