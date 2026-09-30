import { describe, expect, it } from 'vitest';
import {
  citedNumbers, documentSourceRef, finalizeCitations, formatLocator, formatSourceLine, stripModelSourcesSection, unclosedFence, uncitedSourcesNote,
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
    expect(content).toContain('- [S4] Anne Martin, Paul Durand. Gouvernance des systèmes d’information (2019). *Systèmes d’information et management* — HAL. https://doi.org/10.3917/sim.192.0045');
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
  it('Wikipédia n’est pas répété, les titres ne finissent pas par un double point', () => {
    expect(formatSourceLine(WIKI)).toBe('[S5] Gouvernance des SI. *Wikipédia*. https://fr.wikipedia.org/wiki/Gouvernance_des_SI');
    expect(formatSourceLine({ n: 6, kind: 'institutional', title: 'Programme de cycle 3.', url: 'https://eduscol.education.fr/x' }))
      .toBe('[S6] Programme de cycle 3 — Source institutionnelle. https://eduscol.education.fr/x');
    expect(formatSourceLine({ ...HAL, authors: ['A', 'B', 'C', 'D'] })).toMatch(/^\[S4\] A, B, C et al\. Gouvernance/);
    expect(formatSourceLine({ ...HAL, authors: ['J.-P. Martin Jr.'] })).toMatch(/^\[S4\] J\.-P\. Martin Jr\. Gouvernance/);
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
