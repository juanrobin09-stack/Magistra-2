// scripts/research-check.mjs (npm run research:check) : options, adresse SearXNG, comparaison de la forme des réponses,
// bilan et code de sortie, puis exécution du script (compilation du cœur par esbuild, vrais connecteurs et vraie chaîne
// runResearch) contre de fausses réponses. La vérification sur les VRAIS services est faite par le mainteneur sur son
// poste : ce script ne tourne jamais en CI.

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { jsonResponse, textResponse } from '../shared/helpers';
import { HAL_RESPONSE, OPENALEX_RESPONSE, wikiHandler } from '../shared/researchFixtures';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'scripts', 'research-check.mjs');

interface Inspected { count: number; missingRequired: string[]; missingExpected: string[]; missingOptional: string[] }
interface Result { name: string; status: 'ok' | 'warn' | 'fail'; summary: string; sample?: string; notes?: string[]; ms: number }
interface Options {
  query: string; searxng?: string; mailto?: string; timeoutMs: number; catalogue: boolean; help: boolean;
}
interface ScriptModule {
  DEFAULTS: { query: string; timeoutS: number };
  USAGE: string[];
  SHAPES: Record<'hal' | 'crossref' | 'openalex' | 'wikipedia' | 'searxng', unknown>;
  parseArgs(argv: string[], env?: Record<string, string>): Options;
  normalizeSearxngUrl(raw: string): string;
  isLoopbackHost(hostname: string): boolean;
  inspectShape(shape: unknown, json: unknown): Inspected;
  judgeShape(inspected: Inspected): { status: 'ok' | 'warn' | 'fail'; notes: string[] };
  formatMs(ms: number): string;
  describeError(err: unknown, timeoutMs: number): string;
  describeSample(source: Record<string, unknown>, core: Core): string;
  summarize(results: { status: string }[]): { failures: number; warnings: number; text: string; exitCode: number };
  loadCore(): Promise<Core>;
  runChecks(opts: Options, core: Core, out: (line: string) => void, resolve?: (host: string) => Promise<unknown>): Promise<Result[]>;
  unresolvedDomains(domains: string[], resolve?: (host: string) => Promise<unknown>): Promise<string[]>;
}
type Core = Record<string, (...args: never[]) => unknown> & { sourceReliability(ref: unknown): { label: string }; sourceOrigin(ref: unknown): string | undefined };

let mod: ScriptModule;
let core: Core;
beforeAll(async () => {
  mod = (await import(pathToFileURL(script).href)) as ScriptModule;
  core = await mod.loadCore();
}, 60_000);
afterEach(() => vi.unstubAllGlobals());

describe('options', () => {
  it('valeurs par défaut : sujet « photosynthèse », délai de 20 s, ni SearXNG ni vérification du catalogue', () => {
    const o = mod.parseArgs([], {});
    expect(o).toMatchObject({ query: 'photosynthèse', timeoutMs: 20_000, catalogue: false, help: false });
    expect(o.searxng).toBeUndefined();
    expect(mod.DEFAULTS.query).toBe('photosynthèse');
  });

  it('--query, --searxng, --mailto, --timeout-s, --catalogue ; variables SEARXNG_URL et CROSSREF_MAILTO ; la ligne de commande l’emporte', () => {
    const env = { SEARXNG_URL: 'https://searx.exemple.fr/', CROSSREF_MAILTO: 'contact@exemple.fr' };
    expect(mod.parseArgs([], env)).toMatchObject({ searxng: 'https://searx.exemple.fr', mailto: 'contact@exemple.fr' });
    const o = mod.parseArgs(['--query', '  la   révolution française ', '--searxng', 'http://127.0.0.1:8080/', '--mailto', 'moi@exemple.fr', '--timeout-s', '30', '--catalogue'], env);
    expect(o).toMatchObject({ query: 'la révolution française', searxng: 'http://127.0.0.1:8080', mailto: 'moi@exemple.fr', timeoutMs: 30_000, catalogue: true });
    expect(mod.parseArgs(['--help'], {}).help).toBe(true);
    expect(mod.parseArgs(['-h'], {}).help).toBe(true);
  });

  it('options invalides : message clair en français', () => {
    expect(() => mod.parseArgs(['--vite'])).toThrow(/Option inconnue/);
    expect(() => mod.parseArgs(['--query'])).toThrow(/attend une valeur/);
    expect(() => mod.parseArgs(['--query', '--catalogue'])).toThrow(/attend une valeur/);
    expect(() => mod.parseArgs(['--query', '   '])).toThrow(/de 1 à 200 caractères/);
    expect(() => mod.parseArgs(['--query', 'x'.repeat(201)])).toThrow(/de 1 à 200 caractères/);
    expect(() => mod.parseArgs(['--timeout-s', 'dix'])).toThrow(/nombre entier de secondes/);
    expect(() => mod.parseArgs(['--timeout-s', '2'])).toThrow(/entre 5 et 120/);
    expect(() => mod.parseArgs(['--mailto', 'pas une adresse'])).toThrow(/adresse électronique valide/);
  });
});

