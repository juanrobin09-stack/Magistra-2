import { describe, expect, it } from 'vitest';
import { ALL_TYPES, getMatiereLabel, getMatieresForNiveau, TOOL_FIELDS, type TypeContenu } from '@shared/catalog';
import { selectPassages, type QueryPart } from '@shared/documents/retrieve';
import type { NiveauScolaire } from '@shared/levels';
import type { DocumentPassage, GenerationRequest, ResearchMode, TeacherProfile } from '@shared/types';
import { REQUEST_LIMITS, validateGenerationRequest } from '@shared/validation';
import {
  appreciationCount, appreciationSummary, buildGenerationRequest, buildPassageQuery, buildWeightedPassageQuery, chosenCount, createInitialForm, defaultTrimestre,
  fitPassagesToLimits, isLargeSequence, normalizeAppreciationInput, PLAN_ADVICE_MIN_SEANCES, resolveInitialSujet, resolveInitialType, validateForm,
  visibleFields, withNiveau, type GenerateForm,
} from '@/lib/generation/request';
import { HISTOIRE_COURSE_PAGES, SVT_COURSE_PAGES } from '../documents/fixtures';

const PROFILE: TeacherProfile = {
  displayName: 'Mme Durand',
  etablissement: 'Université de Lille',
  cycle: 'superieur',
  niveaux: ['master_1', 'licence_3'],
  matierePrincipale: 'systemes_information',
  discipline: 'Gouvernance des SI',
};

const PASSAGES: DocumentPassage[] = [
  { docId: 'd1', docName: 'cours.pdf', kind: 'pdf', locator: { type: 'pages', start: 1, end: 3 }, text: 'La gouvernance des SI…' },
];

/** Formulaire où TOUS les champs sont remplis : seul ce qui appartient à l'outil doit sortir. */
function fullForm(type: TypeContenu, niveau: NiveauScolaire): GenerateForm {
  return {
    type,
    niveau,
    matiere: getMatieresForNiveau(niveau)[0].value,
    discipline: 'Droit public',
    sujet: 'Un sujet',
    duree: '2 heures',
    objectifs: 'Des objectifs',
    consignes: 'Des consignes',
    difficulte: 'difficile',
    format: 'td',
    trimestre: '2',
    profilEleve: 'fragile',
    nombreAppreciations: '12',
    profilsDifferenciation: ['standard'],
    contenuSource: 'Exercice 1 : calculer 3/4 + 1/2',
    typeLettre: 'reunion',
    texteEleve: 'La révolution a commencer en 1789.',
    modalite: 'qcm',
    typeEvaluation: 'formative',
    bareme: 'sur10',
    sansCorrige: true,
    nombreExercices: 5,
    nombreSeances: 6,
    planSeulement: true,
    ton: 'exigeant',
    besoins: ['dys', 'allophone'],
  };
}

const BASE_KEYS = ['type', 'niveau', 'matiere', 'sujet', 'researchMode', 'profile', 'documents'];

function extraKeys(req: GenerationRequest): string[] {
  return Object.keys(req).filter(k => !BASE_KEYS.includes(k));
}

