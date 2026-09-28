// Détection de la machine (mémoire, processeur, carte graphique, disque) pour recommander un modèle
// adapté : ne jamais proposer un modèle qui rendrait l'ordinateur inutilisable.

import { execFile as execFileCb } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GpuInfo, HardwareInfo } from '../shared/ai/models.js';

const GB = 1024 ** 3;

export interface HardwareDeps {
  platform: NodeJS.Platform;
  arch: string;
  totalmem: () => number;
  freemem: () => number;
  cpus: () => { model: string }[];
  availableParallelism?: () => number;
  /** app.getGPUInfo('complete') d'Electron. */
  getGPUInfo?: () => Promise<unknown>;
  /** Exécution d'une commande sans shell, avec délai maximal. */
  execFile: (file: string, args: string[], options: { timeout: number; cwd?: string }) => Promise<{ stdout: string }>;
  /** Variables d'environnement (SystemRoot, ProgramFiles sous Windows). */
  env: NodeJS.ProcessEnv;
  /** Vrai si le chemin désigne un fichier existant. */
  fileExists: (p: string) => Promise<boolean>;
  /** Dossier temporaire du système : dossier courant de nvidia-smi hors Windows. */
  tmpdir: string;
  freeDiskBytes: (dir: string) => Promise<number | undefined>;
  /** Dossier où Ollama enregistre les modèles (pour mesurer l'espace disque utile). */
  modelsDir: string;
}

/** Dossier des modèles Ollama : OLLAMA_MODELS s'il est défini, sinon ~/.ollama/models. */
export function ollamaModelsDir(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): string {
  const custom = env.OLLAMA_MODELS?.trim();
  return custom ? custom : path.join(home, '.ollama', 'models');
}

/** Espace libre (octets) sur le disque contenant `dir` (ou son premier parent existant). */
export async function freeDiskBytes(dir: string): Promise<number | undefined> {
  let current = path.resolve(dir);
  for (let i = 0; i < 64; i++) {
    try {
      const st = await fsp.statfs(current);
      return Number(st.bavail) * Number(st.bsize);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }
  return undefined;
}

/** Analyse la sortie de `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits`. */
export function parseNvidiaSmi(stdout: string): GpuInfo[] {
  const gpus: GpuInfo[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*(.+?)\s*,\s*(\d+(?:\.\d+)?)\s*$/.exec(line);
    if (!m) continue;
    const mib = Number(m[2]);
    gpus.push({ name: m[1], ...(Number.isFinite(mib) && mib > 0 ? { vramGB: Math.round((mib / 1024) * 10) / 10 } : {}) });
  }
  return gpus;
}

const VENDORS: Record<number, string> = {
  0x10de: 'NVIDIA',
  0x1002: 'AMD',
  0x1022: 'AMD',
  0x8086: 'Intel',
  0x106b: 'Apple',
  0x5143: 'Qualcomm',
};
/** Rendus logiciels ou virtuels : ce ne sont pas de vraies cartes graphiques. */
const IGNORED_VENDORS = new Set([0x1414 /* Microsoft Basic Render */, 0x1ae0 /* SwiftShader */, 0x15ad /* VMware */, 0x80ee /* VirtualBox */]);
const SOFTWARE_RE = /swiftshader|llvmpipe|softpipe|basic render|microsoft basic|virtualbox|vmware|software/i;

/** Extrait les noms de cartes graphiques de app.getGPUInfo('complete'). */
export function gpusFromChromium(info: unknown): GpuInfo[] {
  if (!info || typeof info !== 'object') return [];
  const data = info as { gpuDevice?: unknown; auxAttributes?: { glRenderer?: unknown } };
  const devices = Array.isArray(data.gpuDevice) ? data.gpuDevice : [];
  const renderer = typeof data.auxAttributes?.glRenderer === 'string' ? data.auxAttributes.glRenderer : undefined;
  const out: GpuInfo[] = [];
  for (const raw of devices) {
    const d = raw as { vendorId?: number; deviceString?: string; active?: boolean };
    const vendorId = typeof d.vendorId === 'number' ? d.vendorId : 0;
    if (IGNORED_VENDORS.has(vendorId)) continue;
    let name = typeof d.deviceString === 'string' && d.deviceString.trim() ? d.deviceString.trim() : '';
    if (!name && d.active && renderer && !SOFTWARE_RE.test(renderer)) name = renderer.replace(/^ANGLE \((.*)\)$/, '$1');
    if (!name) name = VENDORS[vendorId] ? `Carte graphique ${VENDORS[vendorId]}` : '';
    if (!name || SOFTWARE_RE.test(name)) continue;
    if (!out.some(g => g.name === name)) out.push({ name });
  }
  return out;
}

/**
 * Emplacements de nvidia-smi à essayer, dans l'ordre.
 * Windows : uniquement des chemins absolus connus (pilote NVIDIA) — un nom seul serait d'abord cherché dans le
 * dossier courant, où un fichier nvidia-smi.exe piégé pourrait avoir été déposé. Ailleurs : recherche dans le PATH.
 */
export function nvidiaSmiCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform !== 'win32') return ['nvidia-smi'];
  return [
    path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'),
    path.win32.join(env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'),
  ].filter(p => /^[A-Za-z]:\\/.test(p)); // chemin absolu sur un lecteur local (ni relatif, ni partage réseau)
}

