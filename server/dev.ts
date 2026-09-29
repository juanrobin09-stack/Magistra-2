// Point d'entrée de l'API pour le serveur de développement Vite (chargé à la demande par
// server/viteDevApi.ts via ssrLoadModule : la configuration Vite n'importe ainsi jamais
// @clerk/backend ni @supabase/supabase-js).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServerDeps, describeStartup, type ServerDeps } from './deps.js';
import { handleNodeRequest } from './node.js';

/** Informations transmises par le plugin Vite : racine du projet, hôte et port d'écoute réels. */
export interface DevServerInfo {
  root?: string;
  /** Hôte d'écoute de Vite (« localhost » par défaut, « 0.0.0.0 » avec --host). */
  host?: string | null;
  port?: number;
}

let cached: { env: Record<string, string>; key: string; deps: ServerDeps } | undefined;

function depsFor(env: Record<string, string>, info: DevServerInfo = {}): ServerDeps {
  const key = `${info.root ?? ''}|${info.host ?? ''}`;
  if (!cached || cached.env !== env || cached.key !== key) {
    cached = {
      env,
      key,
      deps: createServerDeps({ ...env, NODE_ENV: 'development' }, {
        dev: true,
        ...(info.host !== undefined ? { listen: { host: info.host, ...(info.port ? { port: info.port } : {}) } } : {}),
        ...(info.root ? { projectRoot: info.root } : {}),
      }),
    };
  }
  if (info.port) cached.deps.personal?.setPort(info.port);
  return cached.deps;
}

export async function handleDevRequest(req: IncomingMessage, res: ServerResponse, env: Record<string, string>, info?: DevServerInfo): Promise<void> {
  await handleNodeRequest(req, res, { deps: () => depsFor(env, info) });
}

/** Lignes affichées sous les adresses de Vite : mode (personnel : adresse d'accès avec le jeton), IA détectée. */
export async function devStartupLines(env: Record<string, string>, info: DevServerInfo = {}): Promise<string[]> {
  return describeStartup(depsFor(env, info), info.port);
}
