// Génération dans le processus principal : demande validée → fournisseur (local ou distant) → pipeline commun
// → sauvegarde locale → évènements envoyés à la fenêtre (IPC.genEvent).
//
// GÉNÉRATION ILLIMITÉE : aucun quota, aucun compteur. Seules limites : la machine et le modèle.
// Une seule génération à la fois AU TOTAL (GENERATION_BUSY sinon) ; gen:cancel l'interrompt immédiatement.
//
// Générations « externes » (connecteur local : le site web Magistra utilise l'IA de cet ordinateur) : même moteur,
// même pipeline, MÊME créneau unique que la fenêtre, mais :
//   - leurs évènements vont à leur propre destinataire (flux NDJSON du connecteur), jamais à la fenêtre ;
//   - rien n'est enregistré dans l'historique de l'application : l'évènement « done » porte la génération à
//     enregistrer (`record`, pipeline includeRecord) et c'est le site qui l'enregistre dans le compte ;
//   - `requireLocal` : si le moteur actif n'est pas sur cet ordinateur (application réglée sur un serveur distant),
//     refus LOCAL_ENGINE_REMOTE — jamais de relais silencieux des demandes du site vers un tiers ;
//   - seul leur propriétaire (le navigateur appairé qui les a lancées) peut les arrêter ; le remplacement de la page
//     de la fenêtre (rechargement) n'arrête que les générations de la fenêtre.

import { randomUUID } from 'node:crypto';
import type { AIProvider } from '../shared/ai/provider.js';
import { MagistraError, toMagistraError } from '../shared/errors.js';
import type { LocalPreferences } from '../shared/ipc.js';
import { runGeneration, type NewGenerationRecord } from '../shared/pipeline.js';
import { officialSitesPath, type ResearchConfig, type ResearchDeps } from '../shared/research/index.js';
import type { AINotice, Capabilities, GenerationEvent, GenerationRequest, PrivacyInfo, ProviderInfo } from '../shared/types.js';
import { validateGenerationRequest } from '../shared/validation.js';
import type { LocalStore } from './localStore.js';

export interface GenerationPayload {
  jobId: string;
  event: GenerationEvent;
}

export interface GenerationDeps {
  store: Pick<LocalStore, 'saveGeneration' | 'getPreferences'>;
  /** Prépare le fournisseur d'IA actif (démarre le moteur si besoin, vérifie le modèle). */
  resolveProvider: (signal: AbortSignal, onStatus: (message: string) => void) => Promise<AIProvider>;
  /** Description du moteur actif (capacités) : cause précise s'il n'est pas prêt, prestataire s'il est distant. */
  describeActive: () => Promise<{
    label: string;
    contextTokens: number;
    privacy: PrivacyInfo;
    ready: boolean;
    notReady?: AINotice;
    aiWarning?: AINotice;
    providerInfo?: ProviderInfo;
  }>;
  /** Envoi d'un évènement à la fenêtre ; renvoie faux si la fenêtre n'existe plus. */
  send: (payload: GenerationPayload) => boolean;
  fetch: ResearchDeps['fetch'];
  /** Récupération sécurisée d'une page (server/safeFetch.ts), avec le prédicat facultatif `allowUrl` de la recherche. */
  fetchPage?: ResearchDeps['fetchPage'];
  idFactory?: () => string;
  /**
   * Réglage du moteur actif, sans accès réseau : vrai si c'est le moteur de CET ordinateur (mode local, adresse de
   * la boucle locale). Utilisé par `requireLocal` pour refuser AVANT toute préparation du moteur ; absent : seule
   * la vérification du fournisseur préparé (`provider.local`) s'applique.
   */
  isLocalEngine?: () => boolean;
}

/** Génération demandée par le site web via le connecteur local. */
export interface ExternalGenerationOptions {
  /** Propriétaire : identifiant du navigateur appairé. Lui seul peut arrêter la génération. */
  owner: string;
  /**
   * Destinataire des évènements (flux NDJSON) ; renvoie faux si la connexion est fermée : la génération est alors
   * interrompue (inutile de faire travailler le modèle pour personne).
   */
  send: (event: GenerationEvent) => boolean;
  /** Refuser un moteur qui n'est pas sur cet ordinateur (LOCAL_ENGINE_REMOTE). */
  requireLocal?: boolean;
}

export interface ExternalGenerationHandle {
  jobId: string;
  /** Résolue quand la génération est terminée (dernier évènement envoyé) ET le créneau libéré. Ne rejette jamais. */
  finished: Promise<void>;
}

