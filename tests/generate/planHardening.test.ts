// « Développer une séance » — durcissement après relecture : coupes sûres (aucune demi-paire de substitution), choix du
// tableau des séances parmi plusieurs, total de séances, rubriques à titre numéroté, ponctuation du gabarit, décisions de
// l'enseignant reprises (consignes, durée, démarche).

import { describe, expect, it } from 'vitest';
import { clipText, PLAN_LIMITS, safeSlice, stripEndPunctuation } from '@shared/planTable';
import type { GenerationRequest } from '@shared/types';
import { REQUEST_LIMITS, validateGenerationRequest } from '@shared/validation';
import {
  buildDevelopPrefill, developConsignes, extractPlanContext, parsePlan, planOriginFromRecord, planOriginFromRequest, readPlan,
  type PlanOrigin,
} from '@/lib/generation/plan';

const ORIGIN: PlanOrigin = {
  niveau: '4eme', matiere: 'histoire_geo', sujet: 'La Révolution française', researchMode: 'documents',
};

/** Ligne de tableau « | a | b |… » à partir de cellules. */
const row = (...cells: string[]) => `| ${cells.join(' | ')} |`;

const PLAN = `## Problématique

Comment la Révolution française transforme-t-elle la société et le pouvoir en France ?

## Objectifs de la séquence

- Situer les grandes étapes de la Révolution
- Analyser des documents

## Tableau synoptique

| N° | Titre | Objectif | Activités | Durée |
|---|---|---|---|---|
| 1 | L'Ancien Régime | Décrire la société d'Ancien Régime | Étude de documents | 55 min |
| 2 | 1789 : la prise de la Bastille | Expliquer les causes | Frise chronologique | 55 min |
| 3 | La fin de la monarchie | Comprendre la chute du roi | Débat | 55 min |
| 4 | La Terreur | Analyser la radicalisation | Étude de cas | 55 min |
`;

/** Demi-paire de substitution : une unité haute sans basse après elle, ou une basse sans haute avant elle. */
const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const EMOJI = '😀';
/** `at` caractères, puis un emoji (sa première unité est à l'indice `at`), puis « zz ». */
const emojiAt = (at: number) => `${'a'.repeat(at)}${EMOJI}zz`;
/** Positions autour d'une borne : l'emoji la chevauche à l'une d'elles. */
const around = (limit: number) => Array.from({ length: 9 }, (_, i) => limit - 5 + i);

// ─── L1 : coupes sûres ──────────────────────────────────────────────────────

describe('coupe sûre — safeSlice, clipText, stripEndPunctuation', () => {
  it('safeSlice : jamais au milieu d’une paire de substitution', () => {
    const text = `abc${EMOJI}def`; // a b c ⟨haute⟩ ⟨basse⟩ d e f : l'emoji occupe les indices 3 et 4
    expect(safeSlice(text, 3)).toBe('abc');
    expect(safeSlice(text, 4)).toBe('abc');
    expect(safeSlice(text, 5)).toBe(`abc${EMOJI}`);
    expect(safeSlice(text, 100)).toBe(text);
    expect(safeSlice(text, 0)).toBe('');
    expect(safeSlice(EMOJI, 1)).toBe('');
    expect(safeSlice('', 5)).toBe('');
  });

  it('clipText : jamais plus de « max » caractères, jamais de demi-paire, « … » en fin de texte coupé', () => {
    const long = `${'é'.repeat(5)} ${EMOJI.repeat(30)}`;
    for (let max = 3; max < 45; max++) {
      const out = clipText(long, max);
      expect(out.length, `max ${max}`).toBeLessThanOrEqual(max);
      expect(out, `max ${max}`).not.toMatch(LONE);
      expect(out.endsWith('…'), `max ${max}`).toBe(true);
    }
    expect(clipText('court', 10)).toBe('court');
    expect(clipText(emojiAt(198), 200)).not.toMatch(LONE);
  });

  it('stripEndPunctuation : « . », « ! », « ? », « … », « ; », « : » et espaces de fin', () => {
    expect(stripEndPunctuation('gazeux. ')).toBe('gazeux');
    expect(stripEndPunctuation('Comment ça marche ?')).toBe('Comment ça marche');
    expect(stripEndPunctuation('évolue-t-elle…')).toBe('évolue-t-elle');
    expect(stripEndPunctuation('A ;')).toBe('A');
    expect(stripEndPunctuation('55 min')).toBe('55 min');
    expect(stripEndPunctuation('…')).toBe('');
  });
});

