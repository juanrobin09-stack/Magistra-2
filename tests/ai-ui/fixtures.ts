// État factice de l'IA locale, construit avec la vraie logique de recommandation.

import { MODEL_TIERS, recommendTier, type HardwareInfo, type TierId } from '@shared/ai/models';
import type { AIStatus, EngineState, TierStatus } from '@shared/ipc';

export interface StatusOptions {
  hardware?: Partial<HardwareInfo>;
  engine?: EngineState;
  installed?: TierId[];
  selectedTier?: TierId;
  ready?: boolean;
  mode?: 'local' | 'remote';
  customModel?: string;
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
  const ready = opts.ready ?? (engine === 'running' && installed.has(selectedTier));
  return {
    engine: { state: engine, version: engine === 'running' ? '0.12.3' : undefined, url: 'http://127.0.0.1:11434' },
    installedModels: engine === 'running'
      ? MODEL_TIERS.filter(t => installed.has(t.id)).map(t => ({ name: t.model, sizeGB: t.downloadGB }))
      : [],
    tiers,
    selectedTier,
    activeModel: opts.customModel ?? active.model,
    activeLabel: opts.customModel ?? active.label,
    ready,
    headline: ready ? 'Prête' : 'Non prête',
    hardware,
    recommendation,
    config: {
      mode: opts.mode ?? 'local',
      tier: selectedTier,
      customModel: opts.customModel,
      ollamaUrl: 'http://127.0.0.1:11434',
      ...(opts.mode === 'remote'
        ? { remote: { kind: 'openai-compatible' as const, baseUrl: 'https://ia.exemple.fr/v1', model: 'mistral-small', hasApiKey: true, label: 'Serveur du lycée' } }
        : {}),
    },
    engineDownload: { approxSizeMB: 1100, requiredDiskGB: 5, platformSupported: true },
  };
}