describe('buildGenerationRequest — aucun paramètre fantôme', () => {
  for (const tool of ALL_TYPES) {
    it(`${tool} (collège) : uniquement les champs de l'outil`, () => {
      const req = buildGenerationRequest(fullForm(tool, '4eme'), tool, PROFILE, PASSAGES, 'documents');
      const allowed = TOOL_FIELDS[tool].filter(f => f !== 'format');
      for (const key of extraKeys(req)) expect(allowed).toContain(key);
      // Pas de valeur « undefined » qui traîne dans l'objet.
      for (const [k, v] of Object.entries(req)) expect(v, k).not.toBeUndefined();
      // Hors supérieur : ni discipline ni format.
      expect(req).not.toHaveProperty('discipline');
      expect(req).not.toHaveProperty('format');
      if (!TOOL_FIELDS[tool].includes('sujet')) expect(req.sujet).toBe('');
      // La demande passe la validation partagée (serveur / application) sans perte.
      const validated = validateGenerationRequest(JSON.parse(JSON.stringify(req)));
      for (const key of extraKeys(req)) expect(validated[key as keyof GenerationRequest]).toEqual(req[key as keyof GenerationRequest]);
    });

    it(`${tool} (master) : discipline + champs de l'outil, jamais de trimestre`, () => {
      const req = buildGenerationRequest(fullForm(tool, 'master_1'), tool, PROFILE, PASSAGES, 'documents');
      const allowed = [...TOOL_FIELDS[tool].filter(f => f !== 'trimestre'), 'discipline'];
      for (const key of extraKeys(req)) expect(allowed).toContain(key);
      expect(req.discipline).toBe('Droit public');
      expect(req).not.toHaveProperty('trimestre');
      expect(() => validateGenerationRequest(JSON.parse(JSON.stringify(req)))).not.toThrow();
    });
  }

  it('aucune difficulté par défaut (exercices / évaluation)', () => {
    for (const tool of ['exercices', 'evaluation'] as const) {
      const form = { ...fullForm(tool, '4eme'), difficulte: '' as const };
      expect(buildGenerationRequest(form, tool, PROFILE, [], 'documents')).not.toHaveProperty('difficulte');
      const initial = createInitialForm(PROFILE, { type: tool });
      expect(buildGenerationRequest(initial, tool, PROFILE, [], 'documents')).not.toHaveProperty('difficulte');
    }
  });

  it('les champs saisis pour un autre outil ne sont pas envoyés', () => {
    const form = fullForm('corrige', '4eme');
    const req = buildGenerationRequest(form, 'lettre_parents', PROFILE, [], 'documents');
    expect(extraKeys(req).sort()).toEqual(['consignes', 'typeLettre']);
    expect(req.sujet).toBe('');
    expect(req).not.toHaveProperty('texteEleve');
  });

  it('champs vides ou blancs : non transmis', () => {
    const form: GenerateForm = { ...fullForm('cours', '4eme'), duree: '   ', objectifs: '', consignes: '\n' };
    const req = buildGenerationRequest(form, 'cours', PROFILE, [], 'documents');
    expect(extraKeys(req)).toEqual([]);
  });

  it('travail d’un seul tenant (dictée, dissertation) : aucun nombre d’exercices transmis ; QCM : nombre gardé', () => {
    const form: GenerateForm = { ...fullForm('exercices', '6eme'), matiere: 'francais', modalite: 'dictee', nombreExercices: 5 };
    const dictee = buildGenerationRequest(form, 'exercices', PROFILE, [], 'documents');
    expect(dictee.modalite).toBe('dictee');
    expect(dictee).not.toHaveProperty('nombreExercices');
    expect(visibleFields('exercices', '6eme', 'francais', 'dictee').has('nombreExercices')).toBe(false);
    expect(buildGenerationRequest({ ...form, modalite: 'qcm' }, 'exercices', PROFILE, [], 'documents').nombreExercices).toBe(5);
    // Format gardé d'un autre contexte (dissertation en 6e) : ni transmis, ni pris en compte pour le nombre.
    const stale = buildGenerationRequest({ ...form, modalite: 'dissertation' }, 'exercices', PROFILE, [], 'documents');
    expect(stale).not.toHaveProperty('modalite');
    expect(stale.nombreExercices).toBe(5);
    // Même règle que la validation partagée (serveur et application Windows).
    expect(validateGenerationRequest(dictee)).not.toHaveProperty('nombreExercices');
  });

  it('nombre gardé d’un autre format et non proposé pour celui-ci (12 questions → problèmes) : « Auto », rien transmis', () => {
    const form: GenerateForm = { ...fullForm('exercices', '4eme'), matiere: 'mathematiques', modalite: 'probleme', nombreExercices: 12 };
    expect(buildGenerationRequest(form, 'exercices', PROFILE, [], 'documents')).not.toHaveProperty('nombreExercices');
    expect(buildGenerationRequest({ ...form, nombreExercices: 3 }, 'exercices', PROFILE, [], 'documents').nombreExercices).toBe(3);
    expect(chosenCount(12, { one: 'problème', many: 'problèmes', options: [1, 2, 3, 4] })).toBe('');
    expect(chosenCount(2, { one: 'problème', many: 'problèmes', options: [1, 2, 3, 4] })).toBe(2);
    expect(chosenCount('', { one: 'problème', many: 'problèmes', options: [1, 2, 3, 4] })).toBe('');
  });

  it('matière absente au niveau : remplacée par une matière valide', () => {
    const form: GenerateForm = { ...fullForm('cours', 'cp'), matiere: 'philosophie' };
    const req = buildGenerationRequest(form, 'cours', PROFILE, [], 'documents');
    expect(getMatieresForNiveau('cp').map(m => m.value)).toContain(req.matiere);
  });
});