describe('adresse SearXNG', () => {
  it('https accepté, normalisé (sans barre finale, requête ni fragment)', () => {
    expect(mod.normalizeSearxngUrl('https://searx.exemple.fr/')).toBe('https://searx.exemple.fr');
    expect(mod.normalizeSearxngUrl('https://searx.exemple.fr:8443/moteur/?q=x#y')).toBe('https://searx.exemple.fr:8443/moteur');
  });

  it('http refusé sauf boucle locale (localhost, 127.x.x.x, ::1)', () => {
    for (const ok of ['http://localhost:8080', 'http://127.0.0.1:8080/', 'http://127.0.0.2', 'http://[::1]:8080', 'http://moteur.localhost:8080']) {
      expect(() => mod.normalizeSearxngUrl(ok), ok).not.toThrow();
    }
    for (const refused of ['http://searx.exemple.fr', 'http://192.168.1.10:8080', 'http://10.0.0.5', 'http://127.0.0.1.pirate.example', 'http://localhost.pirate.example', 'http://0.0.0.0:8080']) {
      expect(() => mod.normalizeSearxngUrl(refused), refused).toThrow(/doit être en https.*boucle locale/);
    }
  });

  it('autres schémas, identifiants et adresses illisibles refusés', () => {
    expect(() => mod.normalizeSearxngUrl('ftp://searx.exemple.fr')).toThrow(/https/);
    expect(() => mod.normalizeSearxngUrl('javascript:alert(1)')).toThrow(/https/);
    expect(() => mod.normalizeSearxngUrl('https://moi:secret@searx.exemple.fr')).toThrow(/identifiants/);
    expect(() => mod.normalizeSearxngUrl('http://pirate@127.0.0.1:8080')).toThrow(/identifiants/);
    expect(() => mod.normalizeSearxngUrl('pas une adresse')).toThrow(/illisible/);
    // Via parseArgs : le script s'arrête avant tout appel réseau.
    expect(() => mod.parseArgs(['--searxng', 'http://searx.exemple.fr'])).toThrow(/https/);
    expect(() => mod.parseArgs([], { SEARXNG_URL: 'http://searx.exemple.fr' })).toThrow(/https/);
  });

  it('isLoopbackHost', () => {
    for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '127.255.0.3', '::1', '[::1]', 'a.localhost']) expect(mod.isLoopbackHost(host), host).toBe(true);
    for (const host of ['127.0.0.1.example.com', 'example.com', '128.0.0.1', '10.0.0.1', 'localhost.example.com', '::2']) expect(mod.isLoopbackHost(host), host).toBe(false);
  });
});

