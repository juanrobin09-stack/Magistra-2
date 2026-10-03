#!/usr/bin/env node
// Vérification RÉELLE des services de recherche de Magistra, sur un poste (outil du mainteneur : jamais lancé en CI).
//
// Chaque service est interrogé UNE fois avec le VRAI code de Magistra : shared/research (connecteurs, catalogue des sites
// vérifiés, chemin par les références de Wikipédia) et server/safeFetch.ts (récupération des pages), compilés à la volée
// par esbuild dans un dossier temporaire, comme scripts/real-ai-check.mjs. Aucune dépendance.
//
//   1. HAL, 2. Crossref, 3. OpenAlex : une recherche, la forme de la réponse, un exemple ;
//   4. Wikipédia : pages trouvées, extrait, puis liens externes (références) et ceux qui sont dans le catalogue ;
//   5. sites officiels vérifiés par les références de Wikipédia : le chemin complet, jusqu'aux pages récupérées ;
//   6. SearXNG, seulement avec --searxng ou SEARXNG_URL : les requêtes « site: » sur les principaux sites du catalogue (36
//      domaines : les sites des académies, HAL, OpenAlex, Crossref… sont reconnus mais pas interrogés) ;
//   7. avec --catalogue : chaque domaine du catalogue existe-t-il (DNS) ?
//
// Pour chaque service : état, nombre de résultats, un exemple (titre, année, revue, DOI, fiabilité) et durée. La forme de
// la réponse est comparée à celle que le code attend : un champ absent de TOUS les résultats est signalé (dérive de
// l'API). Code de sortie : 0 si tout répond, 1 si un service échoue, 2 si les options sont invalides.
//
// Usage :
//   npm run research:check
//   npm run research:check -- --query "révolution française" --searxng https://searx.mon-etablissement.fr
//   SEARXNG_URL=http://127.0.0.1:8080 npm run research:check
//
// Options (la ligne de commande l'emporte sur les variables) :
//   --query <sujet>      sujet de la recherche (défaut « photosynthèse »)
//   --searxng <adresse>  instance SearXNG (SEARXNG_URL) : https, ou http sur la boucle locale seulement
//   --mailto <adresse>   contact transmis à Crossref et OpenAlex (CROSSREF_MAILTO), facultatif
//   --timeout-s <n>      délai de chaque requête, en secondes (défaut 20)
//   --catalogue          vérifie aussi que chaque domaine du catalogue existe (DNS)
//   --help               affiche cette aide

import { build } from 'esbuild';
import { lookup } from 'node:dns/promises';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainModule } from './mainModule.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULTS = Object.freeze({ query: 'photosynthèse', timeoutS: 20 });

export const USAGE = [
  'Usage : npm run research:check -- [--query <sujet>] [--searxng <adresse>] [--mailto <adresse>] [--timeout-s <n>] [--catalogue]',
  `  --query <sujet>      sujet de la recherche (défaut « ${DEFAULTS.query} »)`,
  '  --searxng <adresse>  instance SearXNG (SEARXNG_URL) : https, ou http sur la boucle locale seulement',
  '  --mailto <adresse>   contact transmis à Crossref et OpenAlex (CROSSREF_MAILTO), facultatif',
  `  --timeout-s <n>      délai de chaque requête, en secondes (défaut ${DEFAULTS.timeoutS})`,
  '  --catalogue          vérifie aussi que chaque domaine du catalogue existe (DNS)',
];

function clean(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  return v || undefined;
}

// ─── Options ──────────────────────────────────────────────────────────────────

/** Vrai pour la boucle locale : localhost, 127.x.x.x, ::1. */
export function isLoopbackHost(hostname) {
  const host = String(hostname).replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * Adresse SearXNG normalisée (sans barre finale, requête ni fragment). Refuse toute adresse qui n'est pas en https, sauf
 * la boucle locale (http://127.0.0.1:8080), et toute adresse avec identifiants. Lève une Error (message en français).
 */
export function normalizeSearxngUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Adresse SearXNG illisible (« ${String(raw).slice(0, 80)} ») : exemple https://searx.mon-etablissement.fr.`);
  }
  if (url.username || url.password) throw new Error("L'adresse SearXNG ne doit pas contenir d'identifiants.");
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    throw new Error("L'adresse SearXNG doit être en https : http n'est admis que sur la boucle locale (localhost, 127.0.0.1, ::1).");
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error("L'adresse SearXNG doit commencer par https://.");
  url.search = '';
  url.hash = '';
  return url.href.replace(/\/+$/, '');
}

