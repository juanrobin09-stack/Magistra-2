// Options de développement et de test : test de démarrage (--smoke-test, MAGISTRA_SMOKE_*), interface servie
// par Vite (VITE_DEV_SERVER_URL), dossiers et adresse de remplacement (MAGISTRA_DIST_DIR,
// MAGISTRA_USER_DATA_DIR, MAGISTRA_OLLAMA_URL).
//
// Elles ne sont lues QUE hors de l'application installée (app.isPackaged faux : `electron .` depuis les sources).
// Dans l'application installée, ces arguments et variables d'environnement sont sans effet : personne ne peut
// ainsi faire charger une autre interface, détourner le moteur IA vers un autre serveur, changer le dossier des
// données ou déclencher les vérifications automatiques (qui écrivent l'état de l'application sur la sortie standard).
//
// Choix pour la CI (.github/workflows/ci.yml) : le test de démarrage (scripts/electron-smoke.mjs) et les tests E2E
// lancent Electron depuis les sources (`electron .`), y compris dans le job « windows-package », où le test précède
// l'empaquetage ; aucun job n'exécute l'application empaquetée avec --smoke-test. Il n'existe donc AUCUNE exception
// pour l'application empaquetée (ni fichier marqueur, ni option de construction réservée à la CI).

import path from 'node:path';
import { parseDevServerUrl } from './security.js';
import { smokeOptionsFrom, type SmokeOptions } from './smoke.js';

export interface DevOptions {
  /** Test de démarrage automatisé. */
  smoke: SmokeOptions | null;
  /** Serveur Vite (boucle locale uniquement). */
  devServerUrl: string | null;
  /** Dossier dist/ de remplacement. */
  distDir?: string;
  /** Dossier de données de remplacement. */
  userDataDir?: string;
  /** Adresse d'Ollama par défaut (faux serveur des tests). */
  ollamaUrl?: string;
}

export function devOptionsFrom(isPackaged: boolean, argv: readonly string[], env: NodeJS.ProcessEnv): DevOptions {
  if (isPackaged) return { smoke: null, devServerUrl: null };
  return {
    smoke: smokeOptionsFrom(argv, env),
    devServerUrl: parseDevServerUrl(env.VITE_DEV_SERVER_URL),
    ...(env.MAGISTRA_DIST_DIR ? { distDir: path.resolve(env.MAGISTRA_DIST_DIR) } : {}),
    ...(env.MAGISTRA_USER_DATA_DIR ? { userDataDir: path.resolve(env.MAGISTRA_USER_DATA_DIR) } : {}),
    ...(env.MAGISTRA_OLLAMA_URL ? { ollamaUrl: env.MAGISTRA_OLLAMA_URL } : {}),
  };
}
