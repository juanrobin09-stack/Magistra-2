// Choix du tableau des séances parmi plusieurs (leurres « N° | Objectif », chronologies, tableaux coupés en deux) et lecture
// des numéros en liste (« Séances 1, 2 et 3 », « 3, 4, 5 », « Séance 1 : 12 ») : cas rapportés par la relecture, puis corpus
// de plans réalistes générés (graine fixe) dont l'exactitude ne doit pas baisser.

import { describe, expect, it } from 'vitest';
import { checkOutputStructure } from '@shared/outputChecks';
import { leadingRun, readPlanTable } from '@shared/planTable';
import type { GenerationRequest } from '@shared/types';
import { parsePlan, readPlan } from '@/lib/generation/plan';
import { buildCorpus, isRightTable } from './planCorpus';

const row = (...cells: string[]) => `| ${cells.join(' | ')} |`;
/** Tableau Markdown : en-tête, séparation, lignes. */
const table = (header: string[], rows: string[][]) => [row(...header), row(...header.map(() => '---')), ...rows.map(cells => row(...cells))].join('\n');
/** `n` lignes numérotées de 1 à n (ou des numéros donnés), chaque ligne construite par `cells`. */
const lines = (numbers: number | number[], cells: (k: number) => string[]) =>
  (typeof numbers === 'number' ? Array.from({ length: numbers }, (_, i) => i + 1) : numbers).map(k => [String(k), ...cells(k)]);
const numeros = (text: string, requested?: number) => parsePlan(text, requested).map(s => s.numero);
const titles = (text: string, requested?: number) => parsePlan(text, requested).map(s => s.titre);

/** Tableau « leurre » : les objectifs numérotés (un seul objectif par ligne). */
const objectives = (n: number, header = ['N°', 'Objectif']) => table(header, lines(n, k => [`Objectif ${k}`]));

