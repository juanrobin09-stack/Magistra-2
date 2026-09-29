// Site web : générations par le serveur Magistra en ligne OU par Magistra locale (IA de l'ordinateur de l'enseignant,
// via l'application Windows et le connecteur local), selon le choix de l'enseignant (engineChoice).
//
// Règles :
//  - le moteur est choisi AU MOMENT de l'appel (choix enregistré, sinon Magistra locale si ce navigateur est appairé) ;
//  - JAMAIS de repli silencieux : Magistra locale injoignable ou non prête → capacités « non prête » (route
//    'local-connector') et génération en erreur ; seul un choix explicite de l'enseignant passe au serveur en ligne ;
//  - route locale : la demande complète et les extraits de documents vont UNIQUEMENT au connecteur local ; la génération
//    à enregistrer (done.record : résultat, sources citées et paramètres de la demande — sujet, consignes, contenu à
//    adapter, noms des documents… ; jamais le texte des extraits ni le travail d'élève) est envoyée au serveur Magistra
//    pour l'historique du compte (POST /api/generation). Le texte affiché le dit exactement (LOCAL_PRIVACY_MESSAGE).

import { defaultMessage, MagistraError, toMagistraError, type ErrorCode } from '@shared/errors';
import type { AINotice, Capabilities, GenerationEvent, GenerationRecordDraft, GenerationRequest } from '@shared/types';
import { LOCAL_CONNECTOR_PRIVACY_MESSAGE } from '@/lib/generation/research';
import { getEngineChoice } from '@/lib/localConnector/engineChoice';
import type { LocalEngineController, LocalEngineState } from '@/lib/localConnector/controller';
import { localEngineMessage } from '@/lib/localConnector/texts';
import type { GenerationClient } from './types';

/**
 * Confidentialité affichée quand Magistra locale traite les générations : même texte que les notes de la page Générer
 * (src/lib/generation/research.ts, seule source).
 */
export const LOCAL_PRIVACY_MESSAGE = LOCAL_CONNECTOR_PRIVACY_MESSAGE;
/** Nom du moteur local (suivi du libellé du modèle quand il est connu). */
export const LOCAL_ENGINE_LABEL = 'Magistra locale';
/** Extraits de documents par défaut tant que l'application n'a pas donné sa limite. */
export const LOCAL_DEFAULT_MAX_DOCUMENT_CHARS = 40_000;

export const LOCAL_NEEDS_PERMISSION_MESSAGE =
  "Votre navigateur doit autoriser ce site à dialoguer avec l'application Magistra de cet ordinateur : relancez la recherche de Magistra, puis acceptez la demande du navigateur.";
export const LOCAL_NOT_CONNECTED_MESSAGE =
  "Magistra locale n'est pas connectée à ce navigateur : connectez-la (Tableau de bord ou Réglages), ou choisissez le serveur en ligne.";
export const LOCAL_PAIRING_MESSAGE = "Connexion à Magistra locale en cours : confirmez dans l'application Magistra.";
export const LOCAL_CHECKING_MESSAGE = 'Recherche de Magistra sur cet ordinateur…';
export const LOCAL_NOT_READY_MESSAGE =
  "L'intelligence locale de Magistra n'est pas prête : ouvrez l'application Magistra pour la préparer.";
export const LOCAL_BUSY_MESSAGE =
  "Une génération est déjà en cours dans l'application Magistra : la vôtre pourra commencer quand elle sera terminée.";
/** Même texte que la pipeline quand l'enregistrement échoue (shared/pipeline.ts). */
export const LOCAL_SAVE_FAILED_MESSAGE =
  "Le contenu est affiché mais n'a pas pu être enregistré dans l'historique. Copiez-le ou exportez-le.";

/** Erreurs de génération locale après lesquelles l'état de Magistra locale est relu (carte, bandeau). */
const STATE_CHANGING_ERRORS = new Set<ErrorCode>([
  'CONNECTOR_UNREACHABLE', 'CONNECTOR_UNPAIRED', 'LOCAL_NETWORK_PERMISSION_DENIED', 'LOCAL_ENGINE_REMOTE',
]);

export type SaveGenerationDraft = (draft: GenerationRecordDraft) => Promise<{ id: string }>;

