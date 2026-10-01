import { describe, expect, it } from 'vitest';
import { planResearch, runResearch, type ResearchConfig, type ResearchDeps } from '../../shared/research/index';
import {
  isInstitutionalUrl, NO_ABSTRACT_TEXT, searchCrossref, searchHal, searchSearxng, searchWikipedia, stripTags, toPlainQuery,
} from '../../shared/research/providers';
import { jsonResponse, mockFetch, networkError, textResponse } from './helpers';

const HAL_RESPONSE = {
  response: {
    docs: [
      {
        title_s: ['La gouvernance des systèmes d’information'],
        authFullName_s: ['Anne Martin', 'Paul Durand'],
        producedDateY_i: 2019,
        doiId_s: '10.3917/sim.192.0045',
        uri_s: 'https://hal.science/hal-01234567',
        abstract_s: ['<p>Cet article analyse la gouvernance des SI &amp; son alignement stratégique dans les organisations publiques françaises.</p>'],
        journalTitle_s: 'Systèmes d’information et management',
      },
      { title_s: 'Référentiels ITIL et COBIT : une comparaison', authFullName_s: ['Luc Petit'], producedDateY_i: 2021, uri_s: 'https://hal.science/hal-07654321' },
      { authFullName_s: ['Sans titre'] },
    ],
  },
};

const CROSSREF_RESPONSE = {
  message: {
    items: [
      {
        DOI: '10.3917/SIM.192.0045', // même article que HAL (casse différente) : doit être dédoublonné
        title: ['La gouvernance des systèmes d’information'],
        author: [{ given: 'Anne', family: 'Martin' }],
        issued: { 'date-parts': [[2019, 6]] },
        'container-title': ['Systèmes d’information et management'],
      },
      {
        DOI: '10.1016/j.im.2020.103245',
        title: ['IT governance mechanisms and <i>performance</i>'],
        author: [{ given: 'J.', family: 'Smith' }, { name: 'Consortium X' }],
        issued: { 'date-parts': [[null]] },
        'container-title': ['Information & Management'],
        abstract: '<jats:p>We study IT governance mechanisms, decision rights and accountability in 120 firms across Europe.</jats:p>',
      },
      { title: ['Sans DOI'] },
    ],
  },
};

const LONG_WIKI = [
  'La gouvernance des systèmes d’information désigne le dispositif qui encadre les décisions relatives au SI.',
  ...Array.from({ length: 40 }, (_, i) => `Paragraphe annexe ${i} sur l’histoire des ordinateurs centraux et des mainframes, sans rapport direct avec le sujet traité.`),
  'Les référentiels de gouvernance comme COBIT structurent l’alignement stratégique et la maîtrise des risques du système d’information.',
].join('\n\n');

function wikiHandler(url: string): Response {
  if (url.includes('list=search')) return jsonResponse({ query: { search: [{ pageid: 101, title: 'Gouvernance des systèmes d’information' }, { pageid: 102, title: 'COBIT' }] } });
  if (url.includes('pageids=101')) return jsonResponse({ query: { pages: { 101: { title: 'Gouvernance des systèmes d’information', extract: LONG_WIKI, fullurl: 'https://fr.wikipedia.org/wiki/Gouvernance_des_SI' } } } });
  if (url.includes('pageids=102')) return textResponse('erreur', 500); // une page en échec n'empêche pas les autres
  return textResponse('?', 404);
}

function searxHandler(url: string): Response {
  const q = new URL(url).searchParams.get('q') ?? '';
  if (q.includes('site:eduscol.education.fr')) {
    return jsonResponse({ results: [
      { url: 'https://eduscol.education.fr/1234/programme-cycle-3', title: 'Programme du cycle 3', content: 'Le programme du cycle 3 précise les attendus de fin de cycle en mathématiques, dont les fractions simples et décimales.' },
      { url: 'javascript:alert(1)', title: 'piège', content: 'x' },
    ] });
  }
  if (q.includes('site:education.gouv.fr')) {
    return jsonResponse({ results: [{ url: 'https://www.education.gouv.fr/bo/2024/Hebdo1', title: 'Bulletin officiel', content: 'Bulletin officiel de l’éducation nationale : programmes en vigueur à la rentrée, mathématiques au cycle 3 et fractions.' }] });
  }
  return jsonResponse({ results: [
    { url: 'https://blog.example.org/fractions', title: 'Enseigner les fractions', content: 'Un blog d’enseignant propose des activités de manipulation pour introduire les fractions au CM1.' },
    { url: 'https://eduscol.education.fr/1234/programme-cycle-3/', title: 'Programme du cycle 3 (doublon)', content: 'Doublon de la page Éduscol déjà trouvée, avec une barre oblique finale en plus.' },
    { url: 'https://court.example.org', title: 'Trop court', content: 'Trop court.' },
  ] });
}

