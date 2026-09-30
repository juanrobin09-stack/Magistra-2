import { describe, expect, it } from 'vitest';
import { ALL_TYPES, getMatieresForNiveau, TOOL_FIELDS, type TypeContenu } from '@shared/catalog';
import type { NiveauScolaire } from '@shared/levels';
import type { DocumentPassage, GenerationRequest, ResearchMode, TeacherProfile } from '@shared/types';
import { REQUEST_LIMITS, validateGenerationRequest } from '@shared/validation';
import {
  appreciationCount, appreciationSummary, buildGenerationRequest, buildPassageQuery, createInitialForm, defaultTrimestre,
  fitPassagesToLimits, normalizeAppreciationInput, resolveInitialSujet, resolveInitialType, validateForm, visibleFields,
  withNiveau, type GenerateForm,
} from '@/lib/generation/request';

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

  it('matière absente au niveau : remplacée par une matière valide', () => {
    const form: GenerateForm = { ...fullForm('cours', 'cp'), matiere: 'philosophie' };
    const req = buildGenerationRequest(form, 'cours', PROFILE, [], 'documents');
    expect(getMatieresForNiveau('cp').map(m => m.value)).toContain(req.matiere);
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
