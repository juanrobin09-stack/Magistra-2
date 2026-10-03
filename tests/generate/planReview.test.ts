// « Développer une séance » — troisième relecture : total « sur N » sûr, repli de l'intitulé sans décalage d'index, demi-paires
// retirées dès l'entrée, coupes sûres du formulaire repris, séances voisines sans absence affirmée à tort, plans compacts
// (champs en gras sans lignes vides), durée de la fiche.

import { describe, expect, it } from 'vitest';
import { safeSpan, stripLoneSurrogates } from '@shared/planTable';
import { REQUEST_LIMITS, validateGenerationRequest } from '@shared/validation';
import {
  buildDevelopPrefill, developConsignes, extractPlanContext, parsePlan, readPlan, type PlanOrigin,
} from '@/lib/generation/plan';
import { describeRecordParams, formFromRecord, reusedFromState } from '@/lib/generation/reuse';

const ORIGIN: PlanOrigin = {
  niveau: '4eme', matiere: 'histoire_geo', sujet: 'La Révolution française', researchMode: 'documents',
};

const row = (...cells: string[]) => `| ${cells.join(' | ')} |`;
/** Tableau « N° | Titre » aux numéros donnés. */
const rows = (numbers: (string | number)[]) => ['| N° | Titre |', '|---|---|', ...numbers.map(n => row(String(n), `T${n}`))].join('\n');
const consignes = (text: string, index: number, requested?: number, origin: PlanOrigin = ORIGIN) => {
  const plan = readPlan(text, requested)!;
  return buildDevelopPrefill(origin, plan, index)!.reuse.params!.consignes as string;
};

/** Demi-paire de substitution : une unité haute sans basse après elle, ou une basse sans haute avant elle. */
const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const EMOJI = '😀';
const emojiAt = (at: number) => `${'a'.repeat(at)}${EMOJI}zz`;

// ─── V2 : total « sur N » ───────────────────────────────────────────────────

