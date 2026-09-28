// Formatage en français des tailles, progressions et caractéristiques de l'ordinateur.
// Fonctions pures : aucune dépendance à React ni au pont Electron (testées dans tests/ai-ui).

import { formatGB as formatGBShared, nominalRamGB, type HardwareInfo } from '@shared/ai/models';
import type { AIStatus } from '@shared/ipc';

/** Espace insécable entre le nombre et l'unité (« 9 Go » ne doit jamais être coupé en fin de ligne). */
const NBSP = '\u00a0';

/** 9 → « 9 Go » ; 31,8 → « 31,8 Go » (espace insécable). */
export function formatGB(gb: number): string {
  return formatGBShared(gb).replace(' Go', `${NBSP}Go`);
}

function oneDecimal(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',');
}

/** 850 → « 850 Mo » ; 3 277 → « 3,2 Go ». Valeur absente ou invalide → « 0 Mo ». */
export function formatMB(mb: number | null | undefined): string {
  if (mb === null || mb === undefined || !Number.isFinite(mb) || mb <= 0) return `0${NBSP}Mo`;
  if (mb < 1024) return `${Math.round(mb)}${NBSP}Mo`;
  return `${oneDecimal(mb / 1024)}${NBSP}Go`;
}

/** « 120 Mo sur 850 Mo », ou « 120 Mo téléchargés » si la taille totale est inconnue. */
export function formatTransfer(doneMB: number | null | undefined, totalMB?: number | null): string {
  if (totalMB !== null && totalMB !== undefined && Number.isFinite(totalMB) && totalMB > 0) {
    return `${formatMB(doneMB)} sur ${formatMB(totalMB)}`;
  }
  return `${formatMB(doneMB)} téléchargés`;
}

/**
 * Pourcentage entier (0 à 100) à partir d'un pourcentage fourni ou du rapport fait / total.
 * null = progression inconnue (barre indéterminée).
 */
export function progressPercent(p: { percent?: number | null; completed?: number | null; total?: number | null }): number | null {
  const clamp = (n: number) => Math.min(100, Math.max(0, Math.floor(n)));
  if (typeof p.percent === 'number' && Number.isFinite(p.percent)) return clamp(p.percent);
  if (typeof p.total === 'number' && p.total > 0 && typeof p.completed === 'number' && Number.isFinite(p.completed)) {
    return clamp((p.completed / p.total) * 100);
  }
  return null;
}

/** Taille du téléchargement du moteur : exacte si connue, sinon « environ … ». */
export function engineDownloadText(download: AIStatus['engineDownload']): string {
  if (typeof download.sizeMB === 'number' && download.sizeMB > 0) return formatMB(download.sizeMB);
  return `environ${NBSP}${formatMB(download.approxSizeMB)}`;
}

/** Retire les mentions commerciales techniques : « Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz » → « Intel Core i5-8250U ». */
export function cleanDeviceName(name: string | undefined | null): string {
  if (!name) return '';
  return name
    .replace(/\((R|TM|C)\)/gi, '')
    .replace(/[®™]/g, '')
    .replace(/\s+CPU\s*@.*$/i, '')
    .replace(/\s+@\s*[\d.,]+\s*GHz.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export interface HardwareLine {
  label: string;
  value: string;
}

/** Description simple de l'ordinateur (mémoire, processeur, carte graphique, disque). */
export function hardwareLines(hw: HardwareInfo): HardwareLine[] {
  const lines: HardwareLine[] = [];
  // Capacité installée (celle de la fiche technique) et, si elle diffère, ce que le système en voit.
  const nominal = nominalRamGB(hw.totalRamGB);
  lines.push({
    label: 'Mémoire vive',
    value: nominal !== hw.totalRamGB && nominal > 0 ? `${formatGB(nominal)} (${formatGB(hw.totalRamGB)} utilisables)` : formatGB(hw.totalRamGB),
  });

  const cores = hw.cpuCores > 0 ? `${hw.cpuCores}${NBSP}cœur${hw.cpuCores > 1 ? 's' : ''}` : '';
  const cpu = cleanDeviceName(hw.cpuModel);
  lines.push({ label: 'Processeur', value: cpu ? (cores ? `${cpu} (${cores})` : cpu) : cores || 'Inconnu' });

  const gpus = hw.gpus
    .map(g => {
      const name = cleanDeviceName(g.name) || 'Carte graphique';
      return typeof g.vramGB === 'number' && g.vramGB > 0 ? `${name} (${formatGB(g.vramGB)} de mémoire vidéo)` : name;
    });
  lines.push({ label: gpus.length > 1 ? 'Cartes graphiques' : 'Carte graphique', value: gpus.length > 0 ? gpus.join(', ') : 'Aucune carte graphique dédiée détectée' });

  if (typeof hw.freeDiskGB === 'number') lines.push({ label: 'Espace disque libre', value: formatGB(hw.freeDiskGB) });
  return lines;
}
