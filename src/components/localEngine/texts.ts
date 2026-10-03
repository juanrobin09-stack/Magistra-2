// Textes de Magistra locale (site web → application Windows de l'enseignant) : les formulations EXACTES demandées par
// l'utilisateur, réunies ici pour que la carte du tableau de bord, les réglages et la page Générer disent la même chose.
//
// Règles d'écriture : jamais d'adresse (localhost, 127.0.0.1…), jamais de port, jamais le nom du moteur (« Ollama »),
// jamais de clé à saisir ; l'enseignant n'a qu'à ouvrir Magistra et cliquer.

import { defaultMessage } from '@shared/errors';
import type { LocalEngineState } from '@/lib/localConnector/controller';
import { isDisplayableText } from '@/lib/localConnector/texts';

// ─── États de Magistra locale ───────────────────────────────────────────────

export const LOCAL_INTRO_TEXT = 'Activez l’intelligence Magistra sur votre ordinateur.';
export const LOCAL_INTRO_DETAIL =
  'L’application Magistra pour Windows fait tourner l’intelligence artificielle sur cet ordinateur : ce site lui confie vos générations, sans clé ni réglage.';
export const SEARCHING_TEXT = 'Recherche de Magistra sur cet ordinateur…';
export const FOUND_TEXT = '✓ Magistra trouvée';
export const FOUND_DETAIL = 'Connectez-la à ce navigateur : l’application vous demandera votre accord.';
export const NOT_DETECTED_TEXT = 'Magistra n’est pas encore détectée.';
/**
 * Rien ne répond sur les ports dédiés : application fermée ou absente, mais aussi accès du site désactivé dans
 * l'application (ou accès réservés à Magistra occupés) — le site ne peut pas faire la différence, il le dit.
 */
export const SITE_ACCESS_HINT = 'Si elle est déjà ouverte, vérifiez dans Magistra → Réglages → « Site web Magistra » que l’accès du site est activé.';
export const NOT_DETECTED_DETAIL =
  `Si Magistra est installée, ouvrez-la puis réessayez. ${SITE_ACCESS_HINT} Sinon, téléchargez-la : elle s’installe en quelques secondes, sans droits d’administrateur.`;
export const PAIRING_TEXT = 'Confirmez dans l’application Magistra…';
export const PAIRING_DETAIL =
  'Magistra vous demande d’autoriser ce site : cliquez sur « Autoriser ». Si votre navigateur demande d’ouvrir Magistra, acceptez.';
/** Code de vérification de la demande en cours, que la boîte de Magistra affiche aussi (« K7F-2QX »). */
export const PAIRING_CODE_LABEL = 'Code de vérification :';
export const PAIRING_CODE_HINT = 'Magistra affiche le même code : s’il est différent, cliquez sur « Refuser ».';
export function pairingCodeText(code: string): string {
  return `${PAIRING_CODE_LABEL} ${code}. ${PAIRING_CODE_HINT}`;
}
export const CONNECTED_TEXT = '✓ Magistra locale connectée';
export const JUST_CONNECTED_TEXT = '✓ Intelligence locale connectée';
export const APP_CLOSED_TEXT = 'L’application Magistra est fermée.';
/** Suivi de SITE_ACCESS_HINT (paragraphe distinct : le panneau de la page Générer, qui dit déjà d'ouvrir Magistra, le garde). */
export const APP_CLOSED_DETAIL = 'Ouvrez Magistra sur cet ordinateur pour utiliser l’intelligence locale.';
/**
 * Appairé : une application Magistra répond, mais ne reconnaît pas ce navigateur (jamais « fermée » : elle vient de
 * répondre).
 */
export const UNRECOGNIZED_TEXT = 'Magistra ne reconnaît pas ce navigateur.';
/**
 * L'application a répondu mais ne peut pas servir en l'état (reconnexion refusée ou expirée, réponse inattendue,
 * autre version) : la cause suit, jamais « fermée ».
 */
export const UNUSABLE_TEXT = 'Magistra locale n’est pas utilisable pour le moment.';
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
/** Aucune file d'attente : une demande envoyée pendant ce temps est refusée (GENERATION_BUSY), jamais mise en attente. */
export const ENGINE_BUSY_TEXT = 'Une génération est en cours dans l’application Magistra : lancez la vôtre quand elle sera terminée.';

// ─── Boutons ────────────────────────────────────────────────────────────────

export const DOWNLOAD_SHORT_LABEL = 'Télécharger Magistra';
export const SEARCH_EXISTING_LABEL = "J'ai déjà Magistra : la rechercher";
export const CONNECT_LABEL = 'Connecter Magistra locale';
export const DISCONNECT_LABEL = 'Déconnecter Magistra locale';
/** Confirmation de la déconnexion (réglages du site). */
export const DISCONNECT_TEXT =
  'Ce navigateur ne pourra plus utiliser l’intelligence artificielle de cet ordinateur. Si l’application Magistra est ouverte, l’autorisation y est aussi retirée ; sinon, retirez-la dans Magistra → Réglages → « Site web Magistra ». Vous pourrez reconnecter Magistra locale à tout moment.';