describe('choix du tableau — cas rapportés', () => {
  it('A : le tableau des séances (3 lignes) l’emporte sur un leurre d’une seule ligne, nombre demandé 3', () => {
    const real = table(['Séance', 'Thématique', 'Support'], lines(3, k => [`Thème ${k}`, `Support ${k}`]));
    const lure = table(['N°', 'Objectif'], [['1', 'Situer']]);
    expect(titles(`${real}\n\n${lure}`, 3)).toEqual(['Thème 1', 'Thème 2', 'Thème 3']);
    expect(titles(`${lure}\n\n${real}`, 3)).toEqual(['Thème 1', 'Thème 2', 'Thème 3']);
    expect(titles(`${real}\n\n${lure}`)).toEqual(['Thème 1', 'Thème 2', 'Thème 3']);
  });

  it('B : « Séance | Titre | Objectif » de 4 lignes, puis « N° | Objectif » de 5 lignes, sans nombre demandé', () => {
    const real = table(['Séance', 'Titre', 'Objectif'], lines(4, k => [`Titre ${k}`, `Objectif ${k}`]));
    expect(titles(`${real}\n\n${objectives(5)}`)).toEqual(['Titre 1', 'Titre 2', 'Titre 3', 'Titre 4']);
    expect(titles(`${objectives(5)}\n\n${real}`)).toEqual(['Titre 1', 'Titre 2', 'Titre 3', 'Titre 4']);
  });

  it('C : vrai tableau numéroté 1, 2, 4, 5 (trou), puis « N° | Objectif » de 3 lignes, nombre demandé 5', () => {
    const real = table(['N°', 'Titre', 'Objectif', 'Activités'], lines([1, 2, 4, 5], k => [`Titre ${k}`, `Objectif ${k}`, 'Débat']));
    expect(numeros(`${real}\n\n${objectives(3)}`, 5)).toEqual([1, 2, 4, 5]);
    expect(numeros(`${objectives(3)}\n\n${real}`, 5)).toEqual([1, 2, 4, 5]);
    expect(titles(`${real}\n\n${objectives(3)}`, 5)).toEqual(['Titre 1', 'Titre 2', 'Titre 4', 'Titre 5']);
  });

  it('D : vrai tableau des séances 2 à 5 (sans la séance 1), puis leurre de 2 lignes', () => {
    const real = table(['N°', 'Titre', 'Objectif', 'Durée'], lines([2, 3, 4, 5], k => [`Titre ${k}`, `Objectif ${k}`, '55 min']));
    for (const requested of [undefined, 5]) {
      expect(numeros(`${real}\n\n${objectives(2)}`, requested)).toEqual([2, 3, 4, 5]);
      expect(numeros(`${objectives(2)}\n\n${real}`, requested)).toEqual([2, 3, 4, 5]);
    }
  });

  it('H : « N° | Objectif » de 6 lignes AVANT « Séance | Objectif | Activités | Durée » de 6 lignes, nombre demandé 6', () => {
    const real = table(['Séance', 'Objectif', 'Activités', 'Durée'], lines(6, k => [`Réel ${k}`, 'Étude', '55 min']));
    const found = parsePlan(`${objectives(6)}\n\n${real}`, 6);
    expect(found.map(s => s.objectif)).toEqual(['Réel 1', 'Réel 2', 'Réel 3', 'Réel 4', 'Réel 5', 'Réel 6']);
    expect(parsePlan(`${objectives(6)}\n\n${real}`).map(s => s.objectif)).toEqual(found.map(s => s.objectif));
  });

  it('E : leurre « N° | Objectif » avant un vrai tableau « Séance | <colonne> | Durée », même avec moins de lignes que demandé', () => {
    // En-têtes que la liste fermée d'avant ne connaissait pas : « contenu » était même exclu du repli de titre.
    for (const column of ['Description', 'Notion', 'Étape', 'Phase', 'Compétences', 'Capacité', 'Question', 'Contenu', 'Thématique']) {
      const real = table(['Séance', column, 'Durée'], lines(4, k => [`${column} ${k}`, '55 min']));
      for (const requested of [undefined, 4, 6]) {
        expect(titles(`${objectives(5)}\n\n${real}`, requested), `${column} / ${requested}`).toHaveLength(4);
        expect(numeros(`${objectives(5)}\n\n${real}`, requested), `${column} / ${requested}`).toEqual([1, 2, 3, 4]);
      }
    }
    // « Contenu » sert de titre dans la liste des séances.
    expect(titles(table(['N°', 'Contenu', 'Durée'], lines(2, k => [`Contenu ${k}`, '55 min'])))).toEqual(['Contenu 1', 'Contenu 2']);
  });

  it('E : plan coupé en deux tableaux (séances 1-3, puis 4-6) : lu d’un seul tenant, sans faux avertissement', () => {
    const header = ['N°', 'Titre', 'Objectif'];
    const first = table(header, lines(3, k => [`Titre ${k}`, `Objectif ${k}`]));
    const second = table(header, lines([4, 5, 6], k => [`Titre ${k}`, `Objectif ${k}`]));
    const text = `## Séances 1 à 3\n\n${first}\n\n**Suite du tableau**\n\n${second}\n\n## Prolongements`;
    expect(numeros(text)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(numeros(text, 6)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(readPlan(text, 6)?.total).toBe(6);
    const request: GenerationRequest = { type: 'sequence', niveau: '4eme', matiere: 'histoire_geo', sujet: 'S', researchMode: 'documents', nombreSeances: 6, planSeulement: true };
    expect(checkOutputStructure(request, text)).toEqual([]);
    // Une seconde partie qui ne reprend pas la numérotation n'est pas jointe ; ni un tableau de forme différente ; ni loin.
    expect(numeros(`${first}\n\n${table(header, lines([1, 2], k => [`Autre ${k}`, 'x']))}`)).toEqual([1, 2, 3]);
    expect(numeros(`${first}\n\n${table(['N°', 'Objectif'], lines([4, 5], k => [`Autre ${k}`]))}`)).toEqual([1, 2, 3]);
    expect(numeros(`${first}\n\n${'Du texte.\n\n'.repeat(8)}${second}`)).toEqual([1, 2, 3]);
  });

  it('un tableau de séances suffisant n’est pas écarté pour un leurre qui a plus de lignes', () => {
    const real = table(['N°', 'Titre', 'Objectif'], lines(3, k => [`Titre ${k}`, `Objectif ${k}`]));
    expect(numeros(`${objectives(8)}\n\n${real}`)).toEqual([1, 2, 3]);
    // « Séance | Évaluation » (deux lignes : séance 1 et dernière séance) est un rappel, pas le plan.
    const recap = table(['Séance', 'Évaluation'], [['1', 'Diagnostique'], ['8', 'Sommative']]);
    expect(numeros(`${real.replace('| N° |', '| Séance |')}\n\n${recap}`)).toEqual([1, 2, 3]);
    expect(numeros(`${recap}\n\n${real}`)).toEqual([1, 2, 3]);
  });

  it('chronologie, questions et compétences numérotées ne sont pas préférées au tableau des séances', () => {
    const real = table(['N°', 'Titre', 'Durée'], lines(4, k => [`Titre ${k}`, '55 min']));
    const timeline = table(['N°', 'Événement', 'Date'], lines(9, k => [`Événement ${k}`, String(1788 + k)]));
    const questions = table(['N°', 'Question', 'Réponse'], lines(7, k => [`Question ${k} ?`, `Réponse ${k}`]));
    const skills = table(['N°', 'Compétence', 'Niveau de maîtrise'], lines(5, k => [`Compétence ${k}`, 'Acquis']));
    for (const lure of [timeline, questions, skills]) {
      expect(numeros(`${lure}\n\n${real}`), lure.slice(0, 20)).toEqual([1, 2, 3, 4]);
      expect(numeros(`${real}\n\n${lure}`), lure.slice(0, 20)).toEqual([1, 2, 3, 4]);
    }
  });

  it('seul tableau lisible, même pauvre : toujours lu (rien ne change quand il n’y a pas de concurrent)', () => {
    expect(numeros(objectives(3))).toEqual([1, 2, 3]);
    expect(numeros(table(['N°', 'Événement', 'Date'], lines(8, k => [`E${k}`, '1789'])))).toHaveLength(8);
  });

  it('leadingRun : suite 1…n sans trou, lignes regroupées comprises', () => {
    expect(leadingRun([{ numero: 1 }, { numero: 2 }, { numero: 4 }])).toBe(2);
    expect(leadingRun([{ numero: 1, fin: 3 }, { numero: 4 }])).toBe(4);
    expect(leadingRun([{ numero: 2 }, { numero: 3 }])).toBe(0);
  });
});

describe('numéros en liste — une séance n’est pas écartée à tort', () => {
  const sessionsOf = (rows: string[][], header = ['Séance', 'Titre']) => readPlanTable(table(header, rows));

  it('E : « Séances 1, 2 et 3 » / « Séances 4, 5 et 6 » : deux lignes qui regroupent des séances', () => {
    const sessions = sessionsOf([['Séances 1, 2 et 3', 'Début'], ['Séances 4, 5 et 6', 'Fin']]);
    expect(sessions.map(s => [s.numero, s.fin, s.titre])).toEqual([[1, 3, 'Début'], [4, 6, 'Fin']]);
    expect(readPlan(table(['Séance', 'Titre'], [['Séances 1, 2 et 3', 'Début'], ['Séances 4, 5 et 6', 'Fin']]))?.total).toBe(6);
  });

  it('F : deux lignes valides, puis « 3, 4, 5 » et « 6, 7, 8 » : tout est lu', () => {
    const sessions = sessionsOf([['1', 'A'], ['2', 'B'], ['3, 4, 5', 'C'], ['6, 7, 8', 'D']]);
    expect(sessions.map(s => [s.numero, s.fin])).toEqual([[1, undefined], [2, undefined], [3, 5], [6, 8]]);
  });

  it('G : un titre qui n’est qu’un nombre (« Séance 1 : 12 ») n’est pas une liste', () => {
    const sessions = sessionsOf([['Séance 1 : 12', 'x'], ['Séance 2 : 14', 'y']], ['Séance', 'Objectif']);
    expect(sessions.map(s => [s.numero, s.titre])).toEqual([[1, '12'], [2, '14']]);
    expect(sessionsOf([['1 - 25', 'x'], ['2. 40', 'y']], ['Séance', 'Objectif']).map(s => s.numero)).toEqual([1, 2]);
    expect(sessionsOf([['Séance 3 : 150', 'x']], ['Séance', 'Objectif'])).toHaveLength(1);
  });

  it('numéros qui ne se suivent pas (« 1, 3, 5 », « 2 et 5 », « 1-2 ; 3-4 ») : renvois, jamais des séances', () => {
    expect(sessionsOf([['1, 3, 5', 'A'], ['2 et 5', 'B'], ['1-2 ; 3-4', 'C']])).toEqual([]);
    // Une ligne de renvois dans un vrai tableau est écartée, le tableau reste.
    expect(sessionsOf([['1', 'A'], ['2', 'B'], ['3', 'C'], ['1, 3, 5', 'renvoi']]).map(s => s.numero)).toEqual([1, 2, 3]);
    // Colonne de renvois dont l'en-tête le dit : jamais un tableau de séances, même avec un seul numéro par ligne.
    for (const header of ['Séances concernées', 'Séances associées', 'Séances liées', 'N° des séances concernées']) {
      expect(readPlanTable(table(['Compétence', header], [['Lire', '1'], ['Écrire', '2']])), header).toEqual([]);
    }
  });

  it('un tableau n’est rejeté en bloc que si les renvois y sont au moins aussi nombreux que les séances lues', () => {
    // Seuls des renvois : rien. Une matrice qui mêle un numéro seul et des listes (« 1, 3 ») reste une matrice.
    expect(sessionsOf([['1, 3, 5', 'A'], ['2, 4, 6', 'B']])).toEqual([]);
    expect(sessionsOf([['1', 'A'], ['2, 4', 'B']])).toEqual([]);
    // Un vrai tableau qui compte une ligne de renvois, ou une ligne « Séance 1 : 12 », est lu.
    expect(sessionsOf([['1', 'A'], ['2', 'B'], ['3, 5', 'C']]).map(s => s.numero)).toEqual([1, 2]);
    expect(sessionsOf([['Séance 1 : 12', 'A'], ['Séance 2 : 3, 5', 'B']], ['Séance', 'Objectif']).map(s => [s.numero, s.titre])).toEqual([[1, '12'], [2, '3, 5']]);
  });
});

// ─── Corpus de plans réalistes ──────────────────────────────────────────────

describe('corpus de plans générés — exactitude du choix du tableau', () => {
  const corpus = buildCorpus(3_000);
  const results = corpus.map(c => ({ c, ok: isRightTable(readPlanTable(c.markdown, c.requested), c.expected) }));

  it('le corpus est déterministe et varié', () => {
    expect(buildCorpus(50).map(c => c.markdown)).toEqual(corpus.slice(0, 50).map(c => c.markdown));
    const traits = new Set(corpus.flatMap(c => c.traits));
    for (const expected of ['leurre:objectifs', 'leurre:chronologie', 'leurre:matrice', 'leurre:evaluation-seance', 'défaut:gap', 'défaut:start2', 'défaut:tableau-coupé', 'demandé:inconnu']) {
      expect(traits.has(expected), expected).toBe(true);
    }
  });

  it('au moins 98 % des plans : le bon tableau, ligne par ligne', () => {
    const ok = results.filter(r => r.ok).length;
    expect(ok / corpus.length).toBeGreaterThanOrEqual(0.98);
  });

  it('chaque famille (leurre, défaut du tableau, nombre demandé) d’au moins 100 plans : au moins 94 %', () => {
    const byTrait = new Map<string, { ok: number; total: number }>();
    for (const { c, ok } of results) {
      for (const trait of c.traits) {
        const entry = byTrait.get(trait) ?? { ok: 0, total: 0 };
        entry.total++;
        if (ok) entry.ok++;
        byTrait.set(trait, entry);
      }
    }
    for (const [trait, { ok, total }] of byTrait) {
      if (total >= 100) expect(ok / total, `${trait} (${ok}/${total})`).toBeGreaterThanOrEqual(0.94);
    }
  });

  it('sans leurre : tous les plans sont lus (hors tableaux sans numéro de séance), jamais d’exception', () => {
    const alone = results.filter(r => r.c.traits.includes('leurre:aucun'));
    expect(alone.length).toBeGreaterThan(100);
    expect(alone.filter(r => !r.ok).length / alone.length).toBeLessThan(0.02);
  });
});
