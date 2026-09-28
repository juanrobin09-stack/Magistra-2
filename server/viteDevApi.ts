// Plugin Vite : monte l'API /api/* dans le serveur de développement (`npm run dev`), avec
// exactement le même code que la production (server/node.ts → server/handlers.ts).
//
// Les modules serveur sont chargés à la demande (ssrLoadModule) : la configuration Vite reste
// légère et n'importe jamais les dépendances serveur. Les variables d'environnement serveur
// (CLERK_SECRET_KEY, SUPABASE_*, AI_*…) sont lues côté Node uniquement.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

interface DevApiModule {
  handleDevRequest(req: IncomingMessage, res: ServerResponse, env: Record<string, string>): Promise<void>;
}

function isApiPath(url: string | undefined): boolean {
  const path = (url ?? '').split('?')[0];
  return path === '/api' || path.startsWith('/api/');
}

function sendMisconfigured(res: ServerResponse, message: string): void {
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  const body = JSON.stringify({ error: { code: 'SERVER_MISCONFIGURED', message, retryable: false } });
  res.statusCode = 500;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(body);
}

export function magistraDevApi(env: Record<string, string>): Plugin {
  return {
    name: 'magistra-dev-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!isApiPath(req.url)) {
          next();
          return;
        }
        server
          .ssrLoadModule('/server/dev.ts')
          .then(mod => (mod as unknown as DevApiModule).handleDevRequest(req, res, env))
          .catch((err: unknown) => {
            server.config.logger.error(`[magistra] API de développement indisponible : ${err instanceof Error ? err.message : String(err)}`);
            sendMisconfigured(res, "L'API de développement n'a pas pu démarrer. Consultez le terminal de `npm run dev`.");
          });
      });
    },
    configurePreviewServer(server) {
      // `vite preview` ne sert que les fichiers statiques : l'API est fournie par `npm start`
      // (serveur autonome) ou par Vercel. Réponse JSON claire plutôt qu'une page HTML.
      server.middlewares.use((req, res, next) => {
        if (!isApiPath(req.url)) {
          next();
          return;
        }
        sendMisconfigured(res, "L'API n'est pas disponible avec « vite preview » : utilisez « npm run build && npm start ».");
      });
    },
  };
}