describe('séquence en deux temps : « Commencer par le plan »', () => {
  const sequence = (patch: Partial<GenerateForm> = {}) => ({ ...fullForm('sequence', '4eme'), ...patch });

  it('transmis pour une séquence seulement quand la case est cochée', () => {
    const on = buildGenerationRequest(sequence(), 'sequence', PROFILE, [], 'documents');
    expect(on.planSeulement).toBe(true);
    expect(on.nombreSeances).toBe(6);
    const off = buildGenerationRequest(sequence({ planSeulement: false }), 'sequence', PROFILE, [], 'documents');
    expect(off).not.toHaveProperty('planSeulement');
    // Formulaire d'une version antérieure (sans ce champ) : séquence complète.
    const legacy = { ...sequence() } as Partial<GenerateForm>;
    delete legacy.planSeulement;
    expect(buildGenerationRequest(legacy as GenerateForm, 'sequence', PROFILE, [], 'documents')).not.toHaveProperty('planSeulement');
  });

  it('jamais transmis pour un autre outil, même cochée dans le formulaire (champ gardé en changeant d’outil)', () => {
    for (const tool of ALL_TYPES.filter(t => t !== 'sequence')) {
      expect(buildGenerationRequest(fullForm(tool, '4eme'), tool, PROFILE, [], 'documents'), tool).not.toHaveProperty('planSeulement');
    }
  });

  it('champ visible à tous les niveaux (maternelle, élémentaire, collège, lycée, supérieur) pour la séquence seulement', () => {
    for (const niveau of ['maternelle_ps', 'cp', 'cm2', '6eme', 'terminale_pro', 'bts', 'licence_1', 'doctorat'] as NiveauScolaire[]) {
      expect(visibleFields('sequence', niveau, getMatieresForNiveau(niveau)[0].value).has('planSeulement'), niveau).toBe(true);
    }
    expect(visibleFields('fiche_prep', '4eme').has('planSeulement')).toBe(false);
    expect(createInitialForm(PROFILE, { type: 'sequence' }).planSeulement).toBe(false);
  });

  it('la demande passe la validation partagée sans perte', () => {
    const req = buildGenerationRequest(sequence(), 'sequence', PROFILE, [], 'documents');
    expect(validateGenerationRequest(JSON.parse(JSON.stringify(req)))).toMatchObject({ planSeulement: true, nombreSeances: 6 });
  });

  it('grosse séquence : à partir de 5 séances, ou d’une durée très longue (texte libre, jamais d’effet sur la demande)', () => {
    expect(PLAN_ADVICE_MIN_SEANCES).toBe(5);
    expect(isLargeSequence('', '')).toBe(false);
    expect(isLargeSequence(4, '')).toBe(false);
    expect(isLargeSequence(5, '')).toBe(true);
    expect(isLargeSequence(12, '45 min')).toBe(true);
    for (const duree of ['3 semaines', '4 sem.', '10 heures', '12h', 'un mois', '1 mois', 'un trimestre', 'le semestre', 'toute l’année', 'Année scolaire', '3 Semaines']) {
      expect(isLargeSequence('', duree), duree).toBe(true);
    }
    for (const duree of ['55 minutes', '2 semaines', '1 semaine', '2 heures', '9h', '1h30', '45 min', 'moisson', 'trimestriel', 'une séance', 'x'.repeat(500)]) {
      expect(isLargeSequence('', duree), duree).toBe(false);
    }
    // Texte démesuré : bornée, jamais de lenteur.
    const start = performance.now();
    isLargeSequence('', `${' '.repeat(200_000)}3 semaines`);
    isLargeSequence('', `${'1'.repeat(200_000)} h`);
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe('appréciations', () => {
  it('transmet exactement N, borné entre 1 et 40', () => {
    const form = fullForm('appreciations', '4eme');
    expect(buildGenerationRequest({ ...form, nombreAppreciations: '12' }, 'appreciations', PROFILE, [], 'documents').nombreAppreciations).toBe(12);
    expect(buildGenerationRequest({ ...form, nombreAppreciations: '55' }, 'appreciations', PROFILE, [], 'documents').nombreAppreciations).toBe(40);
    expect(buildGenerationRequest({ ...form, nombreAppreciations: '0' }, 'appreciations', PROFILE, [], 'documents').nombreAppreciations).toBe(1);
    const req = buildGenerationRequest({ ...form, nombreAppreciations: '7' }, 'appreciations', PROFILE, [], 'documents');
    expect(req.trimestre).toBe('2');
    expect(req.profilEleve).toBe('fragile');
  });

  it('livret scolaire (bac) : appréciation annuelle, ni trimestre affiché ni transmis ; la matière reste', () => {
    expect(visibleFields('appreciations', 'terminale_gen', 'mathematiques', 'livret_bac').has('trimestre')).toBe(false);
    expect(visibleFields('appreciations', 'terminale_gen', 'mathematiques', 'livret_bac').has('modalite')).toBe(true);
    const form: GenerateForm = { ...fullForm('appreciations', 'terminale_gen'), matiere: 'mathematiques', modalite: 'livret_bac', trimestre: '1' };
    const req = buildGenerationRequest(form, 'appreciations', PROFILE, [], 'documents');
    expect(req.modalite).toBe('livret_bac');
    expect(req).not.toHaveProperty('trimestre');
    expect(req.matiere).toBe('mathematiques');
    expect(req.profilEleve).toBe('fragile');
    expect(validateGenerationRequest(JSON.parse(JSON.stringify(req))).trimestre).toBeUndefined();
    // Retour au bulletin : le trimestre saisi réapparaît et repart.
    expect(buildGenerationRequest({ ...form, modalite: '' }, 'appreciations', PROFILE, [], 'documents').trimestre).toBe('1');
  });

  it('conseil de classe : trimestre et matière gardés ; livret gardé d’un autre niveau : le trimestre reste', () => {
    const conseil: GenerateForm = { ...fullForm('appreciations', '4eme'), matiere: 'mathematiques', modalite: 'conseil_classe' };
    const req = buildGenerationRequest(conseil, 'appreciations', PROFILE, [], 'documents');
    expect(req.modalite).toBe('conseil_classe');
    expect(req.trimestre).toBe('2');
    expect(req.matiere).toBe('mathematiques');
    // Le livret scolaire n'existe pas en 4e : format ignoré, rien n'est masqué.
    expect(visibleFields('appreciations', '4eme', 'mathematiques', 'livret_bac').has('trimestre')).toBe(true);
    const stale = buildGenerationRequest({ ...conseil, modalite: 'livret_bac' }, 'appreciations', PROFILE, [], 'documents');
    expect(stale).not.toHaveProperty('modalite');
    expect(stale.trimestre).toBe('2');
    // Sans matière connue, le format n'est pas vérifiable : rien n'est masqué.
    expect(visibleFields('appreciations', 'terminale_gen', undefined, 'livret_bac').has('trimestre')).toBe(true);
  });

  it('le champ peut être vidé sans revenir à 10', () => {
    expect(appreciationCount('')).toBeNull();
    expect(normalizeAppreciationInput('')).toBe('');
    expect(normalizeAppreciationInput('55')).toBe('40');
    expect(normalizeAppreciationInput('0')).toBe('1');
    expect(normalizeAppreciationInput('3.6')).toBe('4');
    const problems = validateForm({ ...fullForm('appreciations', '4eme'), nombreAppreciations: '' });
    expect(problems.map(p => p.field)).toContain('nombreAppreciations');
  });

  it('texte exact « Magistra rédigera N appréciations »', () => {
    expect(appreciationSummary('12', false)).toBe('Magistra rédigera 12 appréciations');
    expect(appreciationSummary('1', false)).toBe('Magistra rédigera 1 appréciation');
    expect(appreciationSummary('55', false)).toBe('Magistra rédigera 40 appréciations (maximum 40)');
    expect(appreciationSummary('8', true)).toBe('Magistra rédigera 8 commentaires');
    expect(appreciationSummary('', false)).toBe('Indiquez un nombre entre 1 et 40.');
  });
});

describe('différenciation', () => {
  it('profils cochés (ordre canonique) + contenu à adapter', () => {
    const form: GenerateForm = {
      ...fullForm('differenciation', '5eme'),
      profilsDifferenciation: ['approfondissement', 'renforce'],
      contenuSource: 'Exercice 1\nExercice 2',
    };
    const req = buildGenerationRequest(form, 'differenciation', PROFILE, [], 'documents');
    expect(req.profilsDifferenciation).toEqual(['renforce', 'approfondissement']);
    expect(req.contenuSource).toBe('Exercice 1\nExercice 2');
    expect(req.sujet).toBe('Un sujet');
  });

  it('au moins un profil ; sujet OU contenu à adapter', () => {
    const base = fullForm('differenciation', '5eme');
    expect(validateForm({ ...base, profilsDifferenciation: [] }).map(p => p.field)).toContain('profilsDifferenciation');
    expect(validateForm({ ...base, sujet: '', contenuSource: '' }).map(p => p.field)).toContain('contenuSource');
    expect(validateForm({ ...base, sujet: '', contenuSource: 'Exercice' })).toEqual([]);
  });
});

describe('supérieur : discipline et format', () => {
  it('discipline + format transmis quand l’outil les prévoit', () => {
    const form: GenerateForm = { ...fullForm('cours', 'master_1'), discipline: "Systèmes d'information", format: 'cm' };
    const req = buildGenerationRequest(form, 'cours', PROFILE, [], 'documents');
    expect(req.discipline).toBe("Systèmes d'information");
    expect(req.format).toBe('cm');
  });

  it('format jamais transmis pour un outil qui ne le prévoit pas', () => {
    const req = buildGenerationRequest(fullForm('evaluation', 'licence_2'), 'evaluation', PROFILE, [], 'documents');
    expect(req).not.toHaveProperty('format');
  });

  it('aucun format par défaut', () => {
    const initial = createInitialForm(PROFILE);
    expect(initial.format).toBe('');
    expect(buildGenerationRequest(initial, 'cours', PROFILE, [], 'documents')).not.toHaveProperty('format');
  });

  it('champs visibles selon le niveau', () => {
    expect(visibleFields('cours', 'master_2').has('discipline')).toBe(true);
    expect(visibleFields('cours', 'master_2').has('format')).toBe(true);
    expect(visibleFields('cours', '3eme').has('format')).toBe(false);
    expect(visibleFields('appreciations', 'licence_1').has('trimestre')).toBe(false);
    expect(visibleFields('appreciations', 'cm2').has('trimestre')).toBe(true);
  });
});

describe('documents et mode de recherche', () => {
  const cases: [ResearchMode, boolean][] = [
    ['documents', true], ['academic', true], ['internet', false], ['documents_internet', true],
  ];
  for (const [mode, expected] of cases) {
    it(`${mode} : documents ${expected ? 'transmis' : 'jamais transmis'}`, () => {
      const req = buildGenerationRequest(fullForm('cours', 'licence_3'), 'cours', PROFILE, PASSAGES, mode);
      expect(req.researchMode).toBe(mode);
      if (expected) expect(req.documents).toEqual(PASSAGES);
      else expect(req).not.toHaveProperty('documents');
    });
  }

  it('sans document : pas de clé documents', () => {
    expect(buildGenerationRequest(fullForm('cours', '4eme'), 'cours', PROFILE, [], 'documents')).not.toHaveProperty('documents');
  });

  it('respecte les limites du serveur (nombre et taille des extraits)', () => {
    const many: DocumentPassage[] = Array.from({ length: 90 }, (_, i) => ({
      docId: 'd', docName: 'notes.md', kind: 'md', locator: { type: 'section', start: i, end: i, title: `S${i}` }, text: `Section ${i} gouvernance`,
    }));
    const fitted = fitPassagesToLimits(many, 'gouvernance');
    expect(fitted.length).toBe(REQUEST_LIMITS.maxPassages);
    const long: DocumentPassage[] = [{ ...PASSAGES[0], text: 'x'.repeat(REQUEST_LIMITS.passageChars + 500) }];
    expect(fitPassagesToLimits(long, 'x')[0].text.length).toBe(REQUEST_LIMITS.passageChars);
    const req = buildGenerationRequest(fullForm('cours', 'licence_3'), 'cours', PROFILE, many, 'documents');
    expect(() => validateGenerationRequest(JSON.parse(JSON.stringify(req)))).not.toThrow();
  });

  it('requête de sélection des passages = sujet + discipline + objectifs + consignes', () => {
    const form: GenerateForm = { ...fullForm('cours', 'master_1'), sujet: 'Gouvernance', discipline: 'SI', objectifs: 'COBIT', consignes: 'ITIL' };
    expect(buildPassageQuery(form)).toBe('Gouvernance SI COBIT ITIL');
    // Collège : pas de discipline ; lettre : pas de sujet.
    expect(buildPassageQuery({ ...form, niveau: '4eme' })).toBe('Gouvernance COBIT ITIL');
    expect(buildPassageQuery({ ...form, niveau: '4eme', type: 'lettre_parents' })).toBe('ITIL');
  });
});

describe('profil enseignant', () => {
  it('transmis dans la requête', () => {
    const req = buildGenerationRequest(fullForm('lettre_parents', '4eme'), 'lettre_parents', PROFILE, [], 'documents');
    expect(req.profile).toEqual(PROFILE);
    expect(buildGenerationRequest(fullForm('cours', '4eme'), 'cours', null, [], 'documents').profile).toBeNull();
  });

  it('valeurs par défaut issues du profil', () => {
    const form = createInitialForm(PROFILE, {}, new Date(2026, 9, 5));
    expect(form.niveau).toBe('master_1');
    expect(form.matiere).toBe('systemes_information');
    expect(form.discipline).toBe('Gouvernance des SI');
    expect(form.difficulte).toBe('');
    expect(form.trimestre).toBe('1');
    expect(form.nombreAppreciations).toBe('10');
  });

  it('matière du profil indisponible au niveau : première matière du niveau', () => {
    const form = createInitialForm({ ...PROFILE, niveaux: ['cp'], matierePrincipale: 'philosophie' });
    expect(getMatieresForNiveau('cp').map(m => m.value)).toContain(form.matiere);
  });
});

describe('paramètres d’URL et changement de niveau', () => {
  it('?type= invalide → cours ; ?sujet= prérempli', () => {
    expect(resolveInitialType('pirate')).toBe('cours');
    expect(resolveInitialType(null)).toBe('cours');
    expect(resolveInitialType('corrige')).toBe('corrige');
    expect(resolveInitialSujet('  Les fractions ')).toBe('Les fractions');
    expect(resolveInitialSujet('x'.repeat(500)).length).toBe(REQUEST_LIMITS.sujet);
    const form = createInitialForm(PROFILE, { type: '<script>', sujet: 'La Révolution' });
    expect(form.type).toBe('cours');
    expect(form.sujet).toBe('La Révolution');
  });

  it('matière réinitialisée si absente au nouveau niveau, conservée sinon', () => {
    const form = createInitialForm(PROFILE);
    const toCp = withNiveau({ ...form, matiere: 'philosophie' }, 'cp', PROFILE);
    expect(getMatieresForNiveau('cp').map(m => m.value)).toContain(toCp.matiere);
    const kept = withNiveau({ ...form, matiere: 'mathematiques' }, '3eme', PROFILE);
    expect(kept.matiere).toBe('mathematiques');
  });

  it('trimestre par défaut selon la date', () => {
    expect(defaultTrimestre(new Date(2026, 9, 1))).toBe('1');
    expect(defaultTrimestre(new Date(2027, 0, 15))).toBe('2');
    expect(defaultTrimestre(new Date(2027, 4, 15))).toBe('3');
  });
});

describe('validation du formulaire', () => {
  it('sujet obligatoire pour les outils de création', () => {
    expect(validateForm({ ...fullForm('cours', '4eme'), sujet: ' ' }).map(p => p.field)).toEqual(['sujet']);
    expect(validateForm({ ...fullForm('progression', '4eme'), sujet: '' })).toEqual([]);
  });

  it('corrigé : travail à corriger obligatoire', () => {
    expect(validateForm({ ...fullForm('corrige', '4eme'), texteEleve: '' }).map(p => p.field)).toEqual(['texteEleve']);
  });

  it('textes trop longs signalés (pas de troncature silencieuse)', () => {
    const problems = validateForm({ ...fullForm('corrige', '4eme'), texteEleve: 'a'.repeat(REQUEST_LIMITS.texteEleve + 1) });
    expect(problems.map(p => p.field)).toEqual(['texteEleve']);
  });
});

describe('requête de sélection des passages : texte à adapter, copie, poids du sujet (constats 35 et 41)', () => {
  const STOMATES = 'Exercice : calculer le nombre de stomates sur une feuille de 40 cm² (densité 250/mm²)';
  const vide = { sujet: '', objectifs: '', consignes: '', discipline: '' };
  const svt = (type: TypeContenu, extra: Partial<GenerateForm>): GenerateForm => ({ ...fullForm(type, '2nde_gt'), matiere: 'svt', ...vide, ...extra });

  it('différenciation sans sujet : le texte à adapter décrit la recherche (avant : « SVT »)', () => {
    // AVANT : la requête se réduisait au libellé de la matière.
    expect(buildPassageQuery(svt('differenciation', { contenuSource: '' }))).toBe('SVT');
    const query = buildPassageQuery(svt('differenciation', { contenuSource: STOMATES }));
    expect(query).toContain('stomates');
    expect(query).toBe(STOMATES);
  });

  it('correction sans sujet : le début de la copie complète la requête, limité à 300 caractères et sans mise en forme', () => {
    const copie = `La photosynthèse\n\n   permet aux plantes de fabriquer du glucose. ${'blabla '.repeat(200)}`;
    const query = buildPassageQuery(svt('corrige', { texteEleve: copie }));
    expect(query.startsWith('La photosynthèse permet aux plantes de fabriquer du glucose.')).toBe(true);
    expect(query.length).toBeLessThanOrEqual(300);
    expect(query).not.toContain('\n');
  });

  it('sujet et objectifs suffisants (40 caractères ou plus) : requête inchangée', () => {
    const sujet = 'La photosynthèse et les échanges gazeux de la feuille';
    expect(buildPassageQuery(svt('differenciation', { sujet, contenuSource: STOMATES }))).toBe(sujet);
    // Sujet de 40 caractères exactement : pas de complément.
    const quarante = 'Les échanges gazeux au niveau des feuill';
    expect(quarante).toHaveLength(40);
    expect(buildPassageQuery(svt('differenciation', { sujet: quarante, contenuSource: STOMATES }))).toBe(quarante);
    // Sujet court : le texte à adapter vient après lui.
    expect(buildPassageQuery(svt('differenciation', { sujet: 'Stomates', contenuSource: STOMATES }))).toBe(`Stomates ${STOMATES}`);
  });

  it('un outil qui n’affiche pas le champ n’utilise jamais ce texte', () => {
    expect(buildPassageQuery(svt('cours', { contenuSource: STOMATES, texteEleve: STOMATES }))).toBe('SVT');
    expect(buildPassageQuery(svt('differenciation', { contenuSource: '', texteEleve: 'Copie de l’élève sur les stomates' }))).toBe('SVT');
  });

  it('requête pondérée : le sujet pèse plus que les objectifs et les consignes', () => {
    const form: GenerateForm = { ...fullForm('cours', 'master_1'), sujet: 'Gouvernance', discipline: 'SI', objectifs: 'COBIT', consignes: 'ITIL' };
    expect(buildWeightedPassageQuery(form)).toEqual([
      { text: 'Gouvernance', weight: 3 }, { text: 'SI', weight: 1.5 }, { text: 'COBIT', weight: 1 }, { text: 'ITIL', weight: 1 },
    ]);
    expect(buildWeightedPassageQuery({ ...form, sujet: '', discipline: '', objectifs: '', consignes: '' })).toEqual([{ text: getMatiereLabel(form.matiere), weight: 1 }]);
  });

  it('deux documents au-delà du budget : la page des stomates est choisie (avant : la page 1 par ordre de lecture)', () => {
    const doc = (id: string, name: string, pages: string[]) => ({
      id, name, kind: 'pdf' as const, warnings: [], stats: { chars: 0 },
      units: pages.map((text, i) => ({ locator: { type: 'pages' as const, start: i + 1, end: i + 1 }, text })),
    });
    const docs = [doc('svt', 'cours_svt.pdf', SVT_COURSE_PAGES), doc('hist', 'cours_histoire.pdf', HISTOIRE_COURSE_PAGES)];
    const pagesOf = (query: string | readonly QueryPart[]) => selectPassages(docs, query, { budgetChars: 1_800 })
      .filter(p => p.docId === 'svt')
      .flatMap(p => Array.from({ length: p.locator.end - p.locator.start + 1 }, (_, i) => p.locator.start + i));
    expect(pagesOf('SVT')).not.toContain(2);
    expect(pagesOf(buildWeightedPassageQuery(svt('differenciation', { contenuSource: STOMATES })))).toContain(2);
  });

  it('au-delà des limites du serveur, les passages gardés sont ceux de la requête pondérée', () => {
    const passages: DocumentPassage[] = Array.from({ length: REQUEST_LIMITS.maxPassages + 5 }, (_, i) => ({
      docId: 'd', docName: 'cours.pdf', kind: 'pdf', locator: { type: 'pages', start: i + 1, end: i + 1 },
      text: i === 61 ? 'Les stomates de la feuille assurent les échanges gazeux.' : `Page ${i + 1} : les élèves doivent savoir expliquer cette séance.`,
    }));
    const kept = fitPassagesToLimits(passages, [{ text: 'Les échanges gazeux et les stomates', weight: 3 }, { text: 'Les élèves doivent savoir expliquer la séance', weight: 1 }]);
    expect(kept).toHaveLength(REQUEST_LIMITS.maxPassages);
    expect(kept.map(p => p.locator.start)).toContain(62);
  });
});
