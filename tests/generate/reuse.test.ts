import { describe, expect, it } from 'vitest';
import { describeRecordParams, formFromRecord, type ReusableRecord } from '@/lib/generation/reuse';
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
