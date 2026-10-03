// Option « plan d'abord » de l'outil Séquence : consigne du modèle (3 variantes ; rien ne change sans l'option), validation
// partagée (demande et enregistrement), contrôle du nombre de séances d'un plan, enregistrement dans l'historique.

import { describe, expect, it } from 'vitest';
import { TOOL_FIELDS, type TypeContenu } from '../../shared/catalog.js';
import { MockProvider } from '../../shared/ai/mock.js';
import { checkOutputStructure } from '../../shared/outputChecks.js';
import { runGeneration } from '../../shared/pipeline.js';
import { buildSystemPrompt, buildUserPrompt } from '../../shared/prompts/index.js';
import { toolInstructions } from '../../shared/prompts/tools.js';
import { getLevelGroup, type NiveauScolaire } from '../../shared/levels.js';
import type { GenerationRequest } from '../../shared/types.js';
import { validateGenerationRecordDraft, validateGenerationRequest } from '../../shared/validation.js';
import { collect } from './helpers';
import { SEQUENCE_PROMPT_BASELINE } from './sequencePromptBaseline';

function req(extra: Partial<GenerationRequest> = {}): GenerationRequest {
  return { type: 'sequence', niveau: '4eme', matiere: 'histoire_geo', sujet: 'La Révolution française', researchMode: 'documents', ...extra };
}

/** Variantes de la consigne : primaire / collège / lycée, maternelle, supérieur. */
const VARIANTS: { name: string; niveau: NiveauScolaire; matiere: GenerationRequest['matiere'] }[] = [
  { name: 'collège', niveau: '4eme', matiere: 'histoire_geo' },
  { name: 'primaire', niveau: 'cm1', matiere: 'francais' },
  { name: 'lycée', niveau: 'terminale_gen', matiere: 'histoire_geo' },
  { name: 'maternelle', niveau: 'maternelle_ms', matiere: 'langage_oral' },
  { name: 'supérieur', niveau: 'licence_3', matiere: 'autre' },
];

