// Textes de Magistra locale (site web → application Windows de l'enseignant) : les formulations EXACTES demandées par
// l'utilisateur, réunies ici pour que la carte du tableau de bord, les réglages et la page Générer disent la même chose.
//
// Règles d'écriture : jamais d'adresse (localhost, 127.0.0.1…), jamais de port, jamais le nom du moteur (« Ollama »),
// jamais de clé à saisir ; l'enseignant n'a qu'à ouvrir Magistra et cliquer.

import { defaultMessage, type ErrorCode } from '@shared/errors';
import type { LocalEngineState } from '@/lib/localConnector/controller';

// ─── États de Magistra locale ───────────────────────────────────────────────

export const LOCAL_INTRO_TEXT = 'Activez l’intelligence Magistra sur votre ordinateur.';
export const LOCAL_INTRO_DETAIL =
  'L’application Magistra pour Windows fait tourner l’intelligence artificielle sur cet ordinateur : ce site lui confie vos générations, sans clé ni réglage.';
export const SEARCHING_TEXT = 'Recherche de Magistra sur cet ordinateur…';
export const FOUND_TEXT = '✓ Magistra trouvée';
export const FOUND_DETAIL = 'Connectez-la à ce navigateur : l’application vous demandera votre accord.';
export const NOT_DETECTED_TEXT = 'Magistra n’est pas encore détectée.';
export const NOT_DETECTED_DETAIL =
  'Si Magistra est installée, ouvrez-la puis réessayez. Sinon, téléchargez-la : l’installation ne prend que quelques minutes.';
export const PAIRING_TEXT = 'Confirmez dans l’application Magistra…';
export const PAIRING_DETAIL =
  'Magistra vous demande d’autoriser ce site : cliquez sur « Autoriser ». Si votre navigateur demande d’ouvrir Magistra, acceptez.';
export const CONNECTED_TEXT = '✓ Magistra locale connectée';
export const JUST_CONNECTED_TEXT = '✓ Intelligence locale connectée';
export const APP_CLOSED_TEXT = 'L’application Magistra est fermée.';
export const APP_CLOSED_DETAIL = 'Ouvrez Magistra sur cet ordinateur pour utiliser l’intelligence locale.';
export const NEEDS_PERMISSION_TEXT = 'Autorisation du navigateur nécessaire';
export const PERMISSION_EXPLANATION =
  'Votre navigateur va vous demander l’autorisation d’accéder aux applications de cet appareil : acceptez-la. Elle permet uniquement à ce site de dialoguer avec l’application Magistra installée sur cet ordinateur.';
export const PERMISSION_DENIED_TEXT = 'Votre navigateur bloque l’accès à l’application Magistra.';
export const PERMISSION_DENIED_INTRO = 'Pour l’autoriser :';
/** Étapes pour accorder l'autorisation (Chrome, Edge : « Applications sur l'appareil » ou « Réseau local »). */
export const PERMISSION_DENIED_STEPS: readonly string[] = [
  'cliquez sur l’icône à gauche de l’adresse du site ;',
  'ouvrez les autorisations du site ;',
  "à la ligne « Applications sur l'appareil » (ou « Réseau local »), choisissez « Autoriser » ;",
  'puis cliquez sur « Réessayer ».',
];
export const ENGINE_BUSY_TEXT = 'Une génération est en cours dans l’application Magistra : la vôtre commencera ensuite.';

// ─── Boutons ────────────────────────────────────────────────────────────────

export const DOWNLOAD_WINDOWS_LABEL = 'Télécharger Magistra pour Windows';
export const DOWNLOAD_SHORT_LABEL = 'Télécharger Magistra';
export const SEARCH_EXISTING_LABEL = "J'ai déjà Magistra : la rechercher";
export const CONNECT_LABEL = 'Connecter Magistra locale';
export const DISCONNECT_LABEL = 'Déconnecter Magistra locale';
export const RETRY_LABEL = 'Réessayer';
export const CANCEL_LABEL = 'Annuler';
export const OPEN_APP_LABEL = 'Ouvrir Magistra';
export const SEARCH_WITH_PERMISSION_LABEL = 'Rechercher Magistra…';
export const CONTINUE_LABEL = 'Continuer';
export const USE_SERVER_LABEL = 'Utiliser le serveur en ligne…';
export const USE_LOCAL_LABEL = 'Utiliser l’IA locale';
export const INSTALLED_TEXT = 'J’ai installé Magistra';
export const DETECT_NOW_LABEL = 'Détecter maintenant';

// ─── Moteur de génération (site web) ────────────────────────────────────────

export const LOCAL_BANNER_TEXT = 'IA locale — Vos contenus sont générés sur cet ordinateur.';
export const LOCAL_AVAILABLE_TEXT = 'Magistra locale est disponible';
export const LOCAL_NOT_READY_TITLE = 'Magistra locale n’est pas prête';
export const LOCAL_CHOICE_LABEL = 'Magistra locale (recommandé)';
export const ROUTE_CHECKING_TEXT = 'Vérification du moteur de génération…';
/** Nom affiché quand le serveur n'a annoncé aucun prestataire. */
export const DEFAULT_SERVER_NAME = 'le serveur Magistra en ligne';
export const NOT_CONFIGURED_TEXT = 'non configuré';

