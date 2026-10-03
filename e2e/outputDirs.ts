// Dossiers de sortie des tests de bout en bout : UN dossier par projet Playwright (playwright.config.ts).
//
// Au début d'un lancement, Playwright vide le dossier de sortie de chaque projet LANCÉ, et de lui seul. Avec un dossier
// commun (test-results/), « --project=connector » lancé après « --project=electron » dans le même job de CI effaçait
// les captures et les traces de l'application. Chaque projet range donc tout ce qu'il produit (traces, captures,
// harnais construit) dans SON dossier : un projet ne vide jamais ce qu'un autre a produit.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Projets du connecteur local : même fichier de tests, un navigateur chacun (Chromium de Playwright, Microsoft Edge). */
export type ConnectorProject = 'connector' | 'connector-edge';
export type E2EProject = 'web' | 'electron' | 'site' | ConnectorProject;

export const CONNECTOR_PROJECTS: readonly ConnectorProject[] = ['connector', 'connector-edge'];

/** Chemins relatifs à la racine du dépôt (playwright.config.ts, workflows de CI). */
export const E2E_OUTPUT_DIRS: Readonly<Record<E2EProject, string>> = {
  web: 'test-results/web',
  electron: 'test-results/electron',
  site: 'test-results/site',
  connector: 'test-results/connector',
  'connector-edge': 'test-results/connector-edge',
};

/** Captures d'écran d'un projet (celles de « electron » et « connector » sont envoyées en artefact par la CI). */
export const E2E_SCREENSHOT_DIRS: Readonly<Record<'electron' | ConnectorProject, string>> = {
  electron: `${E2E_OUTPUT_DIRS.electron}/captures`,
  connector: `${E2E_OUTPUT_DIRS.connector}/captures`,
  'connector-edge': `${E2E_OUTPUT_DIRS['connector-edge']}/captures`,
};

/** Harnais du site construit par e2e/connector-local.spec.ts (jamais publié), dans le dossier du projet lancé. */
export const CONNECTOR_HARNESS_DIRS: Readonly<Record<ConnectorProject, string>> = {
  connector: `${E2E_OUTPUT_DIRS.connector}/harness-dist`,
  'connector-edge': `${E2E_OUTPUT_DIRS['connector-edge']}/harness-dist`,
};

/** Dossier par défaut du harnais (construction à la main : `npx vite build --config e2e/connector-harness/vite.config.ts`). */
export const CONNECTOR_HARNESS_DIR = CONNECTOR_HARNESS_DIRS.connector;

/** Projet du connecteur local d'après son nom (erreur explicite pour tout autre projet). */
export function connectorProject(name: string): ConnectorProject {
  if ((CONNECTOR_PROJECTS as readonly string[]).includes(name)) return name as ConnectorProject;
  throw new Error(`Projet Playwright inattendu pour le connecteur local : ${name}`);
}

/** Chemin absolu d'un de ces dossiers. */
export function fromRoot(relative: string): string {
  return path.join(root, ...relative.split('/'));
}

/**
 * Projets demandés sur la ligne de commande (`--project=site`, `--project site web`) ; null s'il n'y en a pas, ou si l'un
 * n'est pas reconnu (nom inconnu, motif avec « * ») : tous les projets sont alors supposés lancés.
 * Sert à ne démarrer que les serveurs d'aperçu dont les projets lancés ont besoin (playwright.config.ts) : le site vitrine
 * n'exige que dist-site/, les autres projets que dist/.
 */
export function requestedProjects(argv: readonly string[]): E2EProject[] | null {
  const names: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--project=')) {
      names.push(arg.slice('--project='.length));
    } else if (arg === '--project') {
      for (let j = i + 1; j < argv.length && !argv[j].startsWith('-'); j++) names.push(argv[j]);
    }
  }
  if (names.length === 0) return null;
  const known = Object.keys(E2E_OUTPUT_DIRS);
  return names.every(name => known.includes(name)) ? (names as E2EProject[]) : null;
}
