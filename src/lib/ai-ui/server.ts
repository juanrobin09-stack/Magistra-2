// État de l'IA du serveur Magistra (site web et mode personnel) et transparence sur le prestataire.
// Fonctions pures, testées dans tests/ai-ui : la vraie cause est affichée (jamais « réessayez » pour un
// problème de configuration) et le prestataire qui reçoit les textes est toujours nommé.

import { defaultMessage, type ErrorCode } from '@shared/errors';
import type { AINotice, Capabilities, ProviderInfo } from '@shared/types';
import { safeExternalUrl } from '@/lib/links';

export type ServerMode = 'web' | 'personal';

/**
 * Commandes de vérification. Sans option, « npm run ai:check » vérifie « npm start » (fichier .env) : « npm run dev »
 * se vérifie avec --dev, un site sur Vercel avec sa configuration de production (voir README).
 */
export const CHECK_PERSONAL = 'npm run ai:check -- --dev (ou npm run ai:check si vous utilisez npm start)';
export const CHECK_WEB = 'npm run ai:check sur le serveur (site sur Vercel : npm run ai:check -- --vercel --env-file .env.prod.local, voir README)';

/** Texte dédié quand aucune IA n'est branchée sur le site (AI_NOT_CONFIGURED sans cause précise). */
export const NOT_CONFIGURED_WEB_TEXT =
  "Aucune intelligence artificielle n'est encore branchée sur ce site. L'administrateur doit choisir un fournisseur "
  + `(par exemple AI_PRESET=ovhcloud, gratuit, sans clé) — vérification : ${CHECK_WEB}`;

/** Même situation en mode personnel : c'est l'enseignant lui-même qui administre son serveur. */
export const NOT_CONFIGURED_PERSONAL_TEXT =
  "Aucune intelligence artificielle n'est encore branchée sur ce serveur Magistra. Installez Ollama sur cet ordinateur "
  + 'avec un modèle (par exemple : ollama pull ministral-3:8b) : Magistra le détecte automatiquement. Vous pouvez aussi '
  + 'choisir un fournisseur en ligne dans le fichier .env (par exemple AI_PRESET=ovhcloud, gratuit, sans clé) — '
  + `vérification : ${CHECK_PERSONAL}`;

/** État non vérifié (AI_STATUS_UNKNOWN) : avertissement seulement, la génération reste possible. */
export const STATUS_UNKNOWN_TEXT = "État du serveur d'IA non vérifié : la génération reste possible.";

/** Pannes passagères : un nouvel essai un peu plus tard a du sens. */
const TRANSIENT: ErrorCode[] = ['AI_BUSY', 'AI_SERVER_UNAVAILABLE', 'AI_TIMEOUT', 'NETWORK_ERROR', 'RATE_LIMITED'];

const TITLES: Partial<Record<ErrorCode, { title: string; badge: string }>> = {
  AI_NOT_CONFIGURED: { title: "Aucune intelligence artificielle n'est branchée", badge: 'Aucune IA branchée' },
  AI_AUTH_FAILED: { title: "Le service d'IA refuse l'accès", badge: "Accès à l'IA refusé" },
  MODEL_NOT_INSTALLED: { title: "Modèle d'IA introuvable", badge: 'Modèle IA introuvable' },
  AI_SERVER_UNREACHABLE: { title: "Le serveur d'IA est injoignable", badge: 'Serveur IA injoignable' },
  AI_QUOTA_EXCEEDED: { title: "Quota du service d'IA atteint", badge: 'Quota IA atteint' },
  AI_BUSY: { title: "Le serveur d'IA est surchargé", badge: 'Serveur IA surchargé' },
  AI_TIMEOUT: { title: "Le serveur d'IA répond trop lentement", badge: 'Serveur IA trop lent' },
  AI_BAD_RESPONSE: { title: "Réponse inattendue du serveur d'IA", badge: 'Serveur IA : réponse inattendue' },
  ENGINE_NOT_RUNNING: { title: "Le moteur d'IA n'est pas démarré", badge: 'Moteur IA arrêté' },
  ENGINE_OUTDATED: { title: "Le moteur d'IA doit être mis à jour", badge: 'Moteur IA à mettre à jour' },
  CONTEXT_TOO_LARGE: { title: "Le modèle d'IA est mal réglé", badge: 'IA mal réglée' },
  SERVER_MISCONFIGURED: { title: 'Le serveur Magistra est mal configuré', badge: 'Serveur mal configuré' },
};
const DEFAULT_TITLE = { title: "Le serveur d'IA est indisponible", badge: 'Serveur IA indisponible' };