describe('consigne de la séquence — sans l’option, rien ne change', () => {
  for (const baseline of SEQUENCE_PROMPT_BASELINE) {
    it(`${baseline.name} : texte identique à celui d’avant l’option`, () => {
      const r = req(baseline.req);
      expect(toolInstructions(r, getLevelGroup(r.niveau))).toBe(baseline.tool);
      // Option absente, fausse ou « undefined » : même consigne, même message complet, octet pour octet.
      const system = buildSystemPrompt(r, false);
      const user = buildUserPrompt(r, []);
      for (const off of [{ planSeulement: undefined }, { planSeulement: false }]) {
        expect(buildSystemPrompt({ ...r, ...off }, false)).toBe(system);
        expect(buildSystemPrompt({ ...r, ...off }, true)).toBe(buildSystemPrompt(r, true));
        expect(buildUserPrompt({ ...r, ...off }, [])).toBe(user);
      }
      expect(system).toContain(baseline.tool);
      expect(system).not.toMatch(/PLAN d'/);
      expect(user).not.toMatch(/Plan seul/);
    });
  }

  it('message de la demande (séquence de 6 séances) : octet pour octet', () => {
    const r = req({ niveau: '4eme', matiere: 'francais', nombreSeances: 6, duree: '55 minutes', objectifs: 'Comprendre', consignes: 'Varier' });
    expect(buildUserPrompt(r, [])).toBe(
      'DEMANDE : Séquence.\n- Niveau : 4ème\n- Matière : Français\n- Sujet : La Révolution française\n- Durée : 55 minutes\n- Objectifs de l\'enseignant : Comprendre\n- Nombre de séances : 6\n- Consignes de l\'enseignant (à respecter en priorité) : Varier\n\nProduis maintenant le contenu complet en Markdown.\nRespecte exactement le format et les nombres demandés ci-dessus.',
    );
    expect(buildUserPrompt(req({ niveau: 'cm1', matiere: 'francais' }), [])).toBe(
      'DEMANDE : Séquence.\n- Niveau : CM1\n- Matière : Français\n- Sujet : La Révolution française\n\nProduis maintenant le contenu complet en Markdown.',
    );
  });

  it('l’option n’a aucun effet sur un autre outil (champ hors de l’outil)', () => {
    for (const type of ['cours', 'fiche_prep', 'exercices'] as TypeContenu[]) {
      const base = req({ type });
      expect(buildSystemPrompt({ ...base, planSeulement: true }, false)).toBe(buildSystemPrompt(base, false));
      expect(buildUserPrompt({ ...base, planSeulement: true }, [])).toBe(buildUserPrompt(base, []));
    }
  });
});

describe('consigne de la séquence — plan d’abord (3 variantes)', () => {
  for (const { name, niveau, matiere } of VARIANTS) {
    it(`${name} : le plan seulement, tableau dont la première colonne est le numéro, séances non détaillées`, () => {
      const r = req({ niveau, matiere, nombreSeances: 6, planSeulement: true });
      const task = toolInstructions(r, getLevelGroup(niveau));
      expect(task).toMatch(/^TÂCHE : (?:concevoir|organiser) le PLAN d'/);
      expect(task).toContain('EXACTEMENT 6 séances, numérotées de 1 à 6');
      expect(task).toContain('EXACTEMENT 6 lignes, numérotées de 1 à 6');
      expect(task).toContain('PREMIÈRE colonne');
      expect(task).toContain('NE DÉTAILLE PAS le déroulé de chaque séance');
      // La séquence complète n'est plus demandée : ni détail de chaque séance, ni déroulé minuté.
      expect(task).not.toMatch(/détail de chaque séance/);
      expect(task).not.toMatch(/déroulé minuté/);
      // Court : quelques lignes seulement.
      expect(task.split('\n').length).toBeLessThanOrEqual(3);
      expect(task.length).toBeLessThan(900);
    });
  }

  it('collège : titre, niveau, problématique, objectifs, évaluation diagnostique, tableau (n° | titre | objectif | activités | durée), évaluation sommative, prolongements', () => {
    const task = toolInstructions(req({ nombreSeances: 5, planSeulement: true }), 'college');
    expect(task).toContain(
      'Structure : titre, niveau, problématique, objectifs de la séquence, évaluation diagnostique, tableau synoptique (numéro de séance | titre | objectif | activités | durée | évaluation), évaluation sommative prévue, prolongements.',
    );
  });

  it('primaire : évaluation finale sans note sur 20 ; maternelle : sans évaluation diagnostique, organisation et évaluation positive', () => {
    expect(toolInstructions(req({ niveau: 'cm1', matiere: 'francais', planSeulement: true }), 'elementaire')).toContain('évaluation finale (positionnement sur les objectifs, sans note sur 20) prévue');
    const maternelle = toolInstructions(req({ niveau: 'maternelle_gs', matiere: 'langage_oral', planSeulement: true }), 'maternelle');
    expect(maternelle).toContain('concevoir le PLAN d\'une séquence de maternelle');
    expect(maternelle).toContain('tableau synoptique (numéro de séance | titre | objectif | activités | durée | organisation)');
    expect(maternelle).toContain('évaluation positive prévue');
    expect(maternelle).not.toContain('évaluation diagnostique');
  });

  it('supérieur : tableau des séances CM/TD/TP, mêmes sources et lectures que le module complet', () => {
    const task = toolInstructions(req({ niveau: 'licence_3', matiere: 'autre', nombreSeances: 10, planSeulement: true }), 'licence');
    expect(task).toContain('organiser le PLAN d\'un module (unité d\'enseignement) en EXACTEMENT 10 séances');
    expect(task).toContain('tableau des séances (numéro | format CM/TD/TP | thème | contenus | travail étudiant)');
    expect(task).toContain('lectures recommandées (uniquement parmi les sources fournies');
    expect(task).toContain('EXACTEMENT 10 lignes, numérotées de 1 à 10');
  });

  it('sans nombre de séances : « 4 à 6 séances » et une ligne par séance (jamais « EXACTEMENT »)', () => {
    const task = toolInstructions(req({ planSeulement: true }), 'college');
    expect(task).toContain('séquence pédagogique de 4 à 6 séances');
    expect(task).toContain('une ligne par séance, numérotées à partir de 1');
    expect(task).not.toContain('EXACTEMENT');
    expect(toolInstructions(req({ niveau: 'licence_1', matiere: 'autre', planSeulement: true }), 'licence')).toContain('en séances, uniquement ce plan');
  });

  it('démarche (classe inversée) : appliquée au plan, sans rien développer (ni script, ni questions, ni déroulé)', () => {
    const task = toolInstructions(req({ nombreSeances: 4, modalite: 'classe_inversee', planSeulement: true }), 'college');
    expect(task).toContain('FORME : classe inversée.');
    expect(task).toContain('sans rien développer (ni script, ni questions, ni déroulé)');
    expect(task).not.toContain('à chacune de ses séances');
    expect(task).not.toContain('détail de chaque séance');
    expect(task).toContain('En classe inversée, les séances s’appuient chacune sur une capsule');
  });

  it('message de la demande : « Plan seul », « le plan » (jamais « le contenu complet ») et rappel final', () => {
    const user = buildUserPrompt(req({ nombreSeances: 6, planSeulement: true }), []);
    expect(user).toContain('- Nombre de séances : 6\n- Plan seul : le tableau des séances, sans le détail de chaque séance');
    expect(user).toContain('Produis maintenant le plan (sans le détail des séances) en Markdown.');
    expect(user).not.toContain('contenu complet');
    expect(user.trim().endsWith('Respecte exactement le format et les nombres demandés ci-dessus.')).toBe(true);
    // Sans nombre de séances : le rappel final est quand même ajouté (l'option est un format imposé).
    expect(buildUserPrompt(req({ planSeulement: true }), []).trim().endsWith('Respecte exactement le format et les nombres demandés ci-dessus.')).toBe(true);
    // Avec des sources : la consigne de citation est conservée.
    const sources = [{ ref: { n: 1, kind: 'document' as const, title: 'cours.pdf', docName: 'cours.pdf' }, text: 'Texte' }];
    expect(buildUserPrompt(req({ planSeulement: true }), sources)).toContain('Produis maintenant le plan (sans le détail des séances) en Markdown, en citant les sources fournies ([S1], [S2]…)');
  });
});

describe('validation de la demande (serveur, application Windows, connecteur) — planSeulement', () => {
  it('outil Séquence : booléen « true » accepté ; absent, faux ou non booléen : ignoré, jamais d’erreur', () => {
    expect(validateGenerationRequest(req({ planSeulement: true })).planSeulement).toBe(true);
    expect(validateGenerationRequest(req())).not.toHaveProperty('planSeulement');
    expect(validateGenerationRequest(req({ planSeulement: false }))).not.toHaveProperty('planSeulement');
    for (const value of ['true', 'oui', 1, 0, null, {}, [], 'false']) {
      expect(validateGenerationRequest({ ...req(), planSeulement: value }), String(value)).not.toHaveProperty('planSeulement');
    }
  });

  it('refusé (ignoré) hors de l’outil Séquence, comme les autres champs de l’outil', () => {
    expect(TOOL_FIELDS.sequence).toContain('planSeulement');
    for (const type of Object.keys(TOOL_FIELDS) as TypeContenu[]) {
      if (type === 'sequence') continue;
      expect(TOOL_FIELDS[type], type).not.toContain('planSeulement');
      const cleaned = validateGenerationRequest({ ...req({ type }), planSeulement: true, texteEleve: 'Copie', typeLettre: 'reunion' });
      expect(cleaned, type).not.toHaveProperty('planSeulement');
    }
  });

  it('niveaux scolaires ET supérieur', () => {
    for (const niveau of ['cp', '6eme', 'terminale_gen', 'maternelle_ps', 'licence_1', 'master_2'] as NiveauScolaire[]) {
      expect(validateGenerationRequest(req({ niveau, matiere: undefined as never, planSeulement: true })).planSeulement, niveau).toBe(true);
    }
  });

  it('JSON reçu tel quel (corps d’une requête) : le champ traverse la validation avec le nombre de séances', () => {
    const body = JSON.parse(JSON.stringify(req({ nombreSeances: 6, planSeulement: true })));
    expect(validateGenerationRequest(body)).toMatchObject({ type: 'sequence', nombreSeances: 6, planSeulement: true });
  });
});

describe('enregistrement dans l’historique (POST /api/generation) — planSeulement', () => {
  const draft = (params: Record<string, unknown>, type: TypeContenu = 'sequence') => ({
    type, niveau: '4eme', matiere: 'histoire_geo', sujet: 'La Révolution', contenu: '# Plan', sources: [], params,
  });

  it('accepté pour une séquence, conservé dans les paramètres', () => {
    expect(validateGenerationRecordDraft(draft({ nombreSeances: 6, planSeulement: true })).params).toEqual({ nombreSeances: 6, planSeulement: true });
    expect(validateGenerationRecordDraft(draft({ planSeulement: false })).params).toEqual({ planSeulement: false });
  });

  it('absent : accepté (ancien client)', () => {
    expect(validateGenerationRecordDraft(draft({ nombreSeances: 6 })).params).toEqual({ nombreSeances: 6 });
    expect(validateGenerationRecordDraft(draft({ planSeulement: undefined })).params).toEqual({});
    expect(validateGenerationRecordDraft(draft({ planSeulement: null })).params).toEqual({});
    expect(validateGenerationRecordDraft({ ...draft({}), params: undefined }).params).toEqual({});
  });

  it('non booléen : refusé', () => {
    for (const value of ['true', 1, 0, 'oui', {}, []]) {
      expect(() => validateGenerationRecordDraft(draft({ planSeulement: value })), String(value)).toThrow(/plan d’abord/);
    }
  });

  it('refusé hors de l’outil Séquence', () => {
    for (const type of ['cours', 'fiche_prep', 'exercices', 'evaluation', 'progression'] as TypeContenu[]) {
      expect(() => validateGenerationRecordDraft(draft({ planSeulement: true }, type)), type).toThrow(/plan d’abord/);
      expect(() => validateGenerationRecordDraft(draft({ planSeulement: false }, type)), type).toThrow(/plan d’abord/);
      // Sans l'option, le même enregistrement reste accepté.
      expect(() => validateGenerationRecordDraft(draft({}, type)), type).not.toThrow();
    }
  });
});

describe('contrôle du nombre de séances — plan d’abord', () => {
  const planReq = (n: number) => req({ nombreSeances: n, planSeulement: true });
  const plan = (rows: string[], before = '') => `# Plan\n\n${before}| N° | Titre | Objectif |\n|---|---|---|\n${rows.join('\n')}\n\n## Prolongements\n\nVisite.`;
  const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => `| ${i + 1} | Titre ${i + 1} | Objectif ${i + 1} |`);

  it('compte les lignes numérotées du tableau : 6 sur 6, rien ; 4 sur 6, avertissement', () => {
    expect(checkOutputStructure(planReq(6), plan(rowsOf(6)))).toEqual([]);
    expect(checkOutputStructure(planReq(6), plan(rowsOf(4)))).toEqual([
      'Le plan compte 4 séances au lieu des 6 demandées : vérifiez-le avant de l’utiliser, ou relancez la génération.',
    ]);
    expect(checkOutputStructure(planReq(3), plan(rowsOf(5)))).toEqual([
      'Le plan compte 5 séances au lieu des 3 demandées : vérifiez-le avant de l’utiliser, ou relancez la génération.',
    ]);
    expect(checkOutputStructure(planReq(4), plan(rowsOf(1)))[0]).toContain('Le plan compte 1 séance au lieu des 4');
  });

  it('ne signale jamais l’absence de détail par séance (aucun titre « Séance n » dans un plan)', () => {
    const doc = plan(rowsOf(6));
    expect(doc).not.toMatch(/Séance \d/);
    expect(checkOutputStructure(planReq(6), doc)).toEqual([]);
    // Les mêmes titres (« Séance 1 » à « Séance 4 ») sur 6 séances demandées : séquence complète, avertissement habituel.
    const detailed = `${plan(rowsOf(6))}\n\n### Séance 1\n\n### Séance 2\n\n### Séance 3\n\n### Séance 4`;
    expect(checkOutputStructure(req({ nombreSeances: 6 }), detailed)).toHaveLength(1);
    // Avec l'option : seul le tableau compte.
    expect(checkOutputStructure(planReq(6), detailed)).toEqual([]);
  });

  it('une mention dans le texte (« évaluation en séance 6 », « Séance 2 : … » en liste) ne fausse pas le compte', () => {
    const doc = plan(rowsOf(6), 'Évaluation en séance 6.\n\n**Séance 1** : introduction\n\n- Séance 2 : suite\n\n');
    expect(checkOutputStructure(planReq(6), doc)).toEqual([]);
  });

  it('« Séances 3 et 4 » dans le tableau comptent pour deux ; numérotation « Séance 1 », « S2 » acceptée', () => {
    expect(checkOutputStructure(planReq(5), plan(['| 1 | A | x |', '| 2 | B | x |', '| Séances 3 et 4 | C | x |', '| 5 | D | x |']))).toEqual([]);
    expect(checkOutputStructure(planReq(3), plan(['| Séance 1 | A | x |', '| S2 | B | x |', '| 3. | C | x |']))).toEqual([]);
  });

  it('compte incertain (aucun tableau lisible, texte vide) : aucun avertissement', () => {
    expect(checkOutputStructure(planReq(6), '# Plan\n\nPas de tableau, juste du texte sur 6 séances.')).toEqual([]);
    expect(checkOutputStructure(planReq(6), '| Compétence | Niveau |\n|---|---|\n| Lire | 1 |')).toEqual([]);
    expect(checkOutputStructure(planReq(6), '')).toEqual([]);
  });

  it('pas de nombre demandé : rien à comparer', () => {
    expect(checkOutputStructure(req({ planSeulement: true }), plan(rowsOf(3)))).toEqual([]);
  });

  it('séquence complète (sans l’option) : contrôle inchangé', () => {
    const sequence = (n: number) => `| Séance | Titre |\n| --- | --- |\n| 1 | Découverte |\n\n${Array.from({ length: n }, (_, i) => `### Séance ${i + 1} : étape`).join('\n\n')}`;
    expect(checkOutputStructure(req({ nombreSeances: 6 }), sequence(4))).toEqual([
      'La séquence compte 4 séances au lieu des 6 demandées : vérifiez-le avant de l’utiliser, ou relancez la génération.',
    ]);
    expect(checkOutputStructure(req({ nombreSeances: 4 }), sequence(4))).toEqual([]);
  });
});

describe('pipeline — plan d’abord de bout en bout', () => {
  const PLAN = '# Plan\n\n| N° | Titre |\n|---|---|\n| 1 | A |\n| 2 | B |\n| 3 | C |\n';

  it('le fournisseur reçoit la consigne « plan seul » ; la génération enregistre l’option ; avertissement si le plan est incomplet', async () => {
    const provider = new MockProvider({ reply: PLAN });
    const events = await collect(runGeneration(req({ nombreSeances: 5, planSeulement: true }), { provider }));
    const prompt = provider.calls[0].messages.map(m => m.content).join('\n');
    expect(prompt).toContain('concevoir le PLAN d\'une séquence pédagogique de EXACTEMENT 5 séances');
    expect(prompt).toContain('- Plan seul : le tableau des séances');
    const done = events.find(e => e.type === 'done');
    expect(done).toMatchObject({ type: 'done', content: expect.stringContaining('| 3 | C |') });
    const warnings = events.filter(e => e.type === 'warning');
    expect(warnings).toEqual([{ type: 'warning', code: 'CONTENT_CHECK', message: 'Le plan compte 3 séances au lieu des 5 demandées : vérifiez-le avant de l’utiliser, ou relancez la génération.' }]);
  });

  it('plan complet : aucun avertissement ; enregistrement avec « planSeulement » dans les paramètres', async () => {
    const provider = new MockProvider({ reply: PLAN });
    const saved: unknown[] = [];
    const events = await collect(runGeneration(req({ nombreSeances: 3, planSeulement: true }), {
      provider,
      save: async record => {
        saved.push(record);
        return { id: 'g1' };
      },
    }));
    expect(events.filter(e => e.type === 'warning')).toEqual([]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ type: 'sequence', params: { nombreSeances: 3, planSeulement: true } });
    // Sans l'option : le paramètre n'existe pas.
    const plain = await collect(runGeneration(req({ nombreSeances: 3 }), {
      provider: new MockProvider({ reply: PLAN }),
      save: async record => {
        saved.push(record);
        return { id: 'g2' };
      },
    }));
    expect(plain.some(e => e.type === 'done')).toBe(true);
    expect((saved[1] as { params: Record<string, unknown> }).params).not.toHaveProperty('planSeulement');
  });
});