/** Lit les options (ligne de commande puis variables). Lève une Error (message en français) si elles sont invalides. */
export function parseArgs(argv, env = {}) {
  const opts = {
    query: clean(env.RESEARCH_CHECK_QUERY) ?? DEFAULTS.query,
    searxng: clean(env.SEARXNG_URL),
    mailto: clean(env.CROSSREF_MAILTO),
    timeoutS: DEFAULTS.timeoutS,
    catalogue: false,
    help: false,
  };
  const valueOf = (i, name) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`L'option ${name} attend une valeur.`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--catalogue') opts.catalogue = true;
    else if (arg === '--query') opts.query = valueOf(i++, arg);
    else if (arg === '--searxng') opts.searxng = valueOf(i++, arg);
    else if (arg === '--mailto') opts.mailto = valueOf(i++, arg);
    else if (arg === '--timeout-s') opts.timeoutS = valueOf(i++, arg);
    else throw new Error(`Option inconnue : ${arg.slice(0, 40)}.`);
  }
  opts.query = String(opts.query).replace(/\s+/g, ' ').trim();
  if (!opts.query || opts.query.length > 200) throw new Error('Le sujet (--query) doit compter de 1 à 200 caractères.');
  const timeoutS = Number(opts.timeoutS);
  if (!Number.isInteger(timeoutS) || timeoutS < 5 || timeoutS > 120) throw new Error('Le délai (--timeout-s) doit être un nombre entier de secondes entre 5 et 120.');
  opts.timeoutMs = timeoutS * 1000;
  if (opts.searxng) opts.searxng = normalizeSearxngUrl(opts.searxng);
  if (opts.mailto && !/^[^\s@<>()]{1,64}@[^\s@<>()]{1,190}\.[a-z]{2,}$/i.test(opts.mailto)) throw new Error('Le contact (--mailto) doit être une adresse électronique valide.');
  return opts;
}

// ─── Forme des réponses (dérive des API) ──────────────────────────────────────

/**
 * Champs attendus dans chaque élément d'une liste de résultats, par service :
 *  - required : sans lui, le connecteur ne peut rien produire (échec) ;
 *  - expected : présent d'ordinaire (avertissement s'il manque partout) ;
 *  - optional : absent de certains documents (simple information).
 * Un chemin « a[].b » désigne le champ b d'au moins un élément du tableau a.
 */
export const SHAPES = Object.freeze({
  hal: {
    items: json => json?.response?.docs,
    required: ['title_s', 'uri_s'],
    expected: ['authFullName_s', 'producedDateY_i'],
    optional: ['doiId_s', 'journalTitle_s', 'abstract_s'],
  },
  crossref: {
    items: json => json?.message?.items,
    required: ['DOI', 'title', 'URL'],
    expected: ['author', 'issued.date-parts', 'container-title'],
    optional: ['abstract'],
  },
  openalex: {
    items: json => json?.results,
    required: ['title', 'abstract_inverted_index'],
    expected: ['doi', 'publication_year', 'authorships[].author.display_name', 'primary_location'],
    optional: ['primary_location.source.display_name', 'primary_location.landing_page_url'],
  },
  wikipedia: {
    items: json => json?.query?.search,
    required: ['pageid', 'title'],
    expected: [],
    optional: [],
  },
  searxng: {
    items: json => json?.results,
    required: ['url', 'title'],
    expected: ['content'],
    optional: [],
  },
});

function hasField(value, fieldPath) {
  if (value === undefined || value === null) return false;
  const [head, ...rest] = fieldPath.split('.');
  const isList = head.endsWith('[]');
  const next = value[isList ? head.slice(0, -2) : head];
  if (isList) return Array.isArray(next) && next.some(item => (rest.length ? hasField(item, rest.join('.')) : item !== undefined && item !== null));
  if (rest.length) return hasField(next, rest.join('.'));
  return next !== undefined && next !== null && next !== '' && !(Array.isArray(next) && next.length === 0);
}