export interface ServerAIView {
  /** checking : vérification en cours ; ready : prête ; unverified : état non vérifié (génération possible). */
  state: 'checking' | 'ready' | 'unverified' | 'not_ready';
  /** Libellé court (barre latérale). */
  badge: string;
  /** Titre (carte « IA non prête », réglages). */
  title: string;
  /** Cause précise (message du serveur ou texte dédié). */
  detail: string | null;
  /** Code à transmettre à l'administrateur (état « not_ready » seulement). */
  code?: ErrorCode;
  /** Conseil sur la conduite à tenir. */
  advice?: string;
  /** Avertissement non bloquant (IA prête). */
  warning?: string;
}

/**
 * Traduit les capacités du serveur en un état lisible.
 * `checkError` : échec de la lecture de l'état lui-même (réseau, session…).
 */
export function serverAIView(
  caps: Capabilities | null,
  options: { mode: ServerMode; loading?: boolean; checkError?: string | null },
): ServerAIView {
  if (!caps) {
    if (options.loading || !options.checkError) {
      return { state: 'checking', badge: 'Vérification du serveur IA…', title: "Vérification de l'intelligence artificielle…", detail: null };
    }
    return {
      state: 'not_ready',
      badge: 'Serveur IA indisponible',
      title: "Impossible de vérifier l'état de l'intelligence artificielle",
      detail: options.checkError,
      advice: 'Vérifiez votre connexion, puis réessayez.',
    };
  }

  if (caps.ready) {
    const warning = caps.aiWarning;
    if (warning?.code === 'AI_STATUS_UNKNOWN') {
      return {
        state: 'unverified',
        badge: "État de l'IA non vérifié",
        title: "Serveur d'IA : état non vérifié",
        detail: STATUS_UNKNOWN_TEXT,
      };
    }
    return {
      state: 'ready',
      badge: 'Serveur IA disponible',
      title: "L'intelligence artificielle est prête",
      detail: null,
      ...(warning?.message ? { warning: warning.message } : {}),
    };
  }

  const notice: AINotice = caps.notReady ?? { code: 'AI_SERVER_UNAVAILABLE', message: defaultMessage('AI_SERVER_UNAVAILABLE') };
  const { title, badge } = TITLES[notice.code] ?? DEFAULT_TITLE;
  const personal = options.mode === 'personal';
  const message = notice.message.trim();
  // AI_NOT_CONFIGURED couvre plusieurs causes (préréglage inconnu, clé manquante, AI_MODEL absent, Ollama ou LM Studio
  // sans modèle…) : le message précis du serveur est gardé. Le texte dédié ne remplace que le message générique ou vide.
  const generic = notice.code === 'AI_NOT_CONFIGURED' && (!message || message === defaultMessage('AI_NOT_CONFIGURED'));
  const detail = generic
    ? (personal ? NOT_CONFIGURED_PERSONAL_TEXT : NOT_CONFIGURED_WEB_TEXT)
    : message || defaultMessage(notice.code);

  let advice: string | undefined;
  if (generic && personal) {
    // Le texte dédié dit déjà quoi faire.
    advice = undefined;
  } else if (notice.code === 'AI_QUOTA_EXCEEDED') {
    advice = 'La génération redeviendra possible quand le quota sera renouvelé.';
  } else if (TRANSIENT.includes(notice.code)) {
    advice = personal
      ? 'Réessayez dans quelques instants.'
      : "Réessayez dans quelques instants ; si le problème continue, contactez l'administrateur du site.";
  } else {
    advice = personal
      ? `Ce problème ne se résoudra pas tout seul : corrigez la configuration du serveur Magistra (vérification : ${CHECK_PERSONAL}).`
      : "Ce problème ne se résoudra pas tout seul : transmettez le code ci-dessous à l'administrateur du site.";
  }
  return { state: 'not_ready', badge, title, detail, code: notice.code, ...(advice ? { advice } : {}) };
}

// ─── Transparence sur le prestataire ────────────────────────────────────────

/** « France (centre de Gravelines) » → « France, centre de Gravelines » (pas de parenthèses imbriquées). */
function flattenParens(text: string): string {
  return text.replace(/\s*\(([^()]*)\)/g, ', $1').trim();
}

