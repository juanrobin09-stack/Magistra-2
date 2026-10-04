// Recherche sur les sites officiels vérifiés avec le VRAI récupérateur de pages (server/safeFetch.ts) et un transport
// factice : une redirection ne mène jamais à un hôte hors du catalogue AVANT toute connexion (ni DNS, ni socket), et
// l'adresse finale d'une page doit être une page citable (ni accueil, ni connexion, ni recherche). Aucun accès réseau.

import { describe, expect, it } from 'vitest';
import { createSafePageFetcher, type ResolvedAddress, type Transport } from '../../server/safeFetch.js';
import { NO_OFFICIAL_FOUND_MESSAGE, runResearch, type FetchedPage } from '../../shared/research/index';
import { jsonResponse } from '../shared/helpers';
import { CONFIG as BASE_CONFIG, deps, NO_SEARX as BASE_NO_SEARX, router, wikiHandler } from '../shared/researchFixtures';

const CONFIG = { ...BASE_CONFIG, academic: false };
const NO_SEARX = { ...BASE_NO_SEARX, academic: false };

const PUBLIC_IP = '93.184.215.14';
const QUERY = { text: 'la gouvernance des SI', topic: 'gouvernance des SI', mode: 'internet', group: 'college' } as const;
const BUDGET = { budgetChars: 60_000 };

const html = (body: string, title = 'Page') => new Response(`<html><head><title>${title}</title></head><body><p>${body}</p></body></html>`, {
  status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' },
});
const redirect = (to: string) => () => new Response(null, { status: 302, headers: { Location: to } });
const LONG = 'Texte de la page : définitions, cadre juridique et ressources pour les enseignants sur la gouvernance des systèmes d’information.';

/**
 * Le monde : chaque adresse a sa réponse. Tout nom d'hôte se résout vers une adresse PUBLIQUE : seul le prédicat de la
 * recherche peut empêcher qu'un hôte hors catalogue soit contacté.
 */
function world(pages: Record<string, () => Response>) {
  const resolved: string[] = [];
  const contacted: string[] = [];
  const resolve = async (host: string): Promise<ResolvedAddress[]> => {
    resolved.push(host);
    return [{ address: PUBLIC_IP, family: 4 }];
  };
  const transport: Transport = async url => {
    contacted.push(url.hostname);
    return pages[url.href]?.() ?? new Response('introuvable', { status: 404 });
  };
  const fetcher = createSafePageFetcher({ resolve, fetch: transport });
  const fetchPage = async (url: string, signal?: AbortSignal, options?: Parameters<typeof fetcher>[2]): Promise<FetchedPage | null> => fetcher(url, signal, options);
  return { resolved, contacted, fetchPage };
}

/** Wikipédia : deux pages trouvées, dont les références (liens externes) sont `links`. */
function wikiWith(links: string[]) {
  return (url: string) => (new URL(url).searchParams.get('prop') === 'extlinks'
    ? jsonResponse({ query: { pages: [{ pageid: 1, extlinks: new URL(url).searchParams.get('pageids') === '101' ? links.map(u => ({ url: u })) : [] }] } })
    : wikiHandler(url));
}

/** SearXNG : chaque requête « site: » renvoie les mêmes résultats. */
function searxWith(urls: string[]) {
  return (url: string) => (new URL(url).searchParams.get('q')?.includes('site:')
    ? jsonResponse({ results: urls.map((u, i) => ({ url: u, title: `Résultat ${i}`, content: `Extrait ${i} fourni par le moteur de recherche, sur le sujet.` })) })
    : jsonResponse({ results: [] }));
}