describe('troncature du plan — aucune demi-paire de substitution dans aucun champ', () => {
  const table = (cell: string) => ['| N° | Titre | Objectif | Activités |', '|---|---|---|---|', row('1', cell, cell, cell), row('2', 'B', 'b', 'b')].join('\n');

  it('tableau : emoji à cheval sur la borne de la cellule (600), du titre (200), de l’objectif (400) et d’une partie de la ligne (300)', () => {
    for (const limit of [PLAN_LIMITS.title, 300, PLAN_LIMITS.objective, PLAN_LIMITS.cell]) {
      for (const at of around(limit)) {
        const [first] = parsePlan(table(emojiAt(at)));
        expect(first.titre, `titre @${at}`).not.toMatch(LONE);
        expect(first.titre.length).toBeLessThanOrEqual(PLAN_LIMITS.title);
        expect(first.objectif, `objectif @${at}`).not.toMatch(LONE);
        expect(first.objectif.length).toBeLessThanOrEqual(PLAN_LIMITS.objective);
        expect(first.ligne, `ligne @${at}`).not.toMatch(LONE);
      }
    }
  });

  it('numéro et titre dans la même cellule, en-tête de colonne (40), ligne du plan (1 500) : emoji à cheval sur chaque borne', () => {
    for (const at of around(PLAN_LIMITS.title)) {
      const [first] = parsePlan(['| Séance | Objectif |', '|---|---|', row(`Séance 1 : ${emojiAt(at)}`, 'x'), row('2', 'y')].join('\n'));
      expect(first.titre, `titre @${at}`).not.toMatch(LONE);
      expect(first.ligne, `ligne @${at}`).not.toMatch(LONE);
    }
    for (const at of around(40)) {
      const [first] = parsePlan([`| N° | ${emojiAt(at)} |`, '|---|---|', row('1', 'valeur')].join('\n'));
      expect(first.ligne, `en-tête @${at}`).not.toMatch(LONE);
    }
    // Ligne du plan : sept colonnes de 200 caractères, la dernière à cheval sur la borne de 1 500.
    const header = '| N° | Titre | Objectif | Activités | Durée | Évaluation | Matériel | Organisation |';
    for (let at = 190; at < 225; at++) {
      const big = (c: string) => c.repeat(200);
      const [first] = parsePlan([header, '|---|---|---|---|---|---|---|---|', row('1', big('T'), big('O'), big('A'), big('D'), big('E'), big('M'), emojiAt(at))].join('\n'));
      expect(first.ligne, `ligne @${at}`).not.toMatch(LONE);
      expect(first.ligne.length).toBeLessThanOrEqual(PLAN_LIMITS.line);
    }
    // Texte entier lu jusqu'à 200 000 caractères : la dernière cellule ne finit pas par une demi-paire.
    const head = '| N° | Titre |\n|---|---|\n| 1 | A |\n| 2 | ';
    for (let pad = 0; pad < 6; pad++) {
      const preface = `${'x'.repeat(PLAN_LIMITS.chars - 1 - head.length - pad - 1)}\n`;
      const sessions = parsePlan(`${preface}${head}${'a'.repeat(pad)}${EMOJI}zz`);
      expect(sessions.map(s => s.titre), `pad ${pad}`).toEqual(['A', 'a'.repeat(pad)]);
    }
  });

  it('plan complet : sujet, titre, objectifs, consignes, durée — jamais de demi-paire dans la demande préparée', () => {
    const plan = (title: string, objective = 'Objectif') => readPlan(['| N° | Titre | Objectif |', '|---|---|---|', row('1', title, objective), row('2', title, objective), row('3', 'C', 'c')].join('\n'), 3)!;
    const clean = (origin: PlanOrigin, read: NonNullable<ReturnType<typeof readPlan>>, label: string) => {
      for (let i = 0; i < read.sessions.length; i++) {
        const { reuse, reuseNotice } = buildDevelopPrefill(origin, read, i)!;
        const consignes = reuse.params!.consignes as string;
        expect(reuse.sujet, `${label} sujet`).not.toMatch(LONE);
        expect(consignes, `${label} consignes`).not.toMatch(LONE);
        expect((reuse.params!.objectifs as string | undefined) ?? '', `${label} objectifs`).not.toMatch(LONE);
        expect(reuseNotice, `${label} rappel`).not.toMatch(LONE);
        expect(reuse.sujet.length).toBeLessThanOrEqual(REQUEST_LIMITS.sujet);
        expect(consignes.length).toBeLessThanOrEqual(REQUEST_LIMITS.consignes);
      }
    };
    // Sujet : 120 (rappel), 300 (limite) et toutes les positions entre les deux.
    for (let at = 100; at < 310; at++) clean({ ...ORIGIN, sujet: emojiAt(at) }, plan('T'), `sujet @${at}`);
    // Titre d'une séance : 120 (sujet), 180 (voisines), 200 (limite).
    for (let at = 100; at < 210; at++) clean(ORIGIN, plan(emojiAt(at)), `titre @${at}`);
    // Objectifs de la ligne du plan.
    for (const at of around(PLAN_LIMITS.objective)) clean(ORIGIN, plan('T', emojiAt(at)), `objectif @${at}`);
    // Consignes de l'enseignant (450 dans la demande), durée (80), objectifs de l'enseignant (650 dans la demande).
    const bare = plan('T');
    for (const at of around(450)) clean({ ...ORIGIN, consignes: emojiAt(at) }, bare, `consignes @${at}`);
    for (const at of around(80)) clean({ ...ORIGIN, duree: emojiAt(at) }, bare, `durée @${at}`);
    for (let at = 600; at < 700; at++) clean({ ...ORIGIN, objectifs: emojiAt(at) }, bare, `objectifs @${at}`);
  });

  it('problématique et objectifs du plan (600 caractères, ligne de 2 000) : emoji à cheval sur la borne', () => {
    for (let at = 590; at < 610; at++) {
      const context = extractPlanContext(`## Problématique\n\n${emojiAt(at)}\n\n## Objectifs\n\n- ${emojiAt(at)}`);
      expect(context.problematique, `problématique @${at}`).not.toMatch(LONE);
      expect(context.objectifs, `objectifs @${at}`).not.toMatch(LONE);
    }
    for (const at of around(2_000)) expect(extractPlanContext(`Objectifs : ${emojiAt(at)}`).objectifs).not.toMatch(LONE);
  });

  it('enregistrement de l’historique : sujet (300), durée (80), discipline (150), objectifs (2 000), consignes (3 000) coupés sans demi-paire', () => {
    const limits = { sujet: REQUEST_LIMITS.sujet, duree: REQUEST_LIMITS.duree, discipline: REQUEST_LIMITS.discipline, objectifs: REQUEST_LIMITS.objectifs, consignes: REQUEST_LIMITS.consignes };
    for (const [field, limit] of Object.entries(limits)) {
      for (const at of around(limit)) {
        const value = emojiAt(at);
        const record = {
          type: 'sequence' as const, niveau: '4eme', matiere: 'histoire_geo', discipline: field === 'discipline' ? value : undefined,
          sujet: field === 'sujet' ? value : 'S', params: { [field]: value },
        };
        const origin = planOriginFromRecord(record);
        for (const [key, text] of Object.entries(origin)) expect(String(text), `${field} @${at} → ${key}`).not.toMatch(LONE);
        expect((origin[field as keyof PlanOrigin] as string).length).toBeLessThanOrEqual(limit);
      }
    }
  });

  it('défense en profondeur : une demi-paire reçue est retirée par la validation de la demande, une paire complète reste', () => {
    const request = validateGenerationRequest({
      type: 'fiche_prep', niveau: '4eme', matiere: 'histoire_geo', sujet: `Révolution ${EMOJI}\ud83d`,
      consignes: `\ude00 Séance ${EMOJI} 3 \ud83d`, objectifs: `${'a'.repeat(10)}\ud83d`,
    });
    expect(request.sujet).toBe(`Révolution ${EMOJI}`);
    expect(request.consignes).toBe(`Séance ${EMOJI} 3`);
    expect(request.objectifs).toBe('aaaaaaaaaa');
  });
});

