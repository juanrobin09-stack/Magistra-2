import { describe, expect, it } from 'vitest';
import { runResearch } from '../../shared/research/index';
import { NO_ABSTRACT_TEXT } from '../../shared/research/providers';
import { jsonResponse } from './helpers';
import { deps, fakePages, NO_SEARX, router, wikiHandler } from './researchFixtures';

describe('couverture sans moteur supplémentaire', () => {
  it.each(['photosynthèse', 'Révolution française', 'fractions', 'grammaire', 'économie'])('cherche des publications au primaire sur %s, même sans Wikipédia', async topic => {
    const fetch = router();
    const result = await runResearch({ text: topic, topic, mode: 'internet', group: 'elementaire' },
      { ...NO_SEARX, wikipedia: false }, deps(fetch), { budgetChars: 10_000 });
    expect(fetch.calls.some(c => new URL(c.url).hostname === 'api.archives-ouvertes.fr')).toBe(true);
    expect(fetch.calls.some(c => new URL(c.url).hostname === 'api.crossref.org')).toBe(true);
    expect(fetch.calls.some(c => new URL(c.url).hostname === 'api.openalex.org')).toBe(true);
    expect(fetch.calls.some(c => new URL(c.url).hostname === 'fr.wikipedia.org')).toBe(false);
    expect(result.sources.some(s => s.kind === 'openalex' && s.text !== NO_ABSTRACT_TEXT)).toBe(true);
    const hal = fetch.calls.find(c => new URL(c.url).hostname === 'api.archives-ouvertes.fr')!;
    expect(new URL(hal.url).searchParams.get('q')).toBe(topic);
  });

  it('les pages suivantes restent utilisables quand les trois premières sont inaccessibles ; plafond de six hôtes', async () => {
    const links = ['education.gouv.fr', 'eduscol.education.fr', 'unesco.org', 'who.int', 'fao.org', 'ilo.org', 'oecd.org', 'cnrs.fr'].map(h => `https://${h}/article`);
    const fetch = router({ wiki: url => new URL(url).searchParams.get('prop') === 'extlinks'
      ? jsonResponse({ query: { pages: [{ extlinks: links.map(url => ({ url })) }] } })
      : wikiHandler(url) });
    const fetchPage = fakePages(Object.fromEntries(links.slice(0, 3).map(u => [u, null])));
    const result = await runResearch({ text: 'santé', mode: 'internet', group: 'college' },
      { ...NO_SEARX, academic: false }, deps(fetch, fetchPage), { budgetChars: 10_000 });
    expect(fetchPage.calls).toHaveLength(6);
    expect(new Set(fetchPage.calls.map(u => new URL(u).hostname)).size).toBe(6);
    expect(result.sources.filter(s => s.kind === 'institutional').map(s => s.url)).toEqual(links.slice(3, 6));
  });

  it('petit budget : une page officielle conserve la place avant les publications et notices', async () => {
    const result = await runResearch({ text: 'gouvernance', mode: 'internet', group: 'master' },
      NO_SEARX, deps(router(), fakePages()), { budgetChars: 300 });
    expect(result.sources[0].kind).toBe('institutional');
    expect(result.sources.some(s => s.text === NO_ABSTRACT_TEXT)).toBe(false);
    expect(result.sources.reduce((n, s) => n + s.text.length, 0)).toBeLessThanOrEqual(300);
  });

  it('un résumé retrouvé par OpenAlex remplace la notice Crossref du même DOI', async () => {
    const result = await runResearch({ text: 'gouvernance', mode: 'academic', group: 'lycee' },
      { ...NO_SEARX, wikipedia: false }, deps(router({ hal: () => jsonResponse({ response: { docs: [] } }) })), { budgetChars: 10_000 });
    const copies = result.sources.filter(s => s.doi?.toLowerCase() === '10.3917/sim.192.0045');
    expect(copies).toHaveLength(1);
    expect(copies[0].kind).toBe('openalex');
    expect(copies[0].text).not.toBe(NO_ABSTRACT_TEXT);
  });
});
