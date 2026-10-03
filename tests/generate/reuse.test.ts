import { describe, expect, it } from 'vitest';
import { describeRecordParams, formFromRecord, isPlanFirst, reusedFromState, type ReusableRecord } from '@/lib/generation/reuse';
import type { TeacherProfile } from '@shared/types';

const PROFILE: TeacherProfile = { displayName: 'M. Test', etablissement: 'Collège', cycle: 'college', niveaux: ['4eme'], matierePrincipale: 'francais' };

const RECORD: ReusableRecord = {
  type: 'appreciations',
  niveau: '3eme',
  matiere: 'histoire_geo',
  sujet: 'Bulletin du 2e trimestre',
  params: {
    researchMode: 'documents',
    trimestre: '2',
    profilEleve: 'fragile',
    nombreAppreciations: 7,
    consignes: 'Ton bienveillant',
    documents: ['notes.pdf'],
  },
};

describe('historique : paramètres et reprise d’une demande', () => {
  it('paramètres enregistrés affichés en clair (seulement ceux qui existent)', () => {
    const rows = Object.fromEntries(describeRecordParams(RECORD).map(r => [r.label, r.value]));
    expect(rows).toMatchObject({ Trimestre: '2e trimestre', 'Nombre demandé': '7', Consignes: 'Ton bienveillant', Documents: 'notes.pdf' });
    expect(rows.Profil).toBeTruthy();
    expect(rows).not.toHaveProperty('Durée');
  });

  it('formulaire prérempli fidèlement ; documents à rajouter signalés', () => {
    const { form, researchMode, notes } = formFromRecord(RECORD, PROFILE);
    expect(form).toMatchObject({
      type: 'appreciations', niveau: '3eme', matiere: 'histoire_geo', sujet: 'Bulletin du 2e trimestre',
      trimestre: '2', profilEleve: 'fragile', nombreAppreciations: '7', consignes: 'Ton bienveillant', texteEleve: '',
    });
    expect(researchMode).toBe('documents');
    expect(notes).toEqual(['Ajoutez à nouveau vos documents si nécessaire : notes.pdf.']);
  });

  it('corrigé : le travail d’élève n’étant pas conservé, il faut le recoller', () => {
    const { form, notes } = formFromRecord({ ...RECORD, type: 'corrige', params: { texteEleveLength: 1200 } }, PROFILE);
    expect(form.texteEleve).toBe('');
    expect(notes[0]).toMatch(/collez-le à nouveau/);
    expect(describeRecordParams({ ...RECORD, params: { texteEleveLength: 1200 } })[0].value).toMatch(/non conservé/);
  });

  it('valeurs stockées invalides ou hostiles : ignorées, jamais injectées dans le formulaire', () => {
    const { form, researchMode } = formFromRecord({
      type: 'inconnu' as never,
      niveau: 'niveau-bidon',
      matiere: '<script>',
      sujet: 'x'.repeat(5_000),
      params: { researchMode: 'tout', trimestre: '9', profilEleve: 'pirate', difficulte: 42, profilsDifferenciation: ['x'] },
    }, PROFILE);
    expect(form.type).toBe('cours');
    expect(form.niveau).toBe('4eme');
    expect(form.sujet.length).toBeLessThanOrEqual(300);
    expect(form.difficulte).toBe('');
    expect(form.profilsDifferenciation.length).toBeGreaterThan(0);
    expect(researchMode).toBeNull();
  });
});

describe('historique : options des outils (formats normés, notation, corrigé, nombres, ton, besoins)', () => {
  const EXERCICES: ReusableRecord = {
    type: 'exercices',
    niveau: '1ere_gen',
    matiere: 'francais',
    sujet: 'Le roman',
    params: { modalite: 'dissertation', bareme: 'sur10', sansCorrige: true, nombreExercices: 3 },
  };

  it('affichées en clair, sous le libellé propre à l’outil', () => {
    const rows = Object.fromEntries(describeRecordParams(EXERCICES).map(r => [r.label, r.value]));
    expect(rows).toMatchObject({ 'Type d’exercice': 'Dissertation', Notation: 'Sur 10', Corrigé: 'non (version élève seule)' });
    // Une dissertation est un seul sujet : pas de nombre d'exercices ; un QCM compte des questions.
    expect(rows).not.toHaveProperty("Nombre d'exercices");
    const qcm = describeRecordParams({ ...EXERCICES, params: { modalite: 'qcm', nombreExercices: 10 } });
    expect(Object.fromEntries(qcm.map(r => [r.label, r.value]))).toMatchObject({ 'Type d’exercice': 'QCM', 'Nombre de questions': '10' });
    const plain = describeRecordParams({ ...EXERCICES, params: { nombreExercices: 5 } });
    expect(Object.fromEntries(plain.map(r => [r.label, r.value]))).toMatchObject({ "Nombre d'exercices": '5' });
    const seq = describeRecordParams({ type: 'sequence', niveau: '4eme', matiere: 'svt', sujet: 'Cellule', params: { nombreSeances: 6, modalite: 'investigation' } });
    expect(Object.fromEntries(seq.map(r => [r.label, r.value]))).toMatchObject({ 'Nombre de séances': '6', 'Démarche de la séquence': 'Démarche d’investigation' });
  });

  it('reprises dans le formulaire ; valeurs inconnues ou hors bornes ignorées', () => {
    const { form } = formFromRecord(EXERCICES, PROFILE);
    expect(form).toMatchObject({ modalite: 'dissertation', bareme: 'sur10', sansCorrige: true, nombreExercices: 3 });
    const odd = formFromRecord({
      ...EXERCICES,
      params: { modalite: 'format_futur', bareme: 'sur100', nombreExercices: 99, besoins: ['dys', 'x'], ton: 'agressif' },
    }, PROFILE).form;
    expect(odd).toMatchObject({ modalite: '', bareme: '', nombreExercices: '', besoins: ['dys'], ton: '', sansCorrige: false });
  });
});