describe('forme des réponses (dérive des API)', () => {
  const shape = (name: keyof ScriptModule['SHAPES']) => mod.SHAPES[name];

  it('réponses conformes à la documentation : aucun constat', () => {
    const hal = mod.inspectShape(shape('hal'), HAL_RESPONSE);
    expect(hal).toEqual({ count: 3, missingRequired: [], missingExpected: [], missingOptional: [] });
    expect(mod.judgeShape(hal)).toEqual({ status: 'ok', notes: [] });
    const openalex = mod.inspectShape(shape('openalex'), OPENALEX_RESPONSE);
    expect(openalex).toEqual({ count: 2, missingRequired: [], missingExpected: [], missingOptional: [] });
    const crossref = mod.inspectShape(shape('crossref'), { message: { items: [{ DOI: '10.1/y', title: ['T'], URL: 'https://doi.org/10.1/y', author: [{ family: 'B' }], issued: { 'date-parts': [[2019]] }, 'container-title': ['J'] }] } });
    expect(mod.judgeShape(crossref).status).toBe('ok');
    expect(crossref.missingOptional).toEqual(['abstract']);
  });

  it('champ indispensable absent de tous les résultats : échec « dérive de l’API »', () => {
    const drift = { response: { docs: [{ titre: 'x', uri_s: 'https://hal.science/1' }, { titre: 'y', uri_s: 'https://hal.science/2' }] } };
    const inspected = mod.inspectShape(shape('hal'), drift);
    expect(inspected.missingRequired).toEqual(['title_s']);
    const judged = mod.judgeShape(inspected);
    expect(judged.status).toBe('fail');
    expect(judged.notes[0]).toMatch(/dérive de l'API : champ absent de tous les résultats : title_s/);
  });

  it('champ habituel absent partout : avertissement ; absent de certains documents seulement : rien', () => {
    const noYear = { response: { docs: [{ title_s: ['a'], uri_s: 'u', authFullName_s: ['A'] }, { title_s: ['b'], uri_s: 'v', authFullName_s: ['B'] }] } };
    const judged = mod.judgeShape(mod.inspectShape(shape('hal'), noYear));
    expect(judged.status).toBe('warn');
    expect(judged.notes[0]).toMatch(/champ habituel absent de tous les résultats : producedDateY_i/);
    const some = { response: { docs: [{ title_s: ['a'], uri_s: 'u', authFullName_s: ['A'], producedDateY_i: 2020 }, { title_s: ['b'], uri_s: 'v', authFullName_s: ['B'] }] } };
    expect(mod.inspectShape(shape('hal'), some).missingExpected).toEqual([]);
  });

  it('chemins imbriqués d’OpenAlex : auteurs, revue, résumé', () => {
    const without = { results: [{ title: 'T', abstract_inverted_index: { a: [0] }, doi: 'd', publication_year: 2020, authorships: [{ author: {} }], primary_location: { source: null } }] };
    const inspected = mod.inspectShape(shape('openalex'), without);
    expect(inspected.missingExpected).toEqual(['authorships[].author.display_name']);
    expect(inspected.missingOptional).toEqual(['primary_location.source.display_name', 'primary_location.landing_page_url']);
    const noAbstract = mod.inspectShape(shape('openalex'), { results: [{ title: 'T', doi: 'd' }] });
    expect(noAbstract.missingRequired).toEqual(['abstract_inverted_index']);
  });

  it('liste de résultats absente ou de mauvais type : échec ; liste vide : aucun constat de champ', () => {
    for (const body of [{}, { response: {} }, { response: { docs: 'x' } }, null, undefined, 'texte', []]) {
      expect(mod.inspectShape(shape('hal'), body).missingRequired, JSON.stringify(body)).toEqual(['(liste des résultats)']);
    }
    expect(mod.judgeShape(mod.inspectShape(shape('hal'), {})).status).toBe('fail');
    expect(mod.inspectShape(shape('hal'), { response: { docs: [] } })).toEqual({ count: 0, missingRequired: [], missingExpected: [], missingOptional: [] });
  });

  it('valeurs vides (chaîne vide, tableau vide, null) comptées comme absentes', () => {
    const empty = { response: { docs: [{ title_s: [], uri_s: '', authFullName_s: null, producedDateY_i: undefined }] } };
    expect(mod.inspectShape(shape('hal'), empty).missingRequired).toEqual(['title_s', 'uri_s']);
  });
});

describe('affichage et bilan', () => {
  it('durées lisibles', () => {
    expect(mod.formatMs(412)).toBe('412 ms');
    expect(mod.formatMs(1_234)).toBe('1,2 s');
  });

  it('erreurs de connecteur décrites en français', () => {
    expect(mod.describeError(new Error('HTTP 429'), 20_000)).toMatch(/HTTP 429.*trop de requêtes/);
    expect(mod.describeError(new Error('HTTP 503'), 20_000)).toBe('le service répond une erreur : HTTP 503');
    expect(mod.describeError(Object.assign(new Error('x'), { name: 'TimeoutError' }), 20_000)).toBe('aucune réponse en 20 s');
    expect(mod.describeError(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }), 20_000)).toMatch(/injoignable/);
    expect(mod.describeError(new Error('autre'), 20_000)).toBe('autre');
  });

  it('bilan : échec dès qu’un service échoue, avertissements seuls : code 0', () => {
    expect(mod.summarize([{ status: 'ok' }, { status: 'ok' }])).toMatchObject({ failures: 0, warnings: 0, exitCode: 0, text: '2 services sur 2 répondent.' });
    expect(mod.summarize([{ status: 'ok' }, { status: 'warn' }])).toMatchObject({ failures: 0, warnings: 1, exitCode: 0, text: '2 services sur 2 répondent, 1 avertissement.' });
    expect(mod.summarize([{ status: 'ok' }, { status: 'fail' }, { status: 'fail' }, { status: 'warn' }]))
      .toMatchObject({ failures: 2, warnings: 1, exitCode: 1, text: '2 services sur 4 répondent, 1 avertissement, 2 échecs.' });
  });

  it('exemple : titre, année, revue, DOI, niveau de fiabilité et origine', () => {
    const line = mod.describeSample({ kind: 'openalex', title: 'Photosynthesis', year: 2020, venue: 'Plant Journal', doi: '10.1000/x1', url: 'https://doi.org/10.1000/x1' }, core);
    expect(line).toBe('« Photosynthesis » (2020) — Plant Journal — DOI 10.1000/x1 — Publication scientifique · OpenAlex');
    expect(mod.describeSample({ kind: 'institutional', title: 'Éducation', venue: 'UNESCO', url: 'https://www.unesco.org/fr/esd' }, core))
      .toBe('« Éducation » — Source officielle · UNESCO');
  });
});