/**
 * Compare la réponse brute d'un service à `shape`. `count` : éléments reçus ; `missing*` : champs absents de TOUS les
 * éléments (liste vide : aucun constat possible). Liste de résultats absente : le champ « (liste des résultats) » manque.
 */
export function inspectShape(shape, json) {
  const items = shape.items(json);
  if (!Array.isArray(items)) return { count: 0, missingRequired: ['(liste des résultats)'], missingExpected: [], missingOptional: [] };
  const absentEverywhere = fields => (items.length === 0 ? [] : fields.filter(field => !items.some(item => hasField(item, field))));
  return {
    count: items.length,
    missingRequired: absentEverywhere(shape.required),
    missingExpected: absentEverywhere(shape.expected),
    missingOptional: absentEverywhere(shape.optional),
  };
}

/** État (ok, warn, fail) et remarques tirés de inspectShape. */
export function judgeShape(inspected) {
  const notes = [];
  let status = 'ok';
  if (inspected.missingRequired.length) {
    status = 'fail';
    notes.push(`dérive de l'API : champ absent de tous les résultats : ${inspected.missingRequired.join(', ')}`);
  }
  if (inspected.missingExpected.length) {
    if (status === 'ok') status = 'warn';
    notes.push(`champ habituel absent de tous les résultats : ${inspected.missingExpected.join(', ')}`);
  }
  if (inspected.missingOptional.length) notes.push(`absent de l'échantillon (normal pour certains documents) : ${inspected.missingOptional.join(', ')}`);
  return { status, notes };
}

// ─── Affichage ────────────────────────────────────────────────────────────────