/** Message de GENERATION_BUSY pour la fenêtre quand le site utilise l'IA de cet ordinateur. */
export const BUSY_EXTERNAL_MESSAGE = 'Le site Magistra utilise en ce moment l’IA de cet ordinateur. Attendez la fin de cette génération.';
/** Message de GENERATION_BUSY pour le site quand la fenêtre de l'application génère déjà. */
export const BUSY_WINDOW_MESSAGE = 'Une génération est déjà en cours dans l’application Magistra de cet ordinateur. Attendez sa fin.';

/** Place disponible pour les extraits de documents, selon le contexte du modèle (≈ 55 % du contexte). */
export function maxDocumentCharsFor(contextTokens: number): number {
  return Math.max(0, Math.floor((contextTokens * 0.55 - 2500) * 3.2));
}

export function researchConfigFrom(prefs: LocalPreferences): ResearchConfig {
  return {
    academic: prefs.academicEnabled,
    wikipedia: prefs.wikipediaEnabled,
    // Application Windows : toujours les sites vérifiés seulement (aucune option).
    trustedOnly: true,
    timeoutMs: 8_000,
    ...(prefs.searxngUrl ? { searxngUrl: prefs.searxngUrl } : {}),
  };
}

interface ActiveJob {
  jobId: string;
  controller: AbortController;
  /** null : fenêtre de l'application ; sinon navigateur appairé (connecteur local). */
  owner: string | null;
}

interface RunMode {
  /** Évènement vers son destinataire ; faux = destinataire disparu. */
  sink: (event: GenerationEvent) => boolean;
  /** Fenêtre : sauvegarde dans l'historique local. Connecteur : génération jointe à « done » (includeRecord). */
  save: boolean;
  requireLocal: boolean;
}

export class GenerationManager {
  private readonly deps: GenerationDeps;
  private active: ActiveJob | null = null;

  constructor(deps: GenerationDeps) {
    this.deps = deps;
  }

  get busy(): boolean {
    return this.active !== null;
  }

  /** Vrai si la génération en cours a été demandée par le site web (connecteur local). */
  get busyExternal(): boolean {
    return this.active !== null && this.active.owner !== null;
  }

  private busyError(forExternal: boolean): MagistraError {
    const a = this.active;
    if (a && a.owner !== null && !forExternal) return new MagistraError('GENERATION_BUSY', BUSY_EXTERNAL_MESSAGE);
    if (a && a.owner === null && forExternal) return new MagistraError('GENERATION_BUSY', BUSY_WINDOW_MESSAGE);
    return new MagistraError('GENERATION_BUSY');
  }

  private launch(request: GenerationRequest, owner: string | null, modeFor: (jobId: string) => RunMode): ExternalGenerationHandle {
    const jobId = (this.deps.idFactory ?? randomUUID)();
    const controller = new AbortController();
    const job: ActiveJob = { jobId, controller, owner };
    this.active = job;
    const finished = this.run(jobId, request, controller, modeFor(jobId)).finally(() => {
      if (this.active === job) this.active = null;
    });
    return { jobId, finished };
  }

  /** Valide la demande et lance la génération ; les évènements arrivent ensuite par IPC. */
  start(raw: unknown): { jobId: string } {
    if (this.active) throw this.busyError(false);
    const request = validateGenerationRequest(raw);
    const { jobId } = this.launch(request, null, id => ({
      sink: event => this.deps.send({ jobId: id, event }),
      save: true,
      requireLocal: false,
    }));
    return { jobId };
  }

  /**
   * Génération demandée par le site web (connecteur local). Erreurs levées AVANT tout évènement (le connecteur les
   * renvoie en JSON) : LOCAL_ENGINE_REMOTE, GENERATION_BUSY, INVALID_REQUEST / DOCUMENT_TOO_LARGE.
   */
  startExternal(raw: unknown, options: ExternalGenerationOptions): ExternalGenerationHandle {
    if (!options.owner) throw new MagistraError('INTERNAL');
    if (options.requireLocal && this.deps.isLocalEngine && !this.deps.isLocalEngine()) throw new MagistraError('LOCAL_ENGINE_REMOTE');
    if (this.active) throw this.busyError(true);
    const request = validateGenerationRequest(raw);
    return this.launch(request, options.owner, () => ({ sink: options.send, save: false, requireLocal: options.requireLocal === true }));
  }

  /** Arrêt demandé par la fenêtre : uniquement une génération de la fenêtre. */
  cancel(jobId: string): void {
    if (this.active && this.active.owner === null && this.active.jobId === jobId) this.active.controller.abort();
  }