/** Même confirmation quand le navigateur bloque l'accès à l'application : le retrait ne pourra pas lui être demandé. */
export const DISCONNECT_BLOCKED_TEXT =
  'Ce navigateur ne pourra plus utiliser l’intelligence artificielle de cet ordinateur. Votre navigateur bloque l’accès à l’application Magistra : l’autorisation ne pourra pas y être retirée d’ici. Retirez-la aussi dans Magistra → Réglages → « Site web Magistra ». Vous pourrez reconnecter Magistra locale à tout moment.';
export const RETRY_LABEL = 'Réessayer';
export const CANCEL_LABEL = 'Annuler';
export const SEARCH_WITH_PERMISSION_LABEL = 'Rechercher Magistra…';
export const CONTINUE_LABEL = 'Continuer';
export const USE_SERVER_LABEL = 'Utiliser le serveur en ligne…';
export const USE_LOCAL_LABEL = 'Utiliser l’IA locale';
export const INSTALLED_TEXT = 'J’ai installé Magistra';
/**
 * Section « Magistra pour Windows », visiteur non connecté : le tableau de bord ne cherche PAS Magistra de lui-même
 * (aucune requête vers l'ordinateur sans action de l'enseignant) ; le texte dit quel bouton utiliser.
 */
export const SIGNED_OUT_DETECT_TEXT =
  `Connectez-vous : sur votre tableau de bord, cliquez sur « ${SEARCH_EXISTING_LABEL} » pour la connecter à ce navigateur.`;
export const DETECT_NOW_LABEL = 'Détecter maintenant';

// ─── Installation de Magistra pour Windows ──────────────────────────────────
// Textes dans windowsTexts.ts (sans dépendance : le site vitrine les utilise sans le connecteur local).

export {
  ACTIVATE_AI_NOTE, ALREADY_INSTALLED_TEXT, DOWNLOAD_WINDOWS_LABEL, INSTALL_STEPS, INSTALL_STEPS_LABEL, NOT_PUBLISHED_TEXT,
  OPEN_APP_LABEL,
} from './windowsTexts';

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

// Filtre partagé avec la bibliothèque (erreurs d'une génération locale, src/lib/runtime/hybrid.ts).
export { isDisplayableText, localEngineMessage } from '@/lib/localConnector/texts';

/** Libellé du modèle affiché (« Magistra Standard ») ; jamais le nom du moteur ni une adresse. */
export function localModelLabel(label: string | undefined): string | null {
  const text = label?.trim() ?? '';
  return text && isDisplayableText(text) ? text : null;
}

/**
 * Appairé, rien ne répond (aucune cause, ou le message par défaut de CONNECTOR_UNREACHABLE) : l'application est
 * fermée (ou l'accès du site désactivé). Toute autre cause vient d'une application qui a répondu.
 */
export function appClosedPlain(state: LocalEngineState): boolean {
  return !state.error || (state.error.code === 'CONNECTOR_UNREACHABLE' && state.error.message === defaultMessage('CONNECTOR_UNREACHABLE'));
}

/**
 * Résumé d'une ligne de l'état de Magistra locale (liste des priorités). `searched` : l'enseignant a lancé une
 * recherche pendant cette visite — sans elle, un navigateur jamais appairé n'est pas sondé (sauf autorisation déjà
 * accordée) : « non détectée » affirmerait un résultat qui n'existe pas.
 */
export function localEngineSummary(state: LocalEngineState, searched = false): string {
  switch (state.kind) {
    case 'idle':
    case 'checking':
      return 'recherche en cours…';
    case 'needs-permission':
      return 'autorisation du navigateur nécessaire';
    case 'permission-denied':
      return 'bloquée par le navigateur';
    case 'not-found':
      return searched || state.error || state.permission === 'granted' ? 'non détectée sur cet ordinateur' : 'pas encore connectée à ce navigateur';
    case 'found':
      return 'trouvée, pas encore connectée';
    case 'pairing':
      return 'connexion en cours…';
    case 'app-closed':
      if (state.error?.code === 'CONNECTOR_UNPAIRED') return 'connectée, pas reconnue par l’application Magistra qui répond';
      return appClosedPlain(state) ? 'connectée, application fermée' : 'connectée, pas utilisable pour le moment';
    case 'connected': {
      const engine = state.status?.engine;
      if (engine && !engine.local) return 'connectée, réglée sur un serveur distant dans l’application';
      if (engine && !engine.ready) return 'connectée, moteur pas encore prêt';
      const model = localModelLabel(engine?.label);
      return model ? `connectée — ${model}` : 'connectée';
    }
  }
}
