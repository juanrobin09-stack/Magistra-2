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
//    pour l'historique du compte (POST /api/generation). Le texte affiché le dit exactement (LOCAL_PRIVACY_MESSAGE) ;
//  - options des outils (format, version élève seule, nombres, notation, ton, besoins) et matières récentes : une
//    application d'avant TOOL_OPTIONS_MIN_APP_VERSION les ignore sans erreur (même protocole ; une matière inconnue y
//    est remplacée par la première du niveau) → demande refusée avant l'envoi quand sa version, relue à l'instant, est
//    plus ancienne, avec les choix en cause et la version nécessaire ; version inconnue → envoyée, et le résultat est
//    signalé si l'application ne les a pas appliqués (paramètres de done.record) ; une génération rédigée pour une
//    autre matière (ou un autre outil, un autre niveau) n'est jamais enregistrée dans l'historique. « Plan d'abord »
//    (planSeulement) a sa propre version minimale (PLAN_FIRST_MIN_APP_VERSION) : une application 2.0.3 applique les autres
//    options mais l'ignorerait, l'enseignante attendrait la séquence complète avant d'en être avertie.

import { compareVersions, parseVersion } from '@shared/ai/models';
import { getMatiereLabel, resolveMatiere, type Matiere } from '@shared/catalog';
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

/**
 * Première version de l'application Windows qui applique les options des outils et connaît les matières de
 * RECENT_MATIERES. Le protocole du connecteur n'a pas changé (une application plus ancienne reste utilisable sans ces
 * choix) : c'est le site qui vérifie.
 */
export const TOOL_OPTIONS_MIN_APP_VERSION = '2.0.3';

/**
 * Première version de l'application Windows qui applique « plan d'abord » (planSeulement), livrée après les options des
 * outils : une application 2.0.3 applique celles-ci mais ignore celle-là sans erreur. Version propre à cette option,
 * vérifiée avant l'envoi comme TOOL_OPTIONS_MIN_APP_VERSION l'est pour les autres.
 */
export const PLAN_FIRST_MIN_APP_VERSION = '2.0.4';

/**
 * Matières apparues avec TOOL_OPTIONS_MIN_APP_VERSION. Une application plus ancienne ne les connaît pas et les
 * remplace SANS ERREUR par la première matière du niveau (« Se repérer dans le temps et l'espace » → « Mobiliser le
 * langage — Oral ») : même vérification de version que les options des outils. Toute matière ajoutée au catalogue
 * après une version publiée de l'application s'ajoute ici (avec la version minimale correspondante).
 */
const RECENT_MATIERES: ReadonlySet<Matiere> = new Set<Matiere>(['temps_espace']);

/** Options des outils (champs de la demande) et leur nom pour l'enseignant, dans l'ordre du formulaire. */
const TOOL_OPTIONS = [
  ['modalite', 'format'],
  ['sansCorrige', 'version élève seule'],
  ['nombreExercices', 'nombre demandé'],
  ['nombreSeances', 'nombre de séances'],
  ['planSeulement', "plan d'abord"],
  ['typeEvaluation', "objectif de l'évaluation"],
  ['bareme', 'notation'],
  ['ton', 'ton'],
  ['besoins', 'besoins particuliers'],
] as const satisfies readonly (readonly [keyof GenerationRequest, string])[];

export type ToolOption = (typeof TOOL_OPTIONS)[number][0];

/** Version minimale propre à une option, quand elle est plus récente que TOOL_OPTIONS_MIN_APP_VERSION. */
const OPTION_MIN_APP_VERSION: Readonly<Partial<Record<ToolOption, string>>> = { planSeulement: PLAN_FIRST_MIN_APP_VERSION };

/** Première version de l'application Windows qui applique cette option. */
export function toolOptionMinVersion(option: ToolOption): string {
  return OPTION_MIN_APP_VERSION[option] ?? TOOL_OPTIONS_MIN_APP_VERSION;
}

/** Version à installer pour ces options (et cette matière récente) : la plus récente de leurs versions minimales. */
function requiredVersion(options: readonly ToolOption[], matiere: Matiere | null = null): string {
  const versions = [...options.map(toolOptionMinVersion), ...(matiere ? [TOOL_OPTIONS_MIN_APP_VERSION] : [])];
  return versions.reduce((latest, version) => (compareVersions(version, latest) > 0 ? version : latest), TOOL_OPTIONS_MIN_APP_VERSION);
}

/** « Magistra pour Windows 2.0.4 ou plus récente » : la version à installer pour ces choix. */
function installPhrase(options: readonly ToolOption[], matiere: Matiere | null = null): string {
  return `Magistra pour Windows ${requiredVersion(options, matiere)} ou plus récente`;
}

/** Valeur renseignée (comme les paramètres enregistrés : ni vide, ni faux, ni liste vide). */
function isSet(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && value !== '' && value !== false;
}

/** Options des outils renseignées dans la demande. */
export function requestedToolOptions(request: GenerationRequest): ToolOption[] {
  return TOOL_OPTIONS.filter(([key]) => isSet(request[key])).map(([key]) => key);
}

