// Serveur Node autonome : fichiers statiques, repli SPA, API, en-têtes de sécurité, remontée de répertoire.

import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONNECTOR_HOST, CONNECTOR_PORTS } from '../../shared/localConnector.js';
import {
  buildContentSecurityPolicy, createStandaloneServer, LOCAL_CONNECTOR_ORIGINS, parseExtraOrigins, resolveStaticPath,
} from '../../server/standalone.js';
import { testDeps } from './helpers.js';

/** Requête HTTP brute : le chemin est envoyé tel quel (fetch normaliserait « .. »). */
function rawGet(port: number, rawPath: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: rawPath, method: 'GET', headers }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('serveur autonome', () => {
  let dir: string;
  let publicDir: string;
  let server: ReturnType<typeof createStandaloneServer>;
  let port: number;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'magistra-standalone-'));
    publicDir = path.join(dir, 'public');
    mkdirSync(path.join(publicDir, 'assets'), { recursive: true });
    writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>Magistra</title><div id="root"></div>');
    writeFileSync(path.join(publicDir, 'assets', 'app-1234.js'), 'console.log("magistra");');
    writeFileSync(path.join(publicDir, '.env'), 'SECRET=fichier-cache');
    writeFileSync(path.join(dir, 'secret.txt'), 'DONNEE-SECRETE');
    symlinkSync(path.join(dir, 'secret.txt'), path.join(publicDir, 'lien.txt'));
    // GitHub simulé : aucune version publiée (aucun accès réseau pendant les tests).
    const deps = testDeps({ overrides: { releasesFetch: async () => new Response('{"message":"Not Found"}', { status: 404 }) } });
    server = createStandaloneServer({ staticDir: publicDir, deps, cspExtraOrigins: ['https://clerk.univ-exemple.fr'] });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>(r => server.close(() => r()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuse toute remontée de répertoire', async () => {
    const attempts = [
      '/../secret.txt',
      '/../../../../etc/passwd',
      '/%2e%2e/secret.txt',
      '/%2E%2E%2Fsecret.txt',
      '/..%2fsecret.txt',
      '/assets/../../secret.txt',
      '/assets/%2e%2e/%2e%2e/secret.txt',
      '/..%5csecret.txt',
      '/%00/secret.txt',
      '/%E0%A4%A',
      '/.env',
      '/lien.txt',
      '/assets/%2e%2e%2f%2e%2e%2fsecret.txt',
    ];
    for (const p of attempts) {
      const res = await rawGet(port, p);
      expect(res.body, p).not.toContain('DONNEE-SECRETE');
      expect(res.body, p).not.toContain('fichier-cache');
      expect(res.body, p).not.toContain('root:');
      expect([400, 403, 404], p).toContain(res.status);
    }
  });

  it('resolveStaticPath reste dans le dossier publié', () => {
    const root = path.resolve('/srv/magistra/dist');
    expect(resolveStaticPath(root, '/assets/app.js')).toBe(path.join(root, 'assets', 'app.js'));
    expect(resolveStaticPath(root, '/')).toBe(root);
    expect(resolveStaticPath(root, '/../etc/passwd')).toBeNull();
    expect(resolveStaticPath(root, '/%2e%2e/etc/passwd')).toBeNull();
    expect(resolveStaticPath(root, '/a/%2e%2e/%2e%2e/b')).toBeNull();
    expect(resolveStaticPath(root, '/x%00.js')).toBeNull();
    expect(resolveStaticPath(root, '/%zz')).toBeNull();
    expect(resolveStaticPath(root, '/.git/config')).toBeNull();
    expect(resolveStaticPath(root, '/.well-known/security.txt')).toBe(path.join(root, '.well-known', 'security.txt'));
  });

  it('sert les fichiers et applique le repli SPA uniquement aux chemins sans extension', async () => {
    const asset = await rawGet(port, '/assets/app-1234.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(asset.headers['cache-control']).toContain('immutable');

    const spa = await rawGet(port, '/app/generate?type=cours');
    expect(spa.status).toBe(200);
    expect(spa.body).toContain('<div id="root">');
    expect(spa.headers['cache-control']).toBe('no-cache');

    const missing = await rawGet(port, '/assets/absent.js');
    expect(missing.status).toBe(404);
    expect(missing.body).not.toContain('<div id="root">');
  });

  it('ajoute les en-têtes de sécurité (CSP compatible Clerk, domaine personnalisé inclus)', async () => {
    const res = await rawGet(port, '/');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain('https://*.clerk.accounts.dev');
    expect(csp).toContain('https://clerk.univ-exemple.fr');
    // Connecteur local de l'application Windows : les trois ports exacts de la boucle locale, en connect-src seulement.
    const connect = csp.split(';').map(d => d.trim()).find(d => d.startsWith('connect-src '));
    expect(connect).toBe("connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.com http://127.0.0.1:47831 http://127.0.0.1:47832 http://127.0.0.1:47833 https://clerk.univ-exemple.fr");
    expect(csp.split(';').filter(d => d.includes('127.0.0.1'))).toHaveLength(1);
    expect(LOCAL_CONNECTOR_ORIGINS).toEqual(CONNECTOR_PORTS.map(port => `http://${CONNECTOR_HOST}:${port}`));
  });

  it('GET /api/windows-release : public, servi par l’API avec les en-têtes de sécurité', async () => {
    const res = await rawGet(port, '/api/windows-release');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(String(res.headers['content-security-policy'])).toContain('http://127.0.0.1:47831');
    expect(JSON.parse(res.body)).toEqual({ available: false, reason: 'none', releasesUrl: 'https://github.com/juanrobin09-stack/magistra-downloads/releases' });
  });

  it('GET /telecharger : lien de téléchargement du site servi par l’API (jamais la page de l’interface)', async () => {
    // Aucune version publiée (GitHub simulé) : retour à la section « Magistra pour Windows » de l'accueil.
    for (const p of ['/telecharger', '/telecharger/']) {
      const res = await rawGet(port, p);
      expect(res.status, p).toBe(302);
      expect(res.headers.location, p).toBe('/#magistra-windows');
      expect(res.body, p).toBe('');
      expect(String(res.headers['content-security-policy'])).toContain("default-src 'self'");
    }
    // Un autre chemin voisin reste une page de l'interface (repli SPA).
    const other = await rawGet(port, '/telecharger-maintenant');
    expect(other.status).toBe(200);
    expect(other.body).toContain('<div id="root"></div>');
  });

  it('route /api/* vers l’API (authentification exigée, réponse JSON)', async () => {
    const anon = await rawGet(port, '/api/status');
    expect(anon.status).toBe(401);
    expect(anon.headers['content-type']).toContain('application/json');
    expect(JSON.parse(anon.body).error.code).toBe('UNAUTHENTICATED');
    const status = await rawGet(port, '/api/status', { Authorization: 'Bearer token-A' });
    expect(status.status).toBe(200);
    expect(JSON.parse(status.body).ai.ok).toBe(true);
    const unknown = await rawGet(port, '/api/inexistant', { Authorization: 'Bearer token-A' });
    expect(unknown.status).toBe(404);
    expect(JSON.parse(unknown.body).error.code).toBe('NOT_FOUND');
  });

  it('n’accepte que les origines https valides dans CSP_EXTRA_ORIGINS', () => {
    expect(parseExtraOrigins("https://clerk.univ.fr http://x.fr 'unsafe-eval' https://*.univ.fr;evil")).toEqual(['https://clerk.univ.fr']);
    expect(buildContentSecurityPolicy()).not.toContain('undefined');
  });
});