// ─── L2 : le tableau des séances parmi plusieurs ────────────────────────────

describe('parsePlan — plusieurs tableaux : le tableau des séances, pas le premier venu', () => {
  const synoptic = (n = 6) => [
    '| Séance | Titre | Objectif | Durée |', '|---|---|---|---|',
    ...Array.from({ length: n }, (_, i) => row(String(i + 1), `Titre ${i + 1}`, `Objectif ${i + 1}`, '55 min')),
  ].join('\n');
  const titles = (text: string, requested?: number) => parsePlan(text, requested).map(s => s.titre);
  const SIX = ['Titre 1', 'Titre 2', 'Titre 3', 'Titre 4', 'Titre 5', 'Titre 6'];

  it('« N° | Objectif » (objectifs numérotés) placé avant le tableau synoptique', () => {
    const objectives = ['| N° | Objectif |', '|---|---|', row('1', 'Situer'), row('2', 'Comprendre'), row('3', 'Analyser')].join('\n');
    expect(titles(`## Objectifs\n\n${objectives}\n\n## Tableau synoptique\n\n${synoptic()}`)).toEqual(SIX);
    expect(titles(`${objectives}\n\n${synoptic()}`, 6)).toEqual(SIX);
    // Même nombre de lignes : le tableau qui a un vrai titre l'emporte, pas le premier.
    expect(titles(`${objectives}\n\n${synoptic(3)}`)).toEqual(['Titre 1', 'Titre 2', 'Titre 3']);
  });

  it('matrice « Compétence | Séances concernées » avant le tableau : jamais prise pour les séances', () => {
    const matrix = [
      '| Compétence | Séances concernées |', '|---|---|',
      row('Lire', '1, 3, 5'), row('Écrire', '2 et 4'), row('Compter', '1-2 ; 3-4'), row('Calculer', '6'),
    ].join('\n');
    expect(titles(`${matrix}\n\n${synoptic()}`)).toEqual(SIX);
    // Seule dans le texte : aucune séance (rien n'est proposé, aucun faux avertissement).
    expect(parsePlan(matrix)).toEqual([]);
    expect(readPlan(matrix)).toBeNull();
    // Matrice de numéros simples : l'en-tête « concernées » suffit à l'écarter.
    expect(parsePlan(['| Compétence | Séances concernées |', '|---|---|', row('Lire', '1'), row('Écrire', '2')].join('\n'))).toEqual([]);
  });

  it('variante « Séances | 1-2 ; 3-4 » : une colonne de listes de numéros n’est pas un tableau de séances', () => {
    const variant = ['| Séances | Compétence |', '|---|---|', row('1-2 ; 3-4', 'Lire'), row('1, 3', 'Écrire'), row('2 et 5', 'Calculer'), row('4', 'Compter')].join('\n');
    expect(parsePlan(variant)).toEqual([]);
    expect(titles(`${variant}\n\n${synoptic(4)}`)).toEqual(['Titre 1', 'Titre 2', 'Titre 3', 'Titre 4']);
  });

  it('chronologie « N° | Événement » avant le tableau synoptique', () => {
    const timeline = [
      '| N° | Événement | Date |', '|---|---|---|', ...Array.from({ length: 8 }, (_, i) => row(String(i + 1), `Événement ${i + 1}`, `${1780 + i}`)),
    ].join('\n');
    expect(titles(`${timeline}\n\n${synoptic()}`)).toEqual(SIX);
    // Seule dans le texte, la chronologie reste lisible comme avant (un tableau « numéro » sans autre candidat).
    expect(parsePlan(timeline)).toHaveLength(8);
  });

  it('nombre de séances demandé : le tableau qui a exactement ce nombre de lignes numérotées de 1 à n', () => {
    const six = synoptic(6);
    const ten = ['| N° | Titre |', '|---|---|', ...Array.from({ length: 10 }, (_, i) => row(String(i + 1), `Étape ${i + 1}`))].join('\n');
    expect(titles(`${ten}\n\n${six}`, 6)).toEqual(SIX);
    expect(titles(`${ten}\n\n${six}`)).toHaveLength(10);
    expect(titles(`${six}\n\n${ten}`, 10)).toHaveLength(10);
  });

  it('égalité parfaite : le premier tableau', () => {
    const a = ['| N° | Titre |', '|---|---|', row('1', 'A1'), row('2', 'A2')].join('\n');
    const b = ['| N° | Titre |', '|---|---|', row('1', 'B1'), row('2', 'B2')].join('\n');
    expect(titles(`${a}\n\n${b}`)).toEqual(['A1', 'A2']);
  });

  it('lignes qui regroupent des séances : « 3 et 4 » compte pour deux, « 5 et 7 » n’est pas une étendue', () => {
    const grouped = readPlan(['| N° | Titre |', '|---|---|', row('1', 'A'), row('2', 'B'), row('Séances 3 et 4', 'C'), row('5 et 7', 'D'), row('6', 'E')].join('\n'));
    expect(grouped?.sessions.map(s => [s.numero, s.fin, s.titre])).toEqual([[1, undefined, 'A'], [2, undefined, 'B'], [3, 4, 'C'], [6, undefined, 'E']]);
  });
});

