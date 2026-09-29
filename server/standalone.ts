// Serveur Node autonome pour l'auto-hébergement (université, académie, établissement).
//
//   npm run build && npm run build:server && npm start
//
// Sert l'application (dossier dist/, avec repli sur index.html pour les routes de l'interface)
// et l'API /api/* (même code que sur Vercel). Aucune dépendance d'hébergeur.
// Variables : voir .env.example (PORT, HOST, MAGISTRA_STATIC_DIR, CSP_EXTRA_ORIGINS, MAGISTRA_AUTH…).
//
// Sans Clerk et avec HOST=127.0.0.1 : mode personnel (un seul utilisateur, cet ordinateur uniquement, jeton
// secret affiché dans le terminal). Le serveur REFUSE de démarrer en mode personnel sur une autre adresse.

import { createReadStream, existsSync, realpathSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONNECTOR_HOST, CONNECTOR_PORTS } from '../shared/localConnector.js';
import { createServerDeps, describeStartup } from './deps.js';
import { handleNodeRequest, type DepsSource } from './node.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.xml': 'application/xml; charset=utf-8',
};

const CLERK_ORIGINS = ['https://*.clerk.accounts.dev', 'https://*.clerk.com'];

/**
 * Connecteur local de l'application Windows (Magistra locale) : les TROIS adresses exactes de la boucle locale, et
 * elles seules (ni « localhost », ni joker de port, ni autre hôte). Seul connect-src les autorise (fetch du site vers
 * l'application) : aucun script, aucune image, aucun cadre de la boucle locale. Le connecteur lui-même n'accepte que
 * les origines officielles (voir shared/localConnector.ts).
 */
export const LOCAL_CONNECTOR_ORIGINS: readonly string[] = CONNECTOR_PORTS.map(port => `http://${CONNECTOR_HOST}:${port}`);

/** Politique de sécurité du contenu (identique à vercel.json, plus les origines ajoutées). */
export function buildContentSecurityPolicy(extraOrigins: string[] = []): string {
  const extra = extraOrigins.length ? ` ${extraOrigins.join(' ')}` : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${CLERK_ORIGINS.join(' ')} https://challenges.cloudflare.com${extra}`,
    `connect-src 'self' ${CLERK_ORIGINS.join(' ')} ${LOCAL_CONNECTOR_ORIGINS.join(' ')}${extra}`,
    `img-src 'self' data: blob: https://img.clerk.com${extra}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `frame-src https://challenges.cloudflare.com https://*.clerk.accounts.dev${extra}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function securityHeaders(extraOrigins: string[] = []): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Content-Security-Policy': buildContentSecurityPolicy(extraOrigins),
  };
}

/** Origines supplémentaires autorisées par la CSP (domaine Clerk personnalisé…). */
export function parseExtraOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(s => /^https:\/\/(\*\.)?[a-z0-9.-]+(:\d{1,5})?$/i.test(s));
}

/**
 * Chemin du fichier demandé, garanti à l'intérieur de `root`.
 * null = chemin refusé (remontée de répertoire, fichier caché, octet nul, encodage invalide).
 */