/** Matière de la demande inconnue d'une application d'avant TOOL_OPTIONS_MIN_APP_VERSION, sinon null. */
export function recentMatiere(request: GenerationRequest): Matiere | null {
  return RECENT_MATIERES.has(request.matiere) ? request.matiere : null;
}

/** Noms des options, dans l'ordre du formulaire (« format, notation »). */
function optionNames(options: readonly ToolOption[]): string {
  return TOOL_OPTIONS.filter(([key]) => options.includes(key)).map(([, name]) => name).join(', ');
}

const UPDATE_WHERE = '(Réglages → « Magistra pour Windows »)';

/**
 * Refus avant l'envoi (application d'une version plus ancienne) : nomme ce que l'enseignant a choisi — options des
 * outils renseignées, matière récente — et la version nécessaire (une réinstallation de la même version ne suffit pas).
 * Sans matière récente, l'enseignant peut aussi générer sans ces choix ; avec, le serveur en ligne reste possible.
 */
export function localAppTooOldMessage(options: readonly ToolOption[], matiere: Matiere | null = null): string {
  const single = options.length === 1;
  const choices = options.length === 0 ? '' : single ? `votre choix (${optionNames(options)})` : `vos choix (${optionNames(options)})`;
  const parts = [matiere ? `la matière « ${getMatiereLabel(matiere)} »` : '', choices || (matiere ? '' : 'vos choix')].filter(Boolean);
  const subject = parts.join(' et ');
  const verb = parts.length > 1 || (!single && !matiere) ? 'demandent' : 'demande';
  const alternative = matiere ? 'ou choisissez le serveur en ligne' : `ou générez sans ${single ? 'ce choix' : 'ces choix'}`;
  return `${subject.charAt(0).toUpperCase()}${subject.slice(1)} ${verb} ${installPhrase(options, matiere)}, et l'application de cet ordinateur est plus ancienne : installez la dernière version ${UPDATE_WHERE}, puis réessayez, ${alternative}.`;
}

/**
 * L'application de cette version applique-t-elle les options des outils (et connaît-elle les matières récentes) ?
 * null : version absente ou illisible (inconnue). Seule la partie x.y.z compte : une pré-version de 2.0.3
 * (« 2.0.3-beta.1 ») les applique déjà.
 */
export function appSupportsToolOptions(version: string | undefined): boolean | null {
  const parsed = parseVersion(version);
  if (!parsed) return null;
  return compareVersions(parsed.core.join('.'), TOOL_OPTIONS_MIN_APP_VERSION) >= 0;
}

/**
 * L'application de cette version applique-t-elle cette option ? null : version absente ou illisible. Chaque option a sa
 * version minimale (toolOptionMinVersion) : « plan d'abord » n'est pas appliqué par une application 2.0.3.
 */
export function appSupportsToolOption(version: string | undefined, option: ToolOption): boolean | null {
  const parsed = parseVersion(version);
  if (!parsed) return null;
  return compareVersions(parsed.core.join('.'), toolOptionMinVersion(option)) >= 0;
}

/** Choix de la demande qu'une application de cette version ignorerait (jamais ceux qu'elle applique). */
function unsupportedChoices(version: string | undefined, options: readonly ToolOption[], matiere: Matiere | null): AppTooOld | null {
  const unsupported = options.filter(option => appSupportsToolOption(version, option) === false);
  const unknownMatiere = matiere && appSupportsToolOptions(version) === false ? matiere : null;
  return unsupported.length > 0 || unknownMatiere ? { options: unsupported, matiere: unknownMatiere } : null;
}

/** Ce qu'une application trop ancienne ne sait pas faire de la demande. */
interface AppTooOld {
  options: ToolOption[];
  matiere: Matiere | null;
}

/**
 * Options demandées que l'application n'a pas appliquées : absentes des paramètres de la génération à enregistrer
 * (l'application y note la demande qu'elle a traitée ; une application d'avant 2.0.3 n'en note aucune). Paramètres
 * absents ou illisibles : rien n'est affirmé.
 */
export function ignoredToolOptions(request: GenerationRequest, params: unknown): ToolOption[] {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return [];
  const applied = params as Record<string, unknown>;
  return requestedToolOptions(request).filter(key => !isSet(applied[key]));
}

/** Avertissement joint au résultat quand l'application n'a pas appliqué des options demandées. */
export function ignoredToolOptionsMessage(ignored: readonly ToolOption[]): string {
  const names = optionNames(ignored);
  const choices = ignored.length > 1 ? `Vos choix (${names}) n'ont pas été appliqués` : `Votre choix (${names}) n'a pas été appliqué`;
  const answerKey = ignored.includes('sansCorrige') ? ' Le document peut contenir un corrigé : relisez-le avant de le distribuer.' : '';
  return `${choices} : l'application Magistra de cet ordinateur est trop ancienne.${answerKey} Installez ${installPhrase(ignored)} ${UPDATE_WHERE}, puis relancez la génération.`;
}

/**
 * Génération rédigée pour une autre demande que celle de l'enseignant : matière (une application plus ancienne
 * remplace sans erreur une matière qu'elle ne connaît pas par la première du niveau), outil ou niveau différents dans
 * la génération à enregistrer. Message à afficher (la génération n'est pas enregistrée), sinon null. Génération
 * absente ou champ illisible : rien n'est affirmé.
 */