/**
 * Évènement de Magistra locale tel qu'affiché : messages d'erreur et d'avertissement filtrés (jamais le nom du moteur,
 * d'adresse, de port ni de chemin ; texte neutre pour les codes du moteur), seconde barrière après l'application.
 */
function displayableEvent(event: GenerationEvent): GenerationEvent {
  if (event.type !== 'error' && event.type !== 'warning') return event;
  const message = localEngineMessage(event.code, event.message);
  return message === event.message ? event : { ...event, message };
}

export type EngineRoute = NonNullable<Capabilities['route']>;

function localBase(): Pick<Capabilities, 'privacy' | 'route'> {
  return { privacy: { level: 'local', message: LOCAL_PRIVACY_MESSAGE }, route: 'local-connector' };
}

function notReadyCapabilities(notReady: AINotice): Capabilities {
  return {
    maxDocumentChars: LOCAL_DEFAULT_MAX_DOCUMENT_CHARS,
    research: { academic: false, web: false, institutional: false, wikipedia: false },
    ...localBase(),
    engineLabel: LOCAL_ENGINE_LABEL,
    ready: false,
    notReady,
  };
}

/** Capacités de Magistra locale d'après l'état du contrôleur (jamais de repli vers le serveur). */
export function localCapabilities(state: LocalEngineState): Capabilities {
  if (state.kind === 'connected' && state.status) {
    const { engine, capabilities, busy } = state.status;
    const caps: Capabilities = {
      maxDocumentChars: capabilities.maxDocumentChars,
      research: { ...capabilities.research },
      ...localBase(),
      engineLabel: engine.label ? `${LOCAL_ENGINE_LABEL} — ${engine.label}` : LOCAL_ENGINE_LABEL,
      ready: engine.ready && engine.local,
    };
    if (!engine.local) {
      // Application réglée sur un serveur distant : le connecteur refuse de générer (jamais de relais vers un tiers).
      caps.notReady = { code: 'LOCAL_ENGINE_REMOTE', message: defaultMessage('LOCAL_ENGINE_REMOTE') };
    } else if (!engine.ready) {
      caps.notReady = engine.notReady ?? { code: 'ENGINE_NOT_RUNNING', message: LOCAL_NOT_READY_MESSAGE };
    } else if (busy) {
      caps.aiWarning = { code: 'GENERATION_BUSY', message: LOCAL_BUSY_MESSAGE };
    } else if (engine.warning) {
      caps.aiWarning = engine.warning;
    }
    return caps;
  }
  switch (state.kind) {
    case 'permission-denied':
      return notReadyCapabilities(state.error ?? { code: 'LOCAL_NETWORK_PERMISSION_DENIED', message: defaultMessage('LOCAL_NETWORK_PERMISSION_DENIED') });
    case 'needs-permission':
      return notReadyCapabilities({ code: 'LOCAL_NETWORK_PERMISSION_DENIED', message: LOCAL_NEEDS_PERMISSION_MESSAGE });
    case 'pairing':
      return notReadyCapabilities({ code: 'CONNECTOR_UNPAIRED', message: LOCAL_PAIRING_MESSAGE });
    case 'found':
    case 'not-found':
      if (state.paired) return notReadyCapabilities(state.error ?? { code: 'CONNECTOR_UNREACHABLE', message: defaultMessage('CONNECTOR_UNREACHABLE') });
      return notReadyCapabilities(state.error?.code === 'CONNECTOR_UNPAIRED' ? state.error : { code: 'CONNECTOR_UNPAIRED', message: LOCAL_NOT_CONNECTED_MESSAGE });
    case 'idle':
    case 'checking':
      return notReadyCapabilities({ code: 'CONNECTOR_UNREACHABLE', message: LOCAL_CHECKING_MESSAGE });
    default:
      return notReadyCapabilities(state.error ?? { code: 'CONNECTOR_UNREACHABLE', message: defaultMessage('CONNECTOR_UNREACHABLE') });
  }
}

export class HybridGenerationClient implements GenerationClient {
  readonly kind = 'web' as const;
  private readonly server: GenerationClient;
  private readonly local: LocalEngineController;
  private readonly saveDraft: SaveGenerationDraft;

