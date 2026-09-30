// Formats normés (« type d'exercice », « format de l'épreuve »…) et options des outils : disponibilité par outil,
// niveau et matière (conforme aux épreuves en vigueur), consignes transmises au modèle, validation partagée
// (serveur et application Windows), enregistrement dans l'historique.

import { describe, expect, it } from 'vitest';
import { ALL_MATIERES, ALL_TYPES, getMatieresForNiveau, TOOL_FIELDS, type Matiere, type TypeContenu } from '../../shared/catalog.js';
import {
  BAREMES, BESOINS_PARTICULIERS, countLabel, countUnit, defaultModaliteLabel, getModalite, isModaliteAvailable, LIMITES_NOMBRES,
  MODALITES, modaliteFieldLabel, modalitePrompt, modalitesFor, TONS, TYPES_EVALUATION,
} from '../../shared/formats.js';
import { ALL_NIVEAUX, type NiveauScolaire } from '../../shared/levels.js';
import { buildSystemPrompt, buildUserPrompt, generationTemperature } from '../../shared/prompts/index.js';
import type { GenerationRequest } from '../../shared/types.js';
import { validateGenerationRecordDraft, validateGenerationRequest } from '../../shared/validation.js';

const values = (type: TypeContenu, niveau: NiveauScolaire, matiere: Matiere) => modalitesFor(type, niveau, matiere).map(m => m.value);

function req(extra: Partial<GenerationRequest>): GenerationRequest {
  return { type: 'exercices', niveau: '4eme', matiere: 'mathematiques', sujet: 'Les fractions', researchMode: 'documents', ...extra };
}

