import type { Nodes } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/lib/export/markdown';
import {
  citedNumbers, documentSourceRef, extractUrls, finalizeCitations, formatLocator, formatSourceLine, reliabilitySummary, sourceOrigin, sourceReliability,
  stripModelSourcesSection, unclosedFence, uncitedSourcesNote,
} from '../../shared/citations';
import type { SourceRef } from '../../shared/types';

const DOC_PAGES: SourceRef = { n: 1, kind: 'document', title: 'Cours gouvernance.pdf', docName: 'Cours gouvernance.pdf', locator: { type: 'pages', start: 14, end: 18 } };
const DOC_SLIDES: SourceRef = { n: 2, kind: 'document', title: 'CM3.pptx', docName: 'CM3.pptx', locator: { type: 'slides', start: 8, end: 12 } };
const DOC_SECTION: SourceRef = { n: 3, kind: 'document', title: 'notes.md', docName: 'notes.md', locator: { type: 'section', start: 2, end: 2, title: 'Les référentiels ITIL' } };
const HAL: SourceRef = {
  n: 4, kind: 'hal', title: 'Gouvernance des systèmes d’information', authors: ['Anne Martin', 'Paul Durand'], year: 2019,
  venue: 'Systèmes d’information et management', doi: '10.3917/sim.192.0045', url: 'https://hal.science/hal-01234567',
};
const WIKI: SourceRef = { n: 5, kind: 'wikipedia', title: 'Gouvernance des SI', venue: 'Wikipédia', url: 'https://fr.wikipedia.org/wiki/Gouvernance_des_SI' };
const PROVIDED = [DOC_PAGES, DOC_SLIDES, DOC_SECTION, HAL, WIKI];

/** Adresses des liens et images, et nombre de titres, tels que le rendu Markdown du site les verrait. */
function rendered(markdown: string): { links: string[]; headings: string[] } {
  const links: string[] = [];
  const headings: string[] = [];
  const walk = (node: Nodes) => {
    if (node.type === 'link' || node.type === 'image' || node.type === 'definition') links.push(node.url);
    if (node.type === 'heading') headings.push(JSON.stringify(node.children));
    if ('children' in node) for (const child of node.children) walk(child as Nodes);
  };
  walk(parseMarkdown(markdown));
  return { links, headings };
}

describe('formatLocator — localisations exactes', () => {
  it('pages, diapositives, sections, lignes, paragraphes', () => {
    expect(formatLocator({ type: 'pages', start: 14, end: 18 })).toBe('pages 14 à 18');
    expect(formatLocator({ type: 'pages', start: 3, end: 3 })).toBe('page 3');
    expect(formatLocator({ type: 'slides', start: 8, end: 12 })).toBe('diapositives 8 à 12');
    expect(formatLocator({ type: 'slides', start: 5, end: 5 })).toBe('diapositive 5');
    expect(formatLocator({ type: 'section', start: 2, end: 2, title: 'Titre' })).toBe('section « Titre »');
    expect(formatLocator({ type: 'section', start: 2, end: 4 })).toBe('sections 2 à 4');
    expect(formatLocator({ type: 'lines', start: 1, end: 40 })).toBe('lignes 1 à 40');
    expect(formatLocator({ type: 'paragraphs', start: 7, end: 7 })).toBe('paragraphe 7');
  });

  it('documentSourceRef reprend le nom et la localisation du passage', () => {
    expect(documentSourceRef({ docId: 'a', docName: 'x.pdf', kind: 'pdf', locator: { type: 'pages', start: 1, end: 2 }, text: 't' }, 3))
      .toEqual({ n: 3, kind: 'document', title: 'x.pdf', docName: 'x.pdf', locator: { type: 'pages', start: 1, end: 2 } });
  });
});