  constructor(server: GenerationClient, local: LocalEngineController, saveDraft: SaveGenerationDraft) {
    this.server = server;
    this.local = local;
    this.saveDraft = saveDraft;
  }

  /**
   * Moteur de la prochaine génération, lu AU MOMENT de l'appel. L'appairage est lu dans le magasin (et non dans
   * l'état du contrôleur, peut-être pas encore vérifié) : un navigateur appairé sans choix enregistré n'est jamais
   * envoyé au serveur en ligne par défaut.
   */
  async route(): Promise<EngineRoute> {
    const paired = await this.local.client.hasPairing().catch(() => false);
    return getEngineChoice(paired) === 'local' ? 'local-connector' : 'server';
  }

  async capabilities(): Promise<Capabilities> {
    if ((await this.route()) === 'server') return { ...(await this.server.capabilities()), route: 'server' };
    // Relecture de l'état (sans demande d'autorisation du navigateur) : la carte et le bandeau restent à jour.
    await this.local.refresh();
    return localCapabilities(this.local.getSnapshot());
  }

  async generate(request: GenerationRequest, onEvent: (event: GenerationEvent) => void, signal: AbortSignal): Promise<void> {
    if ((await this.route()) === 'server') {
      await this.server.generate(request, onEvent, signal);
      return;
    }
    let final: Extract<GenerationEvent, { type: 'done' | 'error' }> | null = null;
    await this.local.client.generate(request, received => {
      if (final) return; // rien n'est transmis après l'évènement final
      const event = displayableEvent(received);
      if (event.type === 'done') {
        final = event; // transmis après l'enregistrement du résultat
        return;
      }
      if (event.type === 'error') final = event;
      onEvent(event);
    }, signal);

    const last = final as Extract<GenerationEvent, { type: 'done' | 'error' }> | null;
    if (!last) {
      const e = new MagistraError('CONNECTOR_UNREACHABLE');
      onEvent({ type: 'error', code: e.code, message: e.message, retryable: e.retryable });
      return;
    }
    if (last.type === 'error') {
      // Erreur locale : signalée telle quelle, jamais de nouvel essai sur le serveur en ligne.
      if (STATE_CHANGING_ERRORS.has(last.code)) void this.local.refresh();
      return;
    }
    // Génération réussie : l'application a répondu (prouvé). L'état affiché (« application fermée », moteur pas encore
    // démarré, occupée…) est relu, sans attendre — refresh ne publie que s'il change.
    void this.local.refresh();
    await this.finish(last, onEvent);
  }

  /** Enregistre le résultat d'une génération locale dans l'historique du compte, puis transmet « done ». */
  private async finish(event: Extract<GenerationEvent, { type: 'done' }>, onEvent: (event: GenerationEvent) => void): Promise<void> {
    const { record, ...done } = event;
    if (done.saved && done.id) {
      onEvent(done);
      return;
    }
    if (!record || typeof record !== 'object') {
      onEvent({ type: 'warning', code: 'STORAGE_ERROR', message: LOCAL_SAVE_FAILED_MESSAGE });
      onEvent({ ...done, saved: false, id: undefined });
      return;
    }
    try {
      const result = await this.saveDraft(record);
      if (!result || typeof result.id !== 'string' || !result.id) throw new MagistraError('STORAGE_ERROR');
      onEvent({ ...done, saved: true, id: result.id });
    } catch (err) {
      const e = toMagistraError(err, 'STORAGE_ERROR');
      // Cause précise (session expirée, historique momentanément inaccessible…) ajoutée quand elle en dit plus.
      const precise = e.code !== 'INTERNAL' && e.message !== defaultMessage('STORAGE_ERROR') ? e.message.replace(/[.\s]+$/, '') : '';
      const message = precise
        ? `Le contenu est affiché mais n'a pas pu être enregistré dans l'historique (${precise}). Copiez-le ou exportez-le.`
        : LOCAL_SAVE_FAILED_MESSAGE;
      onEvent({ type: 'warning', code: 'STORAGE_ERROR', message });
      onEvent({ ...done, saved: false, id: undefined });
    }
  }
}