describe('catalogue des formats', () => {
  it('identifiants uniques et stables, libellés et descriptions présents, outils existants', () => {
    const ids = MODALITES.map(m => m.value);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MODALITES) {
      expect(m.value, m.value).toMatch(/^[a-z][a-z_]{0,39}$/);
      expect(m.label.trim().length, m.value).toBeGreaterThan(1);
      expect(m.description.trim().length, m.value).toBeGreaterThan(3);
      for (const tool of m.tools) expect(ALL_TYPES).toContain(tool);
      // Chaque format a sa place dans TOOL_FIELDS : il ne serait jamais transmis sinon.
      for (const tool of m.tools) expect(TOOL_FIELDS[tool], `${m.value} / ${tool}`).toContain('modalite');
    }
  });

  it('chaque format proposé a une consigne non vide, pour chaque niveau et matière où il est proposé', () => {
    for (const type of ALL_TYPES) {
      for (const niveau of ALL_NIVEAUX) {
        for (const { value: matiere } of getMatieresForNiveau(niveau)) {
          for (const m of modalitesFor(type, niveau, matiere)) {
            const prompt = modalitePrompt(m.value, { niveau, matiere });
            expect(prompt.length, `${m.value} / ${type} / ${niveau} / ${matiere}`).toBeGreaterThan(40);
          }
        }
      }
    }
  });

  it('honnêteté : aucun format ne demande d’inventer un extrait, une décision ou une source', () => {
    for (const m of MODALITES.filter(m => typeof m.prompt === 'string')) {
      expect(m.prompt as string, m.value).not.toMatch(/invente(?!\s+jamais)/i);
    }
    const text = modalitePrompt('commentaire', { niveau: '1ere_gen', matiere: 'francais' });
    expect(text).toMatch(/N’invente jamais un extrait attribué à un auteur réel/);
    expect(modalitePrompt('commentaire_arret', { niveau: 'licence_2', matiere: 'droit' })).toMatch(/n’invente jamais de décision/);
    expect(modalitePrompt('etude_documents', { niveau: '3eme', matiere: 'histoire_geo' })).toMatch(/jamais une fausse citation/);
  });

  it('français au lycée : dissertation, commentaire, explication linéaire ; contraction + essai en voie technologique', () => {
    const general = values('exercices', '1ere_gen', 'francais');
    expect(general).toEqual(expect.arrayContaining(['dissertation', 'commentaire', 'explication_lineaire']));
    expect(general).not.toContain('contraction_essai');
    expect(values('exercices', '1ere_techno', 'francais')).toContain('contraction_essai');
    // Au collège : les exercices du brevet, jamais de dissertation.
    const college = values('exercices', '3eme', 'francais');
    expect(college).toEqual(expect.arrayContaining(['comprehension', 'grammaire', 'dictee', 'reecriture', 'redaction']));
    expect(college).not.toContain('dissertation');
  });

  it('épreuves de fin de cycle : sujet type brevet en 3e, sujet type bac en première et terminale seulement', () => {
    expect(values('evaluation', '3eme', 'mathematiques')).toContain('sujet_brevet');
    expect(values('evaluation', '4eme', 'mathematiques')).not.toContain('sujet_brevet');
    expect(values('exercices', '3eme', 'mathematiques')).not.toContain('sujet_brevet');
    expect(values('evaluation', 'terminale_gen', 'philosophie')).toContain('sujet_bac');
    expect(values('evaluation', '2nde_gt', 'francais')).not.toContain('sujet_bac');
    // Contenu propre à chaque discipline (session 2026).
    expect(modalitePrompt('sujet_brevet', { niveau: '3eme', matiere: 'mathematiques' })).toMatch(/automatismes à traiter sans calculatrice/);
    expect(modalitePrompt('sujet_brevet', { niveau: '3eme', matiere: 'francais' })).toMatch(/dictée/);
    expect(modalitePrompt('sujet_brevet', { niveau: '3eme', matiere: 'histoire_geo' })).toMatch(/développement construit/);
    expect(modalitePrompt('sujet_bac', { niveau: '1ere_gen', matiere: 'mathematiques' })).toMatch(/épreuve anticipée de mathématiques.*QCM sans justification/s);
    expect(modalitePrompt('sujet_bac', { niveau: '1ere_techno', matiere: 'francais' })).toMatch(/contraction de texte suivie d’un essai/);
    expect(modalitePrompt('sujet_bac', { niveau: '1ere_gen', matiere: 'francais' })).toMatch(/dissertation sur une œuvre/);
    expect(modalitePrompt('sujet_bac', { niveau: 'terminale_gen', matiere: 'ses' })).toMatch(/épreuve composée/);
    expect(modalitePrompt('sujet_bac', { niveau: 'terminale_gen', matiere: 'hggsp' })).toMatch(/étude critique/);
  });

  it('disciplines : histoire-géographie, SES, EMC, langues, droit — chacune ses formats, jamais ceux des autres', () => {
    expect(values('exercices', '3eme', 'histoire_geo')).toEqual(expect.arrayContaining(['developpement_construit', 'croquis', 'reperes', 'etude_documents']));
    expect(values('exercices', 'terminale_gen', 'histoire_geo')).toEqual(expect.arrayContaining(['composition', 'etude_critique']));
    expect(values('exercices', 'terminale_gen', 'ses')).toEqual(expect.arrayContaining(['dissertation', 'epreuve_composee']));
    expect(values('exercices', '4eme', 'emc')).toContain('situation_pratique');
    expect(values('exercices', '4eme', 'anglais')).toEqual(expect.arrayContaining(['comprehension_ecrite', 'comprehension_orale', 'expression_ecrite', 'expression_orale']));
    expect(values('exercices', 'licence_2', 'droit')).toEqual(expect.arrayContaining(['cas_pratique', 'commentaire_arret', 'dissertation']));
    // Mathématiques : automatismes et démonstration, mais ni dictée ni dissertation.
    const maths = values('exercices', '4eme', 'mathematiques');
    expect(maths).toEqual(expect.arrayContaining(['automatismes', 'demonstration', 'probleme', 'qcm']));
    expect(maths).not.toContain('dictee');
    expect(maths).not.toContain('dissertation');
  });

  it('maternelle : ni copie ni note — ateliers et jeux seulement pour les activités, aucun format d’évaluation', () => {
    expect(values('exercices', 'maternelle_ms', 'nombres_formes')).toEqual(['ateliers', 'jeux']);
    expect(values('evaluation', 'maternelle_gs', 'langage_oral')).toEqual([]);
    expect(values('cours', 'maternelle_ps', 'explorer_monde')).toEqual([]);
  });

  it('outils sans format (cahier journal) ; libellés du choix par défaut propres à chaque outil', () => {
    for (const niveau of ALL_NIVEAUX) {
      for (const { value } of ALL_MATIERES) expect(modalitesFor('cahier_journal', niveau, value)).toEqual([]);
    }
    expect(modaliteFieldLabel('exercices', false)).toBe('Type d’exercice');
    expect(modaliteFieldLabel('evaluation', false)).toBe('Format de l’épreuve');
    expect(modaliteFieldLabel('cours', true)).toBe('Forme du cours');
    expect(defaultModaliteLabel('cours')).toBe('Cours complet');
    expect(defaultModaliteLabel('exercices')).toBe('Variés');
  });
});

