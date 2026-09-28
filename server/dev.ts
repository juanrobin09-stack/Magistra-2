// Point d'entrée de l'API pour le serveur de développement Vite (chargé à la demande par
// server/viteDevApi.ts via ssrLoadModule : la configuration Vite n'importe ainsi jamais
// @clerk/backend ni @supabase/supabase-js).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServerDeps, type ServerDeps } from './deps.js';
import { handleNodeRequest } from './node.js';

let cached: { env: Record<string, string>; deps: ServerDeps } | undefined;

function depsFor(env: Record<string, string>): ServerDeps {
  if (!cached || cached.env !== env) {
    cached = { env, deps: createServerDeps({ ...env, NODE_ENV: 'development' }, { dev: true }) };
  }
  return cached.deps;
}

export async function handleDevRequest(req: IncomingMessage, res: ServerResponse, env: Record<string, string>): Promise<void> {
  await handleNodeRequest(req, res, { deps: () => depsFor(env) });
}
