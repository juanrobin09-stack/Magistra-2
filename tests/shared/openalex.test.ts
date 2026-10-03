// Connecteur OpenAlex (https://api.openalex.org/works) : réponses simulées conformes à la documentation (index inversé du
// résumé, DOI sous forme d'adresse), entrées vides ou hostiles, erreurs HTTP.

import { describe, expect, it } from 'vitest';
import { abstractFromInvertedIndex, NO_ABSTRACT_TEXT, searchOpenAlex } from '../../shared/research/providers';
import { jsonResponse, mockFetch, networkError, textResponse } from './helpers';
import { invertedIndex, OPENALEX_RESPONSE } from './researchFixtures';

const OPTS = { rows: 3, timeoutMs: 1_000 };
const work = (extra: Record<string, unknown> = {}) => ({
  id: 'https://openalex.org/W1',
  doi: 'https://doi.org/10.1000/abc',
  title: 'Un article',
  publication_year: 2020,
  authorships: [{ author: { display_name: 'Anne Martin' } }],
  primary_location: { source: { display_name: 'Revue X' }, landing_page_url: 'https://revue.example.org/a' },
  abstract_inverted_index: invertedIndex('Un résumé réel de quelques mots.'),
  type: 'article',
  ...extra,
});
const search = (results: unknown, opts: Partial<typeof OPTS & { mailto: string }> = {}) =>
  searchOpenAlex('photosynthèse', { fetch: mockFetch(() => jsonResponse({ results })) }, { ...OPTS, ...opts });

describe('searchOpenAlex — réponse normale', () => {
  it('titre, auteurs, année, revue, DOI sans préfixe, adresse du DOI, résumé reconstruit', async () => {
    const fetchImpl = mockFetch(() => jsonResponse(OPENALEX_RESPONSE));
    const sources = await searchOpenAlex('gouvernance des SI', { fetch: fetchImpl }, { ...OPTS, mailto: 'contact@magistra.example' });
    expect(sources).toHaveLength(2);
    expect(sources[0]).toEqual({
      kind: 'openalex',
      title: 'La gouvernance des systèmes d’information',
      authors: ['Anne Martin'],
      year: 2019,
      venue: 'Systèmes d’information et management',
      doi: '10.3917/sim.192.0045',
      url: 'https://doi.org/10.3917/sim.192.0045',
      text: 'Cet article analyse la gouvernance des systèmes d’information dans les organisations publiques françaises.',
    });
    expect(sources[1]).toMatchObject({
      kind: 'openalex',
      title: 'Digital governance and audit quality',
      authors: ['Maria Lopez', 'Chen Wei'],
      year: 2021,
      venue: 'International Journal of Accounting Information Systems',
      doi: '10.1016/j.accinf.2021.100512',
      url: 'https://doi.org/10.1016/j.accinf.2021.100512',
      text: 'Governance frameworks improve audit quality in digital organisations according to a survey of 300 European firms.',
    });
  });

  it('requête : /works avec search, filtre has_abstract, per-page, champs demandés et mailto', async () => {
    const fetchImpl = mockFetch(() => jsonResponse(OPENALEX_RESPONSE));
    await searchOpenAlex('gouvernance des SI', { fetch: fetchImpl }, { ...OPTS, mailto: 'contact@magistra.example' });
    const url = new URL(fetchImpl.calls[0].url);
    expect(url.origin + url.pathname).toBe('https://api.openalex.org/works');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      search: 'gouvernance des SI',
      filter: 'has_abstract:true',
      'per-page': '3',
      select: 'id,doi,title,publication_year,authorships,primary_location,abstract_inverted_index,type',
      mailto: 'contact@magistra.example',
    });
    expect(new Headers(fetchImpl.calls[0].init?.headers).get('Accept')).toBe('application/json');
  });

  it('sans adresse de contact : aucun paramètre mailto', async () => {
    const fetchImpl = mockFetch(() => jsonResponse({ results: [] }));
    await searchOpenAlex('x', { fetch: fetchImpl }, OPTS);
    expect(new URL(fetchImpl.calls[0].url).searchParams.has('mailto')).toBe(false);
  });

  it('auteurs : 8 au plus, noms vides ou absents ignorés ; année absente ou non numérique ignorée', async () => {
    const authorships = [
      ...Array.from({ length: 12 }, (_, i) => ({ author: { display_name: `Auteur ${i + 1}` } })),
    ];
    const [many] = await search([work({ authorships })]);
    expect(many.authors).toEqual(Array.from({ length: 8 }, (_, i) => `Auteur ${i + 1}`));
    const [odd] = await search([work({ authorships: [null, {}, { author: null }, { author: { display_name: '  ' } }, { author: { display_name: 42 } }, { author: { display_name: 'Seule' } }], publication_year: '2020' })]);
    expect(odd.authors).toEqual(['Seule']);
    expect(odd.year).toBeUndefined();
    const [none] = await search([work({ authorships: 'x', publication_year: null })]);
    expect(none.authors).toEqual([]);
    expect(none.year).toBeUndefined();
  });

  it('titre et résumé : balises retirées, résumé coupé à 2 000 caractères', async () => {
    const long = Array.from({ length: 800 }, (_, i) => `mot${i}`).join(' ');
    const [source] = await search([work({ title: 'Étude <i>in vitro</i> &amp; clinique', abstract_inverted_index: invertedIndex(long) })]);
    expect(source.title).toBe('Étude in vitro & clinique');
    expect(source.text.length).toBe(2_001);
    expect(source.text.endsWith('…')).toBe(true);
    expect(source.text.startsWith('mot0 mot1 mot2')).toBe(true);
  });
});