export function formatMs(ms) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n > 1 ? many : one}`;
}

/** Une ligne d'exemple : « titre » (année), revue, DOI, niveau de fiabilité · origine. `core` : le cœur compilé. */
export function describeSample(source, core) {
  const reliability = core.sourceReliability(source);
  const origin = core.sourceOrigin(source);
  return [
    `« ${String(source.title).replace(/\s+/g, ' ').slice(0, 110)} »${source.year ? ` (${source.year})` : ''}`,
    source.venue && source.venue !== origin ? source.venue : null,
    source.doi ? `DOI ${source.doi}` : null,
    origin ? `${reliability.label} · ${origin}` : reliability.label,
  ].filter(Boolean).join(' — ');
}

/** Message lisible d'une erreur de connecteur. */
export function describeError(err, timeoutMs) {
  const message = err instanceof Error ? err.message : String(err);
  if (/^HTTP 429/.test(message)) return 'le service refuse la requête : HTTP 429 (trop de requêtes, réessayez plus tard)';
  if (/^HTTP \d+/.test(message)) return `le service répond une erreur : ${message}`;
  if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) return `aucune réponse en ${Math.round(timeoutMs / 1000)} s`;
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN/.test(`${message} ${err?.cause?.code ?? ''}`)) return 'injoignable (réseau, proxy ou pare-feu)';
  return message;
}

/** Bilan : nombre de services par état et code de sortie (1 dès qu'un service échoue). */
export function summarize(results) {
  const count = status => results.filter(r => r.status === status).length;
  const failures = count('fail');
  const warnings = count('warn');
  const text = `${results.length - failures} service${results.length - failures > 1 ? 's' : ''} sur ${results.length} répondent`
    + (warnings ? `, ${plural(warnings, 'avertissement')}` : '')
    + (failures ? `, ${plural(failures, 'échec')}` : '')
    + '.';
  return { failures, warnings, text, exitCode: failures ? 1 : 0 };
}

// ─── Cœur de Magistra compilé à la volée ──────────────────────────────────────

const CORE_ENTRY = `
export { runResearch } from './shared/research/index.js';
export {
  readWikipediaPages, searchCrossref, searchHal, searchOpenAlex, searchWikipediaPages, wikipediaExternalLinks,
} from './shared/research/providers.js';
export { selectTrustedLinks, trustedSearchGroups, TRUSTED_SITES } from './shared/research/trusted.js';
export { sourceOrigin, sourceReliability } from './shared/citations.js';
export { fetchPublicPage } from './server/safeFetch.js';
`;

/** Compile les modules utiles (TypeScript) avec l'esbuild du dépôt dans un dossier temporaire, puis les charge. */
export async function loadCore() {
  const cache = path.join(root, 'node_modules', '.cache', 'magistra');
  mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(path.join(cache, 'research-check-'));
  const outfile = path.join(dir, 'core.mjs');
  try {
    await build({
      stdin: { contents: CORE_ENTRY, resolveDir: root, sourcefile: 'research-check-core.ts', loader: 'ts' },
      absWorkingDir: root,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      packages: 'external',
      legalComments: 'none',
      sourcemap: 'inline',
      logLevel: 'warning',
      outfile,
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Vérifications ────────────────────────────────────────────────────────────

/**
 * fetch qui garde chaque appel (adresse, statut, réponse brute en JSON) : sert à compter les requêtes et à vérifier la
 * forme des réponses. Un appel sans réponse (réseau coupé) reste dans la liste, sans statut.
 */
function recordingFetch() {
  const calls = [];
  const fetchRecorded = async (input, init) => {
    const call = { url: String(input), status: undefined, json: undefined };
    calls.push(call);
    const res = await fetch(input, init);
    call.status = res.status;
    try {
      call.json = await res.clone().json();
    } catch {
      // réponse qui n'est pas du JSON : la forme sera signalée
    }
    return res;
  };
  return { calls, fetch: fetchRecorded };
}

/** Exécute une vérification : durée mesurée, exception transformée en échec lisible. */
async function timed(name, timeoutMs, run) {
  const started = Date.now();
  try {
    const result = await run();
    return { name, ms: Date.now() - started, ...result };
  } catch (err) {
    return { name, status: 'fail', summary: describeError(err, timeoutMs), ms: Date.now() - started };
  }
}

function publicationCheck(core, opts, { name, search, shape }) {
  return timed(name, opts.timeoutMs, async () => {
    const recorder = recordingFetch();
    const sources = await search({ fetch: recorder.fetch }, { rows: 3, timeoutMs: opts.timeoutMs, mailto: opts.mailto });
    const raw = recorder.calls[0];
    const judged = judgeShape(raw?.json === undefined ? { count: 0, missingRequired: ['(réponse JSON)'], missingExpected: [], missingOptional: [] } : inspectShape(shape, raw.json));
    if (sources.length === 0) {
      return {
        status: 'fail',
        summary: `aucun résultat pour « ${opts.query} » (essayez un autre sujet avec --query)`,
        notes: judged.notes,
      };
    }
    return {
      status: judged.status,
      summary: `${plural(sources.length, 'résultat')}`,
      sample: describeSample(sources[0], core),
      notes: judged.notes,
    };
  });
}

function wikipediaCheck(core, opts) {
  return timed('Wikipédia et ses liens externes', opts.timeoutMs, async () => {
    const recorder = recordingFetch();
    const deps = { fetch: recorder.fetch };
    const pages = await core.searchWikipediaPages(opts.query, deps, { max: 2, timeoutMs: opts.timeoutMs });
    const { status: searchStatus, notes } = judgeShape(inspectShape(SHAPES.wikipedia, recorder.calls[0]?.json));
    let status = searchStatus;
    if (pages.length === 0) return { status: 'fail', summary: `aucune page pour « ${opts.query} » (essayez un autre sujet avec --query)`, notes };
    const articles = await core.readWikipediaPages(pages, deps, { timeoutMs: opts.timeoutMs });
    const extract = recorder.calls.find(c => c.url.includes('prop=extracts'))?.json;
    const firstPage = Object.values(extract?.query?.pages ?? {})[0];
    if (articles.length === 0 || !firstPage?.extract || !firstPage?.fullurl) {
      status = 'fail';
      notes.push("dérive de l'API : extrait (extract) ou adresse (fullurl) absent de la réponse de l'article");
    }
    const links = await core.wikipediaExternalLinks(pages[0].pageId, deps, { timeoutMs: opts.timeoutMs });
    const extlinks = recorder.calls.find(c => c.url.includes('prop=extlinks'))?.json;
    if (!Array.isArray(extlinks?.query?.pages)) {
      status = 'fail';
      notes.push("dérive de l'API : la réponse des liens externes (formatversion=2) n'est plus une liste de pages");
    }
    const chosen = core.selectTrustedLinks(links, 3);
    if (chosen.length === 0 && status === 'ok') {
      status = 'warn';
      notes.push('aucun lien externe de cette page ne figure dans le catalogue des sites vérifiés : le chemin « références de Wikipédia » ne trouvera rien pour ce sujet (essayez --query avec un autre sujet)');
    }
    return {
      status,
      summary: `${plural(pages.length, 'page')} trouvée${pages.length > 1 ? 's' : ''}, ${plural(links.length, 'lien externe')} https sur « ${pages[0].title} », ${chosen.length} dans le catalogue`,
      sample: chosen.length
        ? chosen.map(c => `${c.site.label} — ${core.sourceReliability({ kind: 'institutional', url: c.url }).label} — ${c.url}`).join('\n')
        : undefined,
      notes,
    };
  });
}

/** Résumé des sources officielles d'une recherche complète (runResearch) : avertissements du code compris. */
function officialOutcome(core, outcome) {
  const official = outcome.sources.filter(s => s.kind === 'institutional');
  return {
    official,
    notes: outcome.warnings.map(w => `avertissement de Magistra : ${w.message}`),
    sample: official.map(s => describeSample(s, core)).join('\n') || undefined,
  };
}

function officialViaWikipediaCheck(core, opts) {
  return timed('Sites officiels vérifiés (références de Wikipédia)', opts.timeoutMs, async () => {
    const outcome = await core.runResearch(
      { text: opts.query, topic: opts.query, mode: 'internet', group: 'college' },
      { academic: false, wikipedia: true, trustedOnly: true, timeoutMs: opts.timeoutMs },
      { fetch: (input, init) => fetch(input, init), fetchPage: core.fetchPublicPage },
      { budgetChars: 30_000 },
    );
    const { official, notes, sample } = officialOutcome(core, outcome);
    if (official.length === 0) {
      return { status: 'warn', summary: 'aucune page officielle récupérée pour ce sujet', sample, notes };
    }
    return { status: 'ok', summary: `${plural(official.length, 'page officielle', 'pages officielles')} récupérée${official.length > 1 ? 's' : ''}`, sample, notes };
  });
}

function searxngCheck(core, opts) {
  return timed('SearXNG (requêtes « site: » sur les principaux sites du catalogue)', opts.timeoutMs, async () => {
    const recorder = recordingFetch();
    const outcome = await core.runResearch(
      { text: opts.query, topic: opts.query, mode: 'internet', group: 'college' },
      { academic: false, wikipedia: false, trustedOnly: true, searxngUrl: opts.searxng, timeoutMs: opts.timeoutMs },
      { fetch: recorder.fetch, fetchPage: core.fetchPublicPage },
      { budgetChars: 30_000 },
    );
    const queries = recorder.calls.length;
    const answered = recorder.calls.filter(c => c.status !== undefined && c.status >= 200 && c.status < 300);
    const { official, notes, sample } = officialOutcome(core, outcome);
    if (answered.length === 0) {
      return { status: 'fail', summary: `${plural(queries, 'requête')}, aucune réponse valide`, notes };
    }
    const judged = judgeShape(inspectShape(SHAPES.searxng, answered.find(c => (c.json?.results?.length ?? 0) > 0)?.json ?? answered[0].json));
    const results = answered.reduce((n, c) => n + (Array.isArray(c.json?.results) ? c.json.results.length : 0), 0);
    notes.push(...judged.notes);
    if (judged.status === 'fail') return { status: 'fail', summary: `${plural(queries, 'requête')}, ${plural(results, 'résultat')}`, sample, notes };
    return {
      status: official.length === 0 || judged.status === 'warn' ? 'warn' : 'ok',
      summary: `${plural(queries, 'requête')} (${answered.length} réussie${answered.length > 1 ? 's' : ''}), ${plural(results, 'résultat')}, ${plural(official.length, 'page officielle', 'pages officielles')} retenue${official.length > 1 ? 's' : ''}`,
      sample,
      notes,
    };
  });
}

/** Domaines qui ne se résolvent pas (DNS) ; « www. » est essayé à défaut du domaine seul. `resolve` : résolution (tests). */
export async function unresolvedDomains(domains, resolve = lookup) {
  const missing = [];
  await Promise.all(domains.map(async domain => {
    for (const host of [domain, `www.${domain}`]) {
      try {
        await resolve(host);
        return;
      } catch {
        // essai suivant
      }
    }
    missing.push(domain);
  }));
  return missing.sort();
}

/** Le domaine parent « gouv.fr » (tout site .gouv.fr) n'a pas de site à lui : il n'est pas vérifié. */
function catalogueCheck(core, opts, resolve) {
  return timed('Catalogue des sites vérifiés (DNS)', opts.timeoutMs, async () => {
    const domains = core.TRUSTED_SITES.map(s => s.domain).filter(d => d !== 'gouv.fr');
    const missing = await unresolvedDomains(domains, resolve);
    return {
      status: missing.length ? 'warn' : 'ok',
      summary: `${domains.length - missing.length} domaine${domains.length - missing.length > 1 ? 's' : ''} sur ${domains.length} existent`,
      notes: missing.length ? [`domaine(s) introuvable(s), à corriger dans shared/research/trusted.ts : ${missing.join(', ')}`] : [],
    };
  });
}

// ─── Exécution ────────────────────────────────────────────────────────────────

function printResult(out, result) {
  const mark = result.status === 'ok' ? '✓' : result.status === 'warn' ? '!' : '✗';
  out('');
  out(`── ${result.name}`);
  out(`  ${mark} ${result.summary} (${formatMs(result.ms)})`);
  for (const line of String(result.sample ?? '').split('\n').filter(Boolean)) out(`      exemple : ${line}`);
  for (const note of result.notes ?? []) out(`      ${result.status === 'ok' ? 'note' : 'remarque'} : ${note}`);
}

/** Lance toutes les vérifications ; renvoie les résultats (affichés au fur et à mesure par `out`). `resolve` : DNS (tests). */
export async function runChecks(opts, core, out = console.log, resolve = lookup) {
  const results = [];
  const record = result => {
    results.push(result);
    printResult(out, result);
    return result;
  };
  record(await publicationCheck(core, opts, { name: 'HAL (archive ouverte française)', search: (deps, o) => core.searchHal(opts.query, deps, o), shape: SHAPES.hal }));
  record(await publicationCheck(core, opts, { name: 'Crossref', search: (deps, o) => core.searchCrossref(opts.query, deps, o), shape: SHAPES.crossref }));
  record(await publicationCheck(core, opts, { name: 'OpenAlex', search: (deps, o) => core.searchOpenAlex(opts.query, deps, o), shape: SHAPES.openalex }));
  const wikipedia = record(await wikipediaCheck(core, opts));
  if (wikipedia.status !== 'fail') record(await officialViaWikipediaCheck(core, opts));
  if (opts.searxng) record(await searxngCheck(core, opts));
  if (opts.catalogue) record(await catalogueCheck(core, opts, resolve));
  return results;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2), process.env);
  } catch (err) {
    console.error(`Erreur : ${err.message}`);
    console.error(USAGE.join('\n'));
    process.exitCode = 2;
    return;
  }
  if (opts.help) {
    console.log(USAGE.join('\n'));
    return;
  }
  console.log(`Vérification des services de recherche de Magistra — sujet « ${opts.query} »${opts.searxng ? ', SearXNG indiqué' : ''}.`);
  console.log('Chaque service est interrogé une fois, avec le code de Magistra.');
  const core = await loadCore();
  const results = await runChecks(opts, core);
  const summary = summarize(results);
  console.log('');
  console.log(`Bilan : ${summary.text}`);
  process.exitCode = summary.exitCode;
}

if (isMainModule(import.meta.url)) {
  main().catch(err => {
    console.error(`Erreur inattendue : ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