function router(overrides: Partial<Record<'hal' | 'crossref' | 'searx' | 'wiki', (url: string) => Response>> = {}) {
  return mockFetch(url => {
    const host = new URL(url).hostname;
    if (host === 'api.archives-ouvertes.fr') return (overrides.hal ?? (() => jsonResponse(HAL_RESPONSE)))(url);
    if (host === 'api.crossref.org') return (overrides.crossref ?? (() => jsonResponse(CROSSREF_RESPONSE)))(url);
    if (host === 'searx.example.fr') return (overrides.searx ?? searxHandler)(url);
    if (host === 'fr.wikipedia.org') return (overrides.wiki ?? wikiHandler)(url);
    throw new Error(`Hôte inattendu : ${host}`);
  });
}

const CONFIG: ResearchConfig = { academic: true, wikipedia: true, searxngUrl: 'https://searx.example.fr/', crossrefMailto: 'contact@magistra.example', timeoutMs: 2_000 };
const deps = (fetchImpl: ReturnType<typeof mockFetch>): ResearchDeps => ({ fetch: fetchImpl });

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
    const results = await searchSearxng('https://searx.example.fr/', 'fractions site:eduscol.education.fr', deps(router()), { max: 4, timeoutMs: 1_000 });
    expect(results.map(r => r.url)).toEqual(['https://eduscol.education.fr/1234/programme-cycle-3']);
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

  it('<nav> imbriqués et </navbar> : même résultat que l’ancienne expression, sans blocage', () => {
    expect(stripTags('<nav>a<nav>b</nav>c</nav>Texte')).toBe('c Texte');
    expect(stripTags('<nav>menu</navbar> suite</nav>Texte')).toBe('Texte');
    expect(stripTags('<svg/>Visible')).toBe('Visible');
  });
});

describe('planResearch', () => {
  it('par mode et par niveau', () => {
    expect(planResearch('documents', 'licence')).toEqual({ academic: false, institutional: false, web: false, wikipedia: false });
    expect(planResearch('academic', 'college')).toEqual({ academic: true, institutional: false, web: false, wikipedia: false });
    expect(planResearch('internet', 'master')).toEqual({ academic: true, institutional: false, web: true, wikipedia: true });
    expect(planResearch('documents_internet', 'doctorat')).toEqual({ academic: true, institutional: false, web: true, wikipedia: true });
    expect(planResearch('internet', 'elementaire')).toEqual({ academic: false, institutional: true, web: true, wikipedia: true });
    expect(planResearch('documents_internet', 'lycee')).toEqual({ academic: false, institutional: true, web: true, wikipedia: true });
  });
});

