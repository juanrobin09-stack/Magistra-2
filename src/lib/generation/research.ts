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

export const WEB_LIMITED_ACADEMIC_NOTE = 'Internet : Wikipédia et sources académiques seulement (aucun moteur web configuré)';
export const WEB_LIMITED_NOTE = 'Internet : Wikipédia seulement (aucun moteur web configuré)';
/** Scolaire : Éduscol et le Bulletin officiel passent par le moteur web ; sans lui, on le dit. */
export const WEB_LIMITED_SCOLAIRE_LOCAL_NOTE =
  'Internet : Wikipédia seulement. Éduscol et le Bulletin officiel demandent un moteur de recherche web (SearXNG), à indiquer dans les réglages.';
export const WEB_LIMITED_SCOLAIRE_SERVER_NOTE =
  'Internet : Wikipédia seulement. Éduscol et le Bulletin officiel ne sont pas interrogés : aucun moteur de recherche web configuré sur ce serveur.';
export const ACADEMIC_ONLY_NOTE = 'Internet : sources académiques seulement (aucun moteur web configuré, Wikipédia désactivé)';
export const NO_INTERNET_LOCAL_NOTE = 'Internet indisponible : aucun moteur web configuré et Wikipédia désactivé dans les réglages.';
export const NO_INTERNET_SERVER_NOTE = 'Recherche Internet non activée sur ce serveur.';
export const DEMO_RESEARCH_NOTE = 'Recherche indisponible en mode démonstration.';
export const DOCUMENTS_IGNORED_NOTE = 'Vos documents ne seront pas utilisés dans ce mode.';
export const NETWORK_PRIVACY_NOTE =
  'La recherche en ligne transmet uniquement votre sujet et vos mots-clés (jamais vos documents) aux services de recherche.';
export const LOCAL_PRIVACY_NOTE = 'Vos documents et générations restent sur cet ordinateur.';
/**
 * Site web, Magistra locale (route 'local-connector') : génération par l'application Magistra de cet ordinateur ; la
 * demande et les extraits de documents ne vont qu'à elle (jamais au serveur Magistra en ligne) ; le résultat, lui, est
 * enregistré dans l'historique du compte en ligne. Jamais « restent sur cet ordinateur ».
 */
export const LOCAL_CONNECTOR_PRIVACY_MESSAGE =
  "IA locale : vos contenus sont générés sur cet ordinateur par l'application Magistra. Votre demande et les extraits de vos documents ne sont pas transmis au serveur Magistra en ligne ; seul le résultat est enregistré dans l'historique de votre compte en ligne.";
/** Magistra locale et recherche en ligne : faite par l'application, depuis cet ordinateur (réglages de l'application). */
export const LOCAL_CONNECTOR_NETWORK_NOTE =
  "Les recherches Internet ou académiques sont faites depuis cet ordinateur par l'application Magistra : elles transmettent uniquement votre sujet et vos mots-clés (jamais vos documents) aux services de recherche.";

/**
 * Décrit les 4 modes de recherche selon les capacités du moteur.
 * `caps` null = capacités encore inconnues : tout reste sélectionnable, sans promesse.
 */
export function describeResearchOptions(
  caps: Capabilities | null,
  mode: RuntimeMode,
  niveau: NiveauScolaire,
): ResearchOption[] {
  return RESEARCH_MODES.map(m => {
    const base: ResearchOption = { ...m, available: true };
    if (m.value === 'documents') return base;
    if (mode === 'demo') return { ...base, available: false, note: DEMO_RESEARCH_NOTE };
    if (!caps) return base;

    if (m.value === 'academic') {
      if (caps.research.academic) return base;
      return {
        ...base,
        available: false,
        note: mode === 'local'
          ? 'Recherche académique désactivée dans les réglages.'
          : 'Recherche académique non activée sur ce serveur.',
      };
    }

    // Internet / Documents + Internet : on annonce seulement ce qui sera réellement consulté.
    if (caps.research.web) return base;
    const academicUsed = isSuperieur(niveau) && caps.research.academic;
    const wikipedia = caps.research.wikipedia;
    if (!academicUsed && !wikipedia) {
      return { ...base, available: false, note: mode === 'local' ? NO_INTERNET_LOCAL_NOTE : NO_INTERNET_SERVER_NOTE };
    }
    if (!wikipedia) return { ...base, note: ACADEMIC_ONLY_NOTE };
    if (academicUsed) return { ...base, note: WEB_LIMITED_ACADEMIC_NOTE };
    if (!isSuperieur(niveau)) {
      return { ...base, note: mode === 'local' ? WEB_LIMITED_SCOLAIRE_LOCAL_NOTE : WEB_LIMITED_SCOLAIRE_SERVER_NOTE };
    }
    return { ...base, note: WEB_LIMITED_NOTE };
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
