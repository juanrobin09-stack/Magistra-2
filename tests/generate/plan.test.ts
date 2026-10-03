import { describe, expect, it } from 'vitest';
import { getDemoExample } from '@shared/demo';
import { PLAN_LIMITS, readPlanTable } from '@shared/planTable';
import type { GenerationRequest } from '@shared/types';
import { REQUEST_LIMITS } from '@shared/validation';
import {
  buildDevelopPrefill, developConsignes, developSujet, extractPlanContext, parsePlan, planOriginFromRecord, planOriginFromRequest,
  readPlan, sessionLabel, type PlanOrigin,
} from '@/lib/generation/plan';

const PLAN = `# Séquence — La Révolution française

**Niveau :** 4ème

## Problématique

Comment la Révolution française transforme-t-elle la société et le pouvoir en France ?

## Objectifs de la séquence

- Situer les grandes étapes de la Révolution
- Comprendre la fin de l'Ancien Régime
- Analyser des documents

## Évaluation diagnostique

Un questionnaire de 10 questions sur les prérequis.

## Tableau synoptique

| N° | Titre | Objectif | Activités | Durée | Évaluation |
|---|---|---|---|---|---|
| 1 | L'Ancien Régime | Décrire la société d'Ancien Régime | Étude de documents | 55 min | Diagnostique |
| 2 | 1789 : la prise de la Bastille | Expliquer les causes de la Révolution | Frise chronologique | 55 min | — |
| 3 | La fin de la monarchie | Comprendre la chute du roi | Débat | 55 min | Formative |
| 4 | La Terreur | Analyser la radicalisation | Étude de cas | 55 min | Formative |

## Évaluation sommative prévue

Un devoir en classe de 55 minutes.

## Prolongements

Visite d'un musée.
`;

const ORIGIN: PlanOrigin = {
  niveau: '4eme', matiere: 'histoire_geo', sujet: 'La Révolution française', researchMode: 'documents',
};

/** Ligne de tableau « | a | b |… » à partir de cellules. */
const row = (...cells: string[]) => `| ${cells.join(' | ')} |`;

