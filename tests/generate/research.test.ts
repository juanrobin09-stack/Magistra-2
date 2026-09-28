import { describe, expect, it } from 'vitest';
import type { Capabilities } from '@shared/types';
import {
  ACADEMIC_ONLY_NOTE, describeResearchOptions, DEMO_RESEARCH_NOTE, effectiveResearchMode, LOCAL_PRIVACY_NOTE, NETWORK_PRIVACY_NOTE,
  NO_INTERNET_LOCAL_NOTE, NO_INTERNET_SERVER_NOTE, privacyNotes, researchHints, WEB_LIMITED_ACADEMIC_NOTE, WEB_LIMITED_NOTE,
  WEB_LIMITED_SCOLAIRE_LOCAL_NOTE, WEB_LIMITED_SCOLAIRE_SERVER_NOTE,
} from '@/lib/generation/research';

function caps(partial: Omit<Partial<Capabilities>, 'research'> & { research?: Partial<Capabilities['research']> } = {}): Capabilities {
  return {
    maxDocumentChars: 40_000,
    engineLabel: 'Moteur',
    ready: true,
    privacy: { level: 'local', message: 'Tout reste sur cet ordinateur.' },
    ...partial,
    research: { academic: true, web: true, institutional: true, wikipedia: true, ...partial.research },
  };
}

describe('modes de recherche', () => {
  it('démonstration : seule « Mes documents uniquement » est disponible', () => {
    const options = describeResearchOptions(caps({ research: { academic: false, web: false, institutional: false } }), 'demo', 'licence_1');
    expect(options.map(o => o.value)).toEqual(['documents', 'academic', 'internet', 'documents_internet']);
    expect(options.filter(o => o.available).map(o => o.value)).toEqual(['documents']);
    expect(options[1].note).toBe(DEMO_RESEARCH_NOTE);
    expect(effectiveResearchMode('internet', options)).toBe('documents');
  });

  it('aucun moteur web : Internet limité à Wikipédia (+ académique dans le supérieur)', () => {
    const c = caps({ research: { web: false, academic: true } });
    const sup = describeResearchOptions(c, 'local', 'master_1');
    expect(sup.find(o => o.value === 'internet')?.note).toBe('Internet : Wikipédia et sources académiques seulement (aucun moteur web configuré)');
    expect(sup.find(o => o.value === 'internet')?.note).toBe(WEB_LIMITED_ACADEMIC_NOTE);
    expect(sup.find(o => o.value === 'internet')?.available).toBe(true);
    const college = describeResearchOptions(c, 'web', '4eme');
    expect(college.find(o => o.value === 'documents_internet')?.note).toBe(WEB_LIMITED_SCOLAIRE_SERVER_NOTE);
    // Scolaire : l'absence d'Éduscol / BO est dite explicitement ; supérieur sans académique : Wikipédia seul.
    expect(describeResearchOptions(c, 'local', 'cm2').find(o => o.value === 'internet')?.note).toBe(WEB_LIMITED_SCOLAIRE_LOCAL_NOTE);
    const licenceNoAcademic = describeResearchOptions(caps({ research: { web: false, academic: false } }), 'web', 'licence_1');
    expect(licenceNoAcademic.find(o => o.value === 'internet')?.note).toBe(WEB_LIMITED_NOTE);
  });

  it('Wikipédia désactivé et aucun moteur web : Internet indisponible (ou académique seul dans le supérieur)', () => {
    const c = caps({ research: { web: false, wikipedia: false, academic: true } });
    const college = describeResearchOptions(c, 'local', '4eme');
    expect(college.find(o => o.value === 'internet')).toMatchObject({ available: false, note: NO_INTERNET_LOCAL_NOTE });
    expect(effectiveResearchMode('documents_internet', college)).toBe('documents');
    expect(describeResearchOptions(c, 'web', '4eme').find(o => o.value === 'internet')?.note).toBe(NO_INTERNET_SERVER_NOTE);
    const master = describeResearchOptions(c, 'local', 'master_1');
    expect(master.find(o => o.value === 'internet')).toMatchObject({ available: true, note: ACADEMIC_ONLY_NOTE });
    expect(master.find(o => o.value === 'internet')?.note).not.toMatch(/Wikipédia et/);
  });

  it('moteur web configuré : pas de restriction affichée', () => {
    const options = describeResearchOptions(caps(), 'web', 'licence_2');
    expect(options.every(o => o.available && !o.note)).toBe(true);
  });

  it('recherche académique désactivée : mode indisponible, retour aux documents', () => {
    const options = describeResearchOptions(caps({ research: { academic: false } }), 'local', 'doctorat');
    expect(options.find(o => o.value === 'academic')?.available).toBe(false);
    expect(effectiveResearchMode('academic', options)).toBe('documents');
    expect(effectiveResearchMode('internet', options)).toBe('internet');
  });

  it('capacités inconnues : tout reste sélectionnable', () => {
    expect(describeResearchOptions(null, 'web', '4eme').every(o => o.available)).toBe(true);
  });
});