describe('searchOpenAlex — résumé absent', () => {
  it('sans index, index vide ou index illisible : seules les métadonnées sont annoncées', async () => {
    const sources = await search([
      work({ abstract_inverted_index: null }),
      work({ title: 'Deux', abstract_inverted_index: undefined }),
      work({ title: 'Trois', abstract_inverted_index: {} }),
      work({ title: 'Quatre', abstract_inverted_index: 'texte' }),
      work({ title: 'Cinq', abstract_inverted_index: ['a', 'b'] }),
      work({ title: 'Six', abstract_inverted_index: 42 }),
    ]);
    expect(sources).toHaveLength(6);
    for (const s of sources) expect(s.text).toBe(NO_ABSTRACT_TEXT);
  });
});

describe('abstractFromInvertedIndex — entrées hostiles', () => {
  it('reconstruit dans l’ordre des positions, trous ignorés, premier mot gardé sur une position partagée', () => {
    expect(abstractFromInvertedIndex({ le: [0, 4], chat: [1], mange: [2], la: [3], souris: [5], x: [1] })).toBe('le chat mange la le souris');
    expect(abstractFromInvertedIndex({ a: [0], b: [5] })).toBe('a b');
  });

  it('clés ou valeurs non conformes : positions non numériques, négatives, énormes, décimales ou booléennes ignorées', () => {
    const index = {
      bon: [0],
      objet: { 0: 1, abc: 2 },
      chaine: 'texte',
      nombre: 7,
      nul: null,
      texte: ['1', '2'],
      negatif: [-1, -100],
      enorme: [1e9, Number.MAX_SAFE_INTEGER, 3_000],
      decimal: [1.5, 2.25],
      booleen: [true, false],
      imbrique: [[1], { 0: 2 }],
      limite: [2_999],
    };
    expect(abstractFromInvertedIndex(index)).toBe('bon limite');
  });

  it('mots vides ou démesurés ignorés, balises du résumé retirées par le connecteur', async () => {
    expect(abstractFromInvertedIndex({ '': [0], [`m${'x'.repeat(200)}`]: [1], ok: [2] })).toBe('ok');
    const [source] = await search([work({ abstract_inverted_index: { '<script>alert(1)</script>': [0], résumé: [1] } })]);
    expect(source.text).toBe('résumé');
  });

  it('« __proto__ » et noms d’objets : aucune pollution, aucune exception', () => {
    const hostile = JSON.parse('{"__proto__": [0], "constructor": [1], "toString": [2], "hasOwnProperty": [3]}') as Record<string, number[]>;
    expect(abstractFromInvertedIndex(hostile)).toBe('__proto__ constructor toString hasOwnProperty');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  });

  it('3 000 mots au plus, positions au-delà ignorées', () => {
    const words = Array.from({ length: 4_000 }, (_, i) => `w${i}`);
    const index: Record<string, number[]> = {};
    words.forEach((w, i) => { index[w] = [i]; });
    const text = abstractFromInvertedIndex(index);
    const out = text.split(' ');
    expect(out).toHaveLength(3_000);
    expect(out[0]).toBe('w0');
    expect(out[2_999]).toBe('w2999');
  });

  it('tableaux géants ignorés sans être parcourus, milliers de clés : temps borné', () => {
    const giant = new Array<number>(2_000_000).fill(0);
    const started = performance.now();
    expect(abstractFromInvertedIndex({ geant: giant, ok: [0] })).toBe('ok');
    const many: Record<string, number[]> = {};
    for (let i = 0; i < 300_000; i++) many[`k${i}`] = [i % 3_000];
    const text = abstractFromInvertedIndex(many);
    expect(text.split(' ').length).toBeLessThanOrEqual(3_000);
    expect(performance.now() - started).toBeLessThan(2_000);
    // Un mot qui revient 3 000 fois est admis, 3 001 fois : ignoré.
    expect(abstractFromInvertedIndex({ a: Array.from({ length: 3_000 }, (_, i) => i) }).split(' ')).toHaveLength(3_000);
    expect(abstractFromInvertedIndex({ a: Array.from({ length: 3_001 }, (_, i) => i) })).toBe('');
  });

  it('au plus 5 000 mots-clés parcourus : les suivants sont ignorés', () => {
    const index: Record<string, number[]> = {};
    for (let i = 0; i < 5_000; i++) index[`vide${i}`] = [];
    index.tardif = [0];
    expect(abstractFromInvertedIndex(index)).toBe('');
    delete index.vide0;
    expect(abstractFromInvertedIndex(index)).toBe('tardif');
  });

  it('au plus 20 000 positions parcourues : une entrée qui arrive après est ignorée', () => {
    const index: Record<string, number[]> = {};
    for (let i = 0; i < 8; i++) index[`invalide${i}`] = new Array<number>(3_000).fill(-1);
    index.tardif = [0];
    expect(abstractFromInvertedIndex(index)).toBe('');
    const fewer: Record<string, number[]> = {};
    for (let i = 0; i < 6; i++) fewer[`invalide${i}`] = new Array<number>(3_000).fill(-1);
    fewer.tardif = [0];
    expect(abstractFromInvertedIndex(fewer)).toBe('tardif');
  });

  it('index qui n’est pas un objet : texte vide', () => {
    for (const value of [undefined, null, 'x', 3, true, ['a'], []]) expect(abstractFromInvertedIndex(value)).toBe('');
  });
});

