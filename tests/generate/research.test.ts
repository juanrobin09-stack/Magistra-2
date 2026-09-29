import { describe, expect, it } from 'vitest';
import type { Capabilities } from '@shared/types';
import {
  ACADEMIC_DISABLED_CONNECTOR_NOTE, ACADEMIC_DISABLED_LOCAL_NOTE, ACADEMIC_ONLY_NOTE, describeResearchOptions, DEMO_RESEARCH_NOTE,
  DOCUMENTS_ONLY_ONLINE_DESCRIPTION, effectiveResearchMode, LOCAL_CONNECTOR_NETWORK_NOTE, NO_INTERNET_CONNECTOR_NOTE,
  WEB_LIMITED_SCOLAIRE_CONNECTOR_NOTE,
  LOCAL_CONNECTOR_PRIVACY_MESSAGE, LOCAL_PRIVACY_NOTE, NETWORK_PRIVACY_NOTE, NO_INTERNET_LOCAL_NOTE, NO_INTERNET_SERVER_NOTE,
  privacyNotes, researchHints, WEB_LIMITED_ACADEMIC_NOTE, WEB_LIMITED_NOTE, WEB_LIMITED_SCOLAIRE_LOCAL_NOTE,
  WEB_LIMITED_SCOLAIRE_SERVER_NOTE,
} from '@/lib/generation/research';
import { UNVERIFIED_PROVIDER_TEXT } from '@/lib/ai-ui/server';
import { LOCAL_PRIVACY_MESSAGE } from '@/lib/runtime/hybrid';

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

  it('« Mes documents uniquement » : « Fonctionne hors ligne » dans l’application Windows SEULEMENT (le site nécessite Internet)', () => {
    const documents = (mode: Parameters<typeof describeResearchOptions>[1], route?: Capabilities['route']) =>
      describeResearchOptions(caps(), mode, '4eme', route).find(o => o.value === 'documents')!;
    expect(documents('local').description).toBe('Aucune recherche externe. Fonctionne hors ligne.');
    for (const [mode, route] of [['web', 'server'], ['web', 'local-connector'], ['web', undefined], ['personal', undefined], ['demo', undefined]] as const) {
      expect(documents(mode, route).description, `${mode} ${route}`).toBe(DOCUMENTS_ONLY_ONLINE_DESCRIPTION);
      expect(documents(mode, route).description).not.toMatch(/hors ligne/i);
    }
  });

  it('site web, Magistra locale : notes qui renvoient aux réglages de l’application Windows, sans nom technique', () => {
    const connector = (partial: Parameters<typeof caps>[0], niveau: Parameters<typeof describeResearchOptions>[2]) =>
      describeResearchOptions(caps(partial), 'web', niveau, 'local-connector');
    expect(connector({ research: { web: false, academic: true } }, 'cm2').find(o => o.value === 'internet')?.note).toBe(WEB_LIMITED_SCOLAIRE_CONNECTOR_NOTE);
    expect(connector({ research: { web: false, wikipedia: false, academic: true } }, '4eme').find(o => o.value === 'internet'))
      .toMatchObject({ available: false, note: NO_INTERNET_CONNECTOR_NOTE });
    expect(connector({ research: { academic: false } }, 'doctorat').find(o => o.value === 'academic'))
      .toMatchObject({ available: false, note: ACADEMIC_DISABLED_CONNECTOR_NOTE });
    for (const note of [WEB_LIMITED_SCOLAIRE_CONNECTOR_NOTE, NO_INTERNET_CONNECTOR_NOTE, ACADEMIC_DISABLED_CONNECTOR_NOTE]) {
      expect(note).toContain('réglages de l’application Magistra (Windows)');
      expect(note).not.toMatch(/searxng/i);
    }
    // Dans l'application Windows elle-même : ses propres réglages (inchangé).
    expect(describeResearchOptions(caps({ research: { academic: false } }), 'local', 'doctorat').find(o => o.value === 'academic')?.note).toBe(ACADEMIC_DISABLED_LOCAL_NOTE);
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

describe('confidentialité : Magistra locale depuis le site web (route « local-connector »)', () => {
  const local = (partial: Parameters<typeof caps>[0] = {}) =>
    caps({ route: 'local-connector', privacy: { level: 'local', message: LOCAL_PRIVACY_MESSAGE }, engineLabel: 'Magistra locale — Magistra Standard', ...partial });

  it('notes exactes : générée sur cet ordinateur par l’application, extraits jamais envoyés ; résultat ET paramètres de la demande dans l’historique en ligne', () => {
    const notes = privacyNotes(local(), 'documents', { runtimeMode: 'web' });
    expect(notes).toEqual({ message: LOCAL_CONNECTOR_PRIVACY_MESSAGE, network: null, local: null });
    expect(LOCAL_CONNECTOR_PRIVACY_MESSAGE).toBe(
      "IA locale : vos contenus sont générés sur cet ordinateur par l'application Magistra ; les extraits de vos documents n'en sortent pas. Le résultat et les paramètres de la demande (sujet, objectifs, consignes, contenu à adapter, profils, noms des documents) sont enregistrés dans l'historique de votre compte en ligne.",
    );
    // La génération enregistrée (done.record → POST /api/generation) contient le sujet, les consignes, le contenu à
    // adapter et les noms des documents : jamais « votre demande n'est pas transmise » ni « seul le résultat ».
    expect(LOCAL_CONNECTOR_PRIVACY_MESSAGE).not.toMatch(/demande[^.;]*(ne sont pas|n'est pas|ne passent pas|pas transmis)|seul le résultat/i);
    // Même texte que les capacités du client hybride (une seule source).
    expect(LOCAL_PRIVACY_MESSAGE).toBe(LOCAL_CONNECTOR_PRIVACY_MESSAGE);
    // Le résultat part dans l'historique en ligne : jamais « restent sur cet ordinateur », aucun prestataire tiers.
    expect(JSON.stringify(notes)).not.toContain('restent sur cet ordinateur');
    expect(notes.thirdParty).toBeUndefined();
  });

  it('recherche en ligne : faite depuis cet ordinateur par l’application (sujet et mots-clés seulement)', () => {
    for (const mode of ['academic', 'internet', 'documents_internet'] as const) {
      expect(privacyNotes(local(), mode, { runtimeMode: 'web' }).network).toBe(LOCAL_CONNECTOR_NETWORK_NOTE);
    }
    expect(LOCAL_CONNECTOR_NETWORK_NOTE).toBe(
      "Les recherches Internet ou académiques sont faites depuis cet ordinateur par l'application Magistra : elles transmettent uniquement votre sujet et vos mots-clés (jamais vos documents) aux services de recherche.",
    );
  });

  it('indépendant du message des capacités et de leur disponibilité : Magistra locale non prête, ou capacités pas encore lues', () => {
    const notReady = local({ ready: false, privacy: { level: 'local', message: 'Tout reste sur cet ordinateur.' } });
    expect(privacyNotes(notReady, 'documents', { runtimeMode: 'web' }).message).toBe(LOCAL_CONNECTOR_PRIVACY_MESSAGE);
    // Capacités pas encore lues, moteur choisi connu : annonce de Magistra locale (jamais « prestataire non vérifié »).
    const pending = privacyNotes(null, 'internet', { runtimeMode: 'web', route: 'local-connector' });
    expect(pending).toEqual({ message: LOCAL_CONNECTOR_PRIVACY_MESSAGE, network: LOCAL_CONNECTOR_NETWORK_NOTE, local: null });
  });

  it('serveur en ligne choisi sur le site : comportement du serveur (jamais les notes de Magistra locale)', () => {
    const server = caps({ route: 'server', privacy: { level: 'server', message: 'Transmis au serveur.' } });
    expect(privacyNotes(server, 'internet', { runtimeMode: 'web', route: 'server' })).toEqual({
      message: 'Transmis au serveur.', network: NETWORK_PRIVACY_NOTE, local: null,
    });
    const unknown = privacyNotes(null, 'documents', { runtimeMode: 'web', route: 'server' });
    expect(unknown.message).toBe(UNVERIFIED_PROVIDER_TEXT);
    expect(unknown.thirdParty).toBe(true);
  });
});

describe('indications en démonstration', () => {
  it('pas d’avertissement « connaissances du modèle » (aucun modèle en démo)', () => {
    const options = describeResearchOptions(null, 'demo', '4eme');
    expect(researchHints('documents', 0, '4eme', options, 'demo').modelOnly).toBe(false);
    expect(researchHints('documents', 0, '4eme', options, 'web').modelOnly).toBe(true);
  });
});