describe('indications', () => {
  const options = describeResearchOptions(caps(), 'local', 'master_2');

  it('documents ajoutés + mode Internet : documents non utilisés', () => {
    expect(researchHints('internet', 2, 'master_2', options).documentsIgnored).toBe(true);
    expect(researchHints('documents_internet', 2, 'master_2', options).documentsIgnored).toBe(false);
    expect(researchHints('internet', 0, 'master_2', options).documentsIgnored).toBe(false);
  });

  it('Master / Doctorat sans document : suggérer les sources académiques', () => {
    expect(researchHints('documents', 0, 'master_2', options).suggestAcademic).toBe(true);
    expect(researchHints('documents', 0, 'doctorat', options).suggestAcademic).toBe(true);
    expect(researchHints('documents', 1, 'master_2', options).suggestAcademic).toBe(false);
    expect(researchHints('documents', 0, 'licence_3', options).suggestAcademic).toBe(false);
    const noAcademic = describeResearchOptions(caps({ research: { academic: false } }), 'local', 'master_2');
    expect(researchHints('documents', 0, 'master_2', noAcademic).suggestAcademic).toBe(false);
  });
});

describe('confidentialité', () => {
  it('message du moteur + note locale uniquement si tout reste sur l’ordinateur', () => {
    const local = privacyNotes(caps(), 'documents');
    expect(local.message).toBe('Tout reste sur cet ordinateur.');
    expect(local.local).toBe(LOCAL_PRIVACY_NOTE);
    expect(local.network).toBeNull();

    const server = privacyNotes(caps({ privacy: { level: 'server', message: 'Transmis au serveur.' } }), 'documents');
    expect(server.local).toBeNull();
    const remote = privacyNotes(caps({ privacy: { level: 'remote', message: 'Serveur distant.' } }), 'documents');
    expect(remote.local).toBeNull();
  });

  it('mode réseau : seuls le sujet et les mots-clés partent vers la recherche', () => {
    for (const mode of ['academic', 'internet', 'documents_internet'] as const) {
      expect(privacyNotes(caps(), mode).network).toBe(NETWORK_PRIVACY_NOTE);
    }
    expect(NETWORK_PRIVACY_NOTE).toBe(
      'La recherche en ligne transmet uniquement votre sujet et vos mots-clés (jamais vos documents) aux services de recherche.',
    );
  });
});

describe('indications en démonstration', () => {
  it('pas d’avertissement « connaissances du modèle » (aucun modèle en démo)', () => {
    const options = describeResearchOptions(null, 'demo', '4eme');
    expect(researchHints('documents', 0, '4eme', options, 'demo').modelOnly).toBe(false);
    expect(researchHints('documents', 0, '4eme', options, 'web').modelOnly).toBe(true);
  });
});
