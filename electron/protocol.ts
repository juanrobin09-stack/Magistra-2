// Protocole app:// : sert l'interface React construite (dist/) sans aucun serveur HTTP local.
// En production, les fichiers sont lus à l'intérieur de app.asar (fs est compatible asar dans Electron).
//
// Règles :
// - chemin décodé, normalisé, et refusé s'il sort du dossier dist (→ 404) ;
// - repli SPA (index.html) UNIQUEMENT pour les chemins sans extension (/app/generate…) ;
//   un fichier manquant avec extension (/assets/x.js) renvoie 404, jamais index.html ;
// - types MIME explicites ; en-tête CSP strict sur TOUTES les réponses (HTML, scripts, erreurs) : un worker
//   (pdf.js, SharedWorker…) applique la politique reçue avec son propre script, pas celle de la page.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { APP_HOST, CONTENT_SECURITY_POLICY, hasControlChars } from './security.js';

export const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
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
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
};

export function mimeTypeFor(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export type EntryKind = 'file' | 'dir' | 'none';

export type ResolvedRequest =
  | { status: 200; filePath: string; spaFallback: boolean }
  | { status: 400 | 404 };

/**
 * Résout le chemin d'une requête app:// vers un fichier de `distDir`.
 * `kindOf` indique si un chemin est un fichier, un dossier ou absent (injecté pour les tests).
 */
export async function resolveAppRequest(
  distDir: string,
  pathname: string,
  kindOf: (p: string) => Promise<EntryKind>,
): Promise<ResolvedRequest> {
  const root = path.resolve(distDir);
  const index = path.join(root, 'index.html');

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { status: 400 };
  }
  // Caractères de contrôle et antislash : jamais légitimes dans une URL de l'application.
  if (hasControlChars(decoded) || decoded.includes('\\')) return { status: 404 };

  const normalized = path.posix.normalize(`/${decoded}`);
  const relative = normalized.replace(/^\/+/, '');
  if (relative === '' || relative === '.') return { status: 200, filePath: index, spaFallback: false };

  const candidate = path.resolve(root, relative);
  // Confinement strict au dossier dist (défense en profondeur après la normalisation).
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return { status: 404 };

  const kind = await kindOf(candidate);
  if (kind === 'file') return { status: 200, filePath: candidate, spaFallback: false };

  // Repli SPA : uniquement pour une route de l'application (aucune extension dans le dernier segment).
  const hasExtension = path.posix.extname(normalized) !== '';
  if (!hasExtension) return { status: 200, filePath: index, spaFallback: true };
  return { status: 404 };
}

export async function fsKindOf(p: string): Promise<EntryKind> {
  try {
    const st = await fsp.stat(p);
    if (st.isFile()) return 'file';
    if (st.isDirectory()) return 'dir';
    return 'none';
  } catch {
    return 'none';
  }
}

function textResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    },
  });
}

/** Crée le gestionnaire de `protocol.handle('app', …)` pour un dossier dist donné. */
export function createAppProtocolHandler(
  distDir: string,
  options: { kindOf?: (p: string) => Promise<EntryKind>; readFile?: (p: string) => Promise<Buffer> } = {},
): (request: Request) => Promise<Response> {
  const kindOf = options.kindOf ?? fsKindOf;
  const readFile = options.readFile ?? ((p: string) => fsp.readFile(p));
  return async (request: Request): Promise<Response> => {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return textResponse(400, 'Requête invalide');
    }
    if (url.hostname !== APP_HOST) return textResponse(404, 'Introuvable');
    if (request.method !== 'GET' && request.method !== 'HEAD') return textResponse(405, 'Méthode non autorisée');

    const resolved = await resolveAppRequest(distDir, url.pathname, kindOf);
    if (resolved.status !== 200) return textResponse(resolved.status, resolved.status === 400 ? 'Requête invalide' : 'Introuvable');

    let body: Buffer;
    try {
      body = await readFile(resolved.filePath);
    } catch {
      return textResponse(404, 'Introuvable');
    }
    const type = mimeTypeFor(resolved.filePath);
    const headers: Record<string, string> = {
      'Content-Type': type,
      'Content-Length': String(body.byteLength),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    };
    if (type.startsWith('text/html')) {
      headers['X-Frame-Options'] = 'DENY';
      headers['Referrer-Policy'] = 'no-referrer';
    }
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(body), { status: 200, headers });
  };
}