describe('runResearch', () => {
  it('université : HAL > Crossref > web > Wikipédia, dédoublonnage par DOI et URL', async () => {
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
    expect(kinds.lastIndexOf('crossref')).toBeLessThan(kinds.indexOf('web'));
    expect(kinds[kinds.length - 1]).toBe('wikipedia');
    // L'article présent dans HAL et Crossref n'apparaît qu'une fois (version HAL, prioritaire).
    expect(outcome.sources.filter(s => s.doi?.toLowerCase() === '10.3917/sim.192.0045')).toHaveLength(1);
    // Doublon d'URL (barre oblique finale) et résultat trop court écartés.
    const urls = outcome.sources.map(s => s.url);
    expect(urls.filter(u => u?.startsWith('https://eduscol.education.fr/1234/programme-cycle-3'))).toHaveLength(1);
    expect(urls).not.toContain('https://court.example.org');
    // Pas de sources institutionnelles demandées dans le supérieur.
    expect(fetchImpl.calls.some(c => c.url.includes('site%3A'))).toBe(false);
  });

  it('scolaire : priorité Éduscol / education.gouv.fr via SearXNG (site:), pas d’HAL ni de Crossref', async () => {
    const fetchImpl = router();
    const outcome = await runResearch({ text: 'les fractions', mode: 'internet', group: 'elementaire' }, CONFIG, deps(fetchImpl), { budgetChars: 50_000 });
    const queries = fetchImpl.calls.filter(c => c.url.startsWith('https://searx.example.fr/search')).map(c => new URL(c.url).searchParams.get('q'));
    expect(queries).toEqual(['les fractions site:eduscol.education.fr', 'les fractions site:education.gouv.fr', 'les fractions']);
    expect(fetchImpl.calls.some(c => /archives-ouvertes|crossref/.test(c.url))).toBe(false);
    expect(outcome.sources[0]).toMatchObject({ kind: 'institutional', url: 'https://eduscol.education.fr/1234/programme-cycle-3' });
    expect(outcome.sources[1]).toMatchObject({ kind: 'institutional', url: 'https://www.education.gouv.fr/bo/2024/Hebdo1' });
    expect(outcome.sources.map(s => s.kind)).toEqual(['institutional', 'institutional', 'web', 'wikipedia']);
  });

  it('scolaire sans SearXNG : avertissement institutionnel, Wikipédia utilisée quand même', async () => {
    const outcome = await runResearch({ text: 'les fractions', mode: 'internet', group: 'college' }, { ...CONFIG, searxngUrl: undefined }, deps(router()), { budgetChars: 50_000 });
    expect(outcome.warnings.map(w => w.code)).toEqual(['INSTITUTIONAL_UNAVAILABLE']);
    expect(outcome.sources.map(s => s.kind)).toEqual(['wikipedia']);
    expect(outcome.internetUsed).toBe(true);
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

  it('panne partielle : HAL en erreur, Crossref répond → sources Crossref, pas d’avertissement académique', async () => {
    const outcome = await runResearch(
      { text: 'gouvernance', mode: 'academic', group: 'master' },
      CONFIG, deps(router({ hal: () => textResponse('Solr error', 500) })), { budgetChars: 50_000 },
    );
    expect(outcome.sources.map(s => s.kind)).toEqual(['crossref', 'crossref']);
    expect(outcome.warnings).toEqual([]);
  });

  it('HAL et Crossref en erreur HTTP (réseau OK pour Wikipédia) → avertissement académique', async () => {
    const outcome = await runResearch(
      { text: 'gouvernance', mode: 'internet', group: 'doctorat' },
      { ...CONFIG, searxngUrl: undefined },
      deps(router({ hal: () => textResponse('x', 503), crossref: () => textResponse('x', 503) })), { budgetChars: 50_000 },
    );
    expect(outcome.warnings.map(w => w.code)).toEqual(['ACADEMIC_UNAVAILABLE']);
    expect(outcome.sources.map(s => s.kind)).toEqual(['wikipedia']);
  });

  it('recherche académique désactivée dans les réglages', async () => {
    const fetchImpl = router();
    const outcome = await runResearch({ text: 'gouvernance', mode: 'academic', group: 'master' }, { ...CONFIG, academic: false }, deps(fetchImpl), { budgetChars: 50_000 });
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

    const wiki = await runResearch({ text: 'gouvernance systèmes information COBIT', mode: 'internet', group: 'master' }, { ...CONFIG, academic: false, searxngUrl: undefined }, deps(router()), { budgetChars: 2_000 });
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

    const wiki = await runResearch({ text: 'gouvernance COBIT', mode: 'internet', group: 'master' }, { ...CONFIG, academic: false, searxngUrl: undefined }, deps(router()), { budgetChars: 300 });
    expect(wiki.sources).toHaveLength(1);
    expect(wiki.sources[0].text.length).toBeLessThanOrEqual(300);
    expect(wiki.sources[0].text.length).toBeGreaterThan(50);
  });

  it('la requête envoyée contient uniquement le texte de recherche fourni (sujet court pour HAL et Wikipédia)', async () => {
    const fetchImpl = router();
    await runResearch({ text: 'Le multiplicateur keynésien Économie Comprendre la relance', topic: 'Le multiplicateur keynésien', mode: 'internet', group: 'licence' }, CONFIG, deps(fetchImpl), { budgetChars: 10_000 });
    const hal = new URL(fetchImpl.calls.find(c => c.url.includes('archives-ouvertes'))!.url);
    expect(hal.searchParams.get('q')).toBe('Le multiplicateur keynésien');
    const wiki = new URL(fetchImpl.calls.find(c => c.url.includes('list=search'))!.url);
    expect(wiki.searchParams.get('srsearch')).toBe('Le multiplicateur keynésien');
    const crossref = new URL(fetchImpl.calls.find(c => c.url.includes('crossref'))!.url);
    expect(crossref.searchParams.get('query.bibliographic')).toBe('Le multiplicateur keynésien Économie Comprendre la relance');
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
      if (url.includes('archives-ouvertes') || url.includes('crossref')) {
        return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError'))));
      }
      return wikiHandler(url);
    });
    const outcome = await runResearch({ text: 'gouvernance', mode: 'internet', group: 'master' }, { ...CONFIG, searxngUrl: undefined, timeoutMs: 50 }, deps(slowHal), { budgetChars: 10_000 });
    expect(outcome.warnings.map(w => w.code)).toEqual(['ACADEMIC_UNAVAILABLE']);
    expect(outcome.sources.map(s => s.kind)).toEqual(['wikipedia']);
  });
});
