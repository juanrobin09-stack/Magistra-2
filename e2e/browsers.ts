// Navigateurs installés sur la machine de test, pour les projets Playwright qui en ont besoin (playwright.config.ts,
// e2e/connector-local.spec.ts). Microsoft Edge (canal « msedge ») n'est pas fourni par Playwright : le projet
// « connector-edge » est ignoré proprement (tests « skipped ») là où il n'est pas installé, comme dans la CI Linux.

import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Exécutable de Microsoft Edge (canal stable), aux emplacements où Playwright le cherche pour `channel: 'msedge'` ;
 * null s'il n'est pas installé.
 */
export function msedgeExecutable(): string | null {
  const candidates: string[] = [];
  if (process.platform === 'linux') candidates.push('/opt/microsoft/msedge/msedge');
  else if (process.platform === 'darwin') candidates.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  else if (process.platform === 'win32') {
    for (const base of [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']]) {
      if (base) candidates.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  }
  return candidates.find(file => existsSync(file)) ?? null;
}

/** Raison affichée quand le projet « connector-edge » est ignoré. */
export const MSEDGE_MISSING_REASON =
  'Microsoft Edge n’est pas installé sur cette machine : projet « connector-edge » ignoré (voir README, « Navigateurs vérifiés »).';