describe('total « sur N » — jamais affirmé quand le tableau a des trous ou une ligne isolée', () => {
  const OF = /sur \d+/;

  it('trou (1, 2, 4) sans nombre demandé : « sur N » omis pour toutes les séances, consignes et rappel', () => {
    const plan = readPlan(rows([1, 2, 4]))!;
    expect(plan.totalKnown).toBe(false);
    expect(plan.total).toBe(3);
    for (let i = 0; i < 3; i++) {
      const prefill = buildDevelopPrefill(ORIGIN, plan, i)!;
      expect(prefill.reuse.params!.consignes, `séance ${i}`).not.toMatch(OF);
      expect(prefill.reuseNotice, `rappel ${i}`).not.toMatch(OF);
    }
    expect(consignes(rows([1, 2, 4]), 0)).toMatch(/^Séance 1 d'une séquence « La Révolution française »\. /);
  });

  it('ligne parasite (1 à 6, puis 58) sans nombre demandé : pas « sur 7 »', () => {
    const text = rows([1, 2, 3, 4, 5, 6, 58]);
    const plan = readPlan(text)!;
    expect(plan.totalKnown).toBe(false);
    expect(plan.total).toBeLessThanOrEqual(7);
    for (let i = 0; i < plan.sessions.length; i++) expect(consignes(text, i)).not.toMatch(OF);
  });

  it('nombre demandé valide : c’est le total (la ligne parasite ne le change pas), omis pour la ligne au-delà', () => {
    const text = rows([1, 2, 3, 4, 5, 6, 58]);
    expect(readPlan(text, 6)).toMatchObject({ total: 6, totalKnown: true });
    expect(consignes(text, 0, 6)).toMatch(/^Séance 1 sur 6 d'une séquence/);
    expect(consignes(text, 6, 6)).toMatch(/^Séance 58 d'une séquence/);
    expect(consignes(rows([1, 2, 4]), 2, 4)).toMatch(/^Séance 4 sur 4 d'une séquence/);
    // Nombre demandé invalide (0, 61, 2,5) : comme s'il n'y en avait pas.
    for (const requested of [0, 61, 2.5, Number.NaN]) expect(readPlan(rows([1, 2, 4]), requested)!.totalKnown, String(requested)).toBe(false);
  });

  it('numérotation sans trou : « sur N » comme avant', () => {
    for (const numbers of [[1, 2, 3], [1, 2, 3, 4, 5, 6]]) {
      const plan = readPlan(rows(numbers))!;
      expect(plan).toMatchObject({ total: numbers.length, totalKnown: true });
      expect(consignes(rows(numbers), 1)).toMatch(new RegExp(`^Séance 2 sur ${numbers.length} d'une séquence`));
    }
    // Lignes regroupées (« Séances 3 et 4 ») : les numéros couverts se suivent encore.
    expect(readPlan(['| N° | Titre |', '|---|---|', row('1', 'A'), row('Séances 2 et 3', 'B'), row('4', 'C')].join('\n'))).toMatchObject({ total: 4, totalKnown: true });
  });

  it('garde-fou : jamais un total plus grand que le plus grand du nombre de séances lues et du nombre demandé', () => {
    for (const numbers of [[1, 2, 3], [1, 2, 50], [1, 7], [3, 4, 5], [1, 2, 4], [1, 2, 3, 4, 5, 6, 58]]) {
      for (const requested of [undefined, 2, 6, 99]) {
        const plan = readPlan(rows(numbers), requested);
        if (!plan) continue;
        const asked = requested !== undefined && requested <= 60 ? requested : 0;
        expect(plan.total, `${numbers} / ${requested}`).toBeLessThanOrEqual(Math.max(plan.sessions.length, asked));
      }
    }
  });
});

// ─── V3 : repli de l'intitulé sans décalage d'index ─────────────────────────

describe('intitulé de rubrique — le repli ne décale jamais l’index de coupe', () => {
  it('jamos hangul dans la parenthèse : le texte de la rubrique est intact', () => {
    expect(extractPlanContext('Objectifs (한국) : 😀 Situer les étapes').objectifs).toBe('😀 Situer les étapes');
    expect(extractPlanContext('Objectifs (한국어) : Situer les étapes').objectifs).toBe('Situer les étapes');
    expect(extractPlanContext('**Problématique (한국어 한국어) :** Comment faire ?').problematique).toBe('Comment faire ?');
    expect(extractPlanContext('## Objectifs (日本語の説明)\n\n- Situer').objectifs).toBe('Situer');
  });

  it('marque combinante isolée (« q » + U+0301), caractère qui change de longueur en minuscule', () => {
    expect(extractPlanContext('Objectifs (q\u0301) : Situer les étapes').objectifs).toBe('Situer les étapes');
    expect(extractPlanContext('Objectifs (İstanbul) : Situer').objectifs).toBe('Situer');
    expect(extractPlanContext('OBJECTIFS (ẞ) : SITUER').objectifs).toBe('SITUER');
  });

  it('jamais de demi-paire dans la rubrique, quels que soient les caractères de l’intitulé', () => {
    for (const mark of ['한국', '한국어', 'q\u0301', 'ǅ', '😀', 'é', 'e\u0301']) {
      const { objectifs } = extractPlanContext(`Objectifs (${mark}) : 😀 Situer les étapes`);
      expect(objectifs, mark).not.toMatch(LONE);
      expect(objectifs, mark).toBe('😀 Situer les étapes');
    }
  });

  it('accents et majuscules toujours indifférents dans l’intitulé', () => {
    expect(extractPlanContext('PROBLÉMATIQUE : Comment ?').problematique).toBe('Comment ?');
    expect(extractPlanContext('Acquis d’apprentissage : situer').objectifs).toBe('situer');
  });
});

// ─── V5 : demi-paires retirées dès l'entrée ─────────────────────────────────

describe('demi-paires de substitution du texte du modèle — retirées dès la lecture', () => {
  it('stripLoneSurrogates : la demi-paire part, la paire complète reste', () => {
    expect(stripLoneSurrogates(`a\ud83db${EMOJI}c\ude00d`)).toBe(`ab${EMOJI}cd`);
    expect(stripLoneSurrogates(`\ud83d😀`)).toBe(EMOJI);
    expect(stripLoneSurrogates('')).toBe('');
    expect(stripLoneSurrogates('sans emoji')).toBe('sans emoji');
  });

  it('dans une cellule du tableau : titre, objectif, ligne du plan et demande préparée sans demi-paire', () => {
    const text = ['| N° | Titre | Objectif |', '|---|---|---|', row('1', 'Les causes\ud83d', 'Situer \ude00 les étapes'), row('2', `Suite ${EMOJI}`, 'x')].join('\n');
    const [first, second] = parsePlan(text);
    for (const field of [first.titre, first.objectif, first.ligne]) expect(field).not.toMatch(LONE);
    expect(first.titre).toBe('Les causes');
    expect(first.objectif).toBe('Situer  les étapes'.replace('  ', ' '));
    expect(second.titre).toBe(`Suite ${EMOJI}`);
    const plan = readPlan(text)!;
    for (let i = 0; i < 2; i++) {
      const { reuse, reuseNotice } = buildDevelopPrefill(ORIGIN, plan, i)!;
      expect(reuse.sujet).not.toMatch(LONE);
      expect(reuse.params!.consignes as string).not.toMatch(LONE);
      expect((reuse.params!.objectifs as string | undefined) ?? '').not.toMatch(LONE);
      expect(reuseNotice).not.toMatch(LONE);
    }
  });

  it('dans une rubrique (problématique, objectifs en ligne ou en liste) : retirées aussi', () => {
    const context = extractPlanContext(`## Problématique\n\nComment faire\ud83d ?\n\n## Objectifs\n\n- Situer\ude00 les étapes\n- Comprendre ${EMOJI}`);
    expect(context.problematique).toBe('Comment faire ?');
    expect(context.objectifs).toBe(`Situer les étapes ; Comprendre ${EMOJI}`);
    expect(extractPlanContext('Objectifs : Situer\ud83d').objectifs).toBe('Situer');
    expect(extractPlanContext('\ud83d**Problématique :** Comment ?').problematique).toBe('Comment ?');
  });
});

// ─── V6 : coupes sûres du formulaire repris ─────────────────────────────────

describe('coupes sûres — formulaire repris depuis l’historique ou le plan', () => {
  it('safeSpan : aucune extrémité ne coupe une paire de substitution', () => {
    const text = `abc${EMOJI}def`; // l'emoji occupe les indices 3 et 4
    expect(safeSpan(text, 0, 4)).toBe('abc');
    expect(safeSpan(text, 4, 8)).toBe('def');
    expect(safeSpan(text, 3, 5)).toBe(EMOJI);
    expect(safeSpan(text, -10, 3)).toBe('abc');
    expect(safeSpan(text, 5, 100)).toBe('def');
    expect(safeSpan(text, 6, 2)).toBe('');
    expect(safeSpan('', 0, 5)).toBe('');
  });

  it('rappel d’une séance préparée : 500 caractères au plus, jamais une demi-paire', () => {
    for (let at = 495; at < 505; at++) {
      const reused = reusedFromState({ reuse: { type: 'fiche_prep', sujet: 'S' }, reuseNotice: emojiAt(at) }, null);
      expect(reused?.notice, `@${at}`).not.toMatch(LONE);
      expect((reused?.notice ?? '').length).toBeLessThanOrEqual(500);
    }
  });

  it('champs repris (durée 80, discipline 150, objectifs 2 000, consignes 3 000, contenu) : jamais une demi-paire', () => {
    const limits = { duree: REQUEST_LIMITS.duree, discipline: REQUEST_LIMITS.discipline, objectifs: REQUEST_LIMITS.objectifs, consignes: REQUEST_LIMITS.consignes };
    for (const [field, limit] of Object.entries(limits)) {
      for (let at = limit - 4; at < limit + 3; at++) {
        const record = {
          type: 'fiche_prep' as const, niveau: '4eme', matiere: 'histoire_geo', sujet: 'S',
          ...(field === 'discipline' ? { discipline: emojiAt(at) } : {}),
          params: field === 'discipline' ? {} : { [field]: emojiAt(at) },
        };
        const { form } = formFromRecord(record, null);
        expect(form[field as keyof typeof form] as string, `${field} @${at}`).not.toMatch(LONE);
      }
    }
  });

  it('paramètres affichés (« Contenu adapté » coupé à 299 caractères) : jamais une demi-paire', () => {
    for (let at = 295; at < 303; at++) {
      const shown = describeRecordParams({ type: 'fiche_prep', niveau: '4eme', matiere: 'histoire_geo', sujet: 'S', params: { contenuSource: emojiAt(at) } });
      const value = shown.find(r => r.label === 'Contenu adapté')?.value ?? '';
      expect(value, `@${at}`).not.toMatch(LONE);
    }
  });
});

// ─── V7 : séances voisines ──────────────────────────────────────────────────

describe('séances précédente et suivante — jamais une absence affirmée sans preuve', () => {
  it('« première séance » seulement pour la séance 1 ; « dernière » seulement pour la dernière séance d’un total sûr', () => {
    const text = rows([1, 2, 3, 4]);
    expect(consignes(text, 0)).toContain('Séance précédente : aucune (première séance de la séquence).');
    expect(consignes(text, 3)).toContain('Séance suivante : aucune (dernière séance de la séquence).');
    expect(consignes(text, 1)).not.toContain('aucune');
  });

  it('tableau qui commence à 2 : la séance 2 n’est pas dite première ; la phrase est omise', () => {
    const first = consignes(rows([2, 3, 4]), 0);
    expect(first).not.toMatch(/première|aucune|Séance précédente/);
    expect(first).toContain('Séance suivante : séance 3 — T3.');
    expect(first).toMatch(/^Séance 2 d'une séquence/);
  });

  it('moins de séances lues que demandé (1 à 4 sur 6) : la séance 4 n’est pas dite dernière', () => {
    const last = consignes(rows([1, 2, 3, 4]), 3, 6);
    expect(last).toMatch(/^Séance 4 sur 6 d'une séquence/);
    expect(last).not.toMatch(/dernière|aucune|Séance suivante/);
    expect(last).toContain('Séance précédente : séance 3 — T3.');
    // Avec le nombre demandé égal au dernier numéro, elle l'est.
    expect(consignes(rows([1, 2, 3, 4]), 3, 4)).toContain('Séance suivante : aucune (dernière séance de la séquence).');
  });

  it('trou dans le tableau (1, 2, 4) : la voisine lue est nommée comme figurant au plan, jamais « première » ou « dernière »', () => {
    const text = rows([1, 2, 4]);
    expect(consignes(text, 1)).toContain('Séance suivante figurant au plan : séance 4 — T4.');
    expect(consignes(text, 2)).toContain('Séance précédente figurant au plan : séance 2 — T2.');
    expect(consignes(text, 2)).not.toMatch(/dernière|Séance suivante/);
    expect(consignes(text, 0)).toContain('Séance précédente : aucune (première séance de la séquence).');
    // Voisine directe : formulation inchangée.
    expect(consignes(rows([1, 2, 3]), 1)).toContain('Séance précédente : séance 1 — T1. Séance suivante : séance 3 — T3.');
  });

  it('tableau dans le désordre (3, 1, 2) : les voisines suivent les numéros, pas la place dans le tableau', () => {
    const text = rows([3, 1, 2]);
    expect(consignes(text, 1)).toContain('Séance précédente : aucune (première séance de la séquence). Séance suivante : séance 2 — T2.');
    expect(consignes(text, 0)).toContain('Séance précédente : séance 2 — T2. Séance suivante : aucune (dernière séance de la séquence).');
  });

  it('lignes qui regroupent des séances : la dernière couverte compte', () => {
    const text = ['| N° | Titre |', '|---|---|', row('1', 'A'), row('Séances 2 et 3', 'B')].join('\n');
    expect(consignes(text, 1)).toContain('Séance suivante : aucune (dernière séance de la séquence).');
    expect(consignes(text, 0)).toContain('Séance suivante : séances 2 et 3 — B.');
  });

  it('une séance seule (1) : première et dernière', () => {
    const only = consignes(rows([1]), 0);
    expect(only).toContain('Séance précédente : aucune (première séance de la séquence). Séance suivante : aucune (dernière séance de la séquence).');
  });
});

// ─── V8 : plans compacts ────────────────────────────────────────────────────

describe('rubriques d’un plan compact — les champs voisins ne sont pas avalés', () => {
  it('a : liste d’objectifs suivie de champs en gras sans ligne vide', () => {
    const text = '**Problématique :** Comment les sociétés évoluent-elles ?\n**Objectifs :**\n- Situer\n- Expliquer\n**Évaluation diagnostique :** Quiz\n**Durée :** 6 séances';
    expect(extractPlanContext(text)).toEqual({ problematique: 'Comment les sociétés évoluent-elles ?', objectifs: 'Situer ; Expliquer' });
  });

  it('b : problématique sur la ligne suivante, puis un champ en gras', () => {
    const text = '**Problématique :**\nComment les sociétés évoluent-elles ?\n**Niveau :** 5ème\n**Durée :** 6 séances';
    expect(extractPlanContext(text).problematique).toBe('Comment les sociétés évoluent-elles ?');
  });

  it('c : « Objectifs de l’évaluation » n’est pas « Objectifs de la séquence »', () => {
    const text = '## Évaluation diagnostique\n\nObjectifs de l\'évaluation : repérer les acquis\n\n## Objectifs de la séquence\n\n- Situer';
    expect(extractPlanContext(text).objectifs).toBe('Situer');
    expect(extractPlanContext('Objectifs de la séance : lire').objectifs).toBe('');
    expect(extractPlanContext('Problématique de l\'évaluation diagnostique : comment ?').problematique).toBe('');
    // Une parenthèse ne change pas la rubrique.
    expect(extractPlanContext('Objectifs de la séquence (évaluation comprise) : situer').objectifs).toBe('situer');
  });

  it('champs sans gras (« Libellé : valeur » sur des lignes consécutives) : la rubrique s’arrête au champ suivant', () => {
    expect(extractPlanContext('Objectifs :\nSituer les étapes\nDurée : 6 séances\nNiveau : 5ème').objectifs).toBe('Situer les étapes');
    expect(extractPlanContext('## Problématique\n\nComment faire ?\nNiveau : 5ème').problematique).toBe('Comment faire ?');
    // Une phrase qui contient un « : » n'est pas un champ : la problématique la garde entière.
    expect(extractPlanContext('## Problématique\n\nComment la matière change-t-elle : de quoi dépend la fusion ?\n\n## Suite').problematique)
      .toBe('Comment la matière change-t-elle : de quoi dépend la fusion ?');
    expect(extractPlanContext('## Objectifs\n\nÀ l\'issue de la séquence, l\'élève saura : situer, comparer\n\n## Suite').objectifs)
      .toBe('À l\'issue de la séquence, l\'élève saura : situer, comparer');
  });

  it('liste : toute ligne qui n’est pas une puce l’arrête, sauf la suite indentée d’une puce', () => {
    expect(extractPlanContext('## Objectifs\n\n- Situer\n- Expliquer\nUn paragraphe qui suit.').objectifs).toBe('Situer ; Expliquer');
    expect(extractPlanContext('## Objectifs\n\n- Situer les étapes\n  de la Révolution\n- Expliquer').objectifs).toBe('Situer les étapes de la Révolution ; Expliquer');
    // Éléments « Objectif : … » toujours des éléments ; ligne vide au milieu d'une liste toujours permise.
    expect(extractPlanContext('## Objectifs\n\n1. Objectif : situer\n\n2. Objectif : comprendre\n').objectifs).toBe('Objectif : situer ; Objectif : comprendre');
    expect(extractPlanContext('## Objectifs\n\n- **Objectif 1 :** situer\n- **Objectif 2 :** comprendre\n**Durée :** 6 séances').objectifs)
      .toBe('Objectif 1 : situer ; Objectif 2 : comprendre');
  });

  it('« Problématiques » (pluriel), « ## Problématique ## », <b>Problématique :</b>', () => {
    expect(extractPlanContext('## Problématiques\n\nComment faire ?').problematique).toBe('Comment faire ?');
    expect(extractPlanContext('**Problématiques :** Comment faire ?').problematique).toBe('Comment faire ?');
    expect(extractPlanContext('## Problématique ##\n\nComment faire ?').problematique).toBe('Comment faire ?');
    expect(extractPlanContext('### Objectifs ###\n\n- Situer').objectifs).toBe('Situer');
    expect(extractPlanContext('<b>Problématique :</b> Comment faire ?').problematique).toBe('Comment faire ?');
    expect(extractPlanContext('<strong>Objectifs :</strong>\n- Situer\n- Comprendre').objectifs).toBe('Situer ; Comprendre');
    expect(extractPlanContext('<b>Objectifs</b>\n\n- A').objectifs).toBe('A');
  });

  it('rien de lu avant le premier champ : la rubrique est vide, jamais le champ voisin', () => {
    expect(extractPlanContext('**Objectifs :**\n**Durée :** 6 séances').objectifs).toBe('');
  });
});

// ─── V9 : durée ─────────────────────────────────────────────────────────────

describe('durée de la fiche — celle de la ligne du plan, sinon celle de la demande si c’est une durée de séance', () => {
  const table = (duration = '55 min', header = 'Durée') =>
    ['| N° | Titre | Objectif | ' + header + ' |', '|---|---|---|---|', row('1', 'A', 'a', duration), row('2', 'B', 'b', '—')].join('\n');
  const prefill = (text: string, origin: PlanOrigin = ORIGIN, index = 0) => buildDevelopPrefill(origin, readPlan(text)!, index)!;
  const DURATION_SENTENCE = /Durée (?:prévue|indiquée)/;

  it('colonne « Durée » du tableau : lue dans la séance, absente si la cellule est vide', () => {
    const [first, second] = parsePlan(table());
    expect(first.duree).toBe('55 min');
    expect(second).not.toHaveProperty('duree');
    expect(parsePlan(table('45 minutes.', 'Durée de la séance'))[0].duree).toBe('45 minutes');
    expect(parsePlan(['| N° | Titre |', '|---|---|', row('1', 'A')].join('\n'))[0]).not.toHaveProperty('duree');
    // Durée sans unité sous un en-tête en minutes.
    expect(parsePlan(table('55', 'Durée (min)'))[0].duree).toBe('55 min');
    expect(parsePlan(table('55', 'Temps'))[0].duree).toBe('55');
  });

  it('la ligne du plan préremplit le champ Durée de la fiche ; la fiche reprise l’affiche', () => {
    const { reuse } = prefill(table());
    expect(reuse.params).toMatchObject({ duree: '55 min' });
    expect(formFromRecord(reuse, null).form.duree).toBe('55 min');
    // Aucune phrase de durée dans les consignes quand elle est dans le champ.
    expect(reuse.params!.consignes).not.toMatch(DURATION_SENTENCE);
    // La durée de la ligne l'emporte sur celle de la demande, sans la contredire dans le texte.
    const both = prefill(table(), { ...ORIGIN, duree: '45 minutes' });
    expect(both.reuse.params).toMatchObject({ duree: '55 min' });
    expect(both.reuse.params!.consignes).not.toMatch(DURATION_SENTENCE);
  });

  it('sans colonne « Durée » : la durée de la demande si elle ressemble à une durée de séance (minutes, 4 h au plus)', () => {
    const text = rows([1, 2]);
    for (const given of ['55 minutes', '55 min', '1h30', '1 h 30', '2 heures', '1,5 h', '4 heures', '90 mn', '55 minutes par séance', 'environ 1 heure', '55 MIN']) {
      const { reuse } = prefill(text, { ...ORIGIN, duree: given });
      expect(reuse.params, given).toMatchObject({ duree: given });
      expect(reuse.params!.consignes, given).not.toMatch(DURATION_SENTENCE);
    }
    // Cellule vide (« — ») : la durée de la demande sert aussi.
    expect(prefill(table(), { ...ORIGIN, duree: '55 minutes' }, 1).reuse.params).toMatchObject({ duree: '55 minutes' });
  });

  it('durée longue (semaines, mois, plus de 4 h, nombre de séances) : jamais dans le champ, dite « Durée prévue pour la séquence »', () => {
    const text = rows([1, 2]);
    for (const given of ['4 semaines', '2 mois', '1 trimestre', '10 heures', '4h30', '6 séances de 55 minutes', '15 jours', 'l\'année', '300 minutes']) {
      const { reuse } = prefill(text, { ...ORIGIN, duree: given });
      expect(reuse.params, given).not.toHaveProperty('duree');
      expect(reuse.params!.consignes, given).toContain(`Durée prévue pour la séquence : ${given}.`);
    }
    // La ligne du plan garde son champ, la durée longue reste dite.
    const { reuse } = prefill(table(), { ...ORIGIN, duree: '4 semaines' });
    expect(reuse.params).toMatchObject({ duree: '55 min' });
    expect(reuse.params!.consignes).toContain('Durée prévue pour la séquence : 4 semaines.');
  });

  it('durée illisible : étiquette neutre, jamais celle d’une séance ni de la séquence', () => {
    for (const given of ['45-55 min', 'variable', 'selon la classe', '0 minute', 'x']) {
      const { reuse } = prefill(rows([1, 2]), { ...ORIGIN, duree: given });
      expect(reuse.params, given).not.toHaveProperty('duree');
      expect(reuse.params!.consignes, given).toContain(`Durée indiquée dans la demande de séquence : ${given}.`);
      expect(reuse.params!.consignes, given).not.toContain('Durée prévue pour la séquence');
    }
  });

  it('sans aucune durée : ni champ ni phrase', () => {
    const { reuse } = prefill(rows([1, 2]));
    expect(reuse.params).not.toHaveProperty('duree');
    expect(reuse.params!.consignes).not.toMatch(DURATION_SENTENCE);
  });

  it('bornes : la durée de la fiche tient dans la limite d’une demande, la demande préparée reste valide', () => {
    const long = `${'5'.repeat(3)} min ${'x'.repeat(200)}`;
    for (const text of [table(long), rows([1, 2])]) {
      const { reuse } = prefill(text, { ...ORIGIN, duree: long });
      expect(((reuse.params!.duree as string | undefined) ?? '').length).toBeLessThanOrEqual(REQUEST_LIMITS.duree);
      expect(reuse.params!.consignes as string).not.toMatch(LONE);
      expect(() => validateGenerationRequest({
        type: 'fiche_prep', niveau: reuse.niveau, matiere: reuse.matiere, sujet: reuse.sujet, researchMode: 'documents', ...reuse.params,
      })).not.toThrow();
    }
    // Demi-paire de substitution dans une durée enregistrée : pas dans le champ.
    for (let at = 70; at < 85; at++) {
      expect(prefill(rows([1, 2]), { ...ORIGIN, duree: `${emojiAt(at)} min` }).reuse.params!.consignes as string).not.toMatch(LONE);
      expect(((prefill(table(emojiAt(at))).reuse.params!.duree as string | undefined) ?? '')).not.toMatch(LONE);
    }
  });

  it('developConsignes : la phrase de durée précède les consignes de l’enseignant, comme avant', () => {
    const plan = readPlan(rows([1, 2]))!;
    const text = developConsignes({ ...ORIGIN, duree: '4 semaines', consignes: 'Documents audio uniquement.' }, plan, 0);
    expect(text).toContain('Durée prévue pour la séquence : 4 semaines. Consignes de l\'enseignant pour la séquence : Documents audio uniquement. Ligne du plan');
  });
});

// ─── Entrées démesurées ─────────────────────────────────────────────────────

describe('entrées démesurées — les nouvelles lectures restent linéaires', () => {
  const big = 400_000;
  const timed = (fn: () => void): number => {
    const start = performance.now();
    fn();
    return performance.now() - start;
  };

  it('numéros en liste, tableaux voisins à joindre, intitulés non latins : lecture en moins d’une seconde', () => {
    const header = '| N° | Titre |\n|---|---|\n';
    const inputs = [
      `${header}| 1${', 2'.repeat(big / 3)} | y |`,
      `${header}| 1${' et 2'.repeat(big / 5)} | y |`,
      `${header}| 1${', 2'.repeat(300)}, 4 | y |\n`.repeat(200),
      `${header}| 1${'; 2'.repeat(20)} | y |\n`.repeat(2_000),
      // Des milliers de tableaux dont la numérotation se poursuit (1-2, 3-4…) : jointure bornée à 60 séances.
      Array.from({ length: 8_000 }, (_, i) => `${header}| ${2 * (i % 40) + 1} | a |\n| ${2 * (i % 40) + 2} | b |\n`).join('\n'),
      Array.from({ length: 8_000 }, (_, i) => `${header}| ${(i % 60) + 1} | a |\n`).join('\n'),
      `| ${'한'.repeat(300)} | ${'š'.repeat(300)} |\n|---|---|\n| 1 | x |`.repeat(300),
      `| N° | ${'Titre | '.repeat(5_000)}\n|${'---|'.repeat(5_000)}\n| 1 | x |`,
    ];
    for (const input of inputs) {
      expect(timed(() => { readPlan(input); readPlan(input, 6); }), input.slice(0, 40)).toBeLessThan(1_000);
    }
  });

  it('rubriques : champs en gras, listes, titres à dièses de fermeture, balises, intitulés non latins', () => {
    const inputs = [
      `## Objectifs\n${'**Durée :** 6 séances\n'.repeat(big / 22)}`,
      `**Objectifs :**\n${'Durée : 6 séances\n'.repeat(big / 19)}`,
      `## Objectifs\n${'- un\n  suite\n'.repeat(big / 13)}`,
      `## Objectifs\n\n- a\n${'  suite '.repeat(big / 8)}`,
      `## Problématique${' #'.repeat(big / 2)}`,
      `${'<b>'.repeat(big / 3)}Problématique :</b> x`,
      `${'한국어 '.repeat(big / 4)}`,
      `Objectifs (${'한'.repeat(big)}) : x`,
      `${'Objectifs (한국어) : x\n'.repeat(big / 20)}`,
      `${'Comment faire : voici la suite sans fin\n'.repeat(big / 40)}`,
      `Objectifs :\n${'a'.repeat(big)}\nDurée : x`,
    ];
    for (const input of inputs) {
      expect(timed(() => { extractPlanContext(input); }), input.slice(0, 40)).toBeLessThan(1_000);
    }
  });

  it('durée saisie démesurée ou pathologique : jamais lente, jamais plus longue que la limite', () => {
    const plan = readPlan(rows([1, 2]))!;
    for (const duree of ['9'.repeat(big), `${'1 '.repeat(big / 2)}h`, `${'environ '.repeat(big / 8)}1 h`, `1${' '.repeat(big)}h`, 'é'.repeat(big)]) {
      const ms = timed(() => {
        const { reuse } = buildDevelopPrefill({ ...ORIGIN, duree }, plan, 0)!;
        expect(((reuse.params!.duree as string | undefined) ?? '').length).toBeLessThanOrEqual(REQUEST_LIMITS.duree);
        expect((reuse.params!.consignes as string).length).toBeLessThanOrEqual(REQUEST_LIMITS.consignes);
      });
      expect(ms, duree.slice(0, 20)).toBeLessThan(1_000);
    }
  });
});
