// Détection de la machine → recommandation du modèle.

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { recommendTier } from '../../shared/ai/models.js';
import {
  detectHardware, gpusFromChromium, mergeGpus, nvidiaSmiCandidates, ollamaModelsDir, parseNvidiaSmi, type HardwareDeps,
} from '../../electron/hardware.js';

const GB = 1024 ** 3;
const SYSTEM32_SMI = 'C:\\Windows\\System32\\nvidia-smi.exe';
const NVSMI_SMI = 'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe';

function deps(over: Partial<HardwareDeps> & { ramGB: number; nvidia?: string; chromium?: unknown; diskGB?: number }): HardwareDeps {
  return {
    platform: 'win32',
    arch: 'x64',
    totalmem: () => over.ramGB * GB,
    freemem: () => (over.ramGB / 2) * GB,
    cpus: () => Array.from({ length: 8 }, () => ({ model: 'Intel(R) Core(TM) i5-1235U' })),
    availableParallelism: () => 8,
    getGPUInfo: async () => over.chromium ?? { gpuDevice: [] },
    execFile: async () => {
      if (over.nvidia === undefined) throw Object.assign(new Error('introuvable'), { code: 'ENOENT' });
      return { stdout: over.nvidia };
    },
    env: { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' },
    // Pilote NVIDIA installé : nvidia-smi dans System32.
    fileExists: async p => p === SYSTEM32_SMI,
    tmpdir: 'C:\\Users\\prof\\AppData\\Local\\Temp',
    freeDiskBytes: async () => (over.diskGB ?? 200) * GB,
    modelsDir: 'C:\\Users\\prof\\.ollama\\models',
    ...over,
  };
}

describe('analyse des informations matérielles', () => {
  it('lit la mémoire vidéo NVIDIA (nvidia-smi)', () => {
    expect(parseNvidiaSmi('NVIDIA GeForce RTX 4070, 12282\r\nNVIDIA RTX A2000, 6138\n\n')).toEqual([
      { name: 'NVIDIA GeForce RTX 4070', vramGB: 12 },
      { name: 'NVIDIA RTX A2000', vramGB: 6 },
    ]);
    expect(parseNvidiaSmi('NVIDIA-SMI has failed')).toEqual([]);
  });

  it('extrait les cartes graphiques de Chromium et ignore les rendus logiciels', () => {
    const info = {
      gpuDevice: [
        { vendorId: 0x8086, deviceId: 0x46a8, active: true, deviceString: 'Intel(R) Iris(R) Xe Graphics' },
        { vendorId: 0x10de, deviceId: 0x2786, active: false },
        { vendorId: 0x1414, deviceId: 0x8c, active: false, deviceString: 'Microsoft Basic Render Driver' },
        { vendorId: 0x1ae0, deviceId: 0xc0de, active: false },
      ],
      auxAttributes: { glRenderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)' },
    };
    expect(gpusFromChromium(info)).toEqual([{ name: 'Intel(R) Iris(R) Xe Graphics' }, { name: 'Carte graphique NVIDIA' }]);
    expect(gpusFromChromium(null)).toEqual([]);
    expect(mergeGpus(gpusFromChromium(info), [{ name: 'NVIDIA GeForce RTX 4070', vramGB: 12 }])).toEqual([
      { name: 'NVIDIA GeForce RTX 4070', vramGB: 12 },
      { name: 'Intel(R) Iris(R) Xe Graphics' },
    ]);
  });

  it('dossier des modèles : OLLAMA_MODELS ou ~/.ollama/models', () => {
    expect(ollamaModelsDir({ OLLAMA_MODELS: 'D:\\IA\\modeles' }, 'C:\\Users\\prof')).toBe('D:\\IA\\modeles');
    expect(ollamaModelsDir({}, '/home/prof')).toBe(path.join('/home/prof', '.ollama', 'models'));
  });
});

describe('machine → recommandation', () => {
  it('portable 8 Go sans carte graphique → Magistra Léger', async () => {
    const hw = await detectHardware(deps({ ramGB: 8 }));
    expect(hw).toMatchObject({ totalRamGB: 8, cpuCores: 8, gpus: [], freeDiskGB: 200, platform: 'win32' });
    const rec = recommendTier(hw);
    expect(rec.tier).toBe('leger');
    expect(rec.machine).toBe('modeste');
  });

  it('PC 16 Go → Magistra Standard', async () => {
    expect(recommendTier(await detectHardware(deps({ ramGB: 16 }))).tier).toBe('standard');
  });

  it('station 32 Go + RTX 4090 (24 Go) → Magistra Qualité', async () => {
    const hw = await detectHardware(deps({ ramGB: 32, nvidia: 'NVIDIA GeForce RTX 4090, 24564' }));
    expect(hw.gpus[0]).toEqual({ name: 'NVIDIA GeForce RTX 4090', vramGB: 24 });
    const rec = recommendTier(hw);
    expect(rec.tier).toBe('qualite');
    expect(rec.tiers.find(t => t.id === 'qualite')?.fit).toBe('recommended');
  });

  it('disque presque plein → niveau inférieur et avertissement', async () => {
    const rec = recommendTier(await detectHardware(deps({ ramGB: 16, diskGB: 8 })));
    expect(rec.tier).toBe('leger');
    expect(rec.tiers.find(t => t.id === 'standard')?.fit).toBe('not_recommended');
  });

  it('résiste aux outils absents ou bloqués (nvidia-smi, GPU, disque)', async () => {
    const hw = await detectHardware(deps({
      ramGB: 12,
      getGPUInfo: () => new Promise(() => undefined), // ne répond jamais
      freeDiskBytes: async () => { throw new Error('EPERM'); },
    }));
    expect(hw.totalRamGB).toBe(12);
    expect(hw.freeDiskGB).toBeUndefined();
  }, 10_000);

  it('Windows : nvidia-smi uniquement par un chemin absolu connu, jamais par son seul nom', async () => {
    expect(nvidiaSmiCandidates('win32', { SystemRoot: 'D:\\WINDOWS', ProgramFiles: 'D:\\Programmes' })).toEqual([
      'D:\\WINDOWS\\System32\\nvidia-smi.exe',
      'D:\\Programmes\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
    ]);
    expect(nvidiaSmiCandidates('win32', {})).toEqual([SYSTEM32_SMI, NVSMI_SMI]);
    // Variables détournées (chemin relatif, partage réseau) : emplacement ignoré.
    expect(nvidiaSmiCandidates('win32', { SystemRoot: 'Windows', ProgramFiles: '\\\\serveur\\partage' })).toEqual([]);

    const calls: { file: string; cwd?: string }[] = [];
    const execFile: HardwareDeps['execFile'] = async (file, _args, options) => {
      calls.push({ file, cwd: options.cwd });
      return { stdout: 'NVIDIA GeForce RTX 4060, 8188' };
    };
    // Ancien emplacement (NVSMI) seulement.
    const hw = await detectHardware(deps({ ramGB: 16, execFile, fileExists: async p => p === NVSMI_SMI }));
    expect(calls).toEqual([{ file: NVSMI_SMI, cwd: 'C:\\Users\\prof\\AppData\\Local\\Temp' }]);
    expect(hw.gpus).toEqual([{ name: 'NVIDIA GeForce RTX 4060', vramGB: 8 }]);

    // Aucun des deux : nvidia-smi n'est pas lancé (pas de recherche dans le dossier courant ni le PATH).
    calls.length = 0;
    const chromium = { gpuDevice: [{ vendorId: 0x10de, active: true, deviceString: 'NVIDIA GeForce RTX 4060' }] };
    const noSmi = await detectHardware(deps({ ramGB: 16, execFile, chromium, fileExists: async () => false }));
    expect(calls).toEqual([]);
    expect(noSmi.gpus).toEqual([{ name: 'NVIDIA GeForce RTX 4060' }]);
  });

  it('Linux et macOS : nvidia-smi cherché dans le PATH, depuis le dossier temporaire', async () => {
    expect(nvidiaSmiCandidates('linux', {})).toEqual(['nvidia-smi']);
    const calls: { file: string; cwd?: string }[] = [];
    await detectHardware(deps({
      ramGB: 16,
      platform: 'linux',
      tmpdir: '/tmp',
      fileExists: async () => false,
      execFile: async (file, _args, options) => {
        calls.push({ file, cwd: options.cwd });
        return { stdout: '' };
      },
    }));
    expect(calls).toEqual([{ file: 'nvidia-smi', cwd: '/tmp' }]);
  });

  it('Apple Silicon : mémoire unifiée prise en compte', async () => {
    const hw = await detectHardware(deps({ ramGB: 32, platform: 'darwin', arch: 'arm64' }));
    expect(hw.gpus[0].vramGB).toBe(21);
  });
});