describe('historique : séquence demandée en deux temps (« Plan d’abord »)', () => {
  const PLAN: ReusableRecord = {
    type: 'sequence', niveau: '4eme', matiere: 'histoire_geo', sujet: 'La Révolution française',
    params: { nombreSeances: 6, planSeulement: true, researchMode: 'documents' },
  };

  it('paramètres : « Plan d’abord : oui » après le nombre de séances', () => {
    const rows = describeRecordParams(PLAN);
    expect(rows.find(r => r.label === "Plan d'abord")).toEqual({ label: "Plan d'abord", value: 'oui' });
    expect(rows.map(r => r.label).indexOf("Plan d'abord")).toBe(rows.map(r => r.label).indexOf('Nombre de séances') + 1);
    // Séquence complète, ou enregistrement sans l'option : aucune ligne.
    expect(describeRecordParams({ ...PLAN, params: { nombreSeances: 6 } }).map(r => r.label)).not.toContain("Plan d'abord");
    expect(describeRecordParams({ ...PLAN, params: { planSeulement: false } }).map(r => r.label)).not.toContain("Plan d'abord");
  });

  it('« Reprendre cette demande » : la case « Commencer par le plan » est cochée, avec le reste de la demande', () => {
    const { form, researchMode } = formFromRecord(PLAN, PROFILE);
    expect(form).toMatchObject({ type: 'sequence', nombreSeances: 6, planSeulement: true, sujet: 'La Révolution française' });
    expect(researchMode).toBe('documents');
    // Reprise d'une séquence complète : case décochée.
    expect(formFromRecord({ ...PLAN, params: { nombreSeances: 6 } }, PROFILE).form.planSeulement).toBe(false);
  });

  it('valeur enregistrée inattendue ou pour un autre outil : ignorée', () => {
    for (const value of ['true', 1, 'oui', null, {}, [], false]) {
      expect(isPlanFirst({ type: 'sequence', params: { planSeulement: value } }), String(value)).toBe(false);
      expect(formFromRecord({ ...PLAN, params: { planSeulement: value } }, PROFILE).form.planSeulement).toBe(false);
    }
    expect(isPlanFirst({ type: 'cours', params: { planSeulement: true } })).toBe(false);
    expect(describeRecordParams({ ...PLAN, type: 'cours' }).map(r => r.label)).not.toContain("Plan d'abord");
    expect(formFromRecord({ ...PLAN, type: 'cours' }, PROFILE).form.planSeulement).toBe(false);
    expect(isPlanFirst({ type: 'sequence', params: undefined as never })).toBe(false);
  });
});

describe('page « Générer » : formulaire à préremplir reçu dans l’état du routeur', () => {
  const RECORD: ReusableRecord = { type: 'fiche_prep', niveau: '4eme', matiere: 'histoire_geo', sujet: 'La Révolution — séance 2', params: { consignes: 'Respecte ce plan.' } };

  it('demande reprise, avec ou sans phrase de rappel propre à son origine', () => {
    const plain = reusedFromState({ reuse: RECORD }, PROFILE)!;
    expect(plain.form).toMatchObject({ type: 'fiche_prep', sujet: 'La Révolution — séance 2', consignes: 'Respecte ce plan.' });
    expect(plain.notice).toBeUndefined();
    expect(reusedFromState({ reuse: RECORD, reuseNotice: 'Demande préparée à partir du plan.' }, PROFILE)?.notice).toBe('Demande préparée à partir du plan.');
    expect(reusedFromState({ reuse: RECORD, reuseNotice: '   ' }, PROFILE)?.notice).toBeUndefined();
    expect(reusedFromState({ reuse: RECORD, reuseNotice: 42 }, PROFILE)?.notice).toBeUndefined();
    expect(reusedFromState({ reuse: RECORD, reuseNotice: 'x'.repeat(2_000) }, PROFILE)?.notice).toHaveLength(500);
  });

  it('état absent ou illisible : rien à reprendre, jamais d’exception', () => {
    for (const state of [null, undefined, 'texte', 42, {}, { reuse: null }, { reuse: 'x' }, { reuse: {} }, { reuse: { type: 'cours' } }, { reuse: { sujet: 'S' } }, []]) {
      expect(reusedFromState(state, PROFILE), JSON.stringify(state)).toBeNull();
    }
  });
});