  /** Arrêt demandé par un navigateur (POST /v1/cancel) : uniquement SA génération. Vrai si elle a été arrêtée. */
  cancelExternal(jobId: string, owner: string): boolean {
    const a = this.active;
    if (!a || a.owner === null || a.owner !== owner || a.jobId !== jobId) return false;
    a.controller.abort();
    return true;
  }

  /** Arrête la génération d'un navigateur, quelle qu'elle soit (autorisation retirée). */
  cancelOwner(owner: string): void {
    if (this.active && this.active.owner !== null && this.active.owner === owner) this.active.controller.abort();
  }

  /** Arrête toute génération demandée par le site (connecteur désactivé ou arrêté). */
  cancelExternalAll(): void {
    if (this.active && this.active.owner !== null) this.active.controller.abort();
  }

  /** Arrête la génération de la fenêtre (page remplacée : plus personne ne peut l'afficher ni l'arrêter). */
  cancelWindow(): void {
    if (this.active && this.active.owner === null) this.active.controller.abort();
  }

  /** Arrête toute génération (fermeture de l'application). */
  cancelAll(): void {
    this.active?.controller.abort();
  }

  private async run(jobId: string, request: GenerationRequest, controller: AbortController, mode: RunMode): Promise<void> {
    const signal = controller.signal;
    const emit = (event: GenerationEvent) => {
      let delivered: boolean;
      try {
        delivered = mode.sink(event);
      } catch {
        delivered = false;
      }
      // Destinataire disparu (fenêtre fermée, connexion du navigateur coupée) : inutile de continuer.
      if (!delivered && !signal.aborted) controller.abort();
    };
    let finished = false;
    try {
      const prefs = await this.deps.store.getPreferences();
      emit({ type: 'status', stage: 'loading_model', message: 'Préparation du moteur IA…' });
      const provider = await this.deps.resolveProvider(signal, message => emit({ type: 'status', stage: 'loading_model', message }));
      if (signal.aborted) throw new MagistraError('GENERATION_ABORTED');
      // Contrôle final sur le fournisseur réellement préparé : aucun texte du site ne part vers un autre ordinateur.
      if (mode.requireLocal && !provider.local) throw new MagistraError('LOCAL_ENGINE_REMOTE');
      const events = runGeneration(request, {
        provider,
        signal,
        research: {
          config: researchConfigFrom(prefs),
          deps: { fetch: this.deps.fetch, ...(this.deps.fetchPage ? { fetchPage: this.deps.fetchPage } : {}) },
        },
        ...(mode.save ? { save: (record: NewGenerationRecord) => this.deps.store.saveGeneration(record) } : { includeRecord: true }),
        // Moteur de cet ordinateur : le modèle est d'abord chargé en mémoire (« Chargement du modèle… », délai long),
        // pour que l'attente du premier mot ne compte plus ce chargement (PC sans carte graphique).
        preloadModel: provider.local,
      });
      for await (const event of events) {
        emit(event);
        if (event.type === 'done' || event.type === 'error') finished = true;
      }
      if (!finished) throw new MagistraError('INTERNAL');
    } catch (err) {
      if (finished) return;
      const e = signal.aborted ? new MagistraError('GENERATION_ABORTED') : toMagistraError(err);
      if (e.code === 'INTERNAL') console.error(`[magistra] Erreur de génération (${jobId}) :`, err);
      emit({ type: 'error', code: e.code, message: e.message, retryable: e.retryable });
    }
  }

  async capabilities(): Promise<Capabilities> {
    const [prefs, active] = await Promise.all([this.deps.store.getPreferences(), this.deps.describeActive()]);
    return {
      maxDocumentChars: maxDocumentCharsFor(active.contextTokens),
      research: {
        academic: prefs.academicEnabled,
        web: !!prefs.searxngUrl,
        institutional: officialSitesPath(researchConfigFrom(prefs), this.deps) !== null,
        wikipedia: prefs.wikipediaEnabled,
        // Cette version s'appuie sur le catalogue des sites officiels vérifiés (absent d'une application plus ancienne).
        trustedCatalogue: true,
        academicAllLevels: true,
      },
      privacy: active.privacy,
      engineLabel: active.label,
      ready: active.ready,
      ...(!active.ready && active.notReady ? { notReady: active.notReady } : {}),
      ...(active.ready && active.aiWarning ? { aiWarning: active.aiWarning } : {}),
      ...(active.providerInfo ? { providerInfo: active.providerInfo } : {}),
    };
  }
}
