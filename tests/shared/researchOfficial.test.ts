// Sites officiels vérifiés SANS SearXNG (cas normal d'un enseignant) : références (liens externes) des pages de Wikipédia
// trouvées pour le sujet, filtrées par le catalogue, puis pages récupérées par fetchPage. Réponses simulées.

import { describe, expect, it } from 'vitest';
import {
  NO_OFFICIAL_FOUND_MESSAGE, OFFICIAL_LINKS_UNAVAILABLE_MESSAGE, OFFICIAL_UNAVAILABLE_MESSAGE, officialSitesPath, runResearch,
  WIKIPEDIA_AND_OFFICIAL_UNREACHABLE_MESSAGE,
} from '../../shared/research/index';
import { searchWikipediaPages, wikipediaExternalLinks } from '../../shared/research/providers';
import { jsonResponse, networkError, textResponse } from './helpers';
import { CONFIG, deps, EXTERNAL_LINKS, fakePages, NO_SEARX, router, wikiHandler } from './researchFixtures';

const QUERY = { text: 'la gouvernance des SI', topic: 'gouvernance des SI', mode: 'internet', group: 'college' } as const;
const BUDGET = { budgetChars: 60_000 };

/** URL des pages que fetchPage doit recevoir pour les liens de EXTERNAL_LINKS : éducation > international > recherche. */
const EDUSCOL = 'https://eduscol.education.fr/sciences/gouvernance-si';
const UNESCO = 'https://www.unesco.org/fr/articles/gouvernance-numerique';
const ILO = 'https://www.ilo.org/fr/gouvernance';

describe('officialSitesPath', () => {
  const fetchPage = fakePages();
  it('SearXNG d’abord, puis Wikipédia avec fetchPage, sinon aucun chemin', () => {
    expect(officialSitesPath({ searxngUrl: 'https://searx.example.fr', wikipedia: true }, { fetchPage })).toBe('searxng');
    expect(officialSitesPath({ searxngUrl: 'https://searx.example.fr', wikipedia: false }, {})).toBe('searxng');
    expect(officialSitesPath({ wikipedia: true }, { fetchPage })).toBe('wikipedia');
    expect(officialSitesPath({ wikipedia: false }, { fetchPage })).toBeNull();
    expect(officialSitesPath({ wikipedia: true }, {})).toBeNull();
  });
});

describe('connecteurs MediaWiki des références', () => {
  it('pages trouvées : identifiant et titre seulement, entrées sans identifiant ignorées', async () => {
    const wiki = (url: string) => (url.includes('list=search')
      ? jsonResponse({ query: { search: [{ pageid: 7, title: 'Photosynthèse' }, { title: 'sans identifiant' }, { pageid: '9', title: 'chaîne' }] } })
      : textResponse('?', 404));
    const pages = await searchWikipediaPages('photosynthèse', deps(router({ wiki })), { max: 2, timeoutMs: 1_000 });
    expect(pages).toEqual([{ pageId: 7, title: 'Photosynthèse' }]);
  });

  it('liens externes : requête MediaWiki exacte, seul le champ url de chaque lien est lu', async () => {
    const fetchImpl = router({
      wiki: () => jsonResponse({
        batchcomplete: true,
        query: { pages: [{ pageid: 7, ns: 0, title: 'Photosynthèse', extlinks: [{ url: 'https://www.unesco.org/fr/x' }, { url: 42 }, null, { autre: 'y' }, { url: 'https://who.int/a' }] }] },
      }),
    });
    const links = await wikipediaExternalLinks(7, deps(fetchImpl), { timeoutMs: 1_000 });
    expect(links).toEqual(['https://www.unesco.org/fr/x', 'https://who.int/a']);
    const url = new URL(fetchImpl.calls[0].url);
    expect(url.origin + url.pathname).toBe('https://fr.wikipedia.org/w/api.php');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action: 'query', prop: 'extlinks', ellimit: '500', elprotocol: 'https', pageids: '7', format: 'json', formatversion: '2',
    });
  });

  it('page sans lien externe, réponse inattendue ou en erreur', async () => {
    const none = router({ wiki: () => jsonResponse({ query: { pages: [{ pageid: 7, ns: 0, title: 'P' }] } }) });
    expect(await wikipediaExternalLinks(7, deps(none), { timeoutMs: 1_000 })).toEqual([]);
    const odd = router({ wiki: () => jsonResponse({ query: { pages: { 7: { extlinks: [{ url: 'https://who.int/a' }] } } } }) });
    expect(await wikipediaExternalLinks(7, deps(odd), { timeoutMs: 1_000 })).toEqual([]);
    const empty = router({ wiki: () => jsonResponse({}) });
    expect(await wikipediaExternalLinks(7, deps(empty), { timeoutMs: 1_000 })).toEqual([]);
    await expect(wikipediaExternalLinks(7, deps(router({ wiki: () => textResponse('x', 500) })), { timeoutMs: 1_000 })).rejects.toThrow('HTTP 500');
  });
});