describe('références de Wikipédia (sans SearXNG) : redirections avec le vrai récupérateur', () => {
  it('lien doi.org de Wikipédia (enregistrable par n’importe qui) : jamais sélectionné, ni lui ni l’éditeur ne sont contactés', async () => {
    const w = world({
      'https://doi.org/10.5555/attacker': redirect('https://attacker.example/landing'),
      'https://attacker.example/landing': () => html(LONG),
      'https://www.unesco.org/fr/articles/gouvernance-numerique': () => html(LONG, 'Gouvernance numérique'),
    });
    const wiki = wikiWith(['https://doi.org/10.5555/attacker', 'https://dx.doi.org/10.5555/attacker', 'https://www.unesco.org/fr/articles/gouvernance-numerique']);
    const outcome = await runResearch(QUERY, NO_SEARX, deps(router({ wiki }), w.fetchPage), BUDGET);
    expect(w.contacted).toEqual(['www.unesco.org']);
    expect(w.resolved).toEqual(['www.unesco.org']);
    expect(outcome.sources.filter(s => s.kind === 'institutional').map(s => s.url)).toEqual(['https://www.unesco.org/fr/articles/gouvernance-numerique']);
  });

  it('lien d’un site du catalogue qui redirige vers un hôte quelconque : l’hôte n’est jamais résolu ni contacté, la page est écartée', async () => {
    const w = world({
      'https://www.unesco.org/fr/redirection': redirect('https://attacker.example/landing'),
      'https://attacker.example/landing': () => html(LONG),
    });
    const outcome = await runResearch(QUERY, NO_SEARX, deps(router({ wiki: wikiWith(['https://www.unesco.org/fr/redirection']) }), w.fetchPage), BUDGET);
    expect(w.contacted).toEqual(['www.unesco.org']);
    expect(w.resolved).not.toContain('attacker.example');
    expect(outcome.sources.map(s => s.kind)).toEqual(['wikipedia']);
    expect(outcome.warnings).toEqual([{ code: 'INSTITUTIONAL_UNAVAILABLE', message: NO_OFFICIAL_FOUND_MESSAGE }]);
  });

  it('redirection vers http, vers un suffixe collé ou vers le même nom avec identifiants : refusée avant la connexion', async () => {
    const w = world({
      'https://www.unesco.org/fr/a': redirect('http://www.unesco.org/fr/a'),
      'https://www.who.int/fr/b': redirect('https://who.int.attacker.example/b'),
      'https://www.fao.org/fr/c': redirect('https://www.fao.org@attacker.example/c'),
    });
    const wiki = wikiWith(['https://www.unesco.org/fr/a', 'https://www.who.int/fr/b', 'https://www.fao.org/fr/c']);
    await runResearch(QUERY, NO_SEARX, deps(router({ wiki }), w.fetchPage), BUDGET);
    expect(w.contacted.sort()).toEqual(['www.fao.org', 'www.unesco.org', 'www.who.int']);
    expect(w.resolved.some(h => /attacker/.test(h))).toBe(false);
  });

  it('redirection d’un site du catalogue vers un autre : suivie, la source porte l’adresse finale, le nom et le niveau du site final', async () => {
    const w = world({
      'https://www.education.gouv.fr/fr/ancienne-page': redirect('https://www.who.int/fr/nouvelle-page'),
      'https://www.who.int/fr/nouvelle-page': () => html(LONG, 'Nouvelle page de l’OMS'),
    });
    const outcome = await runResearch(QUERY, NO_SEARX, deps(router({ wiki: wikiWith(['https://www.education.gouv.fr/fr/ancienne-page']) }), w.fetchPage), BUDGET);
    expect(w.contacted).toEqual(['www.education.gouv.fr', 'www.who.int']);
    expect(outcome.sources.find(s => s.kind === 'institutional')).toMatchObject({
      url: 'https://www.who.int/fr/nouvelle-page', venue: 'OMS', title: 'Nouvelle page de l’OMS',
    });
    expect(outcome.warnings).toEqual([]);
  });

  it('page d’un site du catalogue qui redirige vers l’accueil, une page de connexion ou /cas/ : écartée, « aucune source officielle »', async () => {
    const w = world({
      'https://www.education.gouv.fr/old-page': redirect('https://www.education.gouv.fr/'),
      'https://www.education.gouv.fr/': () => html(`Accueil. Menu : actualités, ministère, espace presse. ${LONG}`, 'Accueil'),
      'https://www.ac-lyon.fr/ressources/x': redirect('https://cas.education.gouv.fr/login?service=x'),
      'https://cas.education.gouv.fr/login?service=x': () => html(`Connexion. Identifiant, mot de passe. ${LONG}`, 'Connexion'),
      'https://www.ac-paris.fr/y': redirect('https://www.education.gouv.fr/cas/'),
      'https://www.education.gouv.fr/cas/': () => html(`Authentification centralisée. ${LONG}`, 'CAS'),
    });
    const wiki = wikiWith(['https://www.education.gouv.fr/old-page', 'https://www.ac-lyon.fr/ressources/x', 'https://www.ac-paris.fr/y']);
    const outcome = await runResearch(QUERY, NO_SEARX, deps(router({ wiki }), w.fetchPage), BUDGET);
    expect(outcome.sources.map(s => s.kind)).toEqual(['wikipedia']);
    expect(outcome.sources.some(s => /Menu : actualités|Identifiant, mot de passe|Authentification centralisée/.test(s.text))).toBe(false);
    expect(outcome.warnings).toEqual([{ code: 'INSTITUTIONAL_UNAVAILABLE', message: NO_OFFICIAL_FOUND_MESSAGE }]);
  });

  it('restriction levée par l’administrateur : la redirection hors du catalogue est suivie (web général), mais la page n’est jamais « officielle »', async () => {
    const w = world({
      'https://www.unesco.org/fr/redirection': redirect('https://autre.example/landing'),
      'https://autre.example/landing': () => html(LONG, 'Autre site'),
    });
    const outcome = await runResearch(QUERY, { ...NO_SEARX, trustedOnly: false }, deps(router({ wiki: wikiWith(['https://www.unesco.org/fr/redirection']) }), w.fetchPage), BUDGET);
    expect(w.contacted).toEqual(['www.unesco.org', 'autre.example']);
    expect(outcome.sources.find(s => s.url === 'https://autre.example/landing')).toMatchObject({ kind: 'web' });
  });
});