// ─── L3 : total de séances ──────────────────────────────────────────────────

describe('readPlan — total de séances', () => {
  const rows = (numbers: (string | number)[]) => ['| N° | Titre |', '|---|---|', ...numbers.map(n => row(String(n), `T${n}`))].join('\n');

  it('un numéro démesuré (« 365 ») n’est pas celui d’une séance : ignoré, jamais « séance 2 sur 365 »', () => {
    const text = rows([1, 2, 365]);
    expect(parsePlan(text).map(s => s.numero)).toEqual([1, 2]);
    const plan = readPlan(text)!;
    expect(plan.total).toBe(2);
    const consignes = developConsignes(ORIGIN, plan, 1);
    expect(consignes).toMatch(/^Séance 2 sur 2 d'une séquence/);
    expect(consignes).not.toContain('365');
    // Le nombre demandé reste la référence quand il est plus grand.
    expect(readPlan(text, 6)!.total).toBe(6);
  });

  it('seuls les numéros de 1 à 60 sont lus ; une étendue qui dépasse 60 est ignorée', () => {
    expect(parsePlan(rows([59, 60, 61, 62, 100, 999])).map(s => s.numero)).toEqual([59, 60]);
    const text = ['| N° | Titre |', '|---|---|', row('1', 'A'), row('Séances 59 à 62', 'B'), row('2', 'C')].join('\n');
    expect(parsePlan(text).map(s => s.numero)).toEqual([1, 2]);
  });

  it('jamais un total plus grand que le plus grand du nombre de séances lues et du nombre demandé', () => {
    for (const numbers of [[1, 2, 3], [1, 2, 50], [1, 7], [3, 4, 5], [1, 2, 4]]) {
      for (const requested of [undefined, 2, 6, 99]) {
        const plan = readPlan(rows(numbers), requested);
        if (!plan) continue;
        const asked = requested !== undefined && requested <= PLAN_LIMITS.sessions ? requested : 0;
        expect(plan.total, `${numbers} / ${requested}`).toBeLessThanOrEqual(Math.max(plan.sessions.length, asked));
      }
    }
  });

  it('lignes manquantes (1, 2, 4) : jamais « séance 4 sur 3 » — le total est omis plutôt que faux', () => {
    const plan = readPlan(rows([1, 2, 4]))!;
    expect(plan.total).toBe(3);
    const fourth = buildDevelopPrefill(ORIGIN, plan, 2)!;
    expect(fourth.reuse.params!.consignes).toMatch(/^Séance 4 d'une séquence « La Révolution française »\. /);
    expect(fourth.reuseNotice).toContain('(séance 4 de la séquence');
    expect(buildDevelopPrefill(ORIGIN, plan, 1)!.reuse.params!.consignes).toMatch(/^Séance 2 sur 3 d'une séquence/);
    // Avec le nombre demandé, le total est celui-là.
    expect(buildDevelopPrefill(ORIGIN, readPlan(rows([1, 2, 4]), 4)!, 2)!.reuse.params!.consignes).toMatch(/^Séance 4 sur 4 /);
  });
});

// ─── L4 : rubriques ─────────────────────────────────────────────────────────

describe('extractPlanContext — rubriques à titre numéroté, à parenthèse, en gras, en ligne', () => {
  const PROBLEM = 'Pourquoi l\'eau change-t-elle d\'état ?';

  it('titres numérotés (« ## 1. Problématique », « ## 2. Objectifs de la séquence »)', () => {
    const text = `## 1. Problématique\n\n${PROBLEM}\n\n## 2. Objectifs de la séquence\n\n- Identifier les états\n- Mesurer une température\n\n## 3. Évaluation\n\nUn devoir.`;
    expect(extractPlanContext(text)).toEqual({ problematique: PROBLEM, objectifs: 'Identifier les états ; Mesurer une température' });
    expect(extractPlanContext('# 1) Problématique\n\nQuestion ?\n\n# 2) Objectifs\n\n- A').objectifs).toBe('A');
    expect(extractPlanContext('### 2.1 Objectifs\n\n- A\n- B').objectifs).toBe('A ; B');
  });

  it('titre suivi d’une parenthèse (« Objectifs de la séquence (compétences visées) »)', () => {
    const text = `## Objectifs de la séquence (compétences visées)\n\n- Lire\n- Écrire\n\n## Problématique (question directrice)\n\n${PROBLEM}`;
    expect(extractPlanContext(text)).toEqual({ problematique: PROBLEM, objectifs: 'Lire ; Écrire' });
    expect(extractPlanContext('**Objectifs de la séquence (compétences visées) :** Lire et écrire').objectifs).toBe('Lire et écrire');
    expect(extractPlanContext('**Problématique (question de départ) :** Comment faire ?').problematique).toBe('Comment faire ?');
  });

  it('gras, numérotation et gras ensemble (« **1. Objectifs** », « **2. Problématique :** … »)', () => {
    expect(extractPlanContext('**1. Objectifs**\n\n- A\n- B').objectifs).toBe('A ; B');
    expect(extractPlanContext('**2. Problématique :** Comment ?').problematique).toBe('Comment ?');
    expect(extractPlanContext('1. **Objectifs de la séquence** : Découvrir').objectifs).toBe('Découvrir');
  });

  it('forme en ligne (« Objectifs : … », puce, numérotation, gras)', () => {
    expect(extractPlanContext('Objectifs : Découvrir les états de la matière').objectifs).toBe('Découvrir les états de la matière');
    expect(extractPlanContext('- **Objectifs :** Découvrir').objectifs).toBe('Découvrir');
    expect(extractPlanContext('1) Objectifs : Découvrir\n2) Problématique : Comment ?')).toEqual({ problematique: 'Comment ?', objectifs: 'Découvrir' });
    expect(extractPlanContext('Objectifs (visés) : Découvrir').objectifs).toBe('Découvrir');
  });

  it('majuscules, chiffres romains, lettres, emoji', () => {
    expect(extractPlanContext('## OBJECTIFS DE LA SÉQUENCE\n\n- A\n- B').objectifs).toBe('A ; B');
    expect(extractPlanContext('PROBLÉMATIQUE : COMMENT ?').problematique).toBe('COMMENT ?');
    expect(extractPlanContext('I. Problématique\n\nQuestion ?\n\nII. Objectifs de la séquence\n\n- A\n\nIII. Évaluation')).toEqual({ problematique: 'Question ?', objectifs: 'A' });
    expect(extractPlanContext('iv) Objectifs : Découvrir').objectifs).toBe('Découvrir');
    expect(extractPlanContext('a) Problématique : Comment ?').problematique).toBe('Comment ?');
    expect(extractPlanContext('## 🎯 Objectifs\n\n- A').objectifs).toBe('A');
    expect(extractPlanContext('💡 **Problématique** : Comment ?').problematique).toBe('Comment ?');
    expect(extractPlanContext('## ① Objectifs\n\n- A').objectifs).toBe('A');
  });

  it('éléments de liste qui commencent par « Objectif : » : des éléments, pas une nouvelle rubrique', () => {
    expect(extractPlanContext('## Objectifs\n\n1. Objectif : situer\n2. Objectif : comprendre\n').objectifs).toBe('Objectif : situer ; Objectif : comprendre');
  });

  it('ni phrase ordinaire ni numéro seul pris pour une rubrique', () => {
    expect(extractPlanContext('3 objectifs ont été atteints, voir le bilan.\n\nObjectifs atteints par la classe, voir le bilan.')).toEqual({ problematique: '', objectifs: '' });
    expect(extractPlanContext('1. Introduction\n\n2. Conclusion')).toEqual({ problematique: '', objectifs: '' });
  });

  it('jamais d’affirmation d’absence : rien de lu → la phrase est omise des consignes', () => {
    const plan = readPlan(['## Aperçu', '', 'Un texte sans rubrique reconnue.', '', '| N° | Titre |', '|---|---|', row('1', 'A'), row('2', 'B')].join('\n'))!;
    const consignes = buildDevelopPrefill(ORIGIN, plan, 0)!.reuse.params!.consignes as string;
    expect(consignes).not.toMatch(/non précis|Objectifs et problématique/i);
    expect(consignes.startsWith('Séance 1 sur 2 d\'une séquence « La Révolution française ». Ligne du plan : ')).toBe(true);
  });

  it('plan à rubriques numérotées : les objectifs et la problématique arrivent dans les consignes de la fiche', () => {
    const table = ['| N° | Titre |', '|---|---|', row('1', 'A'), row('2', 'B')].join('\n');
    const text = `## 1. Problématique\n\n${PROBLEM}\n\n## 2. Objectifs de la séquence (compétences visées)\n\n- Identifier les états\n- Mesurer\n\n${table}`;
    const consignes = buildDevelopPrefill(ORIGIN, readPlan(text)!, 1)!.reuse.params!.consignes as string;
    expect(consignes).toContain('Objectifs et problématique de la séquence : objectifs : Identifier les états ; Mesurer ; problématique : Pourquoi l\'eau change-t-elle d\'état ? Ligne du plan');
    expect(consignes).not.toMatch(/non précis/i);
  });
});

// ─── L6 : ponctuation du gabarit ────────────────────────────────────────────

describe('gabarit des consignes — jamais de ponctuation doublée', () => {
  /** Signe de fin de phrase suivi d'un autre signe (« ?. », « .. », « …. », « . ; »). */
  const DOUBLED = /[.!?…;:]\s?[.;:](?!\d)/;
  const sessionsTable = ['| N° | Titre | Objectif | Activités |', '|---|---|---|---|'];

  it('problématique en question, objectifs qui finissent par un point, lignes qui finissent par « . » ou « … »', () => {
    const text = [
      '## Problématique', '', 'Comment la matière évolue-t-elle…', '',
      '## Objectifs de la séquence', '', '- Identifier l\'état gazeux.', '- Savoir lire un thermomètre.', '',
      ...sessionsTable,
      row('1', 'Pourquoi l\'eau change-t-elle d\'état ?', 'Identifier l\'état gazeux.', 'Lire le thermomètre.'),
      row('2', 'Les états.', 'Savoir… ', 'Mesurer…'),
      row('3', 'Bilan !', 'Conclure ;', 'Débat :'),
    ].join('\n');
    const plan = readPlan(text)!;
    for (let i = 0; i < plan.sessions.length; i++) {
      const consignes = buildDevelopPrefill(ORIGIN, plan, i)!.reuse.params!.consignes as string;
      expect(consignes, `séance ${i + 1}`).not.toMatch(DOUBLED);
      expect(consignes).not.toContain('?.');
      expect(consignes).not.toContain('..');
    }
    const first = buildDevelopPrefill(ORIGIN, plan, 0)!.reuse.params!.consignes as string;
    // Problématique en « … » ou en question : le signe reste, aucun point n'est ajouté derrière.
    expect(first).toContain('objectifs : Identifier l\'état gazeux ; Savoir lire un thermomètre ; problématique : Comment la matière évolue-t-elle… Ligne du plan : ');
    expect(first).toContain('Ligne du plan : Titre : Pourquoi l\'eau change-t-elle d\'état ; Objectif : Identifier l\'état gazeux ; Activités : Lire le thermomètre. Séance précédente');
    expect(first).toContain('Séance suivante : séance 2 — Les états. Respecte ce plan.');
  });

  it('ligne du plan : chaque colonne sans sa ponctuation finale (« gazeux. ; Savoir »)', () => {
    const [first] = parsePlan([...sessionsTable, row('1', 'Les états.', 'Identifier l\'état gazeux.', 'Lire !')].join('\n'));
    expect(first.ligne).toBe('Titre : Les états ; Objectif : Identifier l\'état gazeux ; Activités : Lire');
    expect(first.titre).toBe('Les états.');
  });

  it('partie coupée : « … » conservé, jamais « …. »', () => {
    const long = `## Problématique\n\n${'mot '.repeat(300)}\n\n${[...sessionsTable, row('1', 'A', 'b', 'c'), row('2', 'B', 'b', 'c')].join('\n')}`;
    const consignes = buildDevelopPrefill(ORIGIN, readPlan(long)!, 0)!.reuse.params!.consignes as string;
    expect(consignes).toMatch(/problématique : mot( mot)+… Ligne du plan/);
    expect(consignes).not.toMatch(DOUBLED);
  });
});

// ─── L7 : décisions de l'enseignant ─────────────────────────────────────────

describe('décisions de l’enseignant reprises dans la demande de la fiche (consignes, durée, démarche)', () => {
  const plan = readPlan(PLAN, 4)!;
  const MATHS: PlanOrigin = { niveau: '4eme', matiere: 'mathematiques', sujet: 'Les fractions', researchMode: 'documents' };

  it('origine : consignes, durée et démarche de la demande, relues un à un depuis l’historique', () => {
    const req: GenerationRequest = {
      type: 'sequence', niveau: '4eme', matiere: 'histoire_geo', sujet: 'La Révolution', researchMode: 'documents',
      consignes: 'Documents audio uniquement.', duree: '4 semaines', modalite: 'projet_sequence', planSeulement: true,
    };
    expect(planOriginFromRequest(req)).toEqual({
      niveau: '4eme', matiere: 'histoire_geo', sujet: 'La Révolution', consignes: 'Documents audio uniquement.', duree: '4 semaines', modalite: 'projet_sequence', researchMode: 'documents',
    });
    const record = {
      type: 'sequence' as const, niveau: '4eme', matiere: 'histoire_geo', sujet: 'La Révolution',
      params: { consignes: ' Documents  audio\nuniquement. ', duree: '4 semaines', modalite: 'projet_sequence', planSeulement: true },
    };
    expect(planOriginFromRecord(record)).toEqual({
      niveau: '4eme', matiere: 'histoire_geo', sujet: 'La Révolution', consignes: 'Documents audio uniquement.', duree: '4 semaines', modalite: 'projet_sequence',
    });
    // Valeurs illisibles : ignorées ; démarche inconnue : ignorée.
    expect(planOriginFromRecord({ ...record, params: { consignes: 42, duree: {}, modalite: 'inconnue' } })).toEqual({ niveau: '4eme', matiere: 'histoire_geo', sujet: 'La Révolution' });
    expect(planOriginFromRecord({ ...record, params: { duree: 'd'.repeat(500), consignes: 'c'.repeat(5_000) } })).toMatchObject({
      duree: 'd'.repeat(REQUEST_LIMITS.duree), consignes: 'c'.repeat(REQUEST_LIMITS.consignes),
    });
  });

  it('consignes de l’enseignant, durée et démarche : phrases du gabarit, avant la ligne du plan', () => {
    const origin = { ...ORIGIN, consignes: 'Documents audio uniquement.', duree: '4 semaines', modalite: 'projet_sequence' };
    const consignes = buildDevelopPrefill(origin, plan, 1)!.reuse.params!.consignes as string;
    expect(consignes).toContain(
      'Démarche choisie pour la séquence : Pédagogie de projet. Durée prévue pour la séquence : 4 semaines. '
      + 'Consignes de l\'enseignant pour la séquence : Documents audio uniquement. Ligne du plan : Titre : 1789',
    );
    expect(consignes).toMatch(/Respecte ce plan\.$/);
    // Sans ces choix : aucune phrase vide.
    const without = buildDevelopPrefill(ORIGIN, plan, 1)!.reuse.params!.consignes as string;
    expect(without).not.toMatch(/Démarche choisie|Durée prévue|Consignes de l'enseignant/);
  });

  it('démarche qui s’applique aussi à une fiche : reprise dans le champ « format » de la fiche ; sinon seulement citée', () => {
    const investigation = buildDevelopPrefill({ ...MATHS, modalite: 'investigation' }, plan, 0)!;
    expect(investigation.reuse.params).toMatchObject({ modalite: 'investigation' });
    expect(investigation.reuse.params!.consignes).toContain('Démarche choisie pour la séquence : Démarche d’investigation.');
    // Pédagogie de projet : démarche d'une séquence, pas d'une fiche → citée dans les consignes, pas dans les paramètres.
    const project = buildDevelopPrefill({ ...MATHS, modalite: 'projet_sequence' }, plan, 0)!;
    expect(project.reuse.params).not.toHaveProperty('modalite');
    expect(project.reuse.params!.consignes).toContain('Démarche choisie pour la séquence : Pédagogie de projet.');
    // Démarche inconnue, niveau ou matière inconnus : rien.
    expect(buildDevelopPrefill({ ...MATHS, modalite: 'inconnue' }, plan, 0)!.reuse.params).not.toHaveProperty('modalite');
    expect(buildDevelopPrefill({ ...MATHS, niveau: 'x', modalite: 'investigation' }, plan, 0)!.reuse.params).not.toHaveProperty('modalite');
  });

  it('limites : textes démesurés partout, la demande reste valide (sujet, objectifs, consignes) et le gabarit entier', () => {
    const huge = 'mot '.repeat(2_000);
    const table = ['| N° | Titre | Objectif | Activités |', '|---|---|---|---|', ...Array.from({ length: 4 }, (_, i) => row(String(i + 1), huge, huge, huge))].join('\n');
    const bigPlan = readPlan(`## Problématique\n\n${huge}\n\n## Objectifs\n\n${huge}\n\n${table}`, 4)!;
    const origin: PlanOrigin = {
      ...MATHS, sujet: 'S'.repeat(REQUEST_LIMITS.sujet), discipline: 'D'.repeat(REQUEST_LIMITS.discipline), objectifs: huge.slice(0, REQUEST_LIMITS.objectifs),
      consignes: huge.slice(0, REQUEST_LIMITS.consignes), duree: 'd'.repeat(REQUEST_LIMITS.duree), modalite: 'investigation',
    };
    for (let i = 0; i < bigPlan.sessions.length; i++) {
      const { reuse } = buildDevelopPrefill(origin, bigPlan, i)!;
      const consignes = reuse.params!.consignes as string;
      expect(consignes.length).toBeLessThanOrEqual(REQUEST_LIMITS.consignes);
      // Le garde-fou final ne sert jamais : le gabarit n'est pas coupé (début, phrase de l'enseignant, durée, fin).
      expect(consignes).toMatch(/^Séance \d sur 4 d'une séquence « S{300} »\. /);
      expect(consignes).toContain('Consignes de l\'enseignant pour la séquence : mot mot');
      expect(consignes).toContain(`Durée prévue pour la séquence : ${'d'.repeat(REQUEST_LIMITS.duree)}.`);
      expect(consignes).toMatch(/Séance suivante : [^]*Respecte ce plan\.$/);
      expect(consignes.length, 'marge du gabarit').toBeLessThan(REQUEST_LIMITS.consignes - 100);
      expect(() => validateGenerationRequest({
        type: 'fiche_prep', niveau: reuse.niveau, matiere: reuse.matiere, discipline: reuse.discipline, sujet: reuse.sujet, researchMode: 'documents', ...reuse.params,
      })).not.toThrow();
    }
  });
});
