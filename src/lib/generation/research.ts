// Sources de recherche et confidentialité : ce qui est RÉELLEMENT disponible, dit honnêtement.

import { getLevelGroup, isSuperieur, type NiveauScolaire } from '@shared/levels';
import { RESEARCH_MODES, type Capabilities, type ProviderInfo, type ResearchMode } from '@shared/types';
import {
  providerPolicyUrl, serverPrivacyMessage, UNVERIFIED_PROVIDER_PERSONAL_TEXT, UNVERIFIED_PROVIDER_TEXT,
} from '@/lib/ai-ui/server';
import { usesServerApi, type RuntimeMode } from '@/lib/runtime/types';

export interface ResearchOption {
  value: ResearchMode;
  label: string;
  description: string;
  network: boolean;
  /** Le mode peut-il être choisi ici ? */
  available: boolean;
  /** Précision honnête sur ce qui sera réellement consulté (ou pourquoi c'est indisponible). */
  note?: string;
}

/** Ce que la recherche consulte : ces libellés sont ceux de la note affichée sous chaque mode. */
export const PUBLICATIONS_CONSULTED = 'publications HAL, Crossref et OpenAlex';
export const OFFICIAL_VIA_SEARCH_CONSULTED = 'sites officiels vérifiés (UNESCO, Éduscol, ministères…)';
export const OFFICIAL_VIA_WIKIPEDIA_CONSULTED = 'sites officiels vérifiés cités par Wikipédia';
export const WIKIPEDIA_CONSULTED = 'Wikipédia (à recouper)';
export const NO_INTERNET_LOCAL_NOTE = 'Internet indisponible : aucun moteur web configuré et Wikipédia désactivé dans les réglages.';
export const ACADEMIC_DISABLED_LOCAL_NOTE = 'Recherche académique désactivée dans les réglages.';
export const ACADEMIC_DISABLED_SERVER_NOTE = 'Recherche académique non activée sur ce serveur.';
// Site web, Magistra locale (route 'local-connector') : les sources sont celles de l'application Windows, réglées dans
// SES réglages (ceux du site sont en lecture seule) ; aucun nom technique (moteur de recherche web, sans « SearXNG »).
export const NO_INTERNET_CONNECTOR_NOTE =
  'Internet indisponible : aucun moteur web configuré et Wikipédia désactivé dans les réglages de l’application Magistra (Windows).';
export const ACADEMIC_DISABLED_CONNECTOR_NOTE = 'Recherche académique désactivée dans les réglages de l’application Magistra (Windows).';
/**
 * « Mes documents uniquement » hors de l'application Windows : le site nécessite Internet (jamais « Fonctionne hors
 * ligne », réservé à l'application).
 */
export const DOCUMENTS_ONLY_ONLINE_DESCRIPTION = 'Aucune recherche externe.';
export const NO_INTERNET_SERVER_NOTE = 'Recherche Internet non activée sur ce serveur.';
export const DEMO_RESEARCH_NOTE = 'Recherche indisponible en mode démonstration.';
export const DOCUMENTS_IGNORED_NOTE = 'Vos documents ne seront pas utilisés dans ce mode.';
export const NETWORK_PRIVACY_NOTE =
  'La recherche en ligne transmet uniquement votre sujet et vos mots-clés (jamais vos documents) aux services de recherche.';
export const LOCAL_PRIVACY_NOTE = 'Vos documents et générations restent sur cet ordinateur.';
/**
 * Site web, Magistra locale (route 'local-connector') : génération par l'application Magistra de cet ordinateur, seule
 * à recevoir les extraits de documents (jamais le serveur Magistra en ligne). Ce qui part EXACTEMENT vers le serveur :
 * la génération enregistrée dans l'historique du compte (done.record : résultat, sources citées, et paramètres de la
 * demande — sujet, objectifs, consignes, contenu à adapter, profils, noms des documents ; jamais le texte des extraits
 * ni le travail d'élève, dont seule la longueur est notée). Jamais « restent sur cet ordinateur ».
 */
export const LOCAL_CONNECTOR_PRIVACY_MESSAGE =
  "IA locale : vos contenus sont générés sur cet ordinateur par l'application Magistra ; les extraits de vos documents n'en sortent pas. Le résultat et les paramètres de la demande (sujet, objectifs, consignes, contenu à adapter, profils, noms des documents) sont enregistrés dans l'historique de votre compte en ligne.";
/** Magistra locale et recherche en ligne : faite par l'application, depuis cet ordinateur (réglages de l'application). */
export const LOCAL_CONNECTOR_NETWORK_NOTE =
  "Les recherches Internet ou académiques sont faites depuis cet ordinateur par l'application Magistra : elles transmettent uniquement votre sujet et vos mots-clés (jamais vos documents) aux services de recherche.";

/** Où se règlent les sources : application Windows (sur place), application depuis le site, serveur en ligne. */
type ResearchSettingsSide = 'app' | 'connector' | 'server';