describe('SearXNG : redirections avec le vrai récupérateur', () => {
  it('résultat d’un site du catalogue qui redirige vers un hôte quelconque : l’hôte n’est jamais résolu ni contacté', async () => {
    const w = world({ 'https://www.unesco.org/fr/redirection': redirect('https://attacker.example/landing'), 'https://attacker.example/landing': () => html(LONG) });
    const searx = searxWith(['https://www.unesco.org/fr/redirection']);
    const outcome = await runResearch(QUERY, { ...CONFIG, wikipedia: false }, deps(router({ searx }), w.fetchPage), BUDGET);
    expect(w.contacted).toEqual(['www.unesco.org']);
    expect(w.resolved).toEqual(['www.unesco.org']);
    // L'extrait fourni par le moteur de recherche reste utilisé, sous l'adresse demandée (aucune page n'a été lue).
    expect(outcome.sources.map(s => [s.kind, s.url])).toEqual([['institutional', 'https://www.unesco.org/fr/redirection']]);
    expect(outcome.sources[0].text).not.toMatch(/attacker/);
  });

  it('résultat doi.org : écarté (il ne fait que renvoyer ailleurs), jamais contacté', async () => {
    const w = world({ 'https://doi.org/10.5555/attacker': redirect('https://attacker.example/landing') });
    const outcome = await runResearch(QUERY, { ...CONFIG, wikipedia: false }, deps(router({ searx: searxWith(['https://doi.org/10.5555/attacker']) }), w.fetchPage), BUDGET);
    expect(w.contacted).toEqual([]);
    expect(w.resolved).toEqual([]);
    expect(outcome.sources).toEqual([]);
    expect(outcome.warnings).toContainEqual({ code: 'INSTITUTIONAL_UNAVAILABLE', message: NO_OFFICIAL_FOUND_MESSAGE });
  });

  it('redirection catalogue → catalogue : suivie ; adresse finale, nom du site, niveau et titre viennent de la page finale', async () => {
    const w = world({
      'https://www.education.gouv.fr/a': redirect('https://www.who.int/b'),
      'https://www.who.int/b': () => html(LONG, 'Page finale de l’OMS'),
    });
    const outcome = await runResearch(QUERY, { ...CONFIG, wikipedia: false }, deps(router({ searx: searxWith(['https://www.education.gouv.fr/a']) }), w.fetchPage), BUDGET);
    expect(w.contacted).toEqual(['www.education.gouv.fr', 'www.who.int']);
    expect(outcome.sources).toHaveLength(1);
    expect(outcome.sources[0]).toMatchObject({ kind: 'institutional', url: 'https://www.who.int/b', venue: 'OMS', title: 'Page finale de l’OMS' });
    expect(outcome.sources[0].text).toContain('Texte de la page');
  });

  it('deux résultats qui aboutissent à la même page : une seule source (dédoublonnage sur l’adresse finale)', async () => {
    const w = world({
      'https://www.education.gouv.fr/a': redirect('https://www.who.int/b'),
      'https://www.unesco.org/c': redirect('https://www.who.int/b'),
      'https://www.who.int/b': () => html(LONG, 'Page finale'),
    });
    const outcome = await runResearch(QUERY, { ...CONFIG, wikipedia: false }, deps(router({ searx: searxWith(['https://www.education.gouv.fr/a', 'https://www.unesco.org/c']) }), w.fetchPage), BUDGET);
    expect(outcome.sources.map(s => s.url)).toEqual(['https://www.who.int/b']);
  });

  it('page d’un site du catalogue qui redirige vers l’accueil ou une page de connexion : écartée', async () => {
    const w = world({
      'https://www.education.gouv.fr/old-page': redirect('https://www.education.gouv.fr/'),
      'https://www.education.gouv.fr/': () => html(`Accueil. Menu : actualités. ${LONG}`),
      'https://www.unesco.org/old': redirect('https://cas.education.gouv.fr/login?service=x'),
      'https://cas.education.gouv.fr/login?service=x': () => html(`Connexion. ${LONG}`),
    });
    const searx = searxWith(['https://www.education.gouv.fr/old-page', 'https://www.unesco.org/old']);
    const outcome = await runResearch(QUERY, { ...CONFIG, wikipedia: false }, deps(router({ searx }), w.fetchPage), BUDGET);
    expect(outcome.sources).toEqual([]);
    expect(outcome.warnings).toContainEqual({ code: 'INSTITUTIONAL_UNAVAILABLE', message: NO_OFFICIAL_FOUND_MESSAGE });
  });

  it('un résultat « site: » qui est l’accueil ou une page de connexion du catalogue n’est pas retenu non plus', async () => {
    const w = world({});
    const outcome = await runResearch(
      QUERY, { ...CONFIG, wikipedia: false },
      deps(router({ searx: searxWith(['https://www.education.gouv.fr/', 'https://cas.education.gouv.fr/login?service=x', 'https://www.education.gouv.fr/index.html']) }), w.fetchPage),
      BUDGET,
    );
    expect(outcome.sources).toEqual([]);
    expect(w.contacted).toEqual([]);
  });
});
