// Protocole app:// : résolution sûre des chemins, repli SPA, types MIME, CSP.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAppProtocolHandler, fsKindOf, mimeTypeFor, resolveAppRequest } from '../../electron/protocol.js';
import { CONTENT_SECURITY_POLICY } from '../../electron/security.js';

let root: string;
let dist: string;

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'magistra-proto-'));
  dist = path.join(root, 'dist');
  mkdirSync(path.join(dist, 'assets'), { recursive: true });
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(path.join(dist, 'assets', 'index-abc.js'), 'console.log(1)');
  writeFileSync(path.join(dist, 'assets', 'pdf.worker.min.mjs'), 'export {}');
  writeFileSync(path.join(dist, 'assets', 'style.css'), 'body{}');
  writeFileSync(path.join(dist, 'assets', 'font.woff2'), 'x');
  writeFileSync(path.join(dist, 'assets', 'mod.wasm'), 'x');
  // Fichier sensible HORS du dossier dist.
  writeFileSync(path.join(root, 'ai-config.json'), '{"secret":true}');
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('résolution des chemins', () => {
  const resolve = (p: string) => resolveAppRequest(dist, p, fsKindOf);

  it('sert index.html pour la racine et les fichiers existants', async () => {
    expect(await resolve('/')).toEqual({ status: 200, filePath: path.join(dist, 'index.html'), spaFallback: false });
    expect(await resolve('/assets/index-abc.js')).toMatchObject({ status: 200, filePath: path.join(dist, 'assets', 'index-abc.js') });
  });

  it('refuse toute sortie du dossier dist (traversée de répertoires)', async () => {
    for (const p of [
      '/../ai-config.json',
      '/%2e%2e/ai-config.json',
      '/assets/..%2f..%2fai-config.json',
      '/%2e%2e%2f%2e%2e%2fai-config.json',
      '/..%5c..%5cai-config.json',
      '/assets/%00.js',
      '/%2e%2e/%2e%2e/%2e%2e/etc/passwd',
    ]) {
      const r = await resolve(p);
      if (r.status === 200) expect(r.filePath.startsWith(dist + path.sep) || r.filePath === dist).toBe(true);
      expect(r.status === 200 && r.filePath === path.join(root, 'ai-config.json')).toBe(false);
    }
    expect((await resolve('/../ai-config.json')).status).toBe(404);
    expect((await resolve('/..%5c..%5cai-config.json')).status).toBe(404);
    expect((await resolve('/%E0%A4%A')).status).toBe(400);
  });

  it('repli SPA uniquement pour les routes sans extension', async () => {
    expect(await resolve('/app/generate')).toEqual({ status: 200, filePath: path.join(dist, 'index.html'), spaFallback: true });
    expect(await resolve('/app/history/')).toMatchObject({ status: 200, spaFallback: true });
    expect(await resolve('/assets/absent.js')).toEqual({ status: 404 });
    expect(await resolve('/app/favicon.ico')).toEqual({ status: 404 });
  });

  it('types MIME corrects', () => {
    expect(mimeTypeFor('a.mjs')).toMatch(/^text\/javascript/);
    expect(mimeTypeFor('a.js')).toMatch(/^text\/javascript/);
    expect(mimeTypeFor('a.css')).toMatch(/^text\/css/);
    expect(mimeTypeFor('a.woff2')).toBe('font/woff2');
    expect(mimeTypeFor('a.ttf')).toBe('font/ttf');
    expect(mimeTypeFor('a.svg')).toBe('image/svg+xml');
    expect(mimeTypeFor('a.png')).toBe('image/png');
    expect(mimeTypeFor('a.json')).toMatch(/^application\/json/);
    expect(mimeTypeFor('a.wasm')).toBe('application/wasm');
    expect(mimeTypeFor('a.inconnu')).toBe('application/octet-stream');
  });
});

describe('gestionnaire app://', () => {
  const handler = () => createAppProtocolHandler(dist);

  it('ajoute la CSP stricte aux pages HTML', async () => {
    const html = await handler()(new Request('app://magistra/app/settings'));
    expect(html.status).toBe(200);
    expect(html.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const csp = html.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(await html.text()).toContain('id="root"');
  });

  it('envoie aussi la CSP avec les scripts (workers), les autres fichiers et les erreurs', async () => {
    // Un worker (pdf.js, SharedWorker…) applique la politique reçue avec SON script, pas celle de la page.
    for (const file of ['pdf.worker.min.mjs', 'index-abc.js', 'style.css', 'font.woff2', 'mod.wasm']) {
      const res = await handler()(new Request(`app://magistra/assets/${file}`));
      expect(res.status, file).toBe(200);
      expect(res.headers.get('content-security-policy'), file).toBe(CONTENT_SECURITY_POLICY);
      expect(res.headers.get('x-content-type-options'), file).toBe('nosniff');
    }
    const js = await handler()(new Request('app://magistra/assets/pdf.worker.min.mjs'));
    expect(js.headers.get('content-type')).toMatch(/^text\/javascript/);
    for (const [request, status] of [
      [new Request('app://magistra/assets/absent.js'), 404],
      [new Request('app://autre/worker.js'), 404],
      [new Request('app://magistra/%E0%A4%A'), 400],
      [new Request('app://magistra/', { method: 'POST', body: 'x' }), 405],
    ] as const) {
      const res = await handler()(request);
      expect(res.status).toBe(status);
      expect(res.headers.get('content-security-policy')).toBe(CONTENT_SECURITY_POLICY);
    }
  });

  it('renvoie 404 pour un fichier manquant, un autre hôte ou une traversée', async () => {
    expect((await handler()(new Request('app://magistra/assets/absent.js'))).status).toBe(404);
    expect((await handler()(new Request('app://autre/index.html'))).status).toBe(404);
    const res = await handler()(new Request('app://magistra/assets/..%2f..%2fai-config.json'));
    expect(await res.text()).not.toContain('secret');
  });

  it('refuse les méthodes autres que GET/HEAD', async () => {
    expect((await handler()(new Request('app://magistra/', { method: 'POST', body: 'x' }))).status).toBe(405);
  });
});