describe('searchOpenAlex — DOI et adresse', () => {
  it('DOI normalisé : préfixe https://doi.org/, http, dx.doi.org ou doi: retiré ; adresse construite sur doi.org', async () => {
    const sources = await search([
      work({ doi: 'https://doi.org/10.1000/ABC.def' }),
      work({ title: 'B', doi: 'http://dx.doi.org/10.1000/b-2' }),
      work({ title: 'C', doi: 'doi:10.1000/c' }),
      work({ title: 'D', doi: '10.1000/d' }),
      work({ title: 'E', doi: '  https://DOI.org/10.1000/e  ' }),
    ]);
    expect(sources.map(s => s.doi)).toEqual(['10.1000/ABC.def', '10.1000/b-2', '10.1000/c', '10.1000/d', '10.1000/e']);
    expect(sources.map(s => s.url)).toEqual(sources.map(s => `https://doi.org/${s.doi}`));
  });

  it('sans DOI valide : adresse de la page d’accueil de l’article, https seulement', async () => {
    const sources = await search([
      work({ title: 'A', doi: null, primary_location: { landing_page_url: 'https://revue.example.org/article/12' } }),
      work({ title: 'B', doi: 'pas un doi', primary_location: { landing_page_url: 'https://revue.example.org/b' } }),
      work({ title: 'C', doi: '10.12/trop-court', primary_location: { landing_page_url: 'http://revue.example.org/c' } }),
      work({ title: 'D', doi: undefined, primary_location: { landing_page_url: 'javascript:alert(1)' } }),
      work({ title: 'E', doi: undefined, primary_location: { landing_page_url: 'https://moi:secret@revue.example.org/e' } }),
      work({ title: 'F', doi: undefined, primary_location: { landing_page_url: 'ftp://revue.example.org/f' } }),
      work({ title: 'G', doi: undefined, primary_location: { landing_page_url: 'revue.example.org/g' } }),
      work({ title: 'H', doi: undefined, primary_location: null }),
      work({ title: 'I', doi: undefined, primary_location: { landing_page_url: 42 } }),
    ]);
    expect(sources.map(s => s.doi)).toEqual(Array(9).fill(undefined));
    expect(sources.map(s => s.url)).toEqual([
      'https://revue.example.org/article/12', 'https://revue.example.org/b', undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    ]);
  });

  it('le DOI l’emporte sur l’adresse de la page d’accueil', async () => {
    const [source] = await search([work()]);
    expect(source.url).toBe('https://doi.org/10.1000/abc');
  });

  it('revue : seulement un nom non vide', async () => {
    const sources = await search([
      work({ title: 'A', primary_location: { source: { display_name: '  ' } } }),
      work({ title: 'B', primary_location: { source: null } }),
      work({ title: 'C', primary_location: { source: { display_name: 7 } } }),
    ]);
    expect(sources.map(s => s.venue)).toEqual([undefined, undefined, undefined]);
  });
});