describe('runResearch — sites officiels par les références de Wikipédia', () => {
  it('liens des 2 pages trouvées, sites vérifiés seulement, 3 pages au plus, 1 par hôte, éducation > international > recherche', async () => {
    const fetchImpl = router();
    const fetchPage = fakePages();
    const outcome = await runResearch(QUERY, NO_SEARX, deps(fetchImpl, fetchPage), BUDGET);

    // Une requête de liens externes par page trouvée (2 au plus), avec les paramètres de MediaWiki.
    const extlinks = fetchImpl.calls.filter(c => c.url.includes('prop=extlinks')).map(c => new URL(c.url).searchParams);
    expect(extlinks.map(p => p.get('pageids'))).toEqual(['101', '102']);
    for (const p of extlinks) {
      expect(Object.fromEntries(p)).toMatchObject({ ellimit: '500', elprotocol: 'https', formatversion: '2' });
    }
    expect(new URL(fetchImpl.calls.find(c => c.url.includes('list=search'))!.url).searchParams.get('srlimit')).toBe('2');

    // Seules les pages choisies sont récupérées : ni accueil, ni recherche, ni hôte hors catalogue, ni 2e page d'un même hôte.
    expect(fetchPage.calls).toEqual([EDUSCOL, UNESCO, ILO]);
    expect(fetchPage.calls).not.toContain('https://www.unesco.org/');
    expect(fetchPage.calls).not.toContain('https://www.unesco.org/fr/articles/autre-page');
    expect(fetchPage.calls.some(u => /evilunesco|example\.org|legifrance|theses|cnrs/.test(u))).toBe(false);

    expect(outcome.warnings).toEqual([]);
    expect(outcome.sources.map(s => [s.kind, s.venue, s.url])).toEqual([
      ['institutional', 'Éduscol', EDUSCOL],
      ['institutional', 'UNESCO', UNESCO],
      ['institutional', 'OIT', ILO],
      ['wikipedia', 'Wikipédia', 'https://fr.wikipedia.org/wiki/Gouvernance_des_SI'],
    ]);
    expect(outcome.sources[0]).toMatchObject({ title: 'Page officielle de eduscol.education.fr', text: expect.stringContaining('Contenu officiel de eduscol.education.fr') });
    expect(outcome.internetUsed).toBe(true);
  });

  it('ne retient que 3 pages au total même quand plus de sites vérifiés sont cités', async () => {
    const many = { '101': ['https://eduscol.education.fr/a', 'https://www.unesco.org/fr/b', 'https://www.who.int/fr/c', 'https://www.cnrs.fr/fr/d', 'https://www.fao.org/fr/e'], '102': [] };
    const wiki = (url: string) => {
      const p = new URL(url).searchParams;
      return p.get('prop') === 'extlinks'
        ? jsonResponse({ query: { pages: [{ pageid: 1, extlinks: (many[p.get('pageids') as '101' | '102'] ?? []).map(u => ({ url: u })) }] } })
        : wikiHandler(url);
    };
    const fetchPage = fakePages();
    await runResearch(QUERY, NO_SEARX, deps(router({ wiki }), fetchPage), BUDGET);
    expect(fetchPage.calls).toEqual(['https://eduscol.education.fr/a', 'https://www.unesco.org/fr/b', 'https://www.who.int/fr/c']);
  });

  it('un lien du catalogue qui redirige hors du catalogue (hôte inconnu, http, suffixe collé) est écarté', async () => {
    const fetchPage = fakePages({
      [EDUSCOL]: { url: 'https://pirate.example.net/faux' },
      [UNESCO]: { url: 'http://www.unesco.org/fr/articles/gouvernance-numerique' },
      [ILO]: { url: 'https://ilo.org.pirate.example.net/fr' },
    });
    const outcome = await runResearch(QUERY, NO_SEARX, deps(router(), fetchPage), BUDGET);
    expect(outcome.sources.map(s => s.kind)).toEqual(['wikipedia']);
    expect(outcome.warnings).toEqual([{ code: 'INSTITUTIONAL_UNAVAILABLE', message: NO_OFFICIAL_FOUND_MESSAGE }]);
    expect(NO_OFFICIAL_FOUND_MESSAGE).toBe('Aucune source officielle trouvée pour ce sujet : à vérifier.');
  });

  it('un lien du catalogue qui redirige vers l’accueil, une page de connexion ou /cas/ est écarté : son texte (menus) n’est pas une source', async () => {
    for (const final of [
      'https://www.education.gouv.fr/',
      'https://www.education.gouv.fr/index.html',
      'https://cas.education.gouv.fr/login?service=x',
      'https://www.education.gouv.fr/cas/',
      'https://www.education.gouv.fr//',
      'https://www.education.gouv.fr//index.html',
      'https://www.education.gouv.fr/fra',
      'https://www.education.gouv.fr/%69ndex.html',
    ]) {
      const fetchPage = fakePages({
        [EDUSCOL]: { url: final, text: 'Accueil du site : menu, actualités, espace presse, liens utiles, connexion à votre espace enseignant.' },
        [UNESCO]: null,
        [ILO]: null,
      });
      const outcome = await runResearch(QUERY, NO_SEARX, deps(router(), fetchPage), BUDGET);
      expect(outcome.sources.map(s => s.kind), final).toEqual(['wikipedia']);
      expect(outcome.sources.some(s => /Accueil du site/.test(s.text)), final).toBe(false);
      expect(outcome.warnings, final).toEqual([{ code: 'INSTITUTIONAL_UNAVAILABLE', message: NO_OFFICIAL_FOUND_MESSAGE }]);
    }
  });

  it('restriction levée : une redirection vers l’accueil d’un site du catalogue donne une page « web », jamais « officielle »', async () => {
    const fetchPage = fakePages({ [EDUSCOL]: { url: 'https://www.education.gouv.fr/', title: 'Accueil', text: 'Accueil du site : menu, actualités, espace presse, liens utiles pour les enseignants.' }, [UNESCO]: null, [ILO]: null });
    const outcome = await runResearch(QUERY, { ...NO_SEARX, trustedOnly: false }, deps(router(), fetchPage), BUDGET);
    const home = outcome.sources.find(s => s.url === 'https://www.education.gouv.fr/');
    expect(home).toMatchObject({ kind: 'web' });
    expect(home?.venue).toBeUndefined();
  });

  it('« recherche » est une rubrique : /fr/recherche/<article> est récupéré, /fr/recherche et index.html ne le sont pas', async () => {
    const links = [
      'https://www.cnrs.fr/fr/recherche/biologie',
      'https://www.cnrs.fr/fr/recherche',
      'https://www.education.gouv.fr/index.html',
      'https://www.education.gouv.fr/accueil',
    ];
    const wiki = (url: string) => (new URL(url).searchParams.get('prop') === 'extlinks'
      ? jsonResponse({ query: { pages: [{ pageid: 1, extlinks: new URL(url).searchParams.get('pageids') === '101' ? links.map(u => ({ url: u })) : [] }] } })
      : wikiHandler(url));
    const fetchPage = fakePages();
    await runResearch(QUERY, NO_SEARX, deps(router({ wiki }), fetchPage), BUDGET);
    expect(fetchPage.calls).toEqual(['https://www.cnrs.fr/fr/recherche/biologie']);
  });

  it('une redirection vers un autre site du catalogue est gardée sous son adresse finale et le nom de ce site', async () => {
    const fetchPage = fakePages({ [UNESCO]: { url: 'https://whc.unesco.org/fr/list/', title: 'Liste du patrimoine mondial' } });
    const outcome = await runResearch(QUERY, NO_SEARX, deps(router(), fetchPage), BUDGET);
    expect(outcome.sources.find(s => s.url === 'https://whc.unesco.org/fr/list/')).toMatchObject({
      kind: 'institutional', venue: 'Patrimoine mondial (UNESCO)', title: 'Liste du patrimoine mondial',
    });
  });

  it('page refusée, illisible, trop courte ou qui lève : écartée sans gêner les autres', async () => {
    const calls: string[] = [];
    const fetchPage = async (url: string) => {
      calls.push(url);
      if (url === EDUSCOL) return null;
      if (url === UNESCO) throw new Error('SSRF refusé');
      return { url, title: 'Page courte', text: 'Trop court.' };
    };
    const outcome = await runResearch(QUERY, NO_SEARX, deps(router(), fetchPage), BUDGET);
    expect(calls).toEqual([EDUSCOL, UNESCO, ILO]);
    expect(outcome.sources.map(s => s.kind)).toEqual(['wikipedia']);
    expect(outcome.warnings).toEqual([{ code: 'INSTITUTIONAL_UNAVAILABLE', message: NO_OFFICIAL_FOUND_MESSAGE }]);
  });

  it('page qui ne répond jamais : la recherche se termine dans le délai, les autres pages sont gardées', async () => {
    const fetchPage = async (url: string) => (url === EDUSCOL
      ? new Promise<null>(() => {})
      : { url, title: 'Page', text: 'Contenu officiel suffisamment long pour être retenu comme source de la recherche en ligne.' });
    const started = Date.now();
    const outcome = await runResearch(QUERY, { ...NO_SEARX, timeoutMs: 50 }, deps(router(), fetchPage), BUDGET);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(outcome.sources.filter(s => s.kind === 'institutional').map(s => s.venue)).toEqual(['UNESCO', 'OIT']);
  });

  it('références sans aucun site du catalogue : « Aucune source officielle trouvée », aucune page récupérée', async () => {
    const wiki = (url: string) => (new URL(url).searchParams.get('prop') === 'extlinks'
      ? jsonResponse({ query: { pages: [{ pageid: 1, extlinks: [{ url: 'https://example.org/a' }, { url: 'https://www.unesco.org/' }, { url: 'https://evilunesco.org/fr/x' }] }] } })
      : wikiHandler(url));
    const fetchPage = fakePages();
    const outcome = await runResearch(QUERY, NO_SEARX, deps(router({ wiki }), fetchPage), BUDGET);
    expect(fetchPage.calls).toEqual([]);
    expect(outcome.warnings).toEqual([{ code: 'INSTITUTIONAL_UNAVAILABLE', message: NO_OFFICIAL_FOUND_MESSAGE }]);
    expect(outcome.sources.map(s => s.kind)).toEqual(['wikipedia']);
  });

  it('aucune page de Wikipédia pour le sujet : même constat, sans erreur', async () => {
    const wiki = () => jsonResponse({ query: { search: [] } });
    const fetchPage = fakePages();
    const outcome = await runResearch(QUERY, NO_SEARX, deps(router({ wiki }), fetchPage), BUDGET);
    expect(fetchPage.calls).toEqual([]);
    expect(outcome.sources).toEqual([]);
    expect(outcome.warnings.map(w => w.message)).toContain(NO_OFFICIAL_FOUND_MESSAGE);
  });

  it('fetchPage absent (navigateur) : chemin désactivé sans erreur, Wikipédia seule, avertissement « sites officiels non consultés »', async () => {
    const fetchImpl = router();
    const outcome = await runResearch(QUERY, NO_SEARX, deps(fetchImpl), BUDGET);
    expect(fetchImpl.calls.some(c => c.url.includes('prop=extlinks'))).toBe(false);
    expect(outcome.warnings).toEqual([{ code: 'INSTITUTIONAL_UNAVAILABLE', message: OFFICIAL_UNAVAILABLE_MESSAGE }]);
    expect(outcome.sources.map(s => s.kind)).toEqual(['wikipedia']);
  });

  it('Wikipédia désactivé dans les réglages : aucune requête vers Wikipédia, sites officiels non consultés', async () => {
    const fetchImpl = router();
    const fetchPage = fakePages();
    const outcome = await runResearch(QUERY, { ...NO_SEARX, wikipedia: false }, deps(fetchImpl, fetchPage), BUDGET);
    expect(fetchImpl.calls).toEqual([]);
    expect(fetchPage.calls).toEqual([]);
    expect(outcome.warnings[0]).toEqual({ code: 'INSTITUTIONAL_UNAVAILABLE', message: OFFICIAL_UNAVAILABLE_MESSAGE });
    expect(outcome.sources).toEqual([]);
  });

  it('avec SearXNG, les références de Wikipédia ne sont pas lues (un seul chemin)', async () => {
    const fetchImpl = router();
    await runResearch(QUERY, CONFIG, deps(fetchImpl, fakePages()), BUDGET);
    expect(fetchImpl.calls.some(c => c.url.includes('prop=extlinks'))).toBe(false);
  });

  it('Wikipédia injoignable (seul service interrogé) : le message unique « pas de connexion », aucune page récupérée', async () => {
    const fetchPage = fakePages();
    const outcome = await runResearch(QUERY, NO_SEARX, deps(router({ wiki: () => textResponse('x', 503) }), fetchPage), BUDGET);
    expect(fetchPage.calls).toEqual([]);
    expect(outcome.warnings).toHaveLength(1);
    expect(outcome.warnings[0].message).toMatch(/^Pas de connexion Internet/);
    expect(outcome.sources).toEqual([]);
  });

  it('Wikipédia injoignable mais un autre service répond : l’avertissement nomme Wikipédia et dit que les sites officiels qui en dépendent ne sont pas consultés', async () => {
    const outcome = await runResearch({ ...QUERY, group: 'master' }, NO_SEARX, deps(router({ wiki: () => textResponse('x', 503) }), fakePages()), BUDGET);
    expect(outcome.warnings.map(w => w.message)).toEqual([WIKIPEDIA_AND_OFFICIAL_UNREACHABLE_MESSAGE]);
    expect(outcome.warnings.map(w => w.message)).not.toContain(NO_OFFICIAL_FOUND_MESSAGE);
    expect(outcome.sources.map(s => s.kind)).toEqual(['hal', 'hal', 'crossref', 'openalex']);
  });

  it('références de Wikipédia injoignables mais encyclopédie lisible : « sites officiels non consultés », jamais un faux « aucune source officielle »', async () => {
    const wiki = (url: string) => (new URL(url).searchParams.get('prop') === 'extlinks' ? textResponse('x', 500) : wikiHandler(url));
    const fetchPage = fakePages();
    const outcome = await runResearch(QUERY, NO_SEARX, deps(router({ wiki }), fetchPage), BUDGET);
    expect(outcome.sources.map(s => s.kind)).toEqual(['wikipedia']);
    expect(fetchPage.calls).toEqual([]);
    // Aucune consultation n'a abouti : on ne prétend pas avoir cherché sans rien trouver.
    expect(outcome.warnings).toEqual([{ code: 'INSTITUTIONAL_UNAVAILABLE', message: OFFICIAL_LINKS_UNAVAILABLE_MESSAGE }]);
    expect(outcome.warnings.map(w => w.message)).not.toContain(NO_OFFICIAL_FOUND_MESSAGE);
    expect(OFFICIAL_LINKS_UNAVAILABLE_MESSAGE).toMatch(/^Sites officiels .*non consultés/);
  });

  it('réseau coupé pour les références seulement (exception, pas une réponse HTTP) : même avertissement', async () => {
    const wiki = (url: string) => {
      if (new URL(url).searchParams.get('prop') === 'extlinks') throw networkError('ECONNRESET');
      return wikiHandler(url);
    };
    const outcome = await runResearch(QUERY, NO_SEARX, deps(router({ wiki }), fakePages()), BUDGET);
    expect(outcome.warnings).toEqual([{ code: 'INSTITUTIONAL_UNAVAILABLE', message: OFFICIAL_LINKS_UNAVAILABLE_MESSAGE }]);
  });

  it('une seule requête de références sur deux échoue : le chemin a répondu, les pages de l’autre sont récupérées, aucun avertissement', async () => {
    const wiki = (url: string) => (new URL(url).searchParams.get('prop') === 'extlinks' && new URL(url).searchParams.get('pageids') === '102'
      ? textResponse('x', 500)
      : wikiHandler(url));
    const fetchPage = fakePages();
    const outcome = await runResearch(QUERY, NO_SEARX, deps(router({ wiki }), fetchPage), BUDGET);
    expect(outcome.warnings).toEqual([]);
    // Les références de la page 102 (OIT) n'ont pas pu être lues : seules celles de la page 101 sont suivies.
    expect(fetchPage.calls).toEqual([EDUSCOL, UNESCO, 'https://www.cnrs.fr/fr/gouvernance-des-donnees']);
    expect(fetchPage.calls).not.toContain(ILO);
  });

  it('seules des plateformes ouvertes (HAL, data.gouv.fr) dans les références : elles sont gardées « à recouper », mais « aucune source officielle » est signalé', async () => {
    const wiki = (url: string) => (new URL(url).searchParams.get('prop') === 'extlinks'
      ? jsonResponse({ query: { pages: [{ pageid: 1, extlinks: [{ url: 'https://hal.science/hal-01234567' }, { url: 'https://www.data.gouv.fr/fr/datasets/gouvernance-si' }] }] } })
      : wikiHandler(url));
    const outcome = await runResearch(QUERY, NO_SEARX, deps(router({ wiki }), fakePages()), BUDGET);
    expect(outcome.sources.filter(s => s.kind === 'institutional').map(s => s.venue)).toEqual(['HAL', 'data.gouv.fr']);
    expect(outcome.warnings).toEqual([{ code: 'INSTITUTIONAL_UNAVAILABLE', message: NO_OFFICIAL_FOUND_MESSAGE }]);
  });

  it('« Sources académiques » : références injoignables, même avertissement (sites officiels non consultés)', async () => {
    const wiki = (url: string) => (new URL(url).searchParams.get('prop') === 'extlinks' ? textResponse('x', 500) : wikiHandler(url));
    const outcome = await runResearch({ ...QUERY, mode: 'academic', group: 'licence' }, NO_SEARX, deps(router({ wiki }), fakePages()), BUDGET);
    expect(outcome.warnings).toEqual([{ code: 'INSTITUTIONAL_UNAVAILABLE', message: OFFICIAL_LINKS_UNAVAILABLE_MESSAGE }]);
    expect(outcome.sources.map(s => s.kind)).toEqual(['hal', 'hal', 'crossref', 'openalex']);
  });

  it('« Sources académiques » : publications puis sites officiels, sans l’article de Wikipédia (seulement ses références)', async () => {
    const fetchImpl = router();
    const outcome = await runResearch({ ...QUERY, mode: 'academic', group: 'licence' }, NO_SEARX, deps(fetchImpl, fakePages()), BUDGET);
    expect(outcome.sources.map(s => s.kind)).toEqual(['hal', 'hal', 'crossref', 'openalex', 'institutional', 'institutional', 'institutional']);
    expect(outcome.sources.some(s => s.kind === 'wikipedia')).toBe(false);
    // L'article lui-même n'est pas lu : ni extrait, ni page par page.
    expect(fetchImpl.calls.some(c => c.url.includes('prop=extracts'))).toBe(false);
    expect(fetchImpl.calls.some(c => c.url.includes('prop=extlinks'))).toBe(true);
  });

  it('« Sources académiques » avec Wikipédia injoignable : le message dit que ce sont les sites officiels qui ne sont pas consultés', async () => {
    const outcome = await runResearch({ ...QUERY, mode: 'academic', group: 'licence' }, NO_SEARX, deps(router({ wiki: () => textResponse('x', 503) }), fakePages()), BUDGET);
    expect(outcome.warnings.map(w => w.message)).toEqual(['Sites officiels non consultés : Wikipédia, qui indique où les trouver, est injoignable.']);
    expect(outcome.sources.map(s => s.kind)).toEqual(['hal', 'hal', 'crossref', 'openalex']);
  });

  it('supérieur, « Internet » : publications > sites officiels > Wikipédia', async () => {
    const outcome = await runResearch({ ...QUERY, group: 'master' }, NO_SEARX, deps(router(), fakePages()), BUDGET);
    const kinds = outcome.sources.map(s => s.kind);
    expect(kinds).toEqual(['hal', 'hal', 'crossref', 'openalex', 'institutional', 'institutional', 'institutional', 'wikipedia']);
  });

  it('« Documents + Internet » (scolaire) : mêmes sources que « Internet », sites officiels avant Wikipédia', async () => {
    const outcome = await runResearch({ ...QUERY, mode: 'documents_internet' }, NO_SEARX, deps(router(), fakePages()), BUDGET);
    expect(outcome.sources.map(s => s.kind)).toEqual(['institutional', 'institutional', 'institutional', 'wikipedia']);
  });

  it('restriction levée par l’administrateur : une redirection hors du catalogue donne une page « web », jamais « officielle »', async () => {
    const fetchPage = fakePages({ [EDUSCOL]: { url: 'https://autre.example.net/page', title: 'Autre site' } });
    const outcome = await runResearch(QUERY, { ...NO_SEARX, trustedOnly: false }, deps(router(), fetchPage), BUDGET);
    const other = outcome.sources.find(s => s.url === 'https://autre.example.net/page');
    expect(other).toMatchObject({ kind: 'web', title: 'Autre site' });
    expect(other?.venue).toBeUndefined();
  });

  it('seules des adresses de Wikipédia sont demandées : le sujet n’est jamais envoyé aux sites officiels', async () => {
    const fetchImpl = router();
    const fetchPage = fakePages();
    await runResearch({ ...QUERY, text: 'la gouvernance des SI séquence confidentielle Dupont' }, NO_SEARX, deps(fetchImpl, fetchPage), BUDGET);
    for (const url of fetchPage.calls) {
      expect(new URL(url).search).not.toMatch(/gouvernance|Dupont/i);
      expect(url).toBe(Object.values(EXTERNAL_LINKS).flat().find(l => l === url));
    }
    expect(fetchImpl.calls.every(c => new URL(c.url).hostname === 'fr.wikipedia.org')).toBe(true);
  });
});