export function resolveStaticPath(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/');
  // Aucun segment « . », « .. » ni fichier caché (sauf /.well-known/).
  if (segments.some((seg, i) => seg.startsWith('.') && !(i === 1 && seg === '.well-known'))) return null;
  const base = path.resolve(root);
  const full = path.resolve(base, `.${path.posix.normalize(`/${decoded}`)}`);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

async function fileIfInside(root: string, candidate: string): Promise<{ file: string; size: number; mtime: Date } | null> {
  try {
    const info = await stat(candidate);
    if (!info.isFile()) return null;
    // Lien symbolique pointant hors du dossier publié : refusé.
    const [real, realRoot] = await Promise.all([realpath(candidate), realpath(root)]);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
    return { file: real, size: info.size, mtime: info.mtime };
  } catch {
    return null;
  }
}

function sendText(res: ServerResponse, status: number, text: string, headers: Record<string, string>): void {
  res.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, root: string, headers: Record<string, string>): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    sendText(res, 405, 'Méthode non autorisée.', headers);
    return;
  }
  const rawPath = (req.url ?? '/').split('?')[0].split('#')[0] || '/';
  const target = resolveStaticPath(root, rawPath);
  if (!target) {
    sendText(res, 400, 'Chemin invalide.', headers);
    return;
  }
  let found = rawPath.endsWith('/') ? null : await fileIfInside(root, target);
  let isIndex = false;
  if (!found) {
    // Repli de l'application monopage : uniquement pour les chemins sans extension.
    if (path.posix.extname(rawPath) !== '') {
      sendText(res, 404, 'Fichier introuvable.', headers);
      return;
    }
    found = await fileIfInside(root, path.join(root, 'index.html'));
    isIndex = true;
    if (!found) {
      sendText(res, 503, "Application non construite : exécutez « npm run build ».", headers);
      return;
    }
  }
  const ext = path.extname(found.file).toLowerCase();
  if (ext === '.html') isIndex = true;
  const hashedAsset = /\/assets\//.test(rawPath) && !isIndex;
  res.writeHead(200, {
    ...headers,
    'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
    'Content-Length': String(found.size),
    'Last-Modified': found.mtime.toUTCString(),
    'Cache-Control': hashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(found.file);
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

export interface StandaloneOptions {
  staticDir: string;
  deps?: DepsSource;
  cspExtraOrigins?: string[];
}

export function createStandaloneHandler(options: StandaloneOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const root = path.resolve(options.staticDir);
  const headers = securityHeaders(options.cspExtraOrigins);
  return (req, res) => {
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
    const pathname = (req.url ?? '/').split('?')[0];
    const done = (p: Promise<void>) => p.catch(() => {
      if (!res.headersSent) sendText(res, 500, 'Erreur interne.', headers);
      else res.destroy();
    });
    if (pathname === '/healthz') {
      sendText(res, 200, 'ok', headers);
      return;
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      done(handleNodeRequest(req, res, { deps: options.deps }));
      return;
    }
    done(serveStatic(req, res, root, headers));
  };
}

export function createStandaloneServer(options: StandaloneOptions): Server {
  return createServer(createStandaloneHandler(options));
}

function defaultStaticDir(): string {
  // server/standalone.ts et dist-server/standalone.js sont tous deux voisins de dist/.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(realpathSync(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

function main(): void {
  // Fichier .env facultatif dans le dossier courant (les variables déjà définies restent prioritaires).
  const envFile = path.resolve(process.env.MAGISTRA_ENV_FILE ?? '.env');
  if (existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile);
    } catch {
      console.error('[magistra] Fichier de configuration illisible : il est ignoré.');
    }
  }
  const host = process.env.HOST?.trim() || undefined;
  const requestedPort = Number(process.env.PORT ?? 3000);
  const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort < 65_536 ? requestedPort : 3000;
  // HOST vide = toutes les interfaces : le mode personnel (sans compte) n'est alors jamais choisi.
  const deps = createServerDeps(process.env, { listen: { host: host ?? null, port } });
  if (deps.startupError) {
    console.error(`[magistra] Démarrage refusé : ${deps.startupError}`);
    process.exit(1);
  }
  const staticDir = process.env.MAGISTRA_STATIC_DIR ? path.resolve(process.env.MAGISTRA_STATIC_DIR) : defaultStaticDir();
  if (!existsSync(path.join(staticDir, 'index.html'))) {
    console.error(`[magistra] Application non construite (${staticDir}/index.html absent) : exécutez « npm run build ».`);
  }
  const server = createStandaloneServer({ staticDir, deps, cspExtraOrigins: parseExtraOrigins(process.env.CSP_EXTRA_ORIGINS) });
  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    deps.personal?.setPort(actualPort);
    const shown = typeof address === 'object' && address ? `${host ?? 'localhost'}:${address.port}` : String(address);
    console.log(`[magistra] Serveur démarré : http://${shown}`);
    void describeStartup(deps, actualPort).then(lines => {
      for (const line of lines) console.log(`[magistra] ${line}`);
    });
  });
  const stop = () => {
    console.log('[magistra] Arrêt du serveur…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (isMainModule()) main();