describe('validation partagée (serveur et application Windows)', () => {
  it('format accepté seulement s’il convient à l’outil, au niveau et à la matière ; sinon ignoré', () => {
    expect(validateGenerationRequest(req({ modalite: 'automatismes' })).modalite).toBe('automatismes');
    expect(validateGenerationRequest(req({ modalite: 'dictee' }))).not.toHaveProperty('modalite');
    expect(validateGenerationRequest(req({ modalite: 'inexistant' }))).not.toHaveProperty('modalite');
    expect(validateGenerationRequest(req({ type: 'cahier_journal', modalite: 'qcm' }))).not.toHaveProperty('modalite');
    expect(isModaliteAvailable('dissertation', 'evaluation', 'terminale_gen', 'philosophie')).toBe(true);
    expect(isModaliteAvailable(42, 'evaluation', 'terminale_gen', 'philosophie')).toBe(false);
  });

  it('options : listes blanches et bornes ; valeur inattendue ignorée, jamais d’erreur', () => {
    const ok = validateGenerationRequest(req({
      type: 'evaluation', typeEvaluation: 'formative', bareme: 'competences', sansCorrige: true,
    }));
    expect(ok).toMatchObject({ typeEvaluation: 'formative', bareme: 'competences', sansCorrige: true });
    const raw = { ...req({}), nombreExercices: 99, bareme: 'sur100', sansCorrige: 'oui', typeEvaluation: 'formative' };
    const cleaned = validateGenerationRequest(raw);
    expect(cleaned).not.toHaveProperty('nombreExercices');
    expect(cleaned).not.toHaveProperty('bareme');
    expect(cleaned).not.toHaveProperty('sansCorrige');
    // Objectif d'évaluation : champ de l'outil « évaluation » seulement.
    expect(cleaned).not.toHaveProperty('typeEvaluation');
    expect(validateGenerationRequest(req({ nombreExercices: 5 })).nombreExercices).toBe(5);
    expect(validateGenerationRequest(req({ type: 'sequence', nombreSeances: 12 })).nombreSeances).toBe(12);
    expect(validateGenerationRequest(req({ type: 'sequence', nombreSeances: 1 }))).not.toHaveProperty('nombreSeances');
    const besoins = validateGenerationRequest({ ...req({ type: 'differenciation' }), besoins: ['allophone', 'x', 'dys', 'dys'] });
    expect(besoins.besoins).toEqual(['dys', 'allophone']);
    expect(validateGenerationRequest(req({ type: 'appreciations', ton: 'exigeant' })).ton).toBe('exigeant');
    expect(validateGenerationRequest({ ...req({ type: 'appreciations' }), ton: 'agressif' })).not.toHaveProperty('ton');
  });

  it('historique (POST /api/generation) : options enregistrées, format d’une application plus récente accepté, valeur incohérente refusée', () => {
    const draft = {
      type: 'exercices', niveau: '4eme', matiere: 'mathematiques', sujet: 'Fractions', contenu: '# Exercices', sources: [],
      params: { modalite: 'format_futur', bareme: 'sur10', sansCorrige: true, nombreExercices: 5, besoins: ['dys'] },
    };
    expect(validateGenerationRecordDraft(draft).params).toEqual({ modalite: 'format_futur', bareme: 'sur10', sansCorrige: true, nombreExercices: 5, besoins: ['dys'] });
    expect(() => validateGenerationRecordDraft({ ...draft, params: { modalite: 'Pas un identifiant !' } })).toThrow(/format/);
    expect(() => validateGenerationRecordDraft({ ...draft, params: { bareme: 'sur100' } })).toThrow(/notation/);
    expect(() => validateGenerationRecordDraft({ ...draft, params: { nombreSeances: 40 } })).toThrow(/séances/);
  });
});