// ─── Exécution contre de fausses réponses ─────────────────────────────────────

const CROSSREF = { message: { items: [{ DOI: '10.1/y', title: ['Photosynthesis'], URL: 'https://doi.org/10.1/y', author: [{ given: 'A', family: 'B' }], issued: { 'date-parts': [[2019]] }, 'container-title': ['Journal'], abstract: '<jats:p>Résumé.</jats:p>' }] } };
const SEARX = (q: string) => (q.includes('site:education.gouv.fr')
  ? { results: [{ url: 'https://eduscol.education.fr/sciences/photosynthese', title: 'Photosynthèse', content: 'Les élèves étudient la photosynthèse des plantes vertes au cycle 4 : lumière, eau, dioxyde de carbone et dioxygène.' }, { url: 'https://blog.example.org/x', title: 'Blog', content: 'Un blog.' }] }
  : { results: [] });

type Routes = Partial<Record<'hal' | 'crossref' | 'openalex' | 'wiki' | 'searx', (url: string) => Response>>;
function stubNetwork(routes: Routes = {}) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const host = new URL(url).hostname;
    if (host === 'api.archives-ouvertes.fr') return (routes.hal ?? (() => jsonResponse(HAL_RESPONSE)))(url);
    if (host === 'api.crossref.org') return (routes.crossref ?? (() => jsonResponse(CROSSREF)))(url);
    if (host === 'api.openalex.org') return (routes.openalex ?? (() => jsonResponse(OPENALEX_RESPONSE)))(url);
    if (host === 'fr.wikipedia.org') return (routes.wiki ?? wikiHandler)(url);
    if (host === 'searx.example.fr') return (routes.searx ?? (u => jsonResponse(SEARX(new URL(u).searchParams.get('q') ?? ''))))(url);
    throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
  });
  return calls;
}

