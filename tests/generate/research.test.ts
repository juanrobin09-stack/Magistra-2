import { describe, expect, it } from 'vitest';
import type { Capabilities } from '@shared/types';
import {
  ACADEMIC_DISABLED_CONNECTOR_NOTE, ACADEMIC_DISABLED_LOCAL_NOTE, ACADEMIC_DISABLED_SERVER_NOTE, describeResearchOptions, DEMO_RESEARCH_NOTE,
  DOCUMENTS_ONLY_ONLINE_DESCRIPTION, effectiveResearchMode, LOCAL_CONNECTOR_NETWORK_NOTE, NO_INTERNET_CONNECTOR_NOTE,
  LOCAL_CONNECTOR_PRIVACY_MESSAGE, LOCAL_PRIVACY_NOTE, NETWORK_PRIVACY_NOTE, NO_INTERNET_LOCAL_NOTE, NO_INTERNET_SERVER_NOTE,
  privacyNotes, researchHints,
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
    // Version actuelle du moteur : elle annonce le catalogue des sites vérifiés (`trustedCatalogue`).
    research: { academic: true, web: true, institutional: true, wikipedia: true, trustedCatalogue: true, ...partial.research },
  };
}

const OFFICIAL_SEARCH = 'principaux sites officiels vérifiés (UNESCO, Éduscol, ministères, ONU…)';
const OFFICIAL_LEGACY = 'sites officiels (Éduscol, education.gouv.fr…)';
const OFFICIAL_WIKIPEDIA = 'sites officiels vérifiés cités par Wikipédia';
const PUBLICATIONS = 'publications HAL, Crossref et OpenAlex';
const WIKIPEDIA = 'Wikipédia (à recouper)';
const note = (options: ReturnType<typeof describeResearchOptions>, mode: string) => options.find(o => o.value === mode)?.note;