describe('consignes transmises au modèle', () => {
  it('format choisi : sa consigne, qui prime ; plus de « Varie les formats »', () => {
    const sys = buildSystemPrompt(req({ modalite: 'qcm' }), false);
    expect(sys).toMatch(/FORMAT : QCM\. Chaque question porte sur un seul point et propose 4 réponses/);
    expect(sys).toMatch(/Ce format prime sur toute autre indication de forme ci-dessus\./);
    expect(sys).not.toMatch(/Varie les formats/);
    expect(buildSystemPrompt(req({}), false)).toMatch(/Varie les formats/);
    expect(buildUserPrompt(req({ modalite: 'qcm' }), [])).toMatch(/- Format demandé : QCM/);
  });

  it('nombre exact d’exercices, de séances ; rappel final pour les petits modèles', () => {
    const sys = buildSystemPrompt(req({ nombreExercices: 5 }), false);
    expect(sys).toMatch(/EXACTEMENT 5 exercices, numérotés de 1 à 5/);
    expect(sys).not.toMatch(/6 à 10/);
    expect(buildSystemPrompt(req({ nombreExercices: 1 }), false)).toMatch(/EXACTEMENT 1 exercice, numérotés de 1 à 1/);
    const seq = buildSystemPrompt(req({ type: 'sequence', nombreSeances: 8 }), false);
    expect(seq).toMatch(/séquence pédagogique de EXACTEMENT 8 séances, numérotées de 1 à 8/);
    const user = buildUserPrompt(req({ nombreExercices: 5 }), []);
    expect(user).toMatch(/- Nombre d'exercices : 5/);
    expect(user.trim().endsWith('Respecte exactement le format et les nombres demandés ci-dessus.')).toBe(true);
    expect(buildUserPrompt(req({}), [])).not.toMatch(/Respecte exactement/);
  });

  it('sans corrigé : version élève seule, aucune partie « Corrigé » demandée', () => {
    const sys = buildSystemPrompt(req({ sansCorrige: true }), false);
    expect(sys).toMatch(/VERSION ÉLÈVE SEULE : ne rédige AUCUN corrigé/);
    expect(sys).not.toMatch(/Termine par une partie « Corrigé »/);
    const evaluation = buildSystemPrompt(req({ type: 'evaluation', sansCorrige: true }), false);
    expect(evaluation).not.toMatch(/5\. Corrigé détaillé/);
    expect(buildSystemPrompt(req({ type: 'evaluation' }), false)).toMatch(/5\. Corrigé détaillé/);
  });

  it('notation, objectif de l’évaluation, ton, besoins particuliers', () => {
    expect(buildSystemPrompt(req({ type: 'evaluation', bareme: 'competences' }), false))
      .toMatch(/NOTATION : par compétences, sans note chiffrée.*Cette notation prime/s);
    expect(buildSystemPrompt(req({ type: 'evaluation', typeEvaluation: 'diagnostique' }), false)).toMatch(/OBJECTIF : évaluation diagnostique/);
    expect(buildSystemPrompt(req({ type: 'appreciations', ton: 'encourageant' }), false)).toMatch(/TON : très encourageant/);
    const diff = buildSystemPrompt(req({ type: 'differenciation', besoins: ['dys', 'allophone'] }), false);
    expect(diff).toMatch(/BESOINS PARTICULIERS/);
    expect(diff).toMatch(/Élèves DYS : consignes courtes/);
    expect(diff).toMatch(/Élèves allophones/);
    expect(diff).not.toMatch(/Élèves avec TSA/);
    expect(TYPES_EVALUATION).toHaveLength(3);
    expect(BAREMES.map(b => b.value)).toEqual(['sur20', 'sur10', 'competences']);
    expect(TONS).toHaveLength(3);
    expect(BESOINS_PARTICULIERS).toHaveLength(6);
  });

  it('cours : la forme choisie remplace la structure du cours complet', () => {
    const synthese = buildSystemPrompt(req({ type: 'cours', modalite: 'synthese' }), false);
    expect(synthese).toMatch(/FORME : fiche de synthèse d’une page/);
    expect(synthese).not.toMatch(/5\. Trace écrite \(ce que l'élève garde/);
    expect(buildSystemPrompt(req({ type: 'cours' }), false)).toMatch(/5\. Trace écrite/);
  });

  it('correction de copie : le type de travail oriente la correction', () => {
    const sys = buildSystemPrompt(req({ type: 'corrige', niveau: 'terminale_gen', matiere: 'philosophie', modalite: 'dissertation', texteEleve: 'Copie' }), false);
    expect(sys).toMatch(/TYPE DE TRAVAIL : dissertation\./);
    expect(sys).toMatch(/FORMAT : dissertation\./);
  });

  it('qualité : structure et nombres exacts, français soigné ; température selon l’outil', () => {
    const sys = buildSystemPrompt(req({}), false);
    expect(sys).toMatch(/QUALITÉ ATTENDUE/);
    expect(sys).toMatch(/Respecte exactement les nombres demandés/);
    expect(sys).toMatch(/français soigné et fluide/);
    expect(generationTemperature('evaluation')).toBe(0.3);
    expect(generationTemperature('corrige')).toBe(0.3);
    expect(generationTemperature('appreciations')).toBe(0.6);
    expect(generationTemperature('cours')).toBe(0.4);
  });

  it('getModalite : format inconnu → rien', () => {
    expect(getModalite('inexistant')).toBeUndefined();
    expect(getModalite(undefined)).toBeUndefined();
    expect(modalitePrompt('inexistant', { niveau: '4eme', matiere: 'mathematiques' })).toBe('');
  });
});

describe('ce que l’on compte : exercices, questions… ou un seul travail', () => {
  it('un travail d’un seul tenant n’a pas de nombre ; un QCM compte des questions ; par défaut, des exercices', () => {
    for (const single of ['dissertation', 'commentaire', 'dictee', 'redaction', 'etude_cas', 'cas_pratique', 'composition', 'traduction']) {
      expect(countUnit(single), single).toBeNull();
    }
    expect(countLabel(countUnit('qcm')!)).toBe('Nombre de questions');
    expect(countLabel(countUnit('vrai_faux')!)).toBe("Nombre d'affirmations");
    expect(countLabel(countUnit('texte_trous')!)).toBe('Nombre de mots à compléter');
    expect(countLabel(countUnit('probleme')!)).toBe('Nombre de problèmes');
    expect(countLabel(countUnit('jeux', 'maternelle')!)).toBe('Nombre de jeux');
    expect(countLabel(countUnit('application')!)).toBe("Nombre d'exercices");
    expect(countLabel(countUnit(undefined)!)).toBe("Nombre d'exercices");
    expect(countLabel(countUnit(undefined, 'maternelle')!)).toBe("Nombre d'activités");
    expect(countLabel(countUnit('format_futur')!)).toBe("Nombre d'exercices");
  });

  it('chaque format de l’outil Exercices dit ce qu’il compte, avec des nombres proposés dans les bornes acceptées', () => {
    for (const m of [...MODALITES.filter(m => m.tools.includes('exercices')), undefined]) {
      for (const group of ['college', 'maternelle'] as const) {
        const unit = countUnit(m?.value, group);
        if (!unit) continue;
        expect(countLabel(unit), m?.value).toMatch(/^Nombre d(e |')\S/);
        expect(unit.options.length, m?.value).toBeGreaterThanOrEqual(3);
        for (const n of unit.options) {
          expect(Number.isInteger(n) && n >= LIMITES_NOMBRES.exercices.min && n <= LIMITES_NOMBRES.exercices.max, `${m?.value} ${n}`).toBe(true);
        }
      }
    }
    // Des nombres qui ont du sens : quelques problèmes, jamais 12 ; au moins 10 questions possibles pour un QCM.
    expect(Math.max(...countUnit('probleme')!.options)).toBeLessThanOrEqual(5);
    expect(Math.max(...countUnit(undefined, 'maternelle')!.options)).toBeLessThanOrEqual(6);
    expect(countUnit('qcm')!.options).toContain(10);
  });

  it('validation : le nombre d’exercices d’un travail d’un seul tenant est ignoré ; celui d’un QCM est gardé', () => {
    const base = { type: 'exercices', niveau: '6eme', matiere: 'francais', sujet: 'Le passé composé', nombreExercices: 5 };
    expect(validateGenerationRequest({ ...base, modalite: 'dictee' })).not.toHaveProperty('nombreExercices');
    expect(validateGenerationRequest({ ...base, modalite: 'qcm' }).nombreExercices).toBe(5);
    expect(validateGenerationRequest(base).nombreExercices).toBe(5);
    // Format hors de propos (dissertation en 6e) : ignoré, donc le nombre reste valable.
    const odd = validateGenerationRequest({ ...base, modalite: 'dissertation' });
    expect(odd).not.toHaveProperty('modalite');
    expect(odd.nombreExercices).toBe(5);
  });

  it('consignes : un seul travail complet (jamais une série) ; « EXACTEMENT 10 questions » pour un QCM', () => {
    const dictee = req({ niveau: '6eme', matiere: 'francais', modalite: 'dictee', nombreExercices: 3 });
    const sys = buildSystemPrompt(dictee, false);
    expect(sys).toMatch(/TÂCHE : rédiger UN SEUL travail complet, au format demandé ci-dessous \(et non une série d'exercices\)\./);
    expect(sys).not.toMatch(/EXACTEMENT/);
    expect(sys).toMatch(/1\. « Texte de la dictée » : un texte suivi de 80 à 110 mots/);
    expect(sys).toMatch(/aucun verbe à conjuguer entre parenthèses, aucun blanc/);
    expect(sys).toMatch(/la règle en une phrase exacte/);
    // Longueur selon la classe, du CP à la 3e.
    expect(modalitePrompt('dictee', { niveau: 'cp', matiere: 'francais' })).toMatch(/deux ou trois phrases courtes/);
    expect(modalitePrompt('dictee', { niveau: '3eme', matiere: 'francais' })).toMatch(/110 à 150 mots/);
    expect(buildUserPrompt(dictee, [])).not.toMatch(/Nombre d/);
    const qcm = req({ modalite: 'qcm', nombreExercices: 10 });
    expect(buildSystemPrompt(qcm, false)).toMatch(/EXACTEMENT 10 questions, numérotées de 1 à 10/);
    expect(buildSystemPrompt(qcm, false)).toMatch(/« \*\*Question 1\.\*\* Combien font 3 × 4 \? »/);
    expect(buildUserPrompt(qcm, [])).toMatch(/- Nombre de questions : 10/);
    // Sans nombre : un nombre de questions adapté, pas « 6 à 10 exercices ».
    const auto = buildSystemPrompt(req({ modalite: 'qcm' }), false);
    expect(auto).toMatch(/avec un nombre de questions adapté au niveau/);
    expect(auto).not.toMatch(/6 à 10 exercices/);
    // Supérieur : le sujet de TD reste un seul travail pour un cas pratique.
    const cas = buildSystemPrompt(req({ niveau: 'licence_2', matiere: 'droit', modalite: 'cas_pratique', format: 'td' }), true);
    expect(cas).toMatch(/pour une séance de travaux dirigés \(TD\) UN SEUL travail complet/);
    expect(cas).toMatch(/« Éléments de correction »/);
    // Maternelle : des ateliers comptés comme tels.
    expect(buildSystemPrompt(req({ niveau: 'maternelle_ms', matiere: 'explorer_monde', modalite: 'ateliers', nombreExercices: 3 }), false))
      .toMatch(/EXACTEMENT 3 ateliers de maternelle/);
  });
});

describe('correction de copie : notation propre à une copie', () => {
  it('note justifiée critère par critère (pas de « points de chaque question »)', () => {
    const sys = buildSystemPrompt(req({ type: 'corrige', niveau: '3eme', matiere: 'francais', texteEleve: 'Copie', bareme: 'sur10' }), false);
    expect(sys).toMatch(/NOTATION : note sur 10, justifiée critère par critère\. Cette notation remplace celle du point 5\./);
    expect(sys).not.toMatch(/points de chaque question/);
  });
});