/**
 * Sites officiels non consultés (ni moteur de recherche web, ni Wikipédia pour lire ses références) : ce qu'il faut
 * changer, là où ça se règle. `wikipedia` : Wikipédia est déjà actif, seul le moteur web peut encore s'ajouter.
 */
function officialMissingNote(side: ResearchSettingsSide, wikipedia: boolean): string {
  if (side === 'server') {
    return wikipedia
      ? 'Sites officiels non consultés : aucun moteur de recherche web configuré sur ce serveur.'
      : 'Sites officiels non consultés : ni Wikipédia ni moteur de recherche web ne sont activés sur ce serveur.';
  }
  const where = side === 'app' ? 'dans les réglages' : 'dans les réglages de l’application Magistra (Windows)';
  const engine = side === 'app' ? 'un moteur de recherche web (SearXNG)' : 'un moteur de recherche web';
  return wikipedia
    ? `Sites officiels non consultés : indiquez ${engine} ${where}.`
    : `Sites officiels non consultés : activez Wikipédia, ou indiquez ${engine}, ${where}.`;
}

const NOTES_BY_SIDE: Record<ResearchSettingsSide, { academicDisabled: string; noInternet: string }> = {
  app: { academicDisabled: ACADEMIC_DISABLED_LOCAL_NOTE, noInternet: NO_INTERNET_LOCAL_NOTE },
  connector: { academicDisabled: ACADEMIC_DISABLED_CONNECTOR_NOTE, noInternet: NO_INTERNET_CONNECTOR_NOTE },
  server: { academicDisabled: ACADEMIC_DISABLED_SERVER_NOTE, noInternet: NO_INTERNET_SERVER_NOTE },
};

/** « Consulté : … » : ce que la recherche interrogera, dans l'ordre de priorité, et ce qu'elle ne peut pas interroger. */
function consultedNote(parts: (string | null)[], missingOfficial: string | null): string {
  return `Consulté : ${parts.filter(Boolean).join(', ')}.${missingOfficial ? ` ${missingOfficial}` : ''}`;
}

/**
 * Décrit les 4 modes de recherche selon les capacités du moteur, et annonce ce qui sera réellement consulté : sites
 * officiels vérifiés (par un moteur de recherche web, sinon par les références de Wikipédia), publications, Wikipédia.
 * `caps` null = capacités encore inconnues : tout reste sélectionnable, sans promesse.
 * `mode` : mode d'exécution RÉEL (« Fonctionne hors ligne » dans l'application Windows seulement) ; `route` : sur le
 * site, moteur qui traitera la génération ('local-connector' : sources et réglages de l'application Windows).
 */
export function describeResearchOptions(
  caps: Capabilities | null,
  mode: RuntimeMode,
  niveau: NiveauScolaire,
  route?: Capabilities['route'] | null,
): ResearchOption[] {
  const side: ResearchSettingsSide = mode === 'local' ? 'app' : route === 'local-connector' ? 'connector' : 'server';
  const notes = NOTES_BY_SIDE[side];
  return RESEARCH_MODES.map(m => {
    const base: ResearchOption = { ...m, available: true };
    if (m.value === 'documents') return mode === 'local' ? base : { ...base, description: DOCUMENTS_ONLY_ONLINE_DESCRIPTION };
    if (mode === 'demo') return { ...base, available: false, note: DEMO_RESEARCH_NOTE };
    if (!caps) return base;

    const { academic, institutional, web, wikipedia } = caps.research;
    const official = institutional ? (web ? OFFICIAL_VIA_SEARCH_CONSULTED : OFFICIAL_VIA_WIKIPEDIA_CONSULTED) : null;
    const missingOfficial = institutional ? null : officialMissingNote(side, wikipedia);

    if (m.value === 'academic') {
      if (!academic) return { ...base, available: false, note: notes.academicDisabled };
      return { ...base, note: consultedNote([PUBLICATIONS_CONSULTED, official], missingOfficial) };
    }

    // Internet / Documents + Internet : on annonce seulement ce qui sera réellement consulté.
    const parts = [isSuperieur(niveau) && academic ? PUBLICATIONS_CONSULTED : null, official, wikipedia ? WIKIPEDIA_CONSULTED : null];
    if (!parts.some(Boolean)) return { ...base, available: false, note: notes.noInternet };
    return { ...base, note: consultedNote(parts, missingOfficial) };
  });
}

/** Mode réellement utilisé : un mode indisponible retombe sur « Mes documents uniquement ». */
export function effectiveResearchMode(chosen: ResearchMode, options: ResearchOption[]): ResearchMode {
  return options.find(o => o.value === chosen)?.available ? chosen : 'documents';
}

export function modeUsesNetwork(mode: ResearchMode): boolean {
  return RESEARCH_MODES.find(m => m.value === mode)?.network ?? false;
}

export interface ResearchHints {
  /** « Vos documents ne seront pas utilisés dans ce mode » (documents ajoutés + mode Internet). */
  documentsIgnored: boolean;
  /** Master / Doctorat sans document : suggérer « Sources académiques ». */
  suggestAcademic: boolean;
  /** Aucun document et aucune recherche : le modèle ne s'appuie que sur ses connaissances. */
  modelOnly: boolean;
}