function sentence(text: string | undefined): string | null {
  const t = text?.trim();
  if (!t) return null;
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

const UNKNOWN_COUNTRY = /^(inconnu|non précisé|non precise)$/i;
/** Lieux décrits par un nom commun (« Même machine… », « Réseau local… ») : minuscule au milieu de la phrase. */
const COMMON_PLACE_START = /^(Même|Serveur|Réseau|Variable)\b/;

function placeOf(country: string | undefined): string {
  const c = country?.trim();
  if (!c) return '';
  if (UNKNOWN_COUNTRY.test(c)) return " (pays d'hébergement non précisé)";
  const place = flattenParens(c);
  // Les noms propres (France, Union européenne, États-Unis…) gardent leur majuscule.
  return ` (${COMMON_PLACE_START.test(place) ? place.charAt(0).toLowerCase() + place.slice(1) : place})`;
}

/**
 * Message de confidentialité du site web / mode personnel, selon l'IA RÉELLEMENT utilisée.
 * Prestataire tiers : on dit clairement que les textes lui sont envoyés (jamais « restent chez vous »).
 */
export function serverPrivacyMessage(serverLabel: string, info: ProviderInfo | undefined): string {
  const originals = 'Vos fichiers originaux ne quittent pas votre navigateur.';
  if (!info) {
    return `Les données utilisées pour la génération (demande et extraits de vos documents) sont transmises au serveur Magistra puis au serveur d'IA configuré par l'administrateur (${serverLabel}). ${originals}`;
  }
  const parts: string[] = [];
  if (info.thirdParty) {
    parts.push(`Les demandes et les extraits de vos documents sont envoyés à « ${info.label} »${placeOf(info.country)} pour la génération.`);
  } else {
    parts.push(`Les demandes et les extraits de vos documents sont transmis au serveur Magistra puis à « ${info.label} »${placeOf(info.country)} pour la génération.`);
  }
  const retention = sentence(info.retention);
  const training = sentence(info.training);
  if (retention) parts.push(retention);
  if (training) parts.push(training);
  parts.push(originals);
  return parts.join(' ');
}

/** Fiche prestataire reçue du serveur (/api/status, /api/mode), vérifiée champ par champ (jamais d'URL d'API ni de clé). */
export function parseProviderInfo(value: unknown): ProviderInfo | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.label !== 'string' || !v.label.trim() || typeof v.thirdParty !== 'boolean') return undefined;
  const text = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, 400) : undefined);
  const info: ProviderInfo = { label: v.label.trim().slice(0, 200), thirdParty: v.thirdParty };
  const country = text(v.country);
  const retention = text(v.retention);
  const training = text(v.training);
  const privacyUrl = text(v.privacyUrl);
  if (country) info.country = country;
  if (retention) info.retention = retention;
  if (training) info.training = training;
  if (privacyUrl) info.privacyUrl = privacyUrl;
  return info;
}

/**
 * Annonce prudente quand le service d'IA n'a pas encore pu être vérifié (GET /api/status en cours ou en échec) et que
 * le prestataire n'est pas connu d'avance : jamais « restent sur cet ordinateur ».
 */
export const UNVERIFIED_PROVIDER_TEXT =
  "Le service d'IA n'a pas encore pu être vérifié. Si vous générez, votre demande et les extraits de vos documents seront "
  + "transmis au serveur Magistra puis au service d'IA choisi par l'administrateur, qui peut être un service en ligne extérieur. "
  + 'Son nom s’affichera dès la vérification. Vos fichiers originaux ne quittent pas votre navigateur.';

/** Même annonce en mode personnel (l'enseignant a lui-même configuré son serveur). */
export const UNVERIFIED_PROVIDER_PERSONAL_TEXT =
  "Le service d'IA n'a pas encore pu être vérifié. Si vous générez, votre demande et les extraits de vos documents seront "
  + "transmis à votre serveur Magistra puis à l'IA qu'il utilise : une IA de cet ordinateur, ou le service en ligne choisi dans "
  + 'son fichier .env. Son nom s’affichera dès la vérification. Vos fichiers originaux ne quittent pas votre navigateur.';

/** Lien vers la page publique du prestataire (https uniquement), ou null. */
export function providerPolicyUrl(info: ProviderInfo | undefined): string | null {
  return info ? safeExternalUrl(info.privacyUrl) : null;
}

/** Contact de l'administrateur : lien mailto:, lien https, ou simple texte. */
export function adminContactLink(contact: string | undefined): { text: string; href: string | null } | null {
  const text = contact?.trim();
  if (!text) return null;
  if (/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(text)) return { text, href: `mailto:${text}` };
  const url = safeExternalUrl(text);
  return { text, href: url };
}
