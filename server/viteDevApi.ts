// Plugin Vite : monte l'API /api/* dans le serveur de développement (`npm run dev`), avec
// exactement le même code que la production (server/node.ts → server/handlers.ts).
//
// Les modules serveur sont chargés à la demande (ssrLoadModule) : la configuration Vite reste
// légère et n'importe jamais les dépendances serveur. Les variables d'environnement serveur
// (CLERK_SECRET_KEY, SUPABASE_*, AI_*…) sont lues côté Node uniquement.
//
// Sans Clerk, `npm run dev` démarre en mode personnel (voir server/personal.ts) : l'adresse d'accès avec le
// jeton secret est affichée sous les adresses de Vite, avec l'IA locale détectée.
//
// Dossier de données (jeton d'accès secret, historique, profil : <racine>/.magistra-data par défaut, ou
// MAGISTRA_DATA_DIR) : Vite sert tous les fichiers de la racine du projet, dossiers « point » compris. Le plugin
// l'interdit donc de deux façons : server.fs.deny (route statique, /@fs/, ?raw, ?import, %2e…) et, en tête des
// middlewares, un refus de toute adresse qui vise « .magistra-data » (défense en profondeur).

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

/** Valeur par défaut de server.fs.deny (Vite 7). Une liste fournie REMPLACE celle de Vite : on la reprend donc. */
export const VITE_DEFAULT_FS_DENY: readonly string[] = ['.env', '.env.*', '*.{crt,pem}', '**/.git/**'];
/** Même valeur que DEFAULT_DATA_DIR_NAME (server/config.ts), recopiée pour garder la configuration Vite légère. */
export const DATA_DIR_NAME = '.magistra-data';

/** Échappe les caractères spéciaux des motifs (picomatch) d'un chemin absolu. */
function escapeGlob(p: string): string {
  return p.replace(/[\\*?[\]{}()!+@]/g, '\\$&');
}

/** Dossier de données personnalisé (MAGISTRA_DATA_DIR), calculé comme loadConfig ; undefined s'il est vide. */
export function customDataDir(env: Record<string, string | undefined>): string | undefined {
  const raw = env.MAGISTRA_DATA_DIR?.trim();
  return raw ? path.resolve(raw) : undefined;
}

/**
 * Motifs server.fs.deny du dossier de données : le dossier par défaut (où qu'il soit sous la racine) et le dossier
 * MAGISTRA_DATA_DIR s'il est renseigné (chemin absolu, barres obliques normales). Le motif « .magistra-data » seul ne
 * suffirait pas : Vite le préfixe de « ** » et il ne viserait que le dossier, pas les fichiers qu'il contient.
 */
export function dataDirDenyPatterns(env: Record<string, string | undefined>): string[] {
  const patterns = [`**/${DATA_DIR_NAME}`, `**/${DATA_DIR_NAME}/**`];
  const custom = customDataDir(env);
  if (custom) {
    const dir = escapeGlob(custom.split(path.sep).join('/'));
    patterns.push(dir, `${dir}/**`);
  }
  return patterns;
}

