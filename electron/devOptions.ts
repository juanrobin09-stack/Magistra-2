// Options de développement et de test : test de démarrage (--smoke-test, MAGISTRA_SMOKE_*), interface servie
// par Vite (VITE_DEV_SERVER_URL), dossiers et adresse de remplacement (MAGISTRA_DIST_DIR,
// MAGISTRA_USER_DATA_DIR, MAGISTRA_OLLAMA_URL), connecteur local (MAGISTRA_CONNECTOR_PORTS « p1,p2 »,
// MAGISTRA_CONNECTOR_DEV_ORIGINS « http://localhost:5173,… » : origines de la BOUCLE LOCALE uniquement, les autres
// sont ignorées ; MAGISTRA_CONNECTOR_DISABLED=1 : connecteur éteint).
//
// Elles ne sont lues QUE hors de l'application installée (app.isPackaged faux : `electron .` depuis les sources).
// Dans l'application installée, ces arguments et variables d'environnement sont sans effet : personne ne peut
// ainsi faire charger une autre interface, détourner le moteur IA vers un autre serveur, changer le dossier des
// données, déclencher les vérifications automatiques (qui écrivent l'état de l'application sur la sortie standard),
// ni autoriser un autre site que le site officiel à appairer le connecteur local.
//
// Choix pour la CI (.github/workflows/ci.yml) : le test de démarrage (scripts/electron-smoke.mjs) et les tests E2E
// lancent Electron depuis les sources (`electron .`), y compris dans le job « windows-package », où le test précède
// l'empaquetage ; aucun job n'exécute l'application empaquetée avec --smoke-test. Il n'existe donc AUCUNE exception
// pour l'application empaquetée (ni fichier marqueur, ni option de construction réservée à la CI).

import path from 'node:path';
import { isWellFormedOrigin } from '../shared/localConnector.js';
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
  /** Ports du connecteur local à la place de CONNECTOR_PORTS (le site de développement doit utiliser les mêmes). */
  connectorPorts?: number[];
  /** Origines de développement (boucle locale) autorisées EN PLUS des origines officielles. */
  connectorDevOrigins?: string[];
  /** Connecteur local éteint pour ce lancement. */
  connectorDisabled?: boolean;
}

const MAX_LIST = 8;

/** « 47900,47901 » → ports ; une seule valeur invalide (ou plus de MAX_LIST valeurs) et l'option est ignorée. */
export function parseConnectorPorts(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  const items = value.split(',').map(v => v.trim());
  if (items.length > MAX_LIST || !items.every(v => /^\d{1,5}$/.test(v))) return undefined;
  const ports = items.map(Number);
  if (!ports.every(p => p >= 1024 && p <= 65_535)) return undefined;
  return [...new Set(ports)];
}

/**
 * Origine exacte http(s) de la boucle locale (127.0.0.1 ou localhost, avec port éventuel), sans chemin ; tout le
 * reste est refusé. Mêmes règles que les URL magistra://pair (isWellFormedOrigin), restreintes à la boucle locale.
 */
export function isLoopbackDevOrigin(value: string): boolean {
  if (!isWellFormedOrigin(value)) return false;
  const { hostname } = new URL(value);
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

/** « http://localhost:5173,http://127.0.0.1:4173 » → origines de la boucle locale ; les autres entrées sont ignorées. */
export function parseConnectorDevOrigins(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const origins = value.split(',').map(v => v.trim()).filter(isLoopbackDevOrigin).slice(0, MAX_LIST);
  return origins.length ? [...new Set(origins)] : undefined;
}

export function devOptionsFrom(isPackaged: boolean, argv: readonly string[], env: NodeJS.ProcessEnv): DevOptions {
  if (isPackaged) return { smoke: null, devServerUrl: null };
  const connectorPorts = parseConnectorPorts(env.MAGISTRA_CONNECTOR_PORTS);
  const connectorDevOrigins = parseConnectorDevOrigins(env.MAGISTRA_CONNECTOR_DEV_ORIGINS);
  return {
    smoke: smokeOptionsFrom(argv, env),
    devServerUrl: parseDevServerUrl(env.VITE_DEV_SERVER_URL),
    ...(env.MAGISTRA_DIST_DIR ? { distDir: path.resolve(env.MAGISTRA_DIST_DIR) } : {}),
    ...(env.MAGISTRA_USER_DATA_DIR ? { userDataDir: path.resolve(env.MAGISTRA_USER_DATA_DIR) } : {}),
    ...(env.MAGISTRA_OLLAMA_URL ? { ollamaUrl: env.MAGISTRA_OLLAMA_URL } : {}),
    ...(connectorPorts ? { connectorPorts } : {}),
    ...(connectorDevOrigins ? { connectorDevOrigins } : {}),
    ...(env.MAGISTRA_CONNECTOR_DISABLED === '1' ? { connectorDisabled: true } : {}),
  };
}
