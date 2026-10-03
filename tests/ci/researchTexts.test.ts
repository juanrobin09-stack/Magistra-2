// Textes de la recherche sur les sites officiels vérifiés : ce qu'ils promettent est exactement ce que le code fait.
// Lit les fichiers du dépôt (aucun accès réseau).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../server/config.js';
import { NOT_SEARCHED_SITES, SEARCH_SCOPE_TEXT, SEARCHED_DOMAIN_COUNT, trustedSearchGroups } from '../../shared/research/trusted';

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const flat = (text: string) => text.replace(/^# ?/gm, '').replace(/\/\/ ?/g, '').replace(/[’]/g, "'").replace(/\s+/g, ' ');

describe('aucune promesse de couvrir « tous » les sites ou « tout le catalogue »', () => {
  const TEXTS = [
    '.env.example',
    'scripts/research-check.mjs',
    'shared/research/index.ts',
    'shared/research/trusted.ts',
    'shared/types.ts',
    'src/lib/generation/research.ts',
    'src/pages/SettingsPage.tsx',
    'src/pages/landing/content.ts',
  ];
  for (const file of TEXTS) {
    it(file, () => {
      const text = read(file);
      expect(text).not.toMatch(/\btous les sites (officiels|vérifiés)|\bsur tout le catalogue|\btout le catalogue (est|des sites)|interroger directement tous/i);
    });
  }
});

describe('.env.example : ce que SEARXNG_URL interroge, et CROSSREF_MAILTO', () => {
  const env = flat(read('.env.example'));

  it('annonce les principaux sites (nombre exact) et nomme ce qui n’est pas interrogé directement', () => {
    expect(env).toContain('interroger directement les principaux sites officiels vérifiés (UNESCO, Éduscol, ministères, ONU…)');
    expect(env).toContain(`soit ${SEARCHED_DOMAIN_COUNT} domaines (${trustedSearchGroups().length} requêtes « site: » de 6 domaines)`);
    expect(trustedSearchGroups().flat()).toHaveLength(SEARCHED_DOMAIN_COUNT);
    expect(env).toContain(`Ne sont pas interrogés directement : ${flat(NOT_SEARCHED_SITES)}`);
    expect(flat(SEARCH_SCOPE_TEXT)).toContain(flat(NOT_SEARCHED_SITES));
  });

  it('Wikipédia sans SearXNG : seules les pages qu’il cite pour le sujet, aucun site nommé comme garanti', () => {
    const wikipedia = env.slice(env.indexOf('Wikipédia en français'), env.indexOf('RESEARCH_WIKIPEDIA='));
    expect(wikipedia).toContain('seules les pages qu\'il cite pour le sujet sont consultées');
    expect(wikipedia).not.toMatch(/UNESCO|Éduscol|ministères/);
  });

  it('CROSSREF_MAILTO : adresse de contact transmise à Crossref ET à OpenAlex (nom de la variable inchangé)', () => {
    expect(env).toContain('adresse de contact transmise à Crossref et OpenAlex');
    expect(read('.env.example')).toMatch(/^CROSSREF_MAILTO=$/m);
  });
});

describe('CROSSREF_MAILTO (serveur)', () => {
  it('adresse invalide : le message dit que l’adresse est transmise à Crossref et OpenAlex ; adresse valide : transmise aux deux', () => {
    const invalid = loadConfig({ CROSSREF_MAILTO: 'pas une adresse' });
    const problem = invalid.problems.find(p => p.includes('CROSSREF_MAILTO'));
    expect(problem).toBe('CROSSREF_MAILTO (adresse de contact transmise à Crossref et OpenAlex) doit être une adresse électronique valide : ignorée.');
    expect(invalid.research.crossrefMailto).toBeUndefined();
    expect(loadConfig({ CROSSREF_MAILTO: 'contact@univ.fr' }).research.crossrefMailto).toBe('contact@univ.fr');
  });
});