describe('searchOpenAlex — réponses vides et erreurs', () => {
  it('aucun résultat, liste absente ou inattendue, entrées sans titre : liste vide', async () => {
    expect(await search([])).toEqual([]);
    for (const body of [{}, { results: null }, { results: 'x' }, { results: {} }, { meta: { count: 0 } }, []]) {
      const fetchImpl = mockFetch(() => jsonResponse(body));
      expect(await searchOpenAlex('x', { fetch: fetchImpl }, OPTS)).toEqual([]);
    }
    expect(await search([null, 3, 'x', {}, { title: '' }, { title: '   ' }, { title: '<i></i>' }, { title: 42 }, { title: null }])).toEqual([]);
  });

  it('une entrée valide au milieu d’entrées invalides est gardée', async () => {
    const sources = await search([null, { title: '' }, work({ title: 'Bonne' }), 7]);
    expect(sources.map(s => s.title)).toEqual(['Bonne']);
  });

  it('HTTP 429 (limite de requêtes) et HTTP 500 : erreur claire', async () => {
    await expect(searchOpenAlex('x', { fetch: mockFetch(() => textResponse('Too many requests', 429)) }, OPTS)).rejects.toThrow('HTTP 429');
    await expect(searchOpenAlex('x', { fetch: mockFetch(() => textResponse('boom', 500)) }, OPTS)).rejects.toThrow('HTTP 500');
  });

  it('réseau coupé et réponse qui n’est pas du JSON : l’erreur remonte', async () => {
    await expect(searchOpenAlex('x', { fetch: mockFetch(() => { throw networkError('ENOTFOUND'); }) }, OPTS)).rejects.toThrow();
    await expect(searchOpenAlex('x', { fetch: mockFetch(() => textResponse('<html>erreur</html>', 200)) }, OPTS)).rejects.toThrow();
  });
});
