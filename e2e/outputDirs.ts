// Dossiers de sortie des tests de bout en bout : UN dossier par projet Playwright (playwright.config.ts).
//
// Au début d'un lancement, Playwright vide le dossier de sortie de chaque projet LANCÉ, et de lui seul. Avec un dossier
// commun (test-results/), « --project=connector » lancé après « --project=electron » dans le même job de CI effaçait
// les captures et les traces de l'application. Chaque projet range donc tout ce qu'il produit (traces, captures,
// harnais construit) dans SON dossier : un projet ne vide jamais ce qu'un autre a produit.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export type E2EProject = 'web' | 'electron' | 'connector';

/** Chemins relatifs à la racine du dépôt (playwright.config.ts, workflows de CI). */
export const E2E_OUTPUT_DIRS: Readonly<Record<E2EProject, string>> = {
  web: 'test-results/web',
  electron: 'test-results/electron',
  connector: 'test-results/connector',
};

/** Captures d'écran d'un projet (envoyées en artefact par la CI). */
export const E2E_SCREENSHOT_DIRS: Readonly<Record<'electron' | 'connector', string>> = {
  electron: `${E2E_OUTPUT_DIRS.electron}/captures`,
  connector: `${E2E_OUTPUT_DIRS.connector}/captures`,
};

/** Harnais du site construit par e2e/connector-local.spec.ts (jamais publié). */
export const CONNECTOR_HARNESS_DIR = `${E2E_OUTPUT_DIRS.connector}/harness-dist`;

/** Chemin absolu d'un de ces dossiers. */
export function fromRoot(relative: string): string {
  return path.join(root, ...relative.split('/'));
}