export function substitutedRequestMessage(request: GenerationRequest, record: unknown): string | null {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const fields = record as Record<string, unknown>;
  const differs = (key: 'type' | 'niveau' | 'matiere') => typeof fields[key] === 'string' && fields[key] !== request[key];
  const notSaved = "Il n'a pas été enregistré dans l'historique.";
  if (differs('matiere')) {
    const used = resolveMatiere(String(fields.matiere));
    const writtenFor = used ? `« ${getMatiereLabel(used)} »` : 'une autre matière';
    return `La matière « ${getMatiereLabel(request.matiere)} » n'est pas connue de l'application Magistra de cet ordinateur, trop ancienne : le contenu a été rédigé pour ${writtenFor}. ${notSaved} Installez Magistra pour Windows ${TOOL_OPTIONS_MIN_APP_VERSION} ou plus récente ${UPDATE_WHERE}, puis relancez la génération.`;
  }
  if (differs('type') || differs('niveau')) {
    return `Le contenu renvoyé par l'application Magistra de cet ordinateur ne correspond pas à l'outil ou au niveau demandés. ${notSaved} Installez la dernière version de Magistra pour Windows ${UPDATE_WHERE}, puis relancez la génération.`;
  }
  return null;
}

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
      // Cause : le blocage par le navigateur (une cause de plus, comme une déconnexion non confirmée, est affichée
      // par l'état lui-même).
      return notReadyCapabilities(state.error?.code === 'LOCAL_NETWORK_PERMISSION_DENIED'
        ? state.error
        : { code: 'LOCAL_NETWORK_PERMISSION_DENIED', message: defaultMessage('LOCAL_NETWORK_PERMISSION_DENIED') });
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
    // Application trop ancienne pour les options ou la matière demandées : refus AVANT l'envoi (ni temps de génération
    // perdu, ni corrigé rédigé pour une « version élève seule », ni contenu rédigé pour une autre matière). Même code
    // que les autres mises à jour de l'application ; le message nomme les choix en cause et la version nécessaire.
    const options = requestedToolOptions(request);
    const matiere = recentMatiere(request);
    const tooOld = options.length > 0 || matiere ? await this.localAppTooOld(options, matiere) : null;
    if (tooOld && !signal.aborted) {
      const e = new MagistraError('CONNECTOR_UNREACHABLE', localAppTooOldMessage(tooOld.options, tooOld.matiere));
      onEvent({ type: 'error', code: e.code, message: e.message, retryable: e.retryable });
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
    await this.finish(last, request, onEvent);
  }

  /**
   * Choix de la demande (options des outils, matière récente ; appelé seulement quand elle en contient) que l'application
   * appairée ignorerait d'après sa version, ou null. Une version qui n'en applique pas tout est d'abord relue (application
   * mise à jour ou ouverte depuis la dernière lecture ; la preuve obtenue sert aussi à l'envoi) : seule une version lue à
   * l'instant, et plus ancienne, fait refuser — et le message ne nomme que les choix qu'elle ignore. Inconnue après
   * relecture : envoyée.
   */
  private async localAppTooOld(options: readonly ToolOption[], matiere: Matiere | null): Promise<AppTooOld | null> {
    const known = this.local.getSnapshot().appVersion;
    if (parseVersion(known) && !unsupportedChoices(known, options, matiere)) return null;
    await this.local.refresh().catch(() => undefined);
    const state = this.local.getSnapshot();
    return state.kind === 'connected' ? unsupportedChoices(state.appVersion, options, matiere) : null;
  }

  /**
   * Enregistre le résultat d'une génération locale dans l'historique du compte, puis transmet « done » — précédé d'un
   * avertissement si l'application n'a pas appliqué des options demandées (version inconnue avant l'envoi, ou état
   * pas encore relu : le constat se fait sur ce qu'elle a traité, quelle que soit la version annoncée). Génération
   * rédigée pour une autre matière (ou un autre outil, un autre niveau) : avertissement, et JAMAIS enregistrée (elle
   * serait classée sous une matière que l'enseignant n'a pas choisie, pour un contenu qui n'y répond pas) ; seule une
   * application trop ancienne remplace ainsi la demande, et elle n'enregistre jamais elle-même.
   */
  private async finish(
    event: Extract<GenerationEvent, { type: 'done' }>, request: GenerationRequest, onEvent: (event: GenerationEvent) => void,
  ): Promise<void> {
    const { record, ...done } = event;
    const ignored = record && typeof record === 'object' ? ignoredToolOptions(request, record.params) : [];
    if (ignored.length > 0) onEvent({ type: 'warning', code: 'CONNECTOR_UNREACHABLE', message: ignoredToolOptionsMessage(ignored) });
    const substituted = substitutedRequestMessage(request, record);
    if (substituted) {
      onEvent({ type: 'warning', code: 'CONNECTOR_UNREACHABLE', message: substituted });
      onEvent({ ...done, saved: false, id: undefined });
      return;
    }
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
