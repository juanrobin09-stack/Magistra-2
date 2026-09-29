// Génération dans le processus principal : demande validée → fournisseur (local ou distant) → pipeline commun
// → sauvegarde locale → évènements envoyés à la fenêtre (IPC.genEvent).
//
// GÉNÉRATION ILLIMITÉE : aucun quota, aucun compteur. Seules limites : la machine et le modèle.
// Une seule génération à la fois (GENERATION_BUSY sinon) ; gen:cancel l'interrompt immédiatement.

import { randomUUID } from 'node:crypto';
import type { AIProvider } from '../shared/ai/provider.js';
import { MagistraError, toMagistraError } from '../shared/errors.js';
import type { LocalPreferences } from '../shared/ipc.js';
import { runGeneration } from '../shared/pipeline.js';
import type { FetchedPage, ResearchConfig, ResearchDeps } from '../shared/research/index.js';
import type { AINotice, Capabilities, GenerationEvent, PrivacyInfo, ProviderInfo } from '../shared/types.js';
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
  fetchPage?: (url: string, signal?: AbortSignal) => Promise<FetchedPage | null>;
  idFactory?: () => string;
}

/** Place disponible pour les extraits de documents, selon le contexte du modèle (≈ 55 % du contexte). */
export function maxDocumentCharsFor(contextTokens: number): number {
  return Math.max(0, Math.floor((contextTokens * 0.55 - 2500) * 3.2));
}

export function researchConfigFrom(prefs: LocalPreferences): ResearchConfig {
  return {
    academic: prefs.academicEnabled,
    wikipedia: prefs.wikipediaEnabled,
    timeoutMs: 8_000,
    ...(prefs.searxngUrl ? { searxngUrl: prefs.searxngUrl } : {}),
  };
}

export class GenerationManager {
  private readonly deps: GenerationDeps;
  private active: { jobId: string; controller: AbortController } | null = null;

  constructor(deps: GenerationDeps) {
    this.deps = deps;
  }

  get busy(): boolean {
    return this.active !== null;
  }

  /** Valide la demande et lance la génération ; les évènements arrivent ensuite par IPC. */
  start(raw: unknown): { jobId: string } {
    if (this.active) throw new MagistraError('GENERATION_BUSY');
    const request = validateGenerationRequest(raw);
    const jobId = (this.deps.idFactory ?? randomUUID)();
    const controller = new AbortController();
    const job = { jobId, controller };
    this.active = job;
    void this.run(jobId, request, controller).finally(() => {
      if (this.active === job) this.active = null;
    });
    return { jobId };
  }

  cancel(jobId: string): void {
    if (this.active && this.active.jobId === jobId) this.active.controller.abort();
  }

  cancelAll(): void {
    this.active?.controller.abort();
  }

  private emit(jobId: string, event: GenerationEvent, controller: AbortController): void {
    const delivered = this.deps.send({ jobId, event });
    // Fenêtre fermée : inutile de continuer à faire travailler le modèle.
    if (!delivered && !controller.signal.aborted) controller.abort();
  }

  private async run(jobId: string, request: ReturnType<typeof validateGenerationRequest>, controller: AbortController): Promise<void> {
    const signal = controller.signal;
    const emit = (event: GenerationEvent) => this.emit(jobId, event, controller);
    let finished = false;
    try {
      const prefs = await this.deps.store.getPreferences();
      emit({ type: 'status', stage: 'loading_model', message: 'Préparation du moteur IA…' });
      const provider = await this.deps.resolveProvider(signal, message => emit({ type: 'status', stage: 'loading_model', message }));
      if (signal.aborted) throw new MagistraError('GENERATION_ABORTED');
      const events = runGeneration(request, {
        provider,
        signal,
        research: {
          config: researchConfigFrom(prefs),
          deps: { fetch: this.deps.fetch, ...(this.deps.fetchPage ? { fetchPage: this.deps.fetchPage } : {}) },
        },
        save: record => this.deps.store.saveGeneration(record),
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
      if (e.code === 'INTERNAL') console.error('[magistra] Erreur de génération :', err);
      emit({ type: 'error', code: e.code, message: e.message, retryable: e.retryable });
    }
  }

  async capabilities(): Promise<Capabilities> {
    const [prefs, active] = await Promise.all([this.deps.store.getPreferences(), this.deps.describeActive()]);
    return {
      maxDocumentChars: maxDocumentCharsFor(active.contextTokens),
      research: { academic: prefs.academicEnabled, web: !!prefs.searxngUrl, institutional: !!prefs.searxngUrl, wikipedia: prefs.wikipediaEnabled },
      privacy: active.privacy,
      engineLabel: active.label,
      ready: active.ready,
      ...(!active.ready && active.notReady ? { notReady: active.notReady } : {}),
      ...(active.ready && active.aiWarning ? { aiWarning: active.aiWarning } : {}),
      ...(active.providerInfo ? { providerInfo: active.providerInfo } : {}),
    };
  }
}