describe('parsePlan — tableau des séances', () => {
  it('lit numéro, titre, objectif et ligne du plan d’un tableau standard', () => {
    const sessions = parsePlan(PLAN);
    expect(sessions.map(s => s.numero)).toEqual([1, 2, 3, 4]);
    expect(sessions[0]).toMatchObject({ titre: 'L\'Ancien Régime', objectif: 'Décrire la société d\'Ancien Régime' });
    expect(sessions[1].titre).toBe('1789 : la prise de la Bastille');
    expect(sessions[0].ligne).toBe(
      'Titre : L\'Ancien Régime ; Objectif : Décrire la société d\'Ancien Régime ; Activités : Étude de documents ; Durée : 55 min ; Évaluation : Diagnostique',
    );
    // Valeur sans contenu (« — ») : absente de la ligne du plan.
    expect(sessions[1].ligne).not.toContain('Évaluation');
  });

  it('numéros « 1 », « Séance 1 », « S1 », « 1. », « 1) » et « séance n° 5 »', () => {
    const table = [
      '| Séance | Titre |', '|---|---|',
      row('1', 'Un'), row('Séance 2', 'Deux'), row('S3', 'Trois'), row('4.', 'Quatre'), row('5)', 'Cinq'), row('séance n° 6', 'Six'), row('SÉANCE 7', 'Sept'),
    ].join('\n');
    expect(parsePlan(table).map(s => [s.numero, s.titre])).toEqual([
      [1, 'Un'], [2, 'Deux'], [3, 'Trois'], [4, 'Quatre'], [5, 'Cinq'], [6, 'Six'], [7, 'Sept'],
    ]);
  });

  it('gras, espaces superflus, balises <br> et barres échappées dans les cellules', () => {
    const table = [
      '|  **N°**  |   **Titre**   | Objectif |', '| :---: | --- | ---: |',
      '|  **1**  |  **Les  causes**<br>(suite)  | Savoir \\| comprendre |',
    ].join('\n');
    const [first] = parsePlan(table);
    expect(first).toMatchObject({ numero: 1, titre: 'Les causes (suite)', objectif: 'Savoir | comprendre' });
  });

  it('sans barres initiale et finale, avec ligne de séparation', () => {
    const table = ['N° | Titre | Durée', '--- | --- | ---', '1 | Départ | 45 min', '2 | Suite | 45 min'].join('\n');
    expect(parsePlan(table).map(s => s.titre)).toEqual(['Départ', 'Suite']);
  });

  it('sans ligne de séparation mais avec des barres de bordure', () => {
    const table = ['| N° | Titre |', row('1', 'A'), row('2', 'B')].join('\n');
    expect(parsePlan(table).map(s => s.titre)).toEqual(['A', 'B']);
  });

  it('fins de ligne Windows (\\r\\n)', () => {
    const table = ['| N° | Titre |', '|---|---|', row('1', 'A'), row('2', 'B')].join('\r\n');
    expect(parsePlan(table).map(s => s.numero)).toEqual([1, 2]);
  });

  it('numéro et titre dans la même cellule (« Séance 1 : Titre »)', () => {
    const table = ['| Séance | Objectif |', '|---|---|', row('Séance 1 : Les causes', 'Comprendre'), row('2 - Les débuts', 'Situer'), row('Séance 3', 'Conclure')].join('\n');
    const sessions = parsePlan(table);
    // Séance 3 : pas de titre dans la cellule, l'objectif en tient lieu.
    expect(sessions.map(s => s.titre)).toEqual(['Les causes', 'Les débuts', 'Conclure']);
    expect(sessions[0].ligne).toBe('Titre : Les causes ; Objectif : Comprendre');
  });

  it('lignes regroupant plusieurs séances (« Séances 3 et 4 », « 5-6 », « 7 à 9 ») ; « 2 - 3 activités » n’en est pas une', () => {
    const table = [
      '| Séance | Titre |', '|---|---|',
      row('1', 'A'), row('2 - 3 activités', 'B'), row('Séances 4 et 5', 'C'), row('6-7', 'D'), row('8 à 10', 'E'),
    ].join('\n');
    const sessions = parsePlan(table);
    expect(sessions.map(s => [s.numero, s.fin])).toEqual([[1, undefined], [2, undefined], [4, 5], [6, 7], [8, 10]]);
    expect(sessions[1].titre).toBe('B');
    expect(sessionLabel(sessions[2])).toBe('séances 4 et 5');
    expect(sessionLabel(sessions[4])).toBe('séances 8 à 10');
  });

  it('module du supérieur : numéro | format | thème | contenus | travail étudiant', () => {
    const table = [
      '| Numéro | Format | Thème | Contenus | Travail étudiant |', '|---|---|---|---|---|',
      row('1', 'CM', 'Les coûts complets', 'Charges directes et indirectes', 'Lecture'), row('2', 'TD', 'Les coûts partiels', 'Marge sur coût variable', 'Exercices'),
    ].join('\n');
    const sessions = parsePlan(table);
    expect(sessions.map(s => s.titre)).toEqual(['Les coûts complets', 'Les coûts partiels']);
    expect(sessions[0].ligne).toContain('Format : CM');
    expect(sessions[0].objectif).toBe('');
  });

  it('texte sans tableau, tableau sans colonne de numéro, ou sans ligne numérotée : liste vide', () => {
    expect(parsePlan('Pas de tableau ici.\n\nSéance 1 : introduction\nSéance 2 : suite')).toEqual([]);
    expect(parsePlan(['| Compétence | Niveau |', '|---|---|', row('Lire', '1'), row('Écrire', '2')].join('\n'))).toEqual([]);
    expect(parsePlan(['| Séance | Titre |', '|---|---|', row('Introduction', 'A'), row('Conclusion', 'B')].join('\n'))).toEqual([]);
    expect(parsePlan('')).toEqual([]);
    expect(parsePlan('| a | b |')).toEqual([]);
  });

  it('plusieurs tableaux : le premier qui annonce un numéro de séance', () => {
    const text = [
      '| Compétence | Niveau |', '|---|---|', row('Lire', 'A'), '',
      '| N° de séance | Titre |', '|---|---|', row('1', 'Premier'), row('2', 'Second'), '',
      '| Séance | Durée |', '|---|---|', row('1', '10 min'),
    ].join('\n');
    expect(parsePlan(text).map(s => s.titre)).toEqual(['Premier', 'Second']);
  });

  it('lignes mal formées ignorées : sans numéro, numéro douteux (1a, 1h30, 12,5, 0, 1234), doublons, cellules manquantes', () => {
    const table = [
      '| Séance | Titre | Durée |', '|---|---|---|',
      row('1', 'Valide', '45 min'), row('1a', 'Douteux', ''), row('1h30', 'Durée', ''), row('12,5', 'Décimal', ''), row('0', 'Zéro', ''),
      row('1234', 'Trop grand', ''), row('1', 'Doublon', ''), row('Total', '', ''), '| 2 |', '|', '| 3 | Troisième |', row('', 'Sans numéro', ''),
    ].join('\n');
    const sessions = parsePlan(table);
    expect(sessions.map(s => [s.numero, s.titre])).toEqual([[1, 'Valide'], [2, ''], [3, 'Troisième']]);
  });

  it('ordinaux (1ère séance, 2e, 3ème) et total (« 4/6 »)', () => {
    const table = ['| Séance | Titre |', '|---|---|', row('1ère séance', 'A'), row('2e', 'B'), row('3ème', 'C'), row('4/6', 'D')].join('\n');
    expect(parsePlan(table).map(s => [s.numero, s.titre])).toEqual([[1, 'A'], [2, 'B'], [3, 'C'], [4, 'D']]);
  });

  it('tableau dans un bloc de code ou dans un document entouré de « ```markdown »', () => {
    const wrapped = ['```markdown', '| N° | Titre |', '|---|---|', row('1', 'A'), row('2', 'B'), '```'].join('\n');
    expect(parsePlan(wrapped).map(s => s.numero)).toEqual([1, 2]);
  });

  it('plus de 60 séances : les 60 premières seulement', () => {
    const rows = Array.from({ length: 85 }, (_, i) => row(String(i + 1), `Séance numéro ${i + 1}`));
    const sessions = parsePlan(['| N° | Titre |', '|---|---|', ...rows].join('\n'));
    expect(sessions).toHaveLength(PLAN_LIMITS.sessions);
    expect(sessions[59]).toMatchObject({ numero: 60, titre: 'Séance numéro 60' });
  });

  it('jamais d’exception sur une entrée qui n’est pas un texte', () => {
    for (const value of [undefined, null, 42, {}, [], true]) expect(readPlanTable(value)).toEqual([]);
  });

  it('exemples pré-rédigés de la démonstration (scolaire et supérieur) : séances lues', () => {
    const scolaire = getDemoExample({ type: 'sequence', niveau: 'ce2' });
    expect(parsePlan(scolaire.markdown).map(s => s.numero)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(parsePlan(scolaire.markdown)[2].titre).toBe('Fusion et solidification');
    // Tableau « Semaine | CM | TD » (pas de numéro de séance) : rien n'est proposé, sans erreur.
    expect(parsePlan(getDemoExample({ type: 'sequence', niveau: 'licence_3' }).markdown)).toEqual([]);
  });
});

describe('parsePlan — entrées démesurées (jamais de lenteur)', () => {
  const HEADER = '| N° | Titre |\n|---|---|\n';

  /** Durée d'une lecture (ms). */
  function timed(text: string): number {
    const start = performance.now();
    parsePlan(text);
    return performance.now() - start;
  }

  it('200 000 caractères de lignes de tableau : lecture en moins d’une seconde', () => {
    const rows = Array.from({ length: 12_000 }, (_, i) => row(String((i % 99) + 1), 'Titre de la séance')).join('\n');
    const text = (HEADER + rows).slice(0, 200_000);
    expect(text.length).toBe(200_000);
    expect(timed(text)).toBeLessThan(1_000);
  });

  it('entrées pathologiques (barres, espaces, gras, tirets, numéros, cellules géantes) : lecture linéaire', () => {
    const big = 400_000;
    const inputs = [
      '|'.repeat(big),
      'a|'.repeat(big / 2),
      `${' '.repeat(big)}| 1 |`,
      `| N° | Titre |\n|---|---|\n| ${' '.repeat(big)}1 | x |`,
      `| N° | Titre |\n|---|---|\n| Séance ${' '.repeat(big)}x | y |`,
      `| N° | Titre |\n|---|---|\n| ${'1'.repeat(big)} | y |`,
      `| N° | Titre |\n|---|---|\n| ${'*_'.repeat(big / 2)} | y |`,
      `| N° | Titre |\n|---|---|\n| 1 ${'-'.repeat(big)} | ${'\\|'.repeat(big / 2)} |`,
      `| N° | Titre |\n|---|---|\n| 1 ${'et 2 '.repeat(big / 5)} | y |`,
      `|${'---|'.repeat(big / 4)}`,
      `|${' séance |'.repeat(big / 9)}\n|${'---|'.repeat(1000)}\n| 1 |`,
      '\n'.repeat(big),
      '| \n'.repeat(big / 3),
      `${'| N° | Titre |\n|---|---|\n| x | y |\n\n'.repeat(big / 40)}`,
      `<br>`.repeat(big / 4),
      `**${'a'.repeat(big)}`,
    ];
    for (const input of inputs) {
      const ms = timed(input);
      expect(ms, input.slice(0, 30)).toBeLessThan(1_000);
    }
  });

  it('extractPlanContext et readPlan : mêmes bornes (liste immense, lignes démesurées)', () => {
    const big = 400_000;
    const inputs = [
      `## Objectifs\n${'- un objectif\n'.repeat(60_000)}`,
      `${'_'.repeat(big)}a`,
      `a${'_'.repeat(big)}b`,
      `Objectifs ${'a '.repeat(big / 2)}`,
      `Objectifs : ${'* '.repeat(big / 2)}`,
      `${'#'.repeat(big)} Problématique`,
      `**${'*_'.repeat(big / 2)}`,
      `Problématique${' '.repeat(big)}x`,
      `${'Objectifs\n\n'.repeat(big / 12)}`,
      `${'Problématique :\n'.repeat(big / 16)}`,
    ];
    for (const input of inputs) {
      const start = performance.now();
      extractPlanContext(input);
      readPlan(input);
      expect(performance.now() - start, input.slice(0, 20)).toBeLessThan(1_000);
    }
  });
});

describe('extractPlanContext — objectifs et problématique', () => {
  it('rubriques en titre : problématique en paragraphe, objectifs en liste (joints par « ; »)', () => {
    const context = extractPlanContext(PLAN);
    expect(context.problematique).toBe('Comment la Révolution française transforme-t-elle la société et le pouvoir en France ?');
    expect(context.objectifs).toBe('Situer les grandes étapes de la Révolution ; Comprendre la fin de l\'Ancien Régime ; Analyser des documents');
  });

  it('libellés en ligne (gras ou non), avec ou sans texte sur la ligne', () => {
    const text = '**Problématique :** Pourquoi l\'eau change-t-elle d\'état ?\n\nObjectifs de la séquence :\n- Identifier\n- Mesurer\n\nSuite';
    expect(extractPlanContext(text)).toEqual({
      problematique: 'Pourquoi l\'eau change-t-elle d\'état ?',
      objectifs: 'Identifier ; Mesurer',
    });
    expect(extractPlanContext('**Objectifs** : Découvrir les états de la matière').objectifs).toBe('Découvrir les états de la matière');
  });

  it('acquis d’apprentissage (supérieur) ; lignes de tableau jamais prises pour une rubrique', () => {
    const text = '## Acquis d\'apprentissage visés\n\nÀ l\'issue de l\'UE, l\'étudiant sait calculer un coût.\n\n| Séance | Objectifs |\n|---|---|\n| 1 | Coûts |';
    expect(extractPlanContext(text).objectifs).toBe('À l\'issue de l\'UE, l\'étudiant sait calculer un coût.');
  });

  it('rubrique absente, vide ou illisible : texte vide, jamais d’exception', () => {
    expect(extractPlanContext('Rien à signaler')).toEqual({ problematique: '', objectifs: '' });
    expect(extractPlanContext('## Objectifs\n\n## Problématique\n')).toEqual({ problematique: '', objectifs: '' });
    expect(extractPlanContext(undefined as unknown as string)).toEqual({ problematique: '', objectifs: '' });
    // « Objectifs » ne commence pas une phrase ordinaire.
    expect(extractPlanContext('Objectifs atteints par la classe l\'an dernier, voir le bilan.').objectifs).toBe('');
  });

  it('texte long : tronqué proprement', () => {
    const long = `## Problématique\n\n${'mot '.repeat(500)}`;
    const { problematique } = extractPlanContext(long);
    expect(problematique.length).toBeLessThanOrEqual(600);
    expect(problematique.endsWith('…')).toBe(true);
  });
});

describe('readPlan', () => {
  it('séances, contexte et nombre total (le nombre demandé, s’il est plus grand que le dernier numéro lu)', () => {
    expect(readPlan(PLAN)?.total).toBe(4);
    expect(readPlan(PLAN, 6)?.total).toBe(6);
    expect(readPlan(PLAN, 2)?.total).toBe(4);
    expect(readPlan(PLAN, 99)?.total).toBe(4);
    expect(readPlan(PLAN)?.context.problematique).toContain('Révolution');
  });

  it('aucune séance lisible : null (rien n’est proposé)', () => {
    expect(readPlan('# Plan\n\nTexte sans tableau.')).toBeNull();
  });
});

describe('buildDevelopPrefill — demande préparée pour l’outil « fiche de préparation »', () => {
  const plan = readPlan(PLAN, 4)!;

  it('même niveau, matière, discipline ; sujet « <sujet> — séance N : <titre> » ; objectifs de la ligne', () => {
    const prefill = buildDevelopPrefill({ ...ORIGIN, discipline: 'Histoire moderne' }, plan, 1)!;
    expect(prefill.reuse).toMatchObject({
      type: 'fiche_prep', niveau: '4eme', matiere: 'histoire_geo', discipline: 'Histoire moderne',
      sujet: 'La Révolution française — séance 2 : 1789 : la prise de la Bastille',
    });
    expect(prefill.reuse.params).toMatchObject({ objectifs: 'Expliquer les causes de la Révolution', researchMode: 'documents' });
    expect(prefill.reuseNotice).toContain('séance 2 sur 4');
  });

  it('consignes : gabarit fixe qui conserve la cohérence (objectifs, problématique, ligne du plan, voisines)', () => {
    const consignes = buildDevelopPrefill(ORIGIN, plan, 1)!.reuse.params!.consignes;
    expect(consignes).toBe(
      'Séance 2 sur 4 d\'une séquence « La Révolution française ». '
      + 'Objectifs et problématique de la séquence : objectifs : Situer les grandes étapes de la Révolution ; Comprendre la fin de l\'Ancien Régime ; Analyser des documents ; '
      + 'problématique : Comment la Révolution française transforme-t-elle la société et le pouvoir en France ?. '
      + 'Ligne du plan : Titre : 1789 : la prise de la Bastille ; Objectif : Expliquer les causes de la Révolution ; Activités : Frise chronologique ; Durée : 55 min. '
      + 'Séance précédente : séance 1 — L\'Ancien Régime. Séance suivante : séance 3 — La fin de la monarchie. Respecte ce plan.',
    );
  });

  it('première et dernière séances : pas de voisine, dit explicitement', () => {
    const first = buildDevelopPrefill(ORIGIN, plan, 0)!.reuse.params!.consignes as string;
    const last = buildDevelopPrefill(ORIGIN, plan, 3)!.reuse.params!.consignes as string;
    expect(first).toContain('Séance précédente : aucune (première séance de la séquence).');
    expect(last).toContain('Séance suivante : aucune (dernière séance de la séquence).');
    expect(first.startsWith('Séance 1 sur 4')).toBe(true);
  });

  it('sans objectifs ni problématique lisibles : objectifs de l’enseignant, sinon « non précisés dans le plan »', () => {
    const bare = readPlan(['| N° | Titre |', '|---|---|', row('1', 'A'), row('2', 'B')].join('\n'))!;
    expect(buildDevelopPrefill(ORIGIN, bare, 0)!.reuse.params!.consignes).toContain('Objectifs et problématique de la séquence : non précisés dans le plan.');
    const withTeacher = buildDevelopPrefill({ ...ORIGIN, objectifs: 'Maîtriser la chronologie' }, bare, 0)!;
    expect(withTeacher.reuse.params!.consignes).toContain('Objectifs et problématique de la séquence : objectifs : Maîtriser la chronologie.');
    // Pas de colonne « objectif » : le champ « objectifs » du formulaire reste vide.
    expect(withTeacher.reuse.params).not.toHaveProperty('objectifs');
  });

  it('ligne regroupant plusieurs séances ; séance sans titre', () => {
    const merged = readPlan(['| N° | Titre |', '|---|---|', row('1', 'A'), row('Séances 2 et 3', 'B'), row('4', '')].join('\n'))!;
    const prefill = buildDevelopPrefill(ORIGIN, merged, 1)!;
    expect(prefill.reuse.sujet).toBe('La Révolution française — séances 2 et 3 : B');
    expect(prefill.reuse.params!.consignes).toContain('Séances 2 et 3 sur 4 d\'une séquence');
    expect(prefill.reuse.params!.consignes).toContain('Séance suivante : séance 4.');
    expect(buildDevelopPrefill(ORIGIN, merged, 2)!.reuse.sujet).toBe('La Révolution française — séance 4');
  });

  it('indice hors de la liste : null', () => {
    expect(buildDevelopPrefill(ORIGIN, plan, 9)).toBeNull();
    expect(buildDevelopPrefill(ORIGIN, plan, -1)).toBeNull();
  });

  it('jamais au-delà des limites de la demande (sujet, objectifs, consignes), même avec des textes démesurés', () => {
    const huge = 'mot '.repeat(5_000);
    const table = ['| N° | Titre | Objectif | Activités |', '|---|---|---|---|']
      .concat(Array.from({ length: 5 }, (_, i) => row(String(i + 1), huge, huge, huge)))
      .join('\n');
    const bigPlan = readPlan(`## Problématique\n\n${huge}\n\n## Objectifs\n\n${huge}\n\n${table}`, 12)!;
    const origins: PlanOrigin[] = [
      ORIGIN,
      { ...ORIGIN, sujet: 'S'.repeat(REQUEST_LIMITS.sujet), objectifs: huge },
      { ...ORIGIN, sujet: `${'é '.repeat(200)}`, discipline: 'D'.repeat(150) },
      { ...ORIGIN, sujet: '😀'.repeat(150) },
    ];
    for (const origin of origins) {
      for (let i = 0; i < bigPlan.sessions.length; i++) {
        const { reuse } = buildDevelopPrefill(origin, bigPlan, i)!;
        expect(reuse.sujet.length, 'sujet').toBeLessThanOrEqual(REQUEST_LIMITS.sujet);
        expect((reuse.params!.consignes as string).length, 'consignes').toBeLessThanOrEqual(REQUEST_LIMITS.consignes);
        expect(((reuse.params!.objectifs as string | undefined) ?? '').length, 'objectifs').toBeLessThanOrEqual(REQUEST_LIMITS.objectifs);
        // Le gabarit n'est jamais coupé : début et fin toujours là, aucune paire de substitution coupée en deux.
        expect(reuse.params!.consignes).toMatch(/^Séance \d+ sur \d+ d'une séquence « /);
        expect(reuse.params!.consignes).toMatch(/Respecte ce plan\.$/);
        expect(reuse.sujet).not.toMatch(/[\ud800-\udbff]$/);
        expect(reuse.params!.consignes as string).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
      }
    }
  });

  it('developSujet et developConsignes : bornes seules', () => {
    const session = plan.sessions[0];
    expect(developSujet('S'.repeat(300), session).length).toBe(300);
    expect(developSujet('Court', session)).toBe('Court — séance 1 : L\'Ancien Régime');
    expect(developConsignes(ORIGIN, plan, 0).length).toBeLessThan(REQUEST_LIMITS.consignes);
  });
});

describe('planOriginFromRequest / planOriginFromRecord', () => {
  const REQ: GenerationRequest = {
    type: 'sequence', niveau: '4eme', matiere: 'histoire_geo', sujet: 'La Révolution', objectifs: 'Comprendre', researchMode: 'internet', planSeulement: true,
  };

  it('demande de séquence : niveau, matière, sujet, objectifs, mode de recherche', () => {
    expect(planOriginFromRequest(REQ)).toEqual({ niveau: '4eme', matiere: 'histoire_geo', sujet: 'La Révolution', objectifs: 'Comprendre', researchMode: 'internet' });
    expect(planOriginFromRequest({ ...REQ, discipline: 'Histoire' }).discipline).toBe('Histoire');
  });

  it('enregistrement de l’historique : paramètres relus un à un', () => {
    const origin = planOriginFromRecord({
      type: 'sequence', niveau: 'licence_3', matiere: 'autre', discipline: 'Droit', sujet: 'Le contrat',
      params: { objectifs: 'Maîtriser', researchMode: 'documents', planSeulement: true },
    });
    expect(origin).toEqual({ niveau: 'licence_3', matiere: 'autre', discipline: 'Droit', sujet: 'Le contrat', objectifs: 'Maîtriser', researchMode: 'documents' });
    const odd = planOriginFromRecord({ type: 'sequence', niveau: 'x', matiere: 'y', sujet: 'S', params: { objectifs: 42, researchMode: {} } });
    expect(odd).toEqual({ niveau: 'x', matiere: 'y', sujet: 'S' });
  });
});
