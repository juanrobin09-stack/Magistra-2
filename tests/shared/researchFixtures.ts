// Réponses SIMULÉES des services de recherche, conformes à leur documentation publique (HAL, Crossref, OpenAlex,
// MediaWiki, SearXNG) : aucun accès réseau. Partagées par les tests de la recherche (research*.test.ts, pipeline).

import type { FetchedPage, ResearchConfig, ResearchDeps } from '../../shared/research/index';
import { jsonResponse, mockFetch, textResponse } from './helpers';

export const HAL_RESPONSE = {
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

export const CROSSREF_RESPONSE = {
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

/** Index inversé d'OpenAlex ({ mot: [positions] }) d'un texte. */
export function invertedIndex(text: string): Record<string, number[]> {
  const index: Record<string, number[]> = {};
  text.split(' ').forEach((word, position) => {
    (index[word] ??= []).push(position);
  });
  return index;
}

export const OPENALEX_RESPONSE = {
  meta: { count: 2, db_response_time_ms: 41, page: 1, per_page: 3 },
  results: [
    {
      id: 'https://openalex.org/W2741809807',
      doi: 'https://doi.org/10.3917/sim.192.0045', // même article que HAL et Crossref : doit être dédoublonné
      title: 'La gouvernance des systèmes d’information',
      publication_year: 2019,
      authorships: [{ author: { id: 'https://openalex.org/A1', display_name: 'Anne Martin' } }],
      primary_location: { source: { display_name: 'Systèmes d’information et management' }, landing_page_url: 'https://doi.org/10.3917/sim.192.0045' },
      abstract_inverted_index: invertedIndex('Cet article analyse la gouvernance des systèmes d’information dans les organisations publiques françaises.'),
      type: 'article',
    },
    {
      id: 'https://openalex.org/W3000000001',
      doi: 'https://doi.org/10.1016/j.accinf.2021.100512',
      title: 'Digital governance and <i>audit</i> quality',
      publication_year: 2021,
      authorships: [{ author: { display_name: 'Maria Lopez' } }, { author: { display_name: 'Chen Wei' } }],
      primary_location: { source: { display_name: 'International Journal of Accounting Information Systems' }, landing_page_url: 'https://www.sciencedirect.com/science/article/pii/S1467089521000099' },
      abstract_inverted_index: invertedIndex('Governance frameworks improve audit quality in digital organisations according to a survey of 300 European firms.'),
      type: 'article',
    },
  ],
};

export const LONG_WIKI = [
  'La gouvernance des systèmes d’information désigne le dispositif qui encadre les décisions relatives au SI.',
  ...Array.from({ length: 40 }, (_, i) => `Paragraphe annexe ${i} sur l’histoire des ordinateurs centraux et des mainframes, sans rapport direct avec le sujet traité.`),
  'Les référentiels de gouvernance comme COBIT structurent l’alignement stratégique et la maîtrise des risques du système d’information.',
].join('\n\n');

/**
 * Liens externes (https) que MediaWiki renvoie pour chaque page (prop=extlinks, formatversion=2) : références vers des sites
 * vérifiés (dont une page d'accueil, deux pages d'un même hôte), vers un site quelconque, et vers un faux hôte.
 */
export const EXTERNAL_LINKS: Record<string, string[]> = {
  '101': [
    'https://www.unesco.org/',
    'https://example.org/blog/gouvernance',
    'https://www.unesco.org/fr/articles/gouvernance-numerique',
    'https://www.unesco.org/fr/articles/autre-page',
    'https://theses.fr/2019SACLS001',
    'https://www.cnrs.fr/fr/gouvernance-des-donnees',
    'https://eduscol.education.fr/sciences/gouvernance-si',
    'https://evilunesco.org/fr/page',
    'https://www.legifrance.gouv.fr/search/all?q=gouvernance',
  ],
  '102': ['https://www.ilo.org/fr/gouvernance', 'https://www.cnrs.fr/fr/autre-page'],
};

export function wikiHandler(url: string): Response {
  const params = new URL(url).searchParams;
  if (params.get('list') === 'search') return jsonResponse({ query: { search: [{ pageid: 101, title: 'Gouvernance des systèmes d’information' }, { pageid: 102, title: 'COBIT' }] } });
  const id = params.get('pageids') ?? '';
  if (params.get('prop') === 'extlinks') {
    const links = EXTERNAL_LINKS[id];
    return links
      ? jsonResponse({ batchcomplete: true, query: { pages: [{ pageid: Number(id), ns: 0, title: 'Page', extlinks: links.map(u => ({ url: u })) }] } })
      : jsonResponse({ batchcomplete: true, query: { pages: [{ pageid: Number(id), ns: 0, title: 'Page' }] } });
  }
  if (id === '101') return jsonResponse({ query: { pages: { 101: { title: 'Gouvernance des systèmes d’information', extract: LONG_WIKI, fullurl: 'https://fr.wikipedia.org/wiki/Gouvernance_des_SI' } } } });
  if (id === '102') return textResponse('erreur', 500); // une page en échec n'empêche pas les autres
  return textResponse('?', 404);
}

/** Réponse de SearXNG selon la requête : chaque lot « site: » ne renvoie que les pages de ses propres sites. */
export function searxHandler(url: string): Response {
  const q = new URL(url).searchParams.get('q') ?? '';
  if (q.includes('site:education.gouv.fr')) {
    return jsonResponse({ results: [
      { url: 'https://eduscol.education.fr/1234/programme-cycle-3', title: 'Programme du cycle 3', content: 'Le programme du cycle 3 précise les attendus de fin de cycle en mathématiques, dont les fractions simples et décimales.' },
      { url: 'https://www.education.gouv.fr/bo/2024/Hebdo1', title: 'Bulletin officiel', content: 'Bulletin officiel de l’éducation nationale : programmes en vigueur à la rentrée, mathématiques au cycle 3 et fractions.' },
      { url: 'javascript:alert(1)', title: 'piège', content: 'x' },
      { url: 'https://blog.example.org/fractions', title: 'Un blog qui répond à une requête « site: »', content: 'Un blog d’enseignant propose des activités de manipulation pour introduire les fractions au CM1.' },
      { url: 'http://www.education.gouv.fr/ancien/fractions', title: 'Ancienne adresse en http', content: 'Ancienne page servie en http, que seule une adresse https remplace : fractions et décimaux au cycle 3.' },
    ] });
  }
  if (q.includes('site:unesco.org')) {
    return jsonResponse({ results: [{ url: 'https://www.unesco.org/fr/articles/enseigner-les-fractions', title: 'Enseigner les mathématiques', content: 'L’UNESCO publie des ressources sur l’enseignement des mathématiques et des fractions à l’école primaire dans le monde.' }] });
  }
  if (q.includes('site:cnrs.fr')) {
    return jsonResponse({ results: [{ url: 'https://www.cnrs.fr/fr/les-fractions', title: 'Les fractions, histoire d’un nombre', content: 'Le CNRS retrace l’histoire des fractions, des Égyptiens aux mathématiques modernes, en passant par les Babyloniens.' }] });
  }
  if (q.includes('site:')) return jsonResponse({ results: [] });
  return jsonResponse({ results: [
    { url: 'https://blog.example.org/fractions', title: 'Enseigner les fractions', content: 'Un blog d’enseignant propose des activités de manipulation pour introduire les fractions au CM1.' },
    { url: 'https://eduscol.education.fr/1234/programme-cycle-3/', title: 'Programme du cycle 3 (doublon)', content: 'Doublon de la page Éduscol déjà trouvée, avec une barre oblique finale en plus.' },
    { url: 'https://court.example.org', title: 'Trop court', content: 'Trop court.' },
  ] });
}

export type Handlers = Partial<Record<'hal' | 'crossref' | 'openalex' | 'searx' | 'wiki', (url: string) => Response>>;

/** fetch simulé qui aiguille chaque appel vers le service d'après son nom d'hôte (hôte inconnu : erreur). */
export function router(overrides: Handlers = {}) {
  return mockFetch(url => {
    const host = new URL(url).hostname;
    if (host === 'api.archives-ouvertes.fr') return (overrides.hal ?? (() => jsonResponse(HAL_RESPONSE)))(url);
    if (host === 'api.crossref.org') return (overrides.crossref ?? (() => jsonResponse(CROSSREF_RESPONSE)))(url);
    if (host === 'api.openalex.org') return (overrides.openalex ?? (() => jsonResponse(OPENALEX_RESPONSE)))(url);
    if (host === 'searx.example.fr') return (overrides.searx ?? searxHandler)(url);
    if (host === 'fr.wikipedia.org') return (overrides.wiki ?? wikiHandler)(url);
    throw new Error(`Hôte inattendu : ${host}`);
  });
}

export const CONFIG: ResearchConfig = { academic: true, wikipedia: true, searxngUrl: 'https://searx.example.fr/', crossrefMailto: 'contact@magistra.example', timeoutMs: 2_000 };
/** Cas normal d'un enseignant : pas de SearXNG. */
export const NO_SEARX: ResearchConfig = { ...CONFIG, searxngUrl: undefined };

/**
 * Récupération de pages simulée (fetchPage) : une page par adresse demandée, avec ses adresses d'appel. `overrides` :
 * null = page refusée ou illisible ; un objet = champs remplacés (adresse finale après redirection, texte, titre).
 */
export function fakePages(overrides: Record<string, Partial<FetchedPage> | null> = {}) {
  const calls: string[] = [];
  const fetchPage = async (url: string): Promise<FetchedPage | null> => {
    calls.push(url);
    const override = url in overrides ? overrides[url] : {};
    if (override === null) return null;
    const host = new URL(url).hostname;
    return {
      url,
      title: `Page officielle de ${host}`,
      text: `Contenu officiel de ${host} sur la gouvernance des systèmes d’information : définitions, cadre juridique et ressources pour les enseignants.`,
      ...override,
    };
  };
  return Object.assign(fetchPage, { calls });
}

export const deps = (fetchImpl: ReturnType<typeof mockFetch>, fetchPage?: ResearchDeps['fetchPage']): ResearchDeps => ({
  fetch: fetchImpl,
  ...(fetchPage ? { fetchPage } : {}),
});