/** nvidia-smi à exécuter, ou null s'il est introuvable (Windows) : app.getGPUInfo suffit alors. */
async function resolveNvidiaSmi(deps: HardwareDeps): Promise<string | null> {
  const candidates = nvidiaSmiCandidates(deps.platform, deps.env);
  if (deps.platform !== 'win32') return candidates[0];
  for (const candidate of candidates) {
    if (await deps.fileExists(candidate).catch(() => false)) return candidate;
  }
  return null;
}

async function runNvidiaSmi(deps: HardwareDeps): Promise<string | undefined> {
  const file = await resolveNvidiaSmi(deps);
  if (!file) return undefined;
  // Dossier courant neutre (dossier temporaire du système) plutôt que celui depuis lequel Magistra a été lancé.
  const { stdout } = await deps.execFile(file, ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { timeout: 3_000, cwd: deps.tmpdir });
  return stdout;
}

/** Fusionne les deux sources : nvidia-smi fait foi pour les cartes NVIDIA (mémoire vidéo mesurée). */
export function mergeGpus(chromium: GpuInfo[], nvidia: GpuInfo[]): GpuInfo[] {
  if (nvidia.length === 0) return chromium;
  const others = chromium.filter(g => !/nvidia|geforce|quadro|rtx|gtx|tesla/i.test(g.name));
  return [...nvidia, ...others];
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
    );
  });
}

export async function detectHardware(deps: HardwareDeps): Promise<HardwareInfo> {
  const totalRamGB = Math.round((deps.totalmem() / GB) * 10) / 10;
  const freeRamGB = Math.round((deps.freemem() / GB) * 10) / 10;
  const cpus = deps.cpus();
  const cpuCores = deps.availableParallelism?.() ?? cpus.length ?? 1;

  const [chromiumInfo, nvidiaOut, freeBytes] = await Promise.all([
    deps.getGPUInfo ? withTimeout(deps.getGPUInfo(), 4_000) : Promise.resolve(undefined),
    withTimeout(runNvidiaSmi(deps), 3_500),
    withTimeout(deps.freeDiskBytes(deps.modelsDir), 3_000),
  ]);

  let gpus = mergeGpus(gpusFromChromium(chromiumInfo), nvidiaOut ? parseNvidiaSmi(nvidiaOut) : []);
  // Apple Silicon : mémoire unifiée, environ deux tiers utilisables par la carte graphique.
  if (deps.platform === 'darwin' && deps.arch === 'arm64') {
    const unified = Math.round(totalRamGB * 0.66);
    gpus = gpus.length
      ? gpus.map(g => (g.vramGB ? g : { ...g, vramGB: unified }))
      : [{ name: 'Apple Silicon (mémoire unifiée)', vramGB: unified }];
  }

  const info: HardwareInfo = {
    totalRamGB,
    freeRamGB,
    cpuCores: Math.max(1, cpuCores),
    gpus,
    platform: deps.platform,
  };
  const cpuModel = cpus[0]?.model?.trim();
  if (cpuModel) info.cpuModel = cpuModel.replace(/\s+/g, ' ');
  if (typeof freeBytes === 'number' && Number.isFinite(freeBytes)) info.freeDiskGB = Math.round((freeBytes / GB) * 10) / 10;
  return info;
}

/** Dépendances réelles (Node + Electron). */
export function systemHardwareDeps(getGPUInfo?: () => Promise<unknown>): HardwareDeps {
  return {
    platform: process.platform,
    arch: process.arch,
    totalmem: () => os.totalmem(),
    freemem: () => os.freemem(),
    cpus: () => os.cpus(),
    availableParallelism: typeof os.availableParallelism === 'function' ? () => os.availableParallelism() : undefined,
    getGPUInfo,
    execFile: (file, args, options) =>
      new Promise((resolve, reject) => {
        execFileCb(file, args, { timeout: options.timeout, cwd: options.cwd, windowsHide: true, encoding: 'utf8' }, (err, stdout) => {
          if (err) reject(err);
          else resolve({ stdout });
        });
      }),
    env: process.env,
    fileExists: async p => {
      try {
        return (await fsp.stat(p)).isFile();
      } catch {
        return false;
      }
    },
    tmpdir: os.tmpdir(),
    freeDiskBytes,
    modelsDir: ollamaModelsDir(),
  };
}
