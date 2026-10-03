import { describe, expect, it } from 'vitest';
import { NO_OFFICIAL_FOUND_MESSAGE, OFFICIAL_UNAVAILABLE_MESSAGE, planResearch, runResearch } from '../../shared/research/index';
import {
  isInstitutionalUrl, NO_ABSTRACT_TEXT, searchCrossref, searchHal, searchSearxng, searchWikipedia, stripTags, toPlainQuery,
} from '../../shared/research/providers';
import { trustedSearchGroups } from '../../shared/research/trusted';
import { jsonResponse, mockFetch, networkError, textResponse } from './helpers';
import { CONFIG, deps, fakePages, NO_SEARX, router, searxHandler, wikiHandler } from './researchFixtures';

describe('connecteurs — parsing', () => {
  it('HAL : métadonnées, résumé nettoyé, référence sans résumé signalée, entrée sans titre ignorée', async () => {
    const fetchImpl = router();
    const sources = await searchHal('gouvernance des SI : COBIT (2019)', deps(fetchImpl), { rows: 4, timeoutMs: 1_000 });
    expect(sources).toHaveLength(2);
    expect(sources[0]).toEqual({
      kind: 'hal',
      title: 'La gouvernance des systèmes d’information',
      authors: ['Anne Martin', 'Paul Durand'],
      year: 2019,
      venue: 'Systèmes d’information et management',
      doi: '10.3917/sim.192.0045',
      url: 'https://hal.science/hal-01234567',
      text: 'Cet article analyse la gouvernance des SI & son alignement stratégique dans les organisations publiques françaises.',
    });
    expect(sources[1].text).toBe(NO_ABSTRACT_TEXT);
    const url = new URL(fetchImpl.calls[0].url);
    expect(url.origin + url.pathname).toBe('https://api.archives-ouvertes.fr/search/');
    expect(url.searchParams.get('q')).toBe('gouvernance des SI COBIT 2019');
    expect(url.searchParams.get('wt')).toBe('json');
  });

  it('Crossref : auteurs, année absente, résumé JATS nettoyé, élément sans DOI ignoré, mailto transmis', async () => {
    const fetchImpl = router();
    const sources = await searchCrossref('gouvernance SI', deps(fetchImpl), { rows: 4, timeoutMs: 1_000, mailto: 'contact@magistra.example' });
    expect(sources).toHaveLength(2);
    expect(sources[1]).toMatchObject({
      kind: 'crossref',
      title: 'IT governance mechanisms and performance',
      authors: ['J. Smith', 'Consortium X'],
      year: undefined,
      venue: 'Information & Management',
      doi: '10.1016/j.im.2020.103245',
      url: 'https://doi.org/10.1016/j.im.2020.103245',
      text: 'We study IT governance mechanisms, decision rights and accountability in 120 firms across Europe.',
    });
    const url = new URL(fetchImpl.calls[0].url);
    expect(url.hostname).toBe('api.crossref.org');
    expect(url.searchParams.get('query.bibliographic')).toBe('gouvernance SI');
    expect(url.searchParams.get('mailto')).toBe('contact@magistra.example');
  });

  it('SearXNG : seules les URL http(s) avec un titre sont gardées', async () => {
    const fetchImpl = router();
    const results = await searchSearxng('https://searx.example.fr/', 'fractions (site:education.gouv.fr OR site:eduscol.education.fr)', deps(fetchImpl), { max: 4, timeoutMs: 1_000 });
    expect(results.map(r => r.url)).toEqual([
      'https://eduscol.education.fr/1234/programme-cycle-3',
      'https://www.education.gouv.fr/bo/2024/Hebdo1',
      'https://blog.example.org/fractions',
      'http://www.education.gouv.fr/ancien/fractions',
    ]);
    // Le filtre sur le catalogue est celui de runResearch : le connecteur, lui, ne fait que renvoyer les résultats web.
    expect(new URL(fetchImpl.calls[0].url).searchParams.get('format')).toBe('json');
  });

  it('Wikipédia : recherche puis extraits ; une page en échec n’empêche pas les autres', async () => {
    const sources = await searchWikipedia('gouvernance des SI', deps(router()), { max: 2, timeoutMs: 1_000 });
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ kind: 'wikipedia', title: 'Gouvernance des systèmes d’information', venue: 'Wikipédia', url: 'https://fr.wikipedia.org/wiki/Gouvernance_des_SI' });
  });

  it('utilitaires : stripTags robuste, requête Solr neutralisée, sites institutionnels', () => {
    expect(stripTags('<p>A &amp;lt; B &#233;t&#xE9; &#99999999; <script>alert(1)</script></p>')).toBe('A &lt; B été');
    expect(toPlainQuery('C++ : "les bases" (L1) AND/OR NOT x*')).toBe('C les bases L1 and or not x');
    expect(isInstitutionalUrl('https://eduscol.education.fr/x')).toBe(true);
    expect(isInstitutionalUrl('https://www.education.gouv.fr/x')).toBe(true);
    expect(isInstitutionalUrl('https://www.legifrance.gouv.fr/x')).toBe(true);
    expect(isInstitutionalUrl('https://eduscol.education.fr.pirate.com/x')).toBe(false);
  });
});