describe('modes de recherche', () => {
  it('démonstration : seule « Mes documents uniquement » est disponible', () => {
    const options = describeResearchOptions(caps({ research: { academic: false, web: false, institutional: false } }), 'demo', 'licence_1');
    expect(options.map(o => o.value)).toEqual(['documents', 'academic', 'internet', 'documents_internet']);
    expect(options.filter(o => o.available).map(o => o.value)).toEqual(['documents']);
    expect(options[1].note).toBe(DEMO_RESEARCH_NOTE);
    expect(effectiveResearchMode('internet', options)).toBe('documents');
  });

  it('moteur web configuré : annonce les sites officiels vérifiés, les publications (supérieur) puis Wikipédia « à recouper »', () => {
    const sup = describeResearchOptions(caps(), 'web', 'licence_2');
    expect(note(sup, 'internet')).toBe(`Consulté : ${PUBLICATIONS}, ${OFFICIAL_SEARCH}, ${WIKIPEDIA}.`);
    expect(note(sup, 'documents_internet')).toBe(note(sup, 'internet'));
    expect(note(sup, 'academic')).toBe(`Consulté : ${PUBLICATIONS}, ${OFFICIAL_SEARCH}.`);
    const scolaire = describeResearchOptions(caps(), 'web', '4eme');
    expect(note(scolaire, 'internet')).toBe(`Consulté : ${OFFICIAL_SEARCH}, ${WIKIPEDIA}.`);
    // Rien n'est restreint : tout est disponible, aucune mention « non consultés ».
    for (const options of [sup, scolaire]) {
      expect(options.every(o => o.available)).toBe(true);
      expect(options.map(o => o.note ?? '').join(' ')).not.toMatch(/non consultés/);
    }
    expect(note(sup, 'documents')).toBeUndefined();
  });

  it('sans moteur web (cas normal d’un enseignant) : les sites officiels sont ceux que les références de Wikipédia citent', () => {
    const c = caps({ research: { web: false, institutional: true } });
    expect(note(describeResearchOptions(c, 'local', 'master_1'), 'internet')).toBe(`Consulté : ${PUBLICATIONS}, ${OFFICIAL_WIKIPEDIA}, ses articles (à recouper).`);
    expect(note(describeResearchOptions(c, 'local', 'cm2'), 'internet')).toBe(`Consulté : ${OFFICIAL_WIKIPEDIA}, ses articles (à recouper).`);
    expect(note(describeResearchOptions(c, 'local', 'cm2'), 'academic')).toBe(`Consulté : ${PUBLICATIONS}, ${OFFICIAL_WIKIPEDIA}.`);
    expect(describeResearchOptions(c, 'local', 'cm2').every(o => o.available)).toBe(true);
  });

  it('sites officiels non consultés (ni moteur web, ni Wikipédia pour les trouver) : dit, avec ce qu’il faut changer là où ça se règle', () => {
    const c = caps({ research: { web: false, institutional: false, wikipedia: true } });
    // Application Windows : réglages de l'application, SearXNG nommé.
    expect(note(describeResearchOptions(c, 'local', '4eme'), 'internet'))
      .toBe(`Consulté : ${WIKIPEDIA}. Sites officiels non consultés : indiquez un moteur de recherche web (SearXNG) dans les réglages.`);
    // Serveur en ligne : rien à régler pour l'enseignant.
    expect(note(describeResearchOptions(c, 'web', '4eme'), 'documents_internet'))
      .toBe(`Consulté : ${WIKIPEDIA}. Sites officiels non consultés : aucun moteur de recherche web configuré sur ce serveur.`);
    // Supérieur : les publications restent consultées ; mode académique : publications seules.
    expect(note(describeResearchOptions(c, 'local', 'master_1'), 'internet'))
      .toBe(`Consulté : ${PUBLICATIONS}, ${WIKIPEDIA}. Sites officiels non consultés : indiquez un moteur de recherche web (SearXNG) dans les réglages.`);
    expect(note(describeResearchOptions(c, 'local', 'master_1'), 'academic'))
      .toBe(`Consulté : ${PUBLICATIONS}. Sites officiels non consultés : indiquez un moteur de recherche web (SearXNG) dans les réglages.`);
    expect(describeResearchOptions(c, 'local', '4eme').every(o => o.available)).toBe(true);
  });

  it('Wikipédia désactivé et aucun moteur web : Internet indisponible (scolaire) ; supérieur : publications seules, sites officiels non consultés', () => {
    const c = caps({ research: { web: false, institutional: false, wikipedia: false, academic: true } });
    const college = describeResearchOptions(c, 'local', '4eme');
    expect(college.find(o => o.value === 'internet')).toMatchObject({ available: false, note: NO_INTERNET_LOCAL_NOTE });
    expect(effectiveResearchMode('documents_internet', college)).toBe('documents');
    expect(note(describeResearchOptions(c, 'web', '4eme'), 'internet')).toBe(NO_INTERNET_SERVER_NOTE);
    const master = describeResearchOptions(c, 'local', 'master_1');
    expect(master.find(o => o.value === 'internet')).toMatchObject({
      available: true,
      note: `Consulté : ${PUBLICATIONS}. Sites officiels non consultés : activez Wikipédia, ou indiquez un moteur de recherche web (SearXNG), dans les réglages.`,
    });
    expect(note(describeResearchOptions(c, 'web', 'master_1'), 'internet'))
      .toBe(`Consulté : ${PUBLICATIONS}. Sites officiels non consultés : ni Wikipédia ni moteur de recherche web ne sont activés sur ce serveur.`);
  });

  it('recherche académique désactivée : mode indisponible, retour aux documents ; Internet reste annoncé sans publications', () => {
    const options = describeResearchOptions(caps({ research: { academic: false } }), 'local', 'doctorat');
    expect(options.find(o => o.value === 'academic')?.available).toBe(false);
    expect(effectiveResearchMode('academic', options)).toBe('documents');
    expect(effectiveResearchMode('internet', options)).toBe('internet');
    expect(note(options, 'internet')).toBe(`Consulté : ${OFFICIAL_SEARCH}, ${WIKIPEDIA}.`);
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
    expect(note(connector({ research: { web: false, institutional: false } }, 'cm2'), 'internet'))
      .toBe(`Consulté : ${WIKIPEDIA}. Sites officiels non consultés : indiquez un moteur de recherche web dans les réglages de l’application Magistra (Windows).`);
    expect(note(connector({ research: { web: false, institutional: false, wikipedia: false } }, 'master_1'), 'internet'))
      .toBe(`Consulté : ${PUBLICATIONS}. Sites officiels non consultés : activez Wikipédia, ou indiquez un moteur de recherche web, dans les réglages de l’application Magistra (Windows).`);
    expect(connector({ research: { web: false, institutional: false, wikipedia: false, academic: true } }, '4eme').find(o => o.value === 'internet'))
      .toMatchObject({ available: false, note: NO_INTERNET_CONNECTOR_NOTE });
    expect(connector({ research: { academic: false } }, 'doctorat').find(o => o.value === 'academic'))
      .toMatchObject({ available: false, note: ACADEMIC_DISABLED_CONNECTOR_NOTE });
    for (const text of [
      note(connector({ research: { web: false, institutional: false } }, 'cm2'), 'internet'),
      note(connector({ research: { web: false, institutional: false, wikipedia: false } }, 'master_1'), 'internet'),
      NO_INTERNET_CONNECTOR_NOTE, ACADEMIC_DISABLED_CONNECTOR_NOTE,
    ]) {
      expect(text).toContain('réglages de l’application Magistra (Windows)');
      expect(text).not.toMatch(/searxng/i);
    }
    // Dans l'application Windows elle-même : ses propres réglages (inchangé).
    expect(describeResearchOptions(caps({ research: { academic: false } }), 'local', 'doctorat').find(o => o.value === 'academic')?.note).toBe(ACADEMIC_DISABLED_LOCAL_NOTE);
    expect(ACADEMIC_DISABLED_SERVER_NOTE).toBe('Recherche académique non activée sur ce serveur.');
  });

  it('capacités inconnues : tout reste sélectionnable, sans note', () => {
    const options = describeResearchOptions(null, 'web', '4eme');
    expect(options.every(o => o.available)).toBe(true);
    expect(options.every(o => o.note === undefined)).toBe(true);
  });

  it('descriptions des modes : sites officiels vérifiés, jamais « le web » en général, aucun site nommé comme garanti', () => {
    const descriptions = describeResearchOptions(caps(), 'local', '4eme').map(o => o.description);
    expect(descriptions[1]).toBe('Vos documents + publications scientifiques (HAL, Crossref, OpenAlex) et sites officiels vérifiés.');
    expect(descriptions[2]).toBe('Recherche en ligne, sans utiliser vos documents.');
    expect(descriptions[3]).toBe('Vos documents en priorité, complétés par une recherche en ligne.');
    expect(descriptions.join(' ')).not.toMatch(/UNESCO|Éduscol|\btous\b|tout le catalogue/);
  });

  it('jamais « tous » les sites ni « tout le catalogue » dans ce que le sélecteur annonce ; seul le moteur de recherche web nomme des sites, comme des exemples', () => {
    const all = [OFFICIAL_SEARCH, OFFICIAL_WIKIPEDIA, OFFICIAL_LEGACY];
    for (const text of all) expect(text).not.toMatch(/\btous\b|tout le catalogue/i);
    expect(OFFICIAL_SEARCH).toMatch(/^principaux sites officiels vérifiés/);
    // Sans moteur de recherche web : les pages que Wikipédia cite pour le sujet, aucun site nommé comme garanti.
    expect(OFFICIAL_WIKIPEDIA).not.toMatch(/UNESCO|Éduscol|ministères/);
    const wikipediaOnly = describeResearchOptions(caps({ research: { web: false } }), 'local', '4eme');
    expect(wikipediaOnly.map(o => o.note ?? '').join(' ')).not.toMatch(/UNESCO|Éduscol|ministères/);
  });

  it('ancienne application (même protocole, sans « trustedCatalogue ») : texte prudent, ni UNESCO ni « vérifiés », aucun filtrage promis', () => {
    const legacy = (research: Partial<Capabilities['research']>) => caps({ research: { trustedCatalogue: undefined, ...research } });
    for (const mode of ['local', 'web'] as const) {
      for (const niveau of ['4eme', 'master_1'] as const) {
        const options = describeResearchOptions(legacy({}), mode, niveau);
        for (const value of ['internet', 'documents_internet', 'academic'] as const) {
          const text = note(options, value) ?? '';
          expect(text, `${mode}/${niveau}/${value}`).toContain(OFFICIAL_LEGACY);
          expect(text, `${mode}/${niveau}/${value}`).not.toMatch(/UNESCO|vérifiés|ministères|ONU/);
        }
      }
    }
    expect(note(describeResearchOptions(legacy({}), 'local', '4eme'), 'internet')).toBe(`Consulté : ${OFFICIAL_LEGACY}, ${WIKIPEDIA}.`);
    expect(note(describeResearchOptions(legacy({}), 'local', 'master_1'), 'academic')).toBe(`Consulté : ${PUBLICATIONS}, ${OFFICIAL_LEGACY}.`);
    // Site web, Magistra locale : même texte prudent.
    expect(note(describeResearchOptions(legacy({}), 'web', '4eme', 'local-connector'), 'internet')).toBe(`Consulté : ${OFFICIAL_LEGACY}, ${WIKIPEDIA}.`);
    // Le champ explicitement faux vaut l'absence ; seul « vrai » annonce le catalogue.
    expect(note(describeResearchOptions(legacy({ trustedCatalogue: false }), 'local', '4eme'), 'internet')).toBe(`Consulté : ${OFFICIAL_LEGACY}, ${WIKIPEDIA}.`);
    expect(note(describeResearchOptions(caps({ research: { trustedCatalogue: true } }), 'local', '4eme'), 'internet')).toBe(`Consulté : ${OFFICIAL_SEARCH}, ${WIKIPEDIA}.`);
    // Sans moteur de recherche web, « institutional » ne vient que du chemin par Wikipédia, propre aux versions actuelles.
    expect(note(describeResearchOptions(legacy({ web: false }), 'local', '4eme'), 'internet')).toBe(`Consulté : ${OFFICIAL_WIKIPEDIA}, ses articles (à recouper).`);
    // Sans chemin vers les sites officiels : le champ ne change rien (rien n'est promis).
    expect(note(describeResearchOptions(legacy({ web: false, institutional: false }), 'local', '4eme'), 'internet'))
      .toBe(`Consulté : ${WIKIPEDIA}. Sites officiels non consultés : indiquez un moteur de recherche web (SearXNG) dans les réglages.`);
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