/** Pages officielles simulées : le script les récupère par la fonction de récupération sécurisée du dépôt. */
const fakeFetchPublicPage = async (url: string) => ({ url, title: `Page de ${new URL(url).hostname}`, text: `Contenu officiel de ${new URL(url).hostname} sur la photosynthèse : définitions, schémas et ressources pour les enseignants.` });
const patchedCore = (): Core => ({ ...core, fetchPublicPage: fakeFetchPublicPage as never }) as Core;

async function run(argv: string[] = [], routes?: Routes) {
  const calls = stubNetwork(routes);
  const lines: string[] = [];
  const results = await mod.runChecks(mod.parseArgs(argv, {}), patchedCore(), line => lines.push(line));
  return { results, lines, output: lines.join('\n'), calls, summary: mod.summarize(results) };
}

describe('exécution contre de fausses réponses', () => {
  it('tous les services répondent : un état, un nombre de résultats, un exemple et une durée par service ; code de sortie 0', async () => {
    const { results, output, summary, calls } = await run();
    expect(results.map(r => [r.name, r.status])).toEqual([
      ['HAL (archive ouverte française)', 'ok'],
      ['Crossref', 'ok'],
      ['OpenAlex', 'ok'],
      ['Wikipédia et ses liens externes', 'ok'],
      ['Sites officiels vérifiés (références de Wikipédia)', 'ok'],
    ]);
    expect(summary).toMatchObject({ exitCode: 0, failures: 0 });
    expect(summary.text).toBe('5 services sur 5 répondent.');
    // Nombre de résultats, exemple avec fiabilité, durée.
    expect(output).toContain('── HAL (archive ouverte française)');
    expect(output).toMatch(/✓ 2 résultats \(\d+ ms\)/);
    expect(output).toContain('exemple : « La gouvernance des systèmes d’information » (2019) — Systèmes d’information et management — DOI 10.3917/sim.192.0045 — Publication scientifique · HAL');
    expect(output).toContain('Publication scientifique · Crossref');
    expect(output).toContain('Publication scientifique · OpenAlex');
    expect(output).toMatch(/3 liens? externes? https|\d+ liens? externes? https/);
    expect(output).toContain('Source officielle · Éduscol');
    expect(output).toContain('Source officielle · UNESCO');
    // Le sujet par défaut est celui envoyé aux services.
    expect(calls.some(u => decodeURIComponent(u).includes('photosynthèse'))).toBe(true);
    // Aucun appel vers SearXNG sans adresse.
    expect(calls.some(u => u.includes('searx'))).toBe(false);
  });

  it('SearXNG indiqué : requêtes « site: » sur le catalogue, pages officielles retenues, blog écarté', async () => {
    const { results, output, calls } = await run(['--searxng', 'https://searx.example.fr']);
    const searx = results.find(r => r.name.startsWith('SearXNG'))!;
    expect(searx.status).toBe('ok');
    const queries = calls.filter(u => u.startsWith('https://searx.example.fr/')).map(u => new URL(u).searchParams.get('q') ?? '');
    expect(queries.length).toBeGreaterThan(1);
    expect(queries.length).toBeLessThanOrEqual(6);
    expect(queries.every(q => q.includes('site:'))).toBe(true);
    expect(searx.summary).toMatch(new RegExp(`^${queries.length} requêtes \\(${queries.length} réussies\\), 2 résultats, 1 page officielle retenue$`));
    expect(output).toContain('Source officielle · Éduscol');
    expect(output).not.toContain('blog.example.org');
  });

  it('dérive d’une API (champ absent de tous les résultats) : échec, code de sortie 1, champ nommé', async () => {
    const drift = () => jsonResponse({ results: OPENALEX_RESPONSE.results.map(({ abstract_inverted_index: _omitted, ...rest }) => rest) });
    const { results, output, summary } = await run([], { openalex: drift });
    const openalex = results.find(r => r.name === 'OpenAlex')!;
    expect(openalex.status).toBe('fail');
    expect(output).toContain("dérive de l'API : champ absent de tous les résultats : abstract_inverted_index");
    expect(summary.exitCode).toBe(1);
    expect(summary.text).toBe('4 services sur 5 répondent, 1 échec.');
  });

  it('HTTP 429, HTTP 500 et service injoignable : échecs distincts et lisibles', async () => {
    const { results, summary } = await run([], {
      hal: () => textResponse('Too many requests', 429),
      crossref: () => textResponse('boom', 500),
      openalex: () => { throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }); },
    });
    expect(results.slice(0, 3).map(r => [r.status, r.summary])).toEqual([
      ['fail', 'le service refuse la requête : HTTP 429 (trop de requêtes, réessayez plus tard)'],
      ['fail', 'le service répond une erreur : HTTP 500'],
      ['fail', 'injoignable (réseau, proxy ou pare-feu)'],
    ]);
    expect(summary.exitCode).toBe(1);
  });

  it('aucun résultat pour le sujet : échec avec la piste --query', async () => {
    const { results, output } = await run(['--query', 'sujet introuvable'], { hal: () => jsonResponse({ response: { docs: [] } }) });
    expect(results[0]).toMatchObject({ status: 'fail', summary: 'aucun résultat pour « sujet introuvable » (essayez un autre sujet avec --query)' });
    expect(output).toContain('--query');
  });

  it('Wikipédia sans lien du catalogue : avertissement (pas un échec), le bilan reste 0', async () => {
    const wiki = (url: string) => (new URL(url).searchParams.get('prop') === 'extlinks'
      ? jsonResponse({ query: { pages: [{ pageid: 101, extlinks: [{ url: 'https://example.org/a' }, { url: 'https://www.unesco.org/' }] }] } })
      : wikiHandler(url));
    const { results, summary } = await run([], { wiki });
    const wikipedia = results.find(r => r.name.startsWith('Wikipédia'))!;
    expect(wikipedia.status).toBe('warn');
    expect(wikipedia.notes?.join(' ')).toMatch(/aucun lien externe de cette page ne figure dans le catalogue/);
    expect(results.find(r => r.name.startsWith('Sites officiels'))!.status).toBe('warn');
    expect(summary.exitCode).toBe(0);
    expect(summary.warnings).toBe(2);
  });

  it('Wikipédia : réponse des liens externes qui change de forme (formatversion 2 abandonné) : dérive signalée, échec', async () => {
    const wiki = (url: string) => (new URL(url).searchParams.get('prop') === 'extlinks'
      ? jsonResponse({ query: { pages: { 101: { extlinks: [{ '*': 'https://www.unesco.org/fr/x' }] } } } })
      : wikiHandler(url));
    const { results } = await run([], { wiki });
    const wikipedia = results.find(r => r.name.startsWith('Wikipédia'))!;
    expect(wikipedia.status).toBe('fail');
    expect(wikipedia.notes?.join(' ')).toMatch(/dérive de l'API.*formatversion=2/);
    // Le chemin complet n'est pas tenté quand Wikipédia échoue.
    expect(results.some(r => r.name.startsWith('Sites officiels'))).toBe(false);
  });

  it('Wikipédia : extrait ou adresse de l’article absent : dérive signalée', async () => {
    const wiki = (url: string) => (new URL(url).searchParams.get('prop')?.startsWith('extracts')
      ? jsonResponse({ query: { pages: { 101: { title: 'Gouvernance' } } } })
      : wikiHandler(url));
    const { results } = await run([], { wiki });
    const wikipedia = results.find(r => r.name.startsWith('Wikipédia'))!;
    expect(wikipedia.status).toBe('fail');
    expect(wikipedia.notes?.join(' ')).toMatch(/extrait \(extract\) ou adresse \(fullurl\)/);
  });

  it('aucune page officielle récupérée (références hors catalogue après redirection) : avertissement, avec ceux de Magistra', async () => {
    const calls = stubNetwork();
    const redirecting = async (url: string) => ({ url: 'https://pirate.example.net/faux', title: 'Faux', text: `Contenu d'un autre site que ${url}, assez long pour être pris pour une page de recherche en ligne.` });
    const lines: string[] = [];
    const results = await mod.runChecks(mod.parseArgs([], {}), { ...core, fetchPublicPage: redirecting as never } as Core, line => lines.push(line));
    const official = results.find(r => r.name.startsWith('Sites officiels'))!;
    expect(official.status).toBe('warn');
    expect(official.summary).toBe('aucune page officielle récupérée pour ce sujet');
    expect(official.notes?.join(' ')).toContain('Aucune source officielle trouvée pour ce sujet : à vérifier.');
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe('--catalogue : les domaines du catalogue existent-ils ?', () => {
  it('un domaine qui ne se résout pas (ni seul, ni avec « www. ») est signalé ; « www. » suffit ; le domaine parent « gouv.fr » n’est pas vérifié', async () => {
    const asked: string[] = [];
    const resolve = async (host: string) => {
      asked.push(host);
      if (host === 'ac-lyon.fr' || host === 'www.ac-lyon.fr' || host.endsWith('invente.example')) throw new Error('ENOTFOUND');
      if (host === 'cnrs.fr') throw new Error('ENOTFOUND'); // seul « www.cnrs.fr » existe
      return { address: '203.0.113.1', family: 4 };
    };
    expect(await mod.unresolvedDomains(['unesco.org', 'cnrs.fr', 'ac-lyon.fr', 'invente.example'], resolve)).toEqual(['ac-lyon.fr', 'invente.example']);
    expect(asked).toContain('www.cnrs.fr');
    expect(asked).not.toContain('www.unesco.org');

    stubNetwork();
    const lines: string[] = [];
    const results = await mod.runChecks(mod.parseArgs(['--catalogue'], {}), patchedCore(), line => lines.push(line), resolve as never);
    const catalogue = results.find(r => r.name.startsWith('Catalogue'))!;
    expect(catalogue.status).toBe('warn');
    expect(catalogue.summary).toMatch(/domaines sur \d+ existent/);
    expect(catalogue.notes?.join(' ')).toContain('ac-lyon.fr');
    expect(catalogue.notes?.join(' ')).toContain('shared/research/trusted.ts');
    expect(asked).not.toContain('gouv.fr');
    expect(asked).toContain('unesdoc.unesco.org');
    // Un avertissement n'est pas un échec.
    expect(mod.summarize(results).exitCode).toBe(0);
  });

  it('tous les domaines existent : état ok ; sans l’option, aucune résolution DNS', async () => {
    const resolve = vi.fn(async () => ({ address: '203.0.113.1', family: 4 }));
    stubNetwork();
    const withCatalogue = await mod.runChecks(mod.parseArgs(['--catalogue'], {}), patchedCore(), () => undefined, resolve as never);
    expect(withCatalogue.find(r => r.name.startsWith('Catalogue'))?.status).toBe('ok');
    resolve.mockClear();
    const without = await mod.runChecks(mod.parseArgs([], {}), patchedCore(), () => undefined, resolve as never);
    expect(without.some(r => r.name.startsWith('Catalogue'))).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('outil du mainteneur', () => {
  it('npm run research:check lance le script ; aucune dépendance en dehors d’esbuild et de Node', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['research:check']).toBe('node scripts/research-check.mjs');
    const source = readFileSync(script, 'utf8');
    const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map(m => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) expect(specifier, specifier).toMatch(/^(esbuild|node:[a-z/]+|\.\/mainModule\.mjs)$/);
    // Le cœur est compilé dans un dossier temporaire, effacé après chargement.
    expect(source).toContain('mkdtempSync');
    expect(source).toMatch(/rmSync\(dir, \{ recursive: true, force: true \}\)/);
  });

  it('ne tourne jamais en CI : aucun flux de travail GitHub ne le lance', () => {
    const dir = path.join(root, '.github', 'workflows');
    for (const file of readdirSync(dir)) {
      const text = readFileSync(path.join(dir, file), 'utf8');
      expect(text, file).not.toMatch(/research-check|research:check/);
    }
  });

  it('exécution directe : --help (code 0) ; adresse SearXNG non https (code 2, avant tout appel réseau)', () => {
    const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('Usage : npm run research:check');
    const refused = spawnSync(process.execPath, [script, '--searxng', 'http://searx.exemple.fr'], { encoding: 'utf8' });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("L'adresse SearXNG doit être en https");
    expect(refused.stdout).toBe('');
  });
});