describe('stripTags — temps linéaire et fidélité', () => {
  /** Borne absolue très large (machine chargée) : un balayage quadratique la dépasse de loin sur ces entrées. */
  const BOUND_MS = 3000;

  /** Plus courte durée (ms) de 3 exécutions : un pic de charge de la machine ne fausse pas la mesure. */
  const fastest = (html: string) => {
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const started = performance.now();
      stripTags(html);
      best = Math.min(best, performance.now() - started);
    }
    return best;
  };

  /**
   * Temps linéaire : avec 4 fois plus de balises, le temps est multiplié par 4 (par 16 pour un balayage quadratique) ; il
   * ne doit pas dépasser 8 fois celui de la taille de base (plancher de 50 ms : en dessous, la mesure ne dit rien), ni
   * BOUND_MS. Les entrées sont construites hors mesure.
   */
  const expectLinear = (build: (n: number) => string, n: number) => {
    const base = fastest(build(n));
    const scaled = fastest(build(4 * n));
    expect(scaled).toBeLessThan(8 * Math.max(base, 50));
    expect(scaled).toBeLessThan(BOUND_MS);
  };

  it('des milliers de balises <nav> jamais refermées : temps linéaire, texte utile conservé', () => {
    const build = (n: number) => `${'<nav>menu '.repeat(n)}Contenu utile`;
    expect(stripTags(build(20_000))).toContain('Contenu utile');
    expectLinear(build, 10_000);
  });

  it('autres entrées piégées : <script>/<aside> ouverts, chevrons sans fin, commentaires ouverts, blancs massifs', () => {
    const traps: Array<[(n: number) => string, number]> = [
      [n => `${'<script>x'.repeat(n)}fin`, 10_000],
      [n => '<aside a="1" '.repeat(n), 20_000],
      [n => `${'<'.repeat(n)}texte`, 100_000],
      [n => '<!--'.repeat(n), 20_000],
      [n => `${'\n '.repeat(n)}x`, 100_000],
      [n => `${'<nav>'.repeat(n)}${'</navbar>'.repeat(n)}`, 5_000],
    ];
    for (const [build, n] of traps) expectLinear(build, n);
    // Chevrons isolés = texte ; « <texte » sans « > » en fin de document = balise tronquée, écartée.
    expect(stripTags(`${'<'.repeat(1_000)} texte`)).toBe(`${'<'.repeat(1_000)} texte`);
    expect(stripTags('début <balise-tronquee')).toBe('début');
  });

  it('entrée démesurée plafonnée', () => {
    expect(fastest('a'.repeat(5_000_000))).toBeLessThan(BOUND_MS);
    expect(stripTags('a'.repeat(5_000_000))).toHaveLength(2_000_000);
  });

  it('retire menus, scripts et styles, garde le texte et les paragraphes', () => {
    const html = `<!doctype html><html><head><style>p{color:red}</style><script>var a = "<p>";</script></head>
      <body><header>Logo</header><nav><ul><li>Accueil</li></ul></nav>
      <h1>Programme du cycle 3</h1><p>Les fractions<br/>simples &amp; décimales.</p><!-- commentaire -->
      <p>Si a &lt; b alors a < b et c > d.</p><aside>Pub</aside><footer>Mentions</footer></body></html>`;
    expect(stripTags(html)).toBe('Programme du cycle 3\nLes fractions\nsimples & décimales.\n\nSi a < b alors a < b et c > d.');
  });

  it('<nav> imbriqués et </navbar> : résultat attendu, sans blocage', () => {
    expect(stripTags('<nav>a<nav>b</nav>c</nav>Texte')).toBe('c Texte');
    expect(stripTags('<nav>menu</navbar> suite</nav>Texte')).toBe('Texte');
    expect(stripTags('<svg/>Visible')).toBe('Visible');
  });
});

