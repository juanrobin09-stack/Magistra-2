// État factice de l'IA locale, construit avec la vraie logique de recommandation.

import { MIN_OLLAMA_VERSION, MODEL_TIERS, recommendTier, type HardwareInfo, type TierId } from '@shared/ai/models';
import type { AIStatus, EngineState, TierStatus } from '@shared/ipc';

export interface StatusOptions {
  hardware?: Partial<HardwareInfo>;
  engine?: EngineState;
  installed?: TierId[];
  selectedTier?: TierId;
  ready?: boolean;
  mode?: 'local' | 'remote';
  customModel?: string;
  /** Version du moteur en marche (par défaut : version récente, suffisante). */
  engineVersion?: string;
  /** Moteur trop ancien pour les modèles Magistra (AIStatus.engine.outdated). */
  outdated?: boolean;
  /** Ollama installé pour toute la machine (Program Files). */
  managedByAdmin?: boolean;
  /** Proxy du système ignoré par le moteur déjà démarré : « Reprendre le téléchargement » le relance avec le proxy. */
  proxyRestart?: boolean;
  /** Installation (ou mise à jour) du moteur en cours dans le processus principal (AIStatus.engine.installing). */
  installing?: 'install' | 'update';
  /** Adresse du moteur (par défaut : cet ordinateur). */
  ollamaUrl?: string;
  /** Installation automatique du moteur possible (Windows) ; faux : macOS, Linux (installation à la main). Défaut : vrai. */
  platformSupported?: boolean;
}

export function makeStatus(opts: StatusOptions = {}): AIStatus {
  const hardware: HardwareInfo = {
    totalRamGB: 16,
    cpuCores: 8,
    cpuModel: 'Intel(R) Core(TM) i7-1165G7 CPU @ 2.80GHz',
    gpus: [],
    freeDiskGB: 120,
    platform: 'win32',
    ...opts.hardware,
  };
  const recommendation = recommendTier(hardware);
  const installed = new Set(opts.installed ?? []);
  const engine = opts.engine ?? 'running';
  const tiers: TierStatus[] = MODEL_TIERS.map(t => {
    const assessment = recommendation.tiers.find(a => a.id === t.id)!;
    return {
      id: t.id,
      label: t.label,
      description: t.description,
      model: t.model,
      modelDisplayName: t.modelDisplayName,
      license: t.license,
      downloadGB: t.downloadGB,
      installed: installed.has(t.id),
      fit: assessment.fit,
      note: assessment.note,
    };
  });
  const selectedTier = opts.selectedTier ?? recommendation.tier;
  const active = MODEL_TIERS.find(t => t.id === selectedTier)!;
  const ready = opts.ready ?? (engine === 'running' && !opts.customModel && installed.has(selectedTier));
  const url = opts.ollamaUrl ?? 'http://127.0.0.1:11434';
  return {
    engine: {
      state: engine,
      version: engine === 'running' ? opts.engineVersion ?? '0.34.4' : undefined,
      url,
      ...(opts.outdated !== undefined ? { outdated: opts.outdated, minVersion: MIN_OLLAMA_VERSION } : {}),
      ...(opts.managedByAdmin !== undefined ? { managedByAdmin: opts.managedByAdmin } : {}),
      ...(opts.proxyRestart !== undefined ? { proxyRestart: opts.proxyRestart } : {}),
      ...(opts.installing ? { installing: opts.installing } : {}),
    },
    installedModels: engine === 'running'
      ? MODEL_TIERS.filter(t => installed.has(t.id)).map(t => ({ name: t.model, sizeGB: t.downloadGB }))
      : [],
    tiers,
    selectedTier,
    activeModel: opts.customModel ?? active.model,
    activeLabel: opts.customModel ?? active.label,
    ready,
    headline: ready ? 'Prête' : opts.customModel ? `Modèle ${opts.customModel} non installé` : 'Non prête',
    hardware,
    recommendation,
    config: {
      mode: opts.mode ?? 'local',
      tier: selectedTier,
      customModel: opts.customModel,
      ollamaUrl: url,
      ...(opts.mode === 'remote'
        ? { remote: { kind: 'openai-compatible' as const, baseUrl: 'https://ia.exemple.fr/v1', model: 'mistral-small', hasApiKey: true, label: 'Serveur du lycée' } }
        : {}),
    },
    engineDownload: { approxSizeMB: 1100, requiredDiskGB: 5, platformSupported: opts.platformSupported ?? true },
  };
}