export function researchHints(
  mode: ResearchMode,
  documentCount: number,
  niveau: NiveauScolaire,
  options: ResearchOption[],
  runtimeMode?: RuntimeMode,
): ResearchHints {
  const group = getLevelGroup(niveau);
  const academicAvailable = options.find(o => o.value === 'academic')?.available ?? false;
  return {
    documentsIgnored: documentCount > 0 && mode === 'internet',
    suggestAcademic: (group === 'master' || group === 'doctorat') && documentCount === 0 && mode === 'documents' && academicAvailable,
    // En démonstration, aucun modèle n'est utilisé : l'avertissement n'aurait pas de sens.
    modelOnly: documentCount === 0 && mode === 'documents' && runtimeMode !== 'demo',
  };
}

export interface PrivacyNotes {
  /** Message fourni par le moteur (vrai selon le mode d'exécution). */
  message: string | null;
  /** Ajouté si le mode choisi utilise le réseau. */
  network: string | null;
  /** Affiché uniquement si tout reste réellement sur l'ordinateur. */
  local: string | null;
  /** Les textes partent chez un prestataire tiers (service d'IA en ligne) : annonce mise en avant. */
  thirdParty?: boolean;
  /** Page publique du prestataire d'IA (https uniquement). */
  providerUrl?: string | null;
}

export interface PrivacyContext {
  /** Mode d'exécution : site web ou mode personnel = textes transmis au serveur Magistra. */
  runtimeMode?: RuntimeMode;
  /** Prestataire annoncé au démarrage par le serveur (GET /api/mode), avant la réponse de /api/status. */
  fallbackProvider?: ProviderInfo;
  /**
   * Site web : moteur qui traitera la génération, connu avant ses capacités (choix de l'enseignant). Les capacités,
   * quand elles sont là, font foi (`caps.route`).
   */
  route?: Capabilities['route'] | null;
}

/**
 * Le prestataire qui recevra les textes est-il annoncé ? Faux seulement sur le site web ou en mode personnel, tant que
 * /api/status n'a pas répondu et qu'aucun prestataire tiers n'a été annoncé par /api/mode.
 */
export function providerAnnounced(caps: Capabilities | null, context: PrivacyContext = {}): boolean {
  if (caps || !context.runtimeMode || !usesServerApi(context.runtimeMode)) return true;
  return context.fallbackProvider?.thirdParty === true;
}

/**
 * Magistra locale depuis le site web : génération sur cet ordinateur par l'application Magistra, demande et extraits
 * de documents jamais transmis au serveur Magistra en ligne, résultat enregistré dans l'historique du compte en ligne,
 * recherches en ligne éventuelles faites depuis cet ordinateur. Aucun prestataire tiers ; jamais « restent sur cet
 * ordinateur » (le résultat part dans l'historique en ligne).
 */
function localConnectorPrivacy(mode: ResearchMode): PrivacyNotes {
  return {
    message: LOCAL_CONNECTOR_PRIVACY_MESSAGE,
    network: modeUsesNetwork(mode) ? LOCAL_CONNECTOR_NETWORK_NOTE : null,
    local: null,
  };
}

export function privacyNotes(caps: Capabilities | null, mode: ResearchMode, context: PrivacyContext = {}): PrivacyNotes {
  if ((caps ? caps.route : context.route) === 'local-connector') return localConnectorPrivacy(mode);
  if (!caps && context.runtimeMode && usesServerApi(context.runtimeMode)) {
    // Vérification en cours ou en échec : jamais de silence sur le destinataire des textes. Prestataire tiers annoncé
    // par /api/mode : il est nommé ; sinon (inconnu, ou une IA locale qu'un relais pourrait contredire) : annonce prudente.
    const fallback = context.fallbackProvider?.thirdParty ? context.fallbackProvider : undefined;
    return {
      message: fallback
        ? serverPrivacyMessage(fallback.label, fallback)
        : context.runtimeMode === 'personal' ? UNVERIFIED_PROVIDER_PERSONAL_TEXT : UNVERIFIED_PROVIDER_TEXT,
      network: modeUsesNetwork(mode) ? NETWORK_PRIVACY_NOTE : null,
      local: null,
      thirdParty: true,
      ...(fallback ? { providerUrl: providerPolicyUrl(fallback) } : {}),
    };
  }
  const provider = caps?.providerInfo;
  const thirdParty = provider?.thirdParty === true;
  return {
    message: caps?.privacy.message ?? null,
    network: modeUsesNetwork(mode) ? NETWORK_PRIVACY_NOTE : null,
    // Jamais « restent sur cet ordinateur » quand un prestataire tiers reçoit les textes.
    local: caps?.privacy.level === 'local' && !thirdParty ? LOCAL_PRIVACY_NOTE : null,
    ...(thirdParty ? { thirdParty: true } : {}),
    ...(provider ? { providerUrl: providerPolicyUrl(provider) } : {}),
  };
}