describe('planResearch', () => {
  it('par mode et par niveau : les sites vérifiés sont demandés dès qu’une recherche en ligne l’est', () => {
    expect(planResearch('documents', 'licence')).toEqual({ academic: false, institutional: false, web: false, wikipedia: false });
    expect(planResearch('academic', 'college')).toEqual({ academic: true, institutional: true, web: false, wikipedia: false });
    expect(planResearch('academic', 'doctorat')).toEqual({ academic: true, institutional: true, web: false, wikipedia: false });
    expect(planResearch('internet', 'master')).toEqual({ academic: true, institutional: true, web: true, wikipedia: true });
    expect(planResearch('documents_internet', 'doctorat')).toEqual({ academic: true, institutional: true, web: true, wikipedia: true });
    expect(planResearch('internet', 'elementaire')).toEqual({ academic: false, institutional: true, web: true, wikipedia: true });
    expect(planResearch('documents_internet', 'lycee')).toEqual({ academic: false, institutional: true, web: true, wikipedia: true });
  });
});

describe('runResearch', () => {
  it('université : HAL > Crossref > OpenAlex > sites vérifiés > Wikipédia, dédoublonnage par DOI et URL', async () => {
    const fetchImpl = router();
    const outcome = await runResearch(
      { text: 'gouvernance des systèmes d’information', mode: 'internet', group: 'master' },
      CONFIG, deps(fetchImpl), { budgetChars: 50_000 },
    );
    expect(outcome.internetUsed).toBe(true);
    expect(outcome.warnings).toEqual([]);
    const kinds = outcome.sources.map(s => s.kind);
    expect(kinds.indexOf('hal')).toBe(0);
    expect(kinds.lastIndexOf('hal')).toBeLessThan(kinds.indexOf('crossref'));
    expect(kinds.lastIndexOf('crossref')).toBeLessThan(kinds.indexOf('openalex'));
    expect(kinds.lastIndexOf('openalex')).toBeLessThan(kinds.indexOf('institutional'));
    expect(kinds.lastIndexOf('institutional')).toBeLessThan(kinds.indexOf('wikipedia'));
    expect(kinds[kinds.length - 1]).toBe('wikipedia');
    // L'article présent dans HAL, Crossref et OpenAlex n'apparaît qu'une fois (version HAL, prioritaire).
    expect(outcome.sources.filter(s => s.doi?.toLowerCase() === '10.3917/sim.192.0045')).toHaveLength(1);
    expect(outcome.sources.find(s => s.doi?.toLowerCase() === '10.3917/sim.192.0045')?.kind).toBe('hal');
    expect(outcome.sources.filter(s => s.kind === 'openalex').map(s => s.doi)).toEqual(['10.1016/j.accinf.2021.100512']);
    // Doublon d'URL (barre oblique finale) et résultat trop court écartés.
    const urls = outcome.sources.map(s => s.url);
    expect(urls.filter(u => u?.startsWith('https://eduscol.education.fr/1234/programme-cycle-3'))).toHaveLength(1);
    expect(urls).not.toContain('https://court.example.org');
    // Le web général n'est jamais interrogé ni retenu.
    expect(outcome.sources.some(s => s.kind === 'web')).toBe(false);
    expect(urls).not.toContain('https://blog.example.org/fractions');
  });

  it('université : priorité des connecteurs académiques HAL > Crossref > OpenAlex, résumés d’abord dans chacun', async () => {
    const outcome = await runResearch({ text: 'gouvernance', mode: 'academic', group: 'master' }, NO_SEARX, deps(router()), { budgetChars: 50_000 });
    expect(outcome.sources.map(s => s.kind)).toEqual(['hal', 'hal', 'crossref', 'openalex']);
    // La référence HAL sans résumé passe après celle qui en a un.
    expect(outcome.sources[0].text).toMatch(/gouvernance des SI/);
    expect(outcome.sources[1].text).toBe(NO_ABSTRACT_TEXT);
  });

  it('scolaire avec SearXNG : requêtes « site: » par lots sur TOUT le catalogue, jamais de requête générale, sites vérifiés > Wikipédia', async () => {
    const fetchImpl = router();
    const outcome = await runResearch({ text: 'les fractions', mode: 'internet', group: 'elementaire' }, CONFIG, deps(fetchImpl), { budgetChars: 50_000 });
    const queries = fetchImpl.calls.filter(c => c.url.startsWith('https://searx.example.fr/search')).map(c => new URL(c.url).searchParams.get('q'));
    expect(queries).toEqual(trustedSearchGroups().map(group => `les fractions (${group.map(d => `site:${d}`).join(' OR ')})`));
    expect(queries.length).toBeGreaterThan(1);
    expect(queries.length).toBeLessThanOrEqual(6);
    expect(queries.every(q => q?.includes('site:'))).toBe(true);
    // Les domaines de tous les lots forment le catalogue interrogé : éducation en premier.
    expect(queries[0]).toContain('site:education.gouv.fr');
    expect(queries.join(' ')).toContain('site:unesco.org');
    expect(fetchImpl.calls.some(c => /archives-ouvertes|crossref|openalex/.test(c.url))).toBe(false);
    expect(outcome.sources.map(s => [s.kind, s.url])).toEqual([
      ['institutional', 'https://eduscol.education.fr/1234/programme-cycle-3'],
      ['institutional', 'https://www.education.gouv.fr/bo/2024/Hebdo1'],
      ['institutional', 'https://www.unesco.org/fr/articles/enseigner-les-fractions'],
      ['institutional', 'https://www.cnrs.fr/fr/les-fractions'],
      ['wikipedia', 'https://fr.wikipedia.org/wiki/Gouvernance_des_SI'],
    ]);
    // Le nom du site du catalogue est cité comme origine.
    expect(outcome.sources.slice(0, 4).map(s => s.venue)).toEqual(['Éduscol', 'Ministère de l’Éducation nationale', 'UNESCO', 'CNRS']);
  });

  it('SearXNG : le blog, l’adresse javascript: et l’adresse http sont écartés même s’ils répondent à une requête « site: »', async () => {
    const outcome = await runResearch({ text: 'les fractions', mode: 'internet', group: 'college' }, CONFIG, deps(router()), { budgetChars: 50_000 });
    const urls = outcome.sources.map(s => s.url);
    expect(urls).not.toContain('https://blog.example.org/fractions');
    expect(urls).not.toContain('http://www.education.gouv.fr/ancien/fractions');
    expect(urls.some(u => u?.startsWith('javascript'))).toBe(false);
    expect(outcome.sources.every(s => s.kind === 'institutional' || s.kind === 'wikipedia')).toBe(true);
  });

  it('RESEARCH_TRUSTED_ONLY=false (administrateur) : requête générale ajoutée, résultats hors catalogue admis mais jamais présentés comme officiels', async () => {
    // Un seul site vérifié répond, pour que les résultats du web général tiennent dans les 4 pages retenues.
    const oneOfficialPage = (url: string) => {
      const q = new URL(url).searchParams.get('q') ?? '';
      if (!q.includes('site:')) return searxHandler(url);
      return q.includes('site:education.gouv.fr')
        ? jsonResponse({ results: [{ url: 'https://eduscol.education.fr/1234/programme-cycle-3', title: 'Programme du cycle 3', content: 'Le programme du cycle 3 précise les attendus de fin de cycle en mathématiques, dont les fractions simples et décimales.' }] })
        : jsonResponse({ results: [] });
    };
    const fetchImpl = router({ searx: oneOfficialPage });
    const outcome = await runResearch({ text: 'les fractions', mode: 'internet', group: 'elementaire' }, { ...CONFIG, trustedOnly: false }, deps(fetchImpl), { budgetChars: 50_000 });
    const queries = fetchImpl.calls.filter(c => c.url.startsWith('https://searx.example.fr/search')).map(c => new URL(c.url).searchParams.get('q'));
    expect(queries).toHaveLength(trustedSearchGroups().length + 1);
    expect(queries[queries.length - 1]).toBe('les fractions');
    const kinds = outcome.sources.map(s => s.kind);
    expect(kinds.indexOf('web')).toBeGreaterThan(kinds.lastIndexOf('institutional'));
    const blog = outcome.sources.find(s => s.url === 'https://blog.example.org/fractions');
    expect(blog).toMatchObject({ kind: 'web' });
    expect(blog?.venue).toBeUndefined();
    expect(outcome.sources.filter(s => s.kind === 'institutional').every(s => s.venue)).toBe(true);
  });

  it('restriction levée : une adresse http d’un site du catalogue n’est pas présentée comme officielle', async () => {
    const httpOnly = (url: string) => (new URL(url).searchParams.get('q')?.includes('site:education.gouv.fr')
      ? jsonResponse({ results: [{ url: 'http://www.education.gouv.fr/ancien/fractions', title: 'Ancienne adresse en http', content: 'Ancienne page servie en http, que seule une adresse https remplace : fractions et décimaux au cycle 3.' }] })
      : jsonResponse({ results: [] }));
    const outcome = await runResearch({ text: 'les fractions', mode: 'internet', group: 'college' }, { ...CONFIG, wikipedia: false, trustedOnly: false }, deps(router({ searx: httpOnly })), { budgetChars: 50_000 });
    expect(outcome.sources).toHaveLength(1);
    expect(outcome.sources[0]).toMatchObject({ kind: 'web', url: 'http://www.education.gouv.fr/ancien/fractions' });
    expect(outcome.sources[0].venue).toBeUndefined();
  });

  it('trustedOnly vaut vrai par défaut (champ absent) : même comportement que vrai', async () => {
    const fetchImpl = router();
    await runResearch({ text: 'les fractions', mode: 'internet', group: 'college' }, { ...CONFIG, trustedOnly: undefined }, deps(fetchImpl), { budgetChars: 50_000 });
    expect(fetchImpl.calls.filter(c => c.url.startsWith('https://searx.example.fr/search')).every(c => new URL(c.url).searchParams.get('q')?.includes('site:'))).toBe(true);
  });

  it('SearXNG + fetchPage : une redirection hors du catalogue écarte la page, une redirection vers un site vérifié la garde', async () => {
    const fetchPage = fakePages({
      'https://eduscol.education.fr/1234/programme-cycle-3': { url: 'https://pirate.example.net/faux-programme' },
      'https://www.education.gouv.fr/bo/2024/Hebdo1': { url: 'https://www.education.gouv.fr/bo/2024/Hebdo1-final', title: 'BO final' },
    });
    const outcome = await runResearch({ text: 'les fractions', mode: 'internet', group: 'college' }, CONFIG, deps(router(), fetchPage), { budgetChars: 50_000 });
    const urls = outcome.sources.map(s => s.url);
    expect(urls).not.toContain('https://eduscol.education.fr/1234/programme-cycle-3');
    expect(outcome.sources.some(s => /pirate/.test(s.text) || /pirate/.test(s.title))).toBe(false);
    const bo = outcome.sources.find(s => s.url === 'https://www.education.gouv.fr/bo/2024/Hebdo1');
    expect(bo).toMatchObject({ kind: 'institutional', venue: 'Ministère de l’Éducation nationale' });
    expect(bo?.text).toMatch(/Contenu officiel de www\.education\.gouv\.fr/);
    expect(fetchPage.calls).toContain('https://eduscol.education.fr/1234/programme-cycle-3');
  });

  it('SearXNG + fetchPage : redirection vers http, ou vers un hôte voisin (suffixe collé), écartée aussi', async () => {
    const fetchPage = fakePages({
      'https://eduscol.education.fr/1234/programme-cycle-3': { url: 'http://eduscol.education.fr/1234/programme-cycle-3' },
      'https://www.education.gouv.fr/bo/2024/Hebdo1': { url: 'https://education.gouv.fr.pirate.example.net/bo' },
    });
    const outcome = await runResearch({ text: 'les fractions', mode: 'internet', group: 'college' }, CONFIG, deps(router(), fetchPage), { budgetChars: 50_000 });
    expect(outcome.sources.map(s => s.url)).not.toContain('https://eduscol.education.fr/1234/programme-cycle-3');
    expect(outcome.sources.map(s => s.url)).not.toContain('https://www.education.gouv.fr/bo/2024/Hebdo1');
    expect(outcome.sources.some(s => s.kind === 'institutional' && /unesco/.test(s.url ?? ''))).toBe(true);
  });

  it('SearXNG, restriction levée : une redirection hors du catalogue est admise (comportement du web général)', async () => {
    const fetchPage = fakePages({ 'https://eduscol.education.fr/1234/programme-cycle-3': { url: 'https://autre.example.net/x', title: 'Autre page', text: 'Texte de la page finale, bien plus long que l’extrait fourni par le moteur de recherche : les fractions au cycle 3, leurs écritures, leurs comparaisons, les opérations et les problèmes.' } });
    const outcome = await runResearch({ text: 'les fractions', mode: 'internet', group: 'college' }, { ...CONFIG, trustedOnly: false }, deps(router(), fetchPage), { budgetChars: 50_000 });
    expect(outcome.sources.find(s => s.url === 'https://eduscol.education.fr/1234/programme-cycle-3')?.text).toMatch(/Texte de la page finale/);
  });

  it('SearXNG sans aucune page du catalogue : « Aucune source officielle trouvée », jamais une source hors catalogue', async () => {
    const onlyBlogs = (url: string) => (new URL(url).searchParams.get('q')?.includes('site:')
      ? jsonResponse({ results: [{ url: 'https://blog.example.org/fractions', title: 'Enseigner les fractions', content: 'Un blog d’enseignant propose des activités de manipulation pour introduire les fractions au CM1.' }] })
      : jsonResponse({ results: [] }));
    const outcome = await runResearch({ text: 'les fractions', mode: 'internet', group: 'college' }, { ...CONFIG, wikipedia: false }, deps(router({ searx: onlyBlogs })), { budgetChars: 50_000 });
    expect(outcome.sources).toEqual([]);
    expect(outcome.warnings).toContainEqual({ code: 'INSTITUTIONAL_UNAVAILABLE', message: NO_OFFICIAL_FOUND_MESSAGE });
  });

  it('SearXNG injoignable (Wikipédia répond) : avertissement de recherche, pas de « aucune source officielle » en plus', async () => {
    const outcome = await runResearch({ text: 'les fractions', mode: 'internet', group: 'college' }, CONFIG, deps(router({ searx: () => textResponse('x', 502) })), { budgetChars: 50_000 });
    expect(outcome.warnings.map(w => w.message)).toEqual(['Recherche Internet indisponible (serveur SearXNG injoignable).']);
    expect(outcome.sources.map(s => s.kind)).toEqual(['wikipedia']);
  });

  it('scolaire sans SearXNG ni fetchPage : sites officiels non consultés, Wikipédia utilisée quand même', async () => {
    const fetchImpl = router();
    const outcome = await runResearch({ text: 'les fractions', mode: 'internet', group: 'college' }, NO_SEARX, deps(fetchImpl), { budgetChars: 50_000 });
    expect(outcome.warnings).toEqual([{ code: 'INSTITUTIONAL_UNAVAILABLE', message: OFFICIAL_UNAVAILABLE_MESSAGE }]);
    expect(OFFICIAL_UNAVAILABLE_MESSAGE).toBe('Sites officiels (Éduscol, UNESCO, ministères…) non consultés. Ajoutez vos documents officiels (programmes, textes) pour les utiliser.');
    expect(outcome.sources.map(s => s.kind)).toEqual(['wikipedia']);
    expect(outcome.internetUsed).toBe(true);
    // Sans fetchPage, les références de Wikipédia ne sont pas demandées (chemin désactivé sans erreur).
    expect(fetchImpl.calls.some(c => c.url.includes('prop=extlinks'))).toBe(false);
  });

  it('sans Internet : un seul avertissement clair, aucune exception, génération possible', async () => {
    const offline = mockFetch(() => { throw networkError('ENOTFOUND'); });
    const outcome = await runResearch({ text: 'gouvernance', mode: 'documents_internet', group: 'licence' }, CONFIG, deps(offline), { budgetChars: 50_000 });
    expect(outcome.sources).toEqual([]);
    expect(outcome.internetUsed).toBe(false);
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings[0]).toMatchObject({ code: 'RESEARCH_UNAVAILABLE' });
    expect(outcome.warnings[0].message).toMatch(/Pas de connexion Internet.*la génération continue/);
  });

  it('sans Internet, sans chemin vers les sites officiels : l’avertissement « sites officiels » est conservé avec le message unique', async () => {
    const offline = mockFetch(() => { throw networkError('ENOTFOUND'); });
    const outcome = await runResearch({ text: 'gouvernance', mode: 'internet', group: 'college' }, NO_SEARX, deps(offline), { budgetChars: 50_000 });
    expect(outcome.warnings.map(w => w.code)).toEqual(['INSTITUTIONAL_UNAVAILABLE', 'RESEARCH_UNAVAILABLE']);
  });

  it('panne partielle : HAL en erreur, Crossref et OpenAlex répondent → pas d’avertissement académique', async () => {
    const outcome = await runResearch(
      { text: 'gouvernance', mode: 'academic', group: 'master' },
      NO_SEARX, deps(router({ hal: () => textResponse('Solr error', 500) }), fakePages()), { budgetChars: 50_000 },
    );
    expect(outcome.sources.filter(s => ['hal', 'crossref', 'openalex'].includes(s.kind)).map(s => s.kind)).toEqual(['crossref', 'crossref', 'openalex']);
    expect(outcome.warnings.some(w => w.code === 'ACADEMIC_UNAVAILABLE')).toBe(false);
  });

  it('HAL, Crossref et OpenAlex en erreur HTTP (réseau OK pour Wikipédia) → avertissement académique', async () => {
    const down = () => textResponse('x', 503);
    const outcome = await runResearch(
      { text: 'gouvernance', mode: 'internet', group: 'doctorat' },
      NO_SEARX,
      deps(router({ hal: down, crossref: down, openalex: down }), fakePages()), { budgetChars: 50_000 },
    );
    expect(outcome.warnings).toContainEqual({ code: 'ACADEMIC_UNAVAILABLE', message: 'Recherche académique indisponible (HAL, Crossref et OpenAlex injoignables).' });
    expect(outcome.sources.filter(s => s.kind === 'hal' || s.kind === 'crossref' || s.kind === 'openalex')).toEqual([]);
    expect(outcome.sources.some(s => s.kind === 'wikipedia')).toBe(true);
  });

  it('un seul des trois services académiques en panne : aucun avertissement', async () => {
    const outcome = await runResearch(
      { text: 'gouvernance', mode: 'academic', group: 'master' },
      NO_SEARX, deps(router({ hal: () => textResponse('x', 503), crossref: () => textResponse('x', 503) }), fakePages()), { budgetChars: 50_000 },
    );
    expect(outcome.sources.filter(s => s.kind === 'openalex')).toHaveLength(2);
    expect(outcome.warnings.some(w => w.code === 'ACADEMIC_UNAVAILABLE')).toBe(false);
  });

  it('recherche académique désactivée dans les réglages', async () => {
    const fetchImpl = router();
    // Sans fetchPage et sans SearXNG, les sites officiels ne sont pas consultables non plus : aucun appel réseau.
    const outcome = await runResearch({ text: 'gouvernance', mode: 'academic', group: 'master' }, { ...NO_SEARX, academic: false }, deps(fetchImpl), { budgetChars: 50_000 });
    expect(fetchImpl.calls).toHaveLength(0);
    expect(outcome.warnings[0]).toMatchObject({ code: 'ACADEMIC_UNAVAILABLE', message: 'Recherche académique désactivée dans les réglages.' });
  });

  it('mode « Mes documents » ou requête vide : aucun appel réseau', async () => {
    const fetchImpl = router();
    expect(await runResearch({ text: 'gouvernance', mode: 'documents', group: 'master' }, CONFIG, deps(fetchImpl), { budgetChars: 50_000 }))
      .toEqual({ sources: [], internetUsed: false, warnings: [] });
    expect((await runResearch({ text: '   ', mode: 'internet', group: 'master' }, CONFIG, deps(fetchImpl), { budgetChars: 50_000 })).sources).toEqual([]);
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it('budget respecté, aucune source vide, texte long recentré sur la question', async () => {
    const budget = 1_500;
    const outcome = await runResearch({ text: 'gouvernance des systèmes d’information COBIT', mode: 'internet', group: 'master' }, CONFIG, deps(router()), { budgetChars: budget });
    const total = outcome.sources.reduce((n, s) => n + s.text.length, 0);
    expect(total).toBeLessThanOrEqual(budget);
    expect(outcome.sources.length).toBeGreaterThan(0);
    for (const s of outcome.sources) expect(s.text.trim().length).toBeGreaterThan(0);

    const wiki = await runResearch({ text: 'gouvernance systèmes information COBIT', mode: 'internet', group: 'master' }, { ...NO_SEARX, academic: false }, deps(router()), { budgetChars: 2_000 });
    const text = wiki.sources.find(s => s.kind === 'wikipedia')?.text ?? '';
    expect(text.length).toBeLessThanOrEqual(2_000);
    expect(text).toMatch(/COBIT/);
    expect(text).not.toMatch(/Paragraphe annexe 20/);
  });

  it('budget très petit : sources courtes gardées, source longue tronquée plutôt que vide', async () => {
    const outcome = await runResearch({ text: 'gouvernance', mode: 'academic', group: 'master' }, CONFIG, deps(router()), { budgetChars: 300 });
    expect(outcome.sources.length).toBeGreaterThan(0);
    expect(outcome.sources.reduce((n, s) => n + s.text.length, 0)).toBeLessThanOrEqual(300);
    for (const s of outcome.sources) expect(s.text.length).toBeGreaterThan(0);

    const wiki = await runResearch({ text: 'gouvernance COBIT', mode: 'internet', group: 'master' }, { ...NO_SEARX, academic: false }, deps(router()), { budgetChars: 300 });
    expect(wiki.sources).toHaveLength(1);
    expect(wiki.sources[0].text.length).toBeLessThanOrEqual(300);
    expect(wiki.sources[0].text.length).toBeGreaterThan(50);
  });

  it('la requête envoyée contient uniquement le texte de recherche fourni (sujet court pour HAL, OpenAlex et Wikipédia)', async () => {
    const fetchImpl = router();
    await runResearch({ text: 'Le multiplicateur keynésien Économie Comprendre la relance', topic: 'Le multiplicateur keynésien', mode: 'internet', group: 'licence' }, CONFIG, deps(fetchImpl), { budgetChars: 10_000 });
    const hal = new URL(fetchImpl.calls.find(c => c.url.includes('archives-ouvertes'))!.url);
    expect(hal.searchParams.get('q')).toBe('Le multiplicateur keynésien');
    const openalex = new URL(fetchImpl.calls.find(c => c.url.includes('openalex'))!.url);
    expect(openalex.searchParams.get('search')).toBe('Le multiplicateur keynésien');
    expect(openalex.searchParams.get('mailto')).toBe('contact@magistra.example');
    const wiki = new URL(fetchImpl.calls.find(c => c.url.includes('list=search'))!.url);
    expect(wiki.searchParams.get('srsearch')).toBe('Le multiplicateur keynésien');
    const crossref = new URL(fetchImpl.calls.find(c => c.url.includes('crossref'))!.url);
    expect(crossref.searchParams.get('query.bibliographic')).toBe('Le multiplicateur keynésien Économie Comprendre la relance');
    // SearXNG reçoit la recherche complète, sans le texte des documents ni les consignes (jamais fournis à runResearch).
    const searx = fetchImpl.calls.filter(c => c.url.startsWith('https://searx.example.fr/'));
    expect(searx.every(c => new URL(c.url).searchParams.get('q')?.startsWith('Le multiplicateur keynésien Économie Comprendre la relance ('))).toBe(true);
  });

  it('annulation : les requêtes reçoivent le signal et la recherche se termine sans exception', async () => {
    const controller = new AbortController();
    const fetchImpl = mockFetch((_url, init) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const pending = runResearch({ text: 'gouvernance', mode: 'internet', group: 'master' }, CONFIG, deps(fetchImpl), { budgetChars: 10_000, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    const outcome = await pending;
    expect(outcome.sources).toEqual([]);
    expect(fetchImpl.calls.length).toBeGreaterThan(0);
  });

  it('délai dépassé sur un service lent → avertissement, les autres sources restent utilisées', async () => {
    const slowHal = mockFetch((url, init) => {
      if (url.includes('archives-ouvertes') || url.includes('crossref') || url.includes('openalex')) {
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError'))));
      }
      return wikiHandler(url);
    });
    const outcome = await runResearch({ text: 'gouvernance', mode: 'internet', group: 'master' }, { ...NO_SEARX, timeoutMs: 50 }, deps(slowHal, fakePages()), { budgetChars: 10_000 });
    expect(outcome.warnings.map(w => w.code)).toContain('ACADEMIC_UNAVAILABLE');
    expect(outcome.sources.some(s => s.kind === 'wikipedia')).toBe(true);
  });
});