/** Vrai si l'adresse vise le dossier de données, quels que soient l'encodage, la casse ou les barres obliques inverses. */
export function targetsDataDir(url: string | undefined): boolean {
  let p = (url ?? '').split(/[?#]/)[0];
  for (let i = 0; i < 3 && p.includes('%'); i++) {
    try {
      p = decodeURIComponent(p);
    } catch {
      break;
    }
  }
  return p.replace(/\\/g, '/').split('/').some(segment => segment.trim().toLowerCase() === DATA_DIR_NAME);
}

interface DevServerInfo {
  root?: string;
  host?: string | null;
  port?: number;
}

interface DevApiModule {
  handleDevRequest(req: IncomingMessage, res: ServerResponse, env: Record<string, string>, info?: DevServerInfo): Promise<void>;
  devStartupLines(env: Record<string, string>, info?: DevServerInfo): Promise<string[]>;
}

/** Même valeur que DOWNLOAD_PATH (server/handlers.ts), recopiée pour garder la configuration Vite légère. */
export const DEV_DOWNLOAD_PATH = '/telecharger';

function isApiPath(url: string | undefined): boolean {
  const path = (url ?? '').split('?')[0];
  // /telecharger : lien de téléchargement du site (même route que /api/download).
  return path === '/api' || path.startsWith('/api/') || path === DEV_DOWNLOAD_PATH || path === `${DEV_DOWNLOAD_PATH}/`;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

function sendMisconfigured(res: ServerResponse, message: string): void {
  sendJson(res, 500, { error: { code: 'SERVER_MISCONFIGURED', message, retryable: false } });
}

/**
 * Hôte d'écoute de Vite : option server.host (absente = localhost, true ou « » = toutes les interfaces, donc jamais
 * de mode personnel). Exportée pour les tests.
 */
export function listenHost(host: string | boolean | undefined): string | null {
  if (host === undefined || host === false) return 'localhost';
  if (host === true || host === '') return null;
  return host;
}

function serverInfo(server: ViteDevServer): DevServerInfo {
  const address = server.httpServer?.address();
  const port = address && typeof address === 'object' ? (address as AddressInfo).port : server.config.server.port;
  return { root: server.config.root, host: listenHost(server.config.server.host), ...(port ? { port } : {}) };
}

export function magistraDevApi(env: Record<string, string>): Plugin {
  return {
    name: 'magistra-dev-api',
    config(userConfig, { command }) {
      if (command !== 'serve') return;
      // Les valeurs de Vite (ou celles de vite.config.ts) sont conservées, le dossier de données est ajouté.
      const deny = userConfig.server?.fs?.deny ?? VITE_DEFAULT_FS_DENY;
      return { server: { fs: { deny: [...deny, ...dataDirDenyPatterns(env)] } } };
    },
    configureServer(server) {
      // Défense en profondeur, AVANT tous les autres middlewares : le dossier de données n'est jamais servi.
      server.middlewares.use((req, res, next) => {
        if (!targetsDataDir(req.url)) {
          next();
          return;
        }
        res.statusCode = 404;
        res.setHeader('Cache-Control', 'no-store');
        res.end();
      });
      const load = () => server.ssrLoadModule('/server/dev.ts') as Promise<unknown> as Promise<DevApiModule>;
      // Après les adresses de Vite : mode d'authentification, adresse d'accès du mode personnel, IA détectée.
      const printUrls = server.printUrls.bind(server);
      server.printUrls = () => {
        printUrls();
        load()
          .then(mod => mod.devStartupLines(env, serverInfo(server)))
          .then(lines => {
            for (const line of lines) server.config.logger.info(`  [magistra] ${line}`);
          })
          .catch((err: unknown) => {
            server.config.logger.error(`[magistra] API de développement indisponible : ${err instanceof Error ? err.message : String(err)}`);
          });
      };
      server.middlewares.use((req, res, next) => {
        if (!isApiPath(req.url)) {
          next();
          return;
        }
        load()
          .then(mod => mod.handleDevRequest(req, res, env, serverInfo(server)))
          .catch((err: unknown) => {
            server.config.logger.error(`[magistra] API de développement indisponible : ${err instanceof Error ? err.message : String(err)}`);
            sendMisconfigured(res, "L'API de développement n'a pas pu démarrer. Consultez le terminal de `npm run dev`.");
          });
      });
    },
    configurePreviewServer(server) {
      // `vite preview` ne sert que les fichiers statiques : l'API est fournie par `npm start`
      // (serveur autonome) ou par Vercel. Réponse JSON claire plutôt qu'une page HTML ;
      // /api/mode indique « aucune authentification » (l'interface reste en démonstration).
      server.middlewares.use((req, res, next) => {
        if (!isApiPath(req.url)) {
          next();
          return;
        }
        if ((req.url ?? '').split('?')[0].replace(/\/$/, '') === '/api/mode' && (req.method ?? 'GET').toUpperCase() === 'GET') {
          sendJson(res, 200, { auth: 'none' });
          return;
        }
        sendMisconfigured(res, "L'API n'est pas disponible avec « vite preview » : utilisez « npm run build && npm start ».");
      });
    },
  };
}