export function serverChoiceLabel(provider: string): string {
  return `Serveur en ligne : ${provider}`;
}

/** Bandeau de la page Générer quand le serveur en ligne traite la génération. */
export function remoteBannerText(provider: string): string {
  return `Cette génération sera traitée par ${provider} (serveur distant).`;
}

/** Confirmation EXPLICITE avant tout passage du local au distant. */
export function remoteConfirmText(provider: string): string {
  return `${remoteBannerText(provider)} Vos demandes et les extraits de vos documents quitteront cet ordinateur.`;
}

export const REMOTE_CONFIRM_TITLE = 'Utiliser le serveur en ligne ?';
export const REMOTE_CONFIRM_LABEL = 'Utiliser le serveur en ligne';

// ─── Application Windows (réglages) ─────────────────────────────────────────

export const WEBSITE_SECTION_TITLE = 'Site web Magistra';
export const WEBSITE_TOGGLE_LABEL = 'Permettre au site Magistra d’utiliser l’IA de cet ordinateur';
/** Note affichée quand le système ne permet pas de chiffrer les autorisations sur le disque. */
export const NOT_PERSISTENT_NOTE =
  'Ce système ne permet pas de protéger les autorisations sur le disque : elles durent jusqu’à la fermeture de Magistra. Il faudra reconnecter le site après chaque redémarrage de l’application.';

// ─── Textes sûrs ────────────────────────────────────────────────────────────

/**
 * Motifs jamais affichés à propos de Magistra locale : nom du moteur, adresse de la boucle locale, adresse IP, port,
 * URL. L'application filtre déjà ses messages (electron/connector/status.ts) ; ce filtre est une seconde barrière
 * (message générique d'un code qui cite le moteur, application ancienne…).
 */
const HIDDEN_PATTERNS: readonly RegExp[] = [
  /ollama/i,
  /\blocalhost\b/i,
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/,
  /\[?::1\]?/,
  /[A-Za-z0-9\])]:\d{2,5}\b/,
  /\b[a-z][a-z0-9+.-]{1,20}:\/\//i,
];

/** Textes neutres, par code, quand le message reçu ne peut pas être affiché tel quel. */
const NEUTRAL_MESSAGES: Partial<Record<ErrorCode, string>> = {
  ENGINE_NOT_INSTALLED: 'Le moteur d’intelligence artificielle de Magistra n’est pas encore installé : ouvrez l’application Magistra pour le préparer.',
  ENGINE_NOT_RUNNING: 'Le moteur d’intelligence artificielle de Magistra n’est pas démarré : ouvrez l’application Magistra.',
  ENGINE_OUTDATED: 'Le moteur d’intelligence artificielle de Magistra doit être mis à jour : ouvrez l’application Magistra.',
  MODEL_NOT_INSTALLED: 'Le modèle d’IA choisi n’est pas encore installé : ouvrez l’application Magistra pour le télécharger.',
};

const GENERIC_NOT_READY =
  "L'intelligence locale de Magistra n'est pas prête : ouvrez l'application Magistra pour la préparer.";

export function isDisplayableText(text: string): boolean {
  return HIDDEN_PATTERNS.every(re => !re.test(text));
}

/** Message de Magistra locale affichable : le message reçu s'il est sûr, sinon un texte neutre pour son code. */
export function localEngineMessage(code: ErrorCode, message: string | undefined): string {
  const text = message?.trim() ?? '';
  if (text && isDisplayableText(text)) return text;
  const neutral = NEUTRAL_MESSAGES[code];
  if (neutral) return neutral;
  const fallback = defaultMessage(code);
  return isDisplayableText(fallback) ? fallback : GENERIC_NOT_READY;
}

/** Libellé du modèle affiché (« Magistra Standard ») ; jamais le nom du moteur ni une adresse. */
export function localModelLabel(label: string | undefined): string | null {
  const text = label?.trim() ?? '';
  return text && isDisplayableText(text) ? text : null;
}

/** Résumé d'une ligne de l'état de Magistra locale (liste des priorités). */
export function localEngineSummary(state: LocalEngineState): string {
  switch (state.kind) {
    case 'idle':
    case 'checking':
      return 'recherche en cours…';
    case 'needs-permission':
      return 'autorisation du navigateur nécessaire';
    case 'permission-denied':
      return 'bloquée par le navigateur';
    case 'not-found':
      return 'non détectée sur cet ordinateur';
    case 'found':
      return 'trouvée, pas encore connectée';
    case 'pairing':
      return 'connexion en cours…';
    case 'app-closed':
      return 'connectée, application fermée';
    case 'connected': {
      const engine = state.status?.engine;
      if (engine && !engine.local) return 'connectée, réglée sur un serveur distant dans l’application';
      if (engine && !engine.ready) return 'connectée, moteur pas encore prêt';
      const model = localModelLabel(engine?.label);
      return model ? `connectée — ${model}` : 'connectée';
    }
  }
}