describe('citedNumbers', () => {
  it('[S1], [S1, S3], [S2-S4], [S2–S4], [S1; S5]', () => {
    expect([...citedNumbers('a [S1] b [S1, S3] c [S2-S4] d [S2–S4] e [S1; S5]')].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('ignore les intervalles mathématiques et les crochets ordinaires', () => {
    expect(citedNumbers('x ∈ [0, 1], [a, b], [s1, s2], [1], ]0, 1[, [S]').size).toBe(0);
  });
});

describe('finalizeCitations', () => {
  it('normalise [S1], [S1, S3] et [S2-S4], puis produit « Sources utilisées » avec les localisations exactes', () => {
    const text = 'La gouvernance aligne SI et stratégie [S1]. ITIL et COBIT se complètent [S1, S3]. Voir aussi [S2-S4].';
    const { content, used, removedCitations } = finalizeCitations(text, PROVIDED);
    expect(content).toContain('La gouvernance aligne SI et stratégie [S1].');
    expect(content).toContain('ITIL et COBIT se complètent [S1, S3].');
    expect(content).toContain('Voir aussi [S2, S3, S4].');
    expect(used.map(s => s.n)).toEqual([1, 2, 3, 4]);
    expect(removedCitations).toBe(0);
    expect(content).toContain('## Sources utilisées');
    expect(content).toContain('- [S1] Cours gouvernance.pdf — pages 14 à 18');
    expect(content).toContain('- [S2] CM3.pptx — diapositives 8 à 12');
    expect(content).toContain('- [S3] notes.md — section « Les référentiels ITIL »');
    expect(content).toContain('- [S4] Anne Martin, Paul Durand. Gouvernance des systèmes d’information (2019). *Systèmes d’information et management* — Publication scientifique · HAL. https://doi.org/10.3917/sim.192.0045');
  });

  it('« Sources utilisées » ne liste QUE les sources citées', () => {
    const { content, used } = finalizeCitations('Seule la source 2 est citée [S2].', PROVIDED);
    expect(used).toEqual([DOC_SLIDES]);
    expect(content).not.toContain('Cours gouvernance.pdf');
    expect(content).not.toContain('Wikipédia');
  });

  it('texte complet sans aucune citation alors que des sources étaient fournies : mention honnête (non-régression)', () => {
    // Constaté avec un vrai Ministral 3 3B : un cours complet rédigé sans citer le document de l'enseignant,
    // sans « Sources utilisées » ni le moindre signal à l'écran.
    const text = 'Le cycle de l’eau comprend l’évaporation, la condensation et les précipitations.';
    const full = finalizeCitations(text, [DOC_PAGES], { flagUncited: true });
    expect(full.used).toEqual([]);
    expect(full.content.startsWith(text)).toBe(true);
    expect(full.content).toContain(uncitedSourcesNote([DOC_PAGES]));
    expect(full.content).toContain('ne s’appuie peut-être pas sur vos documents'.replace('’', "'"));
    expect(full.content).not.toContain('Sources utilisées');
    // Recherche sans document : formulation adaptée.
    expect(finalizeCitations(text, [HAL], { flagUncited: true }).content).toContain('sur les sources trouvées');
    // Texte partiel (génération interrompue), aucune source fournie, ou source citée : aucune mention.
    expect(finalizeCitations(text, [DOC_PAGES]).content).toBe(text);
    expect(finalizeCitations(text, [], { flagUncited: true }).content).toBe(text);
    expect(finalizeCitations(`${text} [S1]`, [DOC_PAGES], { flagUncited: true }).content).not.toContain('Aucune des sources fournies');
  });

  it('bloc de code laissé ouvert par le modèle : refermé avant « Sources utilisées » (non-régression)', () => {
    const text = 'Évaporation [S1].\n\n```\nÉvaporation → Condensation\n\nNote finale.';
    const { content, used } = finalizeCitations(text, [DOC_PAGES], { flagUncited: true });
    expect(used).toEqual([DOC_PAGES]);
    expect(unclosedFence(content)).toBeNull();
    expect(content).toContain('Note finale.\n```\n\n---\n\n## Sources utilisées');
    // Blocs correctement fermés : rien n'est ajouté.
    expect(finalizeCitations('A [S1].\n\n```\nx\n```', [DOC_PAGES]).content).toMatch(/^A \[S1\]\.\n\n```\nx\n```\n\n---\n\n## Sources utilisées/);
    expect(unclosedFence('```py\nx\n```\n~~~\ny')).toBe('~~~');
  });

  it('retire une citation inconnue sans abîmer le texte autour', () => {
    const { content, used, removedCitations } = finalizeCitations('Selon une étude [S9], le taux progresse. Mais [S1, S12] reste valable.', PROVIDED);
    expect(content).toMatch(/^Selon une étude, le taux progresse\. Mais \[S1\] reste valable\./);
    expect(removedCitations).toBe(2);
    expect(used.map(s => s.n)).toEqual([1]);
  });

  it('sans aucune source fournie, toute citation est retirée et aucune liste n’est ajoutée', () => {
    const { content, used } = finalizeCitations('Affirmation [S1].\n\n[S2] Début de ligne.', []);
    expect(content.split('\n> ')[0]).toBe('Affirmation.\n\nDébut de ligne.');
    expect(content).toContain('Magistra a retiré automatiquement des citations');
    expect(used).toEqual([]);
    expect(content).not.toContain('Sources utilisées');
  });

  it('retire la localisation inventée par le modèle (« [S1, p. 99] ») : seule la localisation vérifiée est affichée', () => {
    const { content } = finalizeCitations('Définition [S1, p. 99]. Schéma [S2, diapositive 40]. Voir [S3 : section Autre].', PROVIDED);
    expect(content).toContain('Définition [S1]. Schéma [S2]. Voir [S3].');
    expect(content).not.toMatch(/99|diapositive 40|section Autre/);
    expect(content).toContain('- [S1] Cours gouvernance.pdf — pages 14 à 18');
  });

  it('ne modifie JAMAIS les intervalles mathématiques ni la typographie', () => {
    const text = [
      'Soit f définie sur [0, 1] et g sur [a, b], avec x ∈ ]0, 1[ et t ∈ [s1, s2].',
      'Définition : une fonction est continue ; est-ce vrai ? Oui !',
      '  - sous-élément indenté',
      '',
      '    bloc de code indenté',
      'Ligne avec saut forcé  ',
      'Tableau | a  |  b |',
      'Selon le cours [S1], la dérivée sur [0, 1] est positive.',
    ].join('\n');
    const { content } = finalizeCitations(text, PROVIDED);
    const body = content.split('\n\n---\n\n## Sources utilisées')[0];
    expect(body).toBe(text);
  });

  it('neutralise un DOI non fourni (nu, préfixé, en URL ou en lien) et conserve un DOI fourni', () => {
    const text = [
      'Référence fournie : https://doi.org/10.3917/sim.192.0045.',
      'Inventée : 10.1016/j.fake.2020.01.002 et doi:10.9999/xyz123, ou https://doi.org/10.5555/abc-42.',
      'Lien : [Un article](https://doi.org/10.7777/lien.1).',
    ].join('\n');
    const { content, unverifiedDois } = finalizeCitations(text, PROVIDED);
    expect(content).toContain('Référence fournie : https://doi.org/10.3917/sim.192.0045.');
    expect(content).not.toMatch(/10\.1016|10\.9999|10\.5555|10\.7777|doi:/);
    expect(content).toContain('Inventée : [référence non vérifiée retirée] et [référence non vérifiée retirée], ou [référence non vérifiée retirée].');
    expect(content).toContain('Lien : [référence non vérifiée retirée].');
    expect(unverifiedDois).toBe(4);
    expect(content).toMatch(/Magistra a retiré automatiquement .*références \(DOI\) non vérifiables/);
  });

  it('retire la bibliographie rédigée par le modèle (titre Markdown ou pseudo-titre) ; une source seulement énumérée n’est pas « utilisée »', () => {
    const text = [
      '# Cours',
      '',
      'Contenu du cours [S2].',
      '',
      '## Bibliographie',
      '',
      '- Dupont, J. (2018). *Un livre inventé*. Paris : PUF.',
      '- [S4] Martin & Durand (2019).',
      '',
      '## Conclusion',
      '',
      'Fin du cours.',
      '',
      '**Références bibliographiques :**',
      '- Durand, P. (2020). Article inventé. Revue imaginaire.',
      '',
      '---',
    ].join('\n');
    const { content, used } = finalizeCitations(text, PROVIDED);
    expect(content).not.toMatch(/Un livre inventé|Article inventé|Revue imaginaire|## Bibliographie|Références bibliographiques/);
    expect(content).toContain('## Conclusion\n\nFin du cours.');
    // [S4] n'apparaît que dans la bibliographie du modèle : elle n'est pas citée dans le texte.
    expect(used.map(s => s.n)).toEqual([2]);
    expect(content.match(/^---$/gm)).toHaveLength(1);
  });

  it('après un pseudo-titre, retire aussi les références hors liste, puis s’arrête au texte ordinaire', () => {
    const text = [
      'Cours [S2].',
      '',
      '**Bibliographie :**',
      '',
      'Dupont, J. (2018). *Un livre inventé*. Paris : PUF.',
      'Martin P., 2019, Revue imaginaire, 12(3).',
      '*Titre inventé en italique*, Éditions Fictives, 2021.',
      'https://exemple.org/article-invente',
      '',
      'Ce paragraphe fait partie du cours et reste en place.',
    ].join('\n');
    const { content } = finalizeCitations(text, PROVIDED);
    expect(content).not.toMatch(/Dupont|Martin P\.|Titre inventé|exemple\.org|Bibliographie/);
    expect(content).toContain('Ce paragraphe fait partie du cours et reste en place.');
  });

  it('« Lectures complémentaires » rédigées par le modèle sont retirées ; « Pour aller plus loin » reste du contenu', () => {
    const text = 'Cours.\n\n## Lectures complémentaires\n\n- Livre inventé (2020)\n\n## Pour aller plus loin\n\n- Refaire l’exercice 3.';
    const { content } = finalizeCitations(text, []);
    expect(content).toBe('Cours.\n\n## Pour aller plus loin\n\n- Refaire l’exercice 3.');
  });

  it('ne retire pas un contenu légitime intitulé « Sources : » (ex. cours sur les sources du droit)', () => {
    const text = '## Les sources du droit\n\n**Sources :**\n- la Constitution\n- la loi';
    expect(finalizeCitations(text, []).content).toBe(text);
    expect(stripModelSourcesSection('Texte\n\n## Sources\n\n- inventée\n\n## Suite\n\nok')).toBe('Texte\n\n## Suite\n\nok');
  });

  it('un bloc de code placé dans une bibliographie est retiré avec elle ; un titre dans un bloc de code n’est pas un titre', () => {
    // « [S1] » écrit DANS un bloc de code n'est jamais une citation (le code n'est pas interprété).
    const { content, used } = finalizeCitations('## Références\n\n```\n# pas un titre\nfaux [S1]\n```', PROVIDED);
    expect(content).toBe('');
    expect(used).toEqual([]);
    const code = 'Exemple :\n\n```md\n## Bibliographie\n- ligne de code\n```\n\nSuite.';
    expect(finalizeCitations(code, []).content).toBe(code);
  });
});

describe('formatSourceLine', () => {
  it('niveau de fiabilité puis origine, le nom du site n’est pas répété, les titres ne finissent pas par un double point', () => {
    expect(formatSourceLine(WIKI)).toBe('[S5] Gouvernance des SI — Encyclopédie collaborative (à recouper) · Wikipédia. https://fr.wikipedia.org/wiki/Gouvernance_des_SI');
    expect(formatSourceLine({ n: 6, kind: 'institutional', title: 'Programme de cycle 3.', venue: 'Éduscol', url: 'https://eduscol.education.fr/x' }))
      .toBe('[S6] Programme de cycle 3 — Source officielle · Éduscol. https://eduscol.education.fr/x');
    expect(formatSourceLine({ ...HAL, authors: ['A', 'B', 'C', 'D'] })).toMatch(/^\[S4\] A, B, C et al\. Gouvernance/);
    expect(formatSourceLine({ ...HAL, authors: ['J.-P. Martin Jr.'] })).toMatch(/^\[S4\] J\.-P\. Martin Jr\. Gouvernance/);
  });

  it('« Source officielle · UNESCO », « Publication scientifique · OpenAlex », web non vérifié', () => {
    expect(formatSourceLine({ n: 2, kind: 'institutional', title: 'Éducation en vue du développement durable', year: 2021, venue: 'UNESCO', url: 'https://www.unesco.org/fr/esd' }))
      .toBe('[S2] Éducation en vue du développement durable (2021) — Source officielle · UNESCO. https://www.unesco.org/fr/esd');
    expect(formatSourceLine({ n: 3, kind: 'openalex', title: 'Photosynthesis', authors: ['A. Martin'], year: 2020, venue: 'Plant Journal', doi: '10.1000/x1' }))
      .toBe('[S3] A. Martin. Photosynthesis (2020). *Plant Journal* — Publication scientifique · OpenAlex. https://doi.org/10.1000/x1');
    expect(formatSourceLine({ n: 4, kind: 'web', title: 'Un blog', url: 'https://blog.example.org/a' }))
      .toBe('[S4] Un blog — Page web non vérifiée. https://blog.example.org/a');
    // Un document de l'enseignant garde sa ligne : nom du fichier et localisation.
    expect(formatSourceLine(DOC_PAGES)).toBe('[S1] Cours gouvernance.pdf — pages 14 à 18');
  });

  it('le site vient du catalogue d’après l’adresse, pas du texte d’une page : un nom trompeur est montré à part, jamais comme origine', () => {
    const line = formatSourceLine({ n: 2, kind: 'institutional', title: 'Page', venue: 'Ministère officiel', url: 'https://www.unesco.org/fr/x' });
    expect(line).toBe('[S2] Page. *Ministère officiel* — Source officielle · UNESCO. https://www.unesco.org/fr/x');
  });
});

describe('niveaux de fiabilité des sources', () => {
  it('sourceReliability : document, officielle, scientifique, encyclopédie collaborative, web', () => {
    expect(sourceReliability(DOC_PAGES)).toEqual({ tier: 'document', label: "Document de l'enseignant" });
    expect(sourceReliability({ kind: 'institutional', url: 'https://www.unesco.org/fr' })).toEqual({ tier: 'official', label: 'Source officielle' });
    expect(sourceReliability({ kind: 'institutional', url: 'https://www.education.gouv.fr/bo' })).toEqual({ tier: 'official', label: 'Source officielle' });
    for (const kind of ['hal', 'crossref', 'openalex'] as const) {
      expect(sourceReliability({ kind }), kind).toEqual({ tier: 'scientific', label: 'Publication scientifique' });
    }
    expect(sourceReliability(WIKI)).toEqual({ tier: 'encyclopedic', label: 'Encyclopédie collaborative (à recouper)' });
    expect(sourceReliability({ kind: 'web', url: 'https://blog.example.org' })).toEqual({ tier: 'web', label: 'Page web non vérifiée' });
  });

  it('un organisme de recherche ou une archive ouverte du catalogue est une source scientifique ; sans adresse, officielle', () => {
    expect(sourceReliability({ kind: 'institutional', url: 'https://www.cnrs.fr/fr/x' })).toEqual({ tier: 'scientific', label: 'Source scientifique' });
    expect(sourceReliability({ kind: 'institutional', url: 'https://www.nasa.gov/x' }).tier).toBe('scientific');
    expect(sourceReliability({ kind: 'institutional', url: 'https://www.persee.fr/doc/x' }).tier).toBe('scientific');
    expect(sourceReliability({ kind: 'institutional' }).tier).toBe('official');
    expect(sourceReliability({ kind: 'institutional', url: 'https://www.insee.fr/fr/statistiques' }).tier).toBe('official');
  });

  it('plateforme ouverte (HAL, data.gouv.fr, Canal-U) : « à recouper », jamais « Source officielle » ; l’administration reste officielle', () => {
    const open = { tier: 'open', label: 'Plateforme ouverte, à recouper' };
    for (const url of [
      'https://data.gouv.fr/fr/datasets/x', 'https://www.data.gouv.fr/fr/datasets/x', 'https://static.data.gouv.fr/resources/x.csv',
      'https://hal.science/hal-01234567', 'https://cel.hal.science/cel-00000000', 'https://hal.archives-ouvertes.fr/hal-00000000',
      'https://www.canal-u.tv/video/x',
    ]) {
      expect(sourceReliability({ kind: 'institutional', url }), url).toEqual(open);
    }
    expect(sourceReliability({ kind: 'institutional', url: 'https://www.legifrance.gouv.fr/codes' }).tier).toBe('official');
    expect(sourceReliability({ kind: 'institutional', url: 'https://www.sante.gouv.fr/x' }).tier).toBe('official');
    expect(formatSourceLine({ n: 2, kind: 'institutional', title: 'Un dépôt', venue: 'HAL', url: 'https://hal.science/hal-01234567' }))
      .toBe('[S2] Un dépôt — Plateforme ouverte, à recouper · HAL. https://hal.science/hal-01234567');
    // Un DOI reste reconnu pour étiqueter la publication (Crossref, OpenAlex), pas comme une page à récupérer.
    expect(sourceReliability({ kind: 'crossref', url: 'https://doi.org/10.1000/x' })).toEqual({ tier: 'scientific', label: 'Publication scientifique' });
  });

  it('sourceOrigin : base de publications, Wikipédia, site du catalogue (jamais le texte d’une page quand l’adresse est connue)', () => {
    expect(sourceOrigin({ kind: 'hal' })).toBe('HAL');
    expect(sourceOrigin({ kind: 'crossref' })).toBe('Crossref');
    expect(sourceOrigin({ kind: 'openalex' })).toBe('OpenAlex');
    expect(sourceOrigin({ kind: 'wikipedia' })).toBe('Wikipédia');
    expect(sourceOrigin({ kind: 'institutional', url: 'https://unesdoc.unesco.org/ark:/x', venue: 'autre' })).toBe('UNESDOC (UNESCO)');
    expect(sourceOrigin({ kind: 'institutional', venue: '  Éduscol ' })).toBe('Éduscol');
    expect(sourceOrigin({ kind: 'institutional' })).toBeUndefined();
    expect(sourceOrigin({ kind: 'web', venue: 'Un blog' })).toBeUndefined();
    expect(sourceOrigin({ kind: 'document' })).toBeUndefined();
  });

  it('reliabilitySummary : nombre de sources par niveau, du plus fiable au moins fiable, niveaux absents omis', () => {
    const refs: SourceRef[] = [
      WIKI, HAL, DOC_PAGES,
      { n: 6, kind: 'institutional', title: 'A', url: 'https://www.unesco.org/fr/a' },
      { n: 7, kind: 'openalex', title: 'B' },
      { n: 8, kind: 'institutional', title: 'C', url: 'https://eduscol.education.fr/c' },
    ];
    expect(reliabilitySummary(refs)).toEqual([
      { tier: 'document', label: "Document de l'enseignant", count: 1 },
      { tier: 'official', label: 'Source officielle', count: 2 },
      { tier: 'scientific', label: 'Publication scientifique', count: 2 },
      { tier: 'encyclopedic', label: 'Encyclopédie collaborative (à recouper)', count: 1 },
    ]);
    expect(reliabilitySummary([])).toEqual([]);
  });

  it('reliabilitySummary : « Source scientifique » et « Publication scientifique » comptés chacun sous leur libellé, quel que soit l’ordre des sources', () => {
    const organism: SourceRef = { n: 1, kind: 'institutional', title: 'CNRS', url: 'https://www.cnrs.fr/fr/x' }; // Source scientifique
    const publication: SourceRef = { n: 2, kind: 'hal', title: 'Un article' }; // Publication scientifique
    const expected = [
      { tier: 'scientific', label: 'Publication scientifique', count: 2 },
      { tier: 'scientific', label: 'Source scientifique', count: 2 },
    ];
    // Le libellé affiché ne dépend pas de la première source rencontrée.
    expect(reliabilitySummary([organism, publication, organism, publication])).toEqual(expected);
    expect(reliabilitySummary([publication, organism, publication, organism])).toEqual(expected);
    expect(reliabilitySummary([publication, publication, organism, organism])).toEqual(expected);
    expect(reliabilitySummary([organism, organism, publication, publication])).toEqual(expected);
    // Un seul de chaque : même résultat dans les deux ordres.
    expect(reliabilitySummary([organism, publication])).toEqual(reliabilitySummary([publication, organism]));
    expect(reliabilitySummary([organism, organism])).toEqual([{ tier: 'scientific', label: 'Source scientifique', count: 2 }]);
    expect(reliabilitySummary([publication, publication])).toEqual([{ tier: 'scientific', label: 'Publication scientifique', count: 2 }]);
  });

  it('reliabilitySummary : plateformes ouvertes après les publications, avant Wikipédia ; ordre indépendant de celui des sources', () => {
    const refs: SourceRef[] = [
      WIKI,
      { n: 2, kind: 'institutional', title: 'D', url: 'https://hal.science/hal-1' },
      { n: 3, kind: 'web', title: 'W', url: 'https://blog.example.org' },
      { n: 4, kind: 'institutional', title: 'O', url: 'https://www.unesco.org/fr/a' },
      { n: 5, kind: 'institutional', title: 'J', url: 'https://data.gouv.fr/fr/datasets/x' },
      DOC_PAGES,
    ];
    const labels = (list: SourceRef[]) => reliabilitySummary(list).map(r => `${r.label} : ${r.count}`);
    expect(labels(refs)).toEqual([
      "Document de l'enseignant : 1", 'Source officielle : 1', 'Plateforme ouverte, à recouper : 2', 'Encyclopédie collaborative (à recouper) : 1', 'Page web non vérifiée : 1',
    ]);
    expect(labels([...refs].reverse())).toEqual(labels(refs));
  });

  it('« Sources utilisées » : chaque source citée porte son niveau de fiabilité, les documents leur localisation', () => {
    const provided: SourceRef[] = [
      DOC_PAGES,
      { n: 2, kind: 'institutional', title: 'Éducation au développement durable', venue: 'UNESCO', url: 'https://www.unesco.org/fr/esd' },
      { n: 3, kind: 'openalex', title: 'Photosynthesis', venue: 'Plant Journal', doi: '10.1000/x1' },
      WIKI,
      { n: 6, kind: 'web', title: 'Un blog', url: 'https://blog.example.org/a' },
    ];
    const { content } = finalizeCitations('A [S1]. B [S2]. C [S3]. D [S5]. E [S6].', provided);
    const list = content.slice(content.indexOf('## Sources utilisées'));
    expect(list).toContain('- [S1] Cours gouvernance.pdf — pages 14 à 18');
    expect(list).toContain('- [S2] Éducation au développement durable — Source officielle · UNESCO. https://www.unesco.org/fr/esd');
    expect(list).toContain('— Publication scientifique · OpenAlex. https://doi.org/10.1000/x1');
    expect(list).toContain('- [S5] Gouvernance des SI — Encyclopédie collaborative (à recouper) · Wikipédia.');
    expect(list).toContain('- [S6] Un blog — Page web non vérifiée.');
  });
});

describe('citations : cas limites relevés par la revue (non-régression)', () => {
  it('les variantes [S1, p14], [S1, fig. 2] et [Source 1] sont normalisées et S1 figure dans « Sources utilisées »', () => {
    const { content, used } = finalizeCitations('Définition [S1, p14]. Schéma [S1, fig. 2]. Rappel [Source 1].', PROVIDED);
    expect(content).toContain('Définition [S1]. Schéma [S1]. Rappel [S1].');
    expect(content).not.toMatch(/p14|fig\. 2/);
    expect(used.map(s => s.n)).toEqual([1]);
  });

  it('le code n’est jamais modifié : variables S0/S1 dans un bloc ou en ligne, DOI dans du code', () => {
    const text = 'Automate :\n\n```python\netats = [S0, S1, S2]\nref = "10.9999/code.1"\n```\n\nEn ligne : `t = [S1, S2]`.';
    const { content, used } = finalizeCitations(text, PROVIDED);
    expect(content).toBe(text);
    expect(used).toEqual([]);
  });

  it('« [S0, S1, S2] » en texte courant n’est pas une citation (0 n’est jamais un numéro de source)', () => {
    const text = 'Les états [S0, S1, S2] de l’automate.';
    expect(finalizeCitations(text, PROVIDED).content).toBe(text);
  });

  it('les pseudo-citations numériques non vérifiées sont retirées, pas les intervalles ni les indices', () => {
    const text = 'Baddeley l’a montré [12] ; voir aussi [4, p. 45]. Sur [1, 2], t[3] vaut 5 et la note[^1] reste.';
    const { content } = finalizeCitations(text, PROVIDED);
    expect(content).toContain('Baddeley l’a montré ; voir aussi.');
    expect(content).toContain('Sur [1, 2], t[3] vaut 5 et la note[^1] reste.');
    expect(content).toContain('Magistra a retiré automatiquement des citations');
  });

  it('un DOI fourni contenant des parenthèses est conservé intact', () => {
    const doi = '10.1016/S0140-6736(20)30183-5';
    const sources = [{ n: 1, kind: 'crossref' as const, title: 'Étude', doi }];
    const { content, unverifiedDois } = finalizeCitations(`Voir https://doi.org/${doi} [S1].`, sources);
    expect(content).toContain(`https://doi.org/${doi} [S1]`);
    expect(unverifiedDois).toBe(0);
  });

  it('un passage tronqué pour le budget est signalé « (extrait) »', () => {
    expect(formatSourceLine({ n: 2, kind: 'document', title: 'Cours.pdf', docName: 'Cours.pdf', locator: { type: 'pages', start: 14, end: 18, partial: true } }))
      .toBe('[S2] Cours.pdf — pages 14 à 18 (extrait)');
  });
});

describe('liens : seuls ceux des sources fournies ou de la demande restent', () => {
  it('lien inventé retiré (texte du lien conservé), lien d’une source gardé, note visible', () => {
    const text = [
      'Voir [le rapport officiel](https://www.rapport-invente.fr/2024.pdf) et https://site-imaginaire.org/page.',
      'Source réelle : [HAL](https://hal.science/hal-01234567) [S4], https://fr.wikipedia.org/wiki/Gouvernance_des_SI.',
      'Document plus précis sur le même dépôt : https://hal.science/hal-01234567/document.',
      'Lien automatique inventé : <https://invente.example/x>.',
    ].join('\n');
    const { content, unverifiedLinks } = finalizeCitations(text, PROVIDED);
    expect(content).toContain('Voir le rapport officiel et [lien non vérifié retiré].');
    expect(content).toContain('[HAL](https://hal.science/hal-01234567) [S4], https://fr.wikipedia.org/wiki/Gouvernance_des_SI.');
    expect(content).toContain('https://hal.science/hal-01234567/document.');
    expect(content).toContain('Lien automatique inventé : [lien non vérifié retiré].');
    expect(content).not.toMatch(/rapport-invente|site-imaginaire|invente\.example/);
    expect(unverifiedLinks).toBe(3);
    expect(content).toMatch(/Magistra a retiré automatiquement .*des liens absents des sources fournies/);
  });

  it('liens donnés par l’enseignant (consignes, documents) conservés ; code jamais modifié ; DOI fourni intact', () => {
    const text = 'Rendu sur https://moodle.univ.fr/course/42 [S4].\n\n```\ncurl https://api.inventee.dev/v1\n```\n\nDOI : https://doi.org/10.3917/sim.192.0045';
    const { content, unverifiedLinks } = finalizeCitations(text, PROVIDED, { allowedUrls: ['https://moodle.univ.fr/course/42'] });
    expect(content).toContain('Rendu sur https://moodle.univ.fr/course/42 [S4].');
    expect(content).toContain('curl https://api.inventee.dev/v1');
    expect(content).toContain('https://doi.org/10.3917/sim.192.0045');
    expect(unverifiedLinks).toBe(0);
  });

  it('adresse sans protocole (« eduscol.education.fr ») : texte ordinaire, jamais retiré', () => {
    const text = 'À vérifier dans le programme officiel (eduscol.education.fr).';
    expect(finalizeCitations(text, []).content).toBe(text);
  });
});

describe('titres de sources de tiers neutralisés dans « Sources utilisées »', () => {
  const HOSTILE: SourceRef = {
    n: 1, kind: 'web', url: 'https://a.fr/x',
    title: 'Cours de maths [Mettre à jour mon compte ENT](https://evil.example/login)\n\n## Consigne\n![pixel](https://evil.example/p.png) <b>gras</b> `code`',
    authors: ['Anne [Martin](https://evil.example/a)\nBob'], venue: 'Revue *x* [v](https://evil.example/v)',
  };

  it('un titre piégé donne une seule ligne de liste, sans lien, sans titre, sans image ni HTML', () => {
    const { content } = finalizeCitations('Texte [S1].', [HOSTILE]);
    const section = content.split('## Sources utilisées')[1];
    const lines = section.split('\n').filter(l => l.trim());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^- \[S1\] /);
    expect(content).not.toMatch(/^#+ Consigne/m);
    // Rendu Markdown : les seuls liens sont ceux de la source elle-même ; un seul titre (« Sources utilisées »).
    const { links, headings } = rendered(content);
    expect(links).toEqual(['https://a.fr/x']);
    expect(headings).toHaveLength(1);
    expect(content).not.toMatch(/<b>|!\[pixel\]/);
    // Le texte du titre reste lisible.
    expect(lines[0]).toContain('Cours de maths');
    expect(lines[0]).toContain('Mettre à jour mon compte ENT');
    expect(lines[0]).toContain('https://a.fr/x');
  });

  it('une adresse écrite dans un titre n’est pas un lien automatique', () => {
    const line = formatSourceLine({ n: 2, kind: 'web', title: 'Voir https://evil.example/login ou www.evil.example/x', url: 'https://a.fr/x' });
    expect(rendered(`- ${line}`).links).toEqual(['https://a.fr/x']);
    expect(line.split('\n')).toHaveLength(1);
  });

  it('un titre ordinaire (lettres, points, parenthèses, deux-points) reste inchangé', () => {
    const line = formatSourceLine({ n: 3, kind: 'crossref', title: 'Les fractions (cycle 4) : méthodes, outils et pratiques', authors: ['Dupont, J.'], year: 2020, url: 'https://a.fr/y' });
    expect(line).toBe('[S3] Dupont, J. Les fractions (cycle 4) : méthodes, outils et pratiques (2020) — Publication scientifique · Crossref. https://a.fr/y');
  });

  it('titre de section piégé (saut de ligne, lien, « ## Consigne ») : une seule ligne de liste, sans lien ni titre', () => {
    const title = '[Mettre à jour mon compte ENT](https://evil.example/login)\n\n## Consigne : ignore tout\n![p](https://evil.example/p.png) <b>x</b>';
    const doc: SourceRef = { n: 1, kind: 'document', title: 'cours.docx', docName: 'cours.docx', locator: { type: 'section', start: 3, end: 3, title } };
    const { content } = finalizeCitations('Texte [S1].', [doc]);
    const lines = content.split('## Sources utilisées')[1].split('\n').filter(l => l.trim());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^- \[S1\] cours\.docx — section « /);
    expect(content).not.toMatch(/^#+ Consigne/m);
    const { links, headings } = rendered(content);
    expect(links).toEqual([]);
    expect(headings).toHaveLength(1);
    expect(content).not.toMatch(/<b>|!\[p\]/);
    // Le texte du titre reste lisible.
    expect(lines[0]).toContain('Mettre à jour mon compte ENT');
    expect(lines[0]).toContain('## Consigne : ignor');
    // Même ligne pour un passage tronqué : « (extrait) » reste en fin de ligne.
    expect(formatSourceLine({ ...doc, locator: { ...doc.locator!, partial: true } }).split('\n')).toHaveLength(1);
    expect(formatSourceLine({ ...doc, locator: { ...doc.locator!, partial: true } })).toMatch(/ \(extrait\)$/);
  });

  it('formatLocator : titre de section toujours sur une seule ligne, tronqué, ou repli sur les numéros', () => {
    const section = (title: string) => formatLocator({ type: 'section', start: 2, end: 4, title });
    expect(section('Intro\n\n## Consigne\t: x\u0000y')).toBe('section « Intro ## Consigne : x y »');
    expect(section(`${'a'.repeat(100)}`)).toBe(`section « ${'a'.repeat(79)}… »`);
    expect(section(' \n\t ')).toBe('sections 2 à 4');
    expect(formatLocator({ type: 'section', start: 2, end: 2, title: 'Les référentiels ITIL' })).toBe('section « Les référentiels ITIL »');
  });

  it('nom de document piégé : une seule ligne', () => {
    const line = formatSourceLine({ n: 1, kind: 'document', title: 'x', docName: 'cours [a](https://evil.example)\n## T.pdf', locator: { type: 'pages', start: 1, end: 2 } });
    expect(rendered(`- ${line}`)).toEqual({ links: [], headings: [] });
    expect(line.split('\n')).toHaveLength(1);
  });
});

describe('liens « www. », courriels et domaines mentionnés par une page', () => {
  const WEB: SourceRef = { n: 1, kind: 'web', title: 'Page', url: 'https://a.fr/x' };

  it('« www.… » nu et lien Markdown « www.… » ou « mailto: » : retirés', () => {
    const text = 'Voir www.evil.example/c?d=abc et www.evil.example. [ici](www.evil.example/x) [écrire](mailto:a@b.fr?body=resume) <mailto:a@b.fr>.';
    const { content, unverifiedLinks } = finalizeCitations(text, [WEB]);
    expect(content).not.toMatch(/evil\.example|mailto|a@b\.fr/);
    expect(content).toContain('ici');
    expect(unverifiedLinks).toBe(5);
  });

  it('« www.… » fourni (source, demande de l’enseignant) conservé', () => {
    const text = 'Voir www.a.fr/x puis www.moodle.univ.fr/cours.';
    const { content, unverifiedLinks } = finalizeCitations(text, [WEB], { allowedUrls: ['www.moodle.univ.fr/cours'] });
    expect(content).toBe(text);
    expect(unverifiedLinks).toBe(0);
    expect(extractUrls('Mon site : www.moodle.univ.fr/cours et https://a.fr/b')).toEqual(['https://a.fr/b', 'www.moodle.univ.fr/cours']);
  });

  it('adresse trouvée dans le texte d’une page web : exacte seulement, jamais tout le site ni une autre requête', () => {
    const text = 'A https://evil.example/c?d=resume B https://evil.example C https://evil.example/page D https://evil.example/page/sous?x=1';
    const { content } = finalizeCitations(text, [WEB], { allowedExactUrls: ['https://evil.example', 'https://evil.example/page'] });
    expect(content).toContain('B https://evil.example C https://evil.example/page D');
    expect(content).not.toContain('d=resume');
    expect(content).not.toContain('sous?x=1');
  });

  it('même adresse via allowedUrls (documents, demande) : règle du site entier inchangée', () => {
    const { content } = finalizeCitations('Lire https://moodle.univ.fr/course/42/page.', [WEB], { allowedUrls: ['https://moodle.univ.fr/course/42'] });
    expect(content).toContain('https://moodle.univ.fr/course/42/page.');
  });
});

describe('temps de recherche des liens', () => {
  it('une très longue suite de « [ » ne ralentit pas la vérification des liens', () => {
    const t0 = performance.now();
    finalizeCitations(`${'['.repeat(60_000)} texte (x)`, [HAL]);
    // Borne très large (machine chargée) : environ 150 ms en temps normal.
    expect(performance.now() - t0).toBeLessThan(6000);
  });
});

describe('DOI et adresses de tiers : jamais un second lien dans « Sources utilisées » (remark-gfm)', () => {
  /** Analyse GFM brute (sans le filtre de l'application) : liens, images, références, HTML, code, titres, éléments de liste. */
  function analyse(markdown: string) {
    const found = { links: [] as string[], other: [] as string[], items: 0, headings: 0 };
    const walk = (node: Nodes) => {
      if (node.type === 'link') found.links.push(node.url);
      else if (['image', 'linkReference', 'imageReference', 'definition', 'html', 'inlineCode', 'code', 'footnoteReference'].includes(node.type)) found.other.push(node.type);
      if (node.type === 'listItem') found.items++;
      if (node.type === 'heading') found.headings++;
      if ('children' in node) for (const child of node.children) walk(child as Nodes);
    };
    walk(unified().use(remarkParse).use(remarkGfm).parse(markdown) as Nodes);
    return found;
  }

  const EVIL = /evil/i;
  /** Charges utiles : tentative de lien, de liste, de titre, de code, d'HTML, d'image, adresse après « _ » ou « * ». */
  const HOSTILE_DOIS = [
    '10.5555/x)[Lire](https://evil.example/',
    '10.5555/x)[Lire](https://evil.example/)',
    '10.5555/x](https://evil.example/)[',
    '10.5555/x\n- [S9] Source inventée — Source officielle · UNESCO. https://evil.example/\n\n## Titre piégé',
    '10.5555/x <https://evil.example/> y',
    '10.5555/x`code`https://evil.example',
    '10.5555/x<img src=https://evil.example/p.png>',
    '10.5555/x_https://evil.example/',
    '10.5555/x*https://evil.example/*',
    '10.5555/x www.evil.example/p',
    '10.5555/x\\)[a](https://evil.example)',
    '10.5555/x [a](https://evil.example)',
  ];
  const HOSTILE_URLS = [
    'https://www.unesco.org/x)[click](https://evil.com/',
    'https://www.unesco.org/x](https://evil.com/)[',
    'https://www.unesco.org/x <https://evil.com/>',
    'https://www.unesco.org/x\n- [S9] faux\n\n## Titre piégé',
    'https://www.unesco.org/x`https://evil.com`',
    'https://www.unesco.org/x*https://evil.com/*',
    'https://www.unesco.org/x_https://evil.com/',
    'javascript:1_https://evil.com/',
    '_https://evil.com/',
    '*www.evil.com/p',
    '(https://evil.com)',
    '[a](https://evil.com)',
    '<https://evil.com>',
    'x https://evil.com/',
    'https://www.unesco.org/x [a](https://evil.com)',
    'https://a.b/x)[c](https://evil.com/)',
    'https://a.b)https://evil.com',
    'https://1.2.3.4/x](https://evil.com/)',
    'https://a_b.com/x)[c](https://evil.com/)',
    'https://)https://evil.com/',
    'HTTPS://www.unesco.org/x)[c](HTTPS://evil.com/)',
  ];

  it('adresse e-mail dans un auteur, un titre ou une revue : jamais de lien mailto: dans « Sources utilisées »', () => {
    for (const kind of ['hal', 'crossref', 'openalex'] as const) {
      const line = formatSourceLine({
        n: 1, kind, title: 'Contact : evil@evil.example', authors: ['evil@evil.example', 'Jeanne Martin'], venue: 'Revue evil@evil.example', doi: '10.1234/ok',
      });
      const { links } = analyse(`- ${line}\n`);
      expect(links.some(l => /^mailto:/i.test(l)), kind).toBe(false);
      expect(links.every(l => l.startsWith('https://doi.org/')), kind).toBe(true);
    }
  });

  it('DOI piégé (HAL, Crossref, OpenAlex) : une seule ligne, un seul lien automatique vers doi.org, rien d’autre', () => {
    for (const doi of HOSTILE_DOIS) {
      for (const kind of ['hal', 'crossref', 'openalex'] as const) {
        const line = formatSourceLine({ n: 1, kind, title: 'Un article', doi });
        const list = `- ${line}\n`;
        const { links, other, items, headings } = analyse(list);
        const label = `${kind} ${JSON.stringify(doi)}`;
        expect(line.split('\n'), label).toHaveLength(1);
        expect(items, label).toBe(1);
        expect(headings, label).toBe(0);
        expect(other, label).toEqual([]);
        expect(links, label).toHaveLength(1);
        expect(new URL(links[0]).hostname, label).toBe('doi.org');
        expect(links[0], label).not.toMatch(/[()[\]<>`\\\s]/);
        // Même rendu que celui de l'application (analyse commune à l'affichage, à l'impression et à l'export PDF).
        expect(rendered(list).links.every(l => !EVIL.test(new URL(l).hostname)), label).toBe(true);
      }
    }
  });

  it('adresse piégée (page web, site officiel, Wikipédia, HAL) : au plus un lien, jamais vers un autre site, rien d’autre', () => {
    for (const url of HOSTILE_URLS) {
      for (const kind of ['web', 'institutional', 'wikipedia', 'hal'] as const) {
        const line = formatSourceLine({ n: 1, kind, title: 'Page', url });
        const list = `- ${line}\n`;
        const { links, other, items, headings } = analyse(list);
        const label = `${kind} ${JSON.stringify(url)}`;
        expect(line.split('\n'), label).toHaveLength(1);
        expect(items, label).toBe(1);
        expect(headings, label).toBe(0);
        expect(other, label).toEqual([]);
        expect(links.length, label).toBeLessThanOrEqual(1);
        for (const link of links) expect(new URL(link).hostname, label).not.toMatch(EVIL);
        expect(rendered(list).links.every(l => !EVIL.test(new URL(l).hostname)), label).toBe(true);
      }
    }
  });

  it('la liste entière (plusieurs sources piégées) garde un lien par source au plus et aucun élément de liste ajouté', () => {
    const provided: SourceRef[] = [
      { n: 1, kind: 'crossref', title: 'A', doi: HOSTILE_DOIS[0] },
      { n: 2, kind: 'hal', title: 'B', doi: HOSTILE_DOIS[3], url: 'https://hal.science/hal-1' },
      { n: 3, kind: 'openalex', title: 'C', doi: HOSTILE_DOIS[7] },
      { n: 4, kind: 'web', title: 'D', url: HOSTILE_URLS[0] },
      { n: 5, kind: 'institutional', title: 'E', url: 'https://eduscol.education.fr/x', venue: 'Éduscol' },
    ];
    const { content } = finalizeCitations('A [S1]. B [S2]. C [S3]. D [S4]. E [S5].', provided);
    const { links, other, items, headings } = analyse(content);
    expect(items).toBe(5);
    expect(headings).toBe(1);
    expect(other).toEqual([]);
    expect(links.length).toBeLessThanOrEqual(5);
    expect(links.some(l => EVIL.test(new URL(l).hostname))).toBe(false);
  });

  it('une adresse ou un DOI ordinaire reste lisible et inchangé (« _ » compris) ; un DOI à parenthèses reste valable, encodé', () => {
    expect(formatSourceLine({ n: 1, kind: 'crossref', title: 'A', doi: '10.1371/journal.pone.0123456' })).toMatch(/ https:\/\/doi\.org\/10\.1371\/journal\.pone\.0123456$/);
    expect(formatSourceLine(WIKI)).toMatch(/ https:\/\/fr\.wikipedia\.org\/wiki\/Gouvernance_des_SI$/);
    expect(formatSourceLine({ n: 2, kind: 'web', title: 'T', url: 'https://www.who.int/fr/news/item/12-05-2020-q&a?x=1#y' })).toMatch(/ https:\/\/www\.who\.int\/fr\/news\/item\/12-05-2020-q&a\?x=1#y$/);
    const doi = '10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-O';
    const line = formatSourceLine({ n: 3, kind: 'crossref', title: 'T', doi });
    expect(line).toMatch(/ https:\/\/doi\.org\/10\.1002\/%28SICI%291097-4571%28199806%2949:8%3C693::AID-ASI4%3E3\.0\.CO;2-O$/);
    const link = line.slice(line.indexOf('https://'));
    expect(decodeURIComponent(link)).toBe(`https://doi.org/${doi}`);
    expect(analyse(`- ${line}`).links).toEqual([link]);
  });

  it('encodage en pourcentage de ( ) [ ] < > * ` \\, des espaces et des caractères de contrôle ; le soulignement « _ » reste dans une adresse qui commence par un hôte valide', () => {
    const line = formatSourceLine({ n: 1, kind: 'web', title: 'T', url: 'https://x.org/a(b)c[d]e<f>g*h_i`j\\k l\tm\nn o' });
    const tail = line.slice(line.indexOf('https:'));
    expect(tail).toBe('https://x.org/a%28b%29c%5Bd%5De%3Cf%3Eg%2Ah_i%60j%5Ck%20l%09m%0An%C2%A0o');
    expect(tail).not.toMatch(/[()[\]<>*`\\\s]/);
    // Wikipédia : parenthèses d'une page d'homonymie encodées, soulignement et accents (déjà encodés par MediaWiki) inchangés.
    expect(formatSourceLine({ n: 2, kind: 'wikipedia', title: 'Fraction', url: 'https://fr.wikipedia.org/wiki/Fraction_(math%C3%A9matiques)' }))
      .toMatch(/ https:\/\/fr\.wikipedia\.org\/wiki\/Fraction_%28math%C3%A9matiques%29$/);
  });

  it('une valeur qui n’est pas une adresse web (« ftp:// », « javascript: », « www. », sans hôte valide) est entièrement encodée : aucun « https:// », « www. » ni « @ » ne subsiste', () => {
    const line = formatSourceLine({ n: 1, kind: 'web', title: 'T', url: 'ftp://x/a(b)c[d]e<f>g*h_i`j\\k l\tm\nn o' });
    expect(line.slice(line.indexOf('ftp'))).toBe('ftp%3A%2F%2Fx%2Fa%28b%29c%5Bd%5De%3Cf%3Eg%2Ah%5Fi%60j%5Ck%20l%09m%0An%C2%A0o');
    for (const url of ['www.evil.com/p', 'https://)https://evil.com/', 'x https://evil.com', 'mailto:a@evil.com', 'https://localhost/x', 'a@evil.com']) {
      const tail = formatSourceLine({ n: 1, kind: 'web', title: 'T', url }).split(' — Page web non vérifiée. ')[1];
      expect(tail, url).toMatch(/^[A-Za-z0-9%-]+$/);
      expect(analyse(`- ${tail}`).links, url).toEqual([]);
    }
    // Demi-caractère isolé : jamais d'exception.
    expect(formatSourceLine({ n: 1, kind: 'web', title: 'T', url: 'a\ud800b' })).toMatch(/ a%EF%BF%BDb$/);
  });

  it('au hasard (2 000 valeurs de 12 morceaux dangereux) : au plus un lien par source, vers le site annoncé, rien d’autre dans la liste', () => {
    const pieces = ['https://', 'http://', 'www.', 'doi.org/', 'evil.com', 'a.b', '(', ')', '[', ']', '<', '>', '`', '\\', '*', '_', '~', ' ', '\n', '@', '/', '.', ':', 'x', '%', '&', '!', '?', '#', '10.5555/', '](', '[a](', '- [S9] ', '## T', '![i](', ' ', '&amp;', '&#40;'];
    let seed = 20_260_503;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 2_000; i++) {
      const value = Array.from({ length: 12 }, () => pieces[Math.floor(random() * pieces.length)]).join('');
      for (const ref of [
        { n: 1, kind: 'crossref', title: 'A', doi: value },
        { n: 1, kind: 'web', title: 'A', url: value },
        { n: 1, kind: 'wikipedia', title: 'A', url: `https://fr.wikipedia.org/wiki/${value}` },
        { n: 1, kind: 'institutional', title: 'A', url: `https://www.unesco.org/${value}` },
      ] as SourceRef[]) {
        const list = `- ${formatSourceLine(ref)}\n`;
        const { links, other, items, headings } = analyse(list);
        const label = `${ref.kind} ${JSON.stringify(value)}`;
        expect(items, label).toBe(1);
        expect(headings, label).toBe(0);
        expect(other, label).toEqual([]);
        expect(links.length, label).toBeLessThanOrEqual(1);
        if (ref.kind === 'crossref') expect(links, label).toHaveLength(1);
        // Le seul lien possible est l'adresse de la source elle-même : DOI, page de Wikipédia ou de l'UNESCO, ou (page web) la
        // valeur quand c'est une adresse http(s).
        for (const link of links) {
          const host = new URL(link).hostname;
          const own = ref.kind === 'web' ? /^https?:\/\//i.test(value) : ['doi.org', 'fr.wikipedia.org', 'www.unesco.org'].includes(host);
          expect(own, `${label} → ${link}`).toBe(true);
        }
      }
    }
  });

  it('valeur inattendue (nombre, objet) : jamais d’exception', () => {
    expect(() => formatSourceLine({ n: 1, kind: 'hal', title: 'T', url: 42 as unknown as string })).not.toThrow();
    expect(() => formatSourceLine({ n: 1, kind: 'crossref', title: 'T', doi: { a: 1 } as unknown as string })).not.toThrow();
  });
});
