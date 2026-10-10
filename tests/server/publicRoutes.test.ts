// Fonctions publiques du site vitrine (api/windows-release.ts, api/download.ts) : elles marchent SANS aucune variable
// d'environnement de comptes ou d'IA, n'écrivent aucun journal de configuration, ne chargent aucun code inutile, ne
// répondent qu'à GET et ne laissent fuiter ni trace, ni variable, ni jeton. Aucun accès réseau : GitHub est simulé.

import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '../../shared/ai/provider.js';
import { loadConfig } from '../../server/config.js';
import { handleNodeRequest } from '../../server/node.js';
import { createPublicRouteHandler, DEFAULT_RELEASES_REPO, loadWindowsReleaseSettings, type PublicRouteName } from '../../server/windowsRelease.js';
import { listen, testDeps, type TestServer } from './helpers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Client des tests : capturé avant que « fetch » ne soit remplacé par le faux GitHub.
const realFetch = globalThis.fetch;

const REPO = DEFAULT_RELEASES_REPO;
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const TAG = 'v2.1.0';
const EXE = 'Magistra-Setup-2.1.0.exe';
const HEX = '0123456789abcdef'.repeat(4);
const TOKEN = `ghp_${'S3cr3tJet0n'.repeat(3)}`;
const INSTALLER_URL = `https://github.com/${REPO}/releases/download/${TAG}/${EXE}`;
const FIXED_NAME_URL = `https://github.com/${REPO}/releases/latest/download/Magistra-Setup.exe`;

function release(): Record<string, unknown> {
  return {
    html_url: `https://github.com/${REPO}/releases/tag/${TAG}`,
    tag_name: TAG,
    draft: false,
    prerelease: false,
    published_at: '2026-09-20T14:03:12Z',
    assets: [{
      name: EXE,
      state: 'uploaded',
      size: 98_765_432,
      browser_download_url: INSTALLER_URL,
      digest: `sha256:${HEX}`,
    }],
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface FakeGitHub extends FetchLike {
  calls: { url: string; headers: Headers }[];
}

/** Faux GitHub : une seule adresse répond ; toute autre est une erreur de test. */
function fakeGitHub(respond: () => Response | Promise<Response>): FakeGitHub {
  const calls: FakeGitHub['calls'] = [];
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, headers: new Headers(init?.headers) });
    if (url !== API) throw new Error(`adresse inattendue : ${url}`);
    return respond();
  };
  return Object.assign(fn, { calls });
}

let saved: NodeJS.ProcessEnv;
let sink: Record<'error' | 'warn' | 'log' | 'info' | 'debug', ReturnType<typeof vi.spyOn>>;
let server: TestServer | undefined;

/** Journaux de la console, tous niveaux confondus. */
const logged = () => (Object.values(sink) as { mock: { calls: unknown[][] } }[]).flatMap(spy => spy.mock.calls.map(args => args.join(' ')));

beforeEach(() => {
  saved = { ...process.env };
  for (const key of Object.keys(process.env)) delete process.env[key];
  sink = {
    error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    log: vi.spyOn(console, 'log').mockImplementation(() => undefined),
    info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
    debug: vi.spyOn(console, 'debug').mockImplementation(() => undefined),
  };
  vi.resetModules();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, saved);
  await server?.close();
  server = undefined;
});

/** Fonctions Vercel réelles : export par défaut des fichiers api/. */
const functions: Record<PublicRouteName, () => Promise<{ default: (req: IncomingMessage, res: ServerResponse) => Promise<void> }>> = {
  'windows-release': () => import('../../api/windows-release.js'),
  download: () => import('../../api/download.js'),
};

/** Fonction Vercel réelle, servie sur un port local, face à un faux GitHub (module rechargé : cache mémoire vide). */
async function serve(route: PublicRouteName, github: FetchLike): Promise<TestServer> {
  vi.stubGlobal('fetch', github);
  vi.resetModules();
  const { default: handler } = await functions[route]();
  server = await listen((req, res) => void handler(req, res));
  return server;
}

const get = (url: string, init: RequestInit = {}) => realFetch(url, { redirect: 'manual', ...init });

describe('process.env vidé : aucune variable de comptes ni d’IA nécessaire', () => {
  it('l’environnement du test est bien vide', () => {
    expect(Object.keys(process.env)).toEqual([]);
  });

  it('GET windows-release : 200 JSON conforme, dépôt officiel, sans jeton, cache HTTP, aucun journal', async () => {
    const github = fakeGitHub(() => json(release()));
    const { url } = await serve('windows-release', github);
    const res = await get(`${url}/api/windows-release`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=600, stale-while-revalidate=86400');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(await res.json()).toEqual({
      available: true,
      version: '2.1.0',
      fileName: EXE,
      downloadUrl: INSTALLER_URL,
      sizeBytes: 98_765_432,
      sha256: HEX,
      publishedAt: '2026-09-20T14:03:12.000Z',
      releaseUrl: `https://github.com/${REPO}/releases/tag/${TAG}`,
      requirements: 'Windows 10 ou 11 (64 bits)',
    });
    expect(github.calls.map(c => c.url)).toEqual([API]);
    expect(github.calls[0].headers.get('authorization')).toBeNull();
    expect(logged()).toEqual([]);
    // Deuxième visite : cache de l'instance, aucune nouvelle requête vers GitHub.
    await get(`${url}/api/windows-release`);
    expect(github.calls).toHaveLength(1);
  });

  it('GET windows-release, GitHub injoignable : 200 avec le repli documenté (page des versions), cache HTTP court, cause seule au journal', async () => {
    const github = fakeGitHub(() => { throw new TypeError('fetch failed'); });
    const { url } = await serve('windows-release', github);
    const res = await get(`${url}/api/windows-release`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=60');
    expect(await res.json()).toEqual({ available: false, reason: 'unavailable', releasesUrl: `https://github.com/${REPO}/releases` });
    expect(logged()).toEqual(['[magistra] Version Windows indisponible : GitHub injoignable.']);
  });

  it('GET windows-release, aucune version publiée : « none » et page des versions en repli', async () => {
    const { url } = await serve('windows-release', fakeGitHub(() => json({ message: 'Not Found' }, 404)));
    const res = await get(`${url}/api/windows-release`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=60');
    expect(await res.json()).toEqual({ available: false, reason: 'none', releasesUrl: `https://github.com/${REPO}/releases` });
    expect(logged()).toEqual([]);
  });

  it('GET download : redirection vers le fichier de l’installateur (jamais une page), sans cache ni corps', async () => {
    const github = fakeGitHub(() => json(release()));
    const { url } = await serve('download', github);
    for (const pathname of ['/api/download', '/telecharger']) {
      const res = await get(`${url}${pathname}`);
      expect(res.status, pathname).toBe(302);
      expect(res.headers.get('location'), pathname).toBe(INSTALLER_URL);
      expect(res.headers.get('cache-control'), pathname).toBe('no-store');
      expect(res.headers.get('access-control-allow-origin'), pathname).toBeNull();
      expect(await res.text(), pathname).toBe('');
    }
    expect(github.calls).toHaveLength(1);
    expect(logged()).toEqual([]);
  });

  it('GET download : GitHub injoignable → installateur au nom fixe ; aucune version → section « Magistra pour Windows » du site', async () => {
    const unreachable = await serve('download', fakeGitHub(() => json({}, 500)));
    expect((await get(`${unreachable.url}/api/download`)).headers.get('location')).toBe(FIXED_NAME_URL);
    await server?.close();
    const none = await serve('download', fakeGitHub(() => json({ message: 'Not Found' }, 404)));
    const res = await get(`${none.url}/api/download?url=https://evil.example/x.exe&repo=pirate/x`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/#magistra-windows');
  });

  it.each<PublicRouteName>(['windows-release', 'download'])('%s : GET uniquement (405 sinon), sans lire la configuration ni interroger GitHub', async route => {
    process.env.GITHUB_TOKEN = 'ghp_invalide avec espace et retour\r\nX: 1';
    const github = fakeGitHub(() => json(release()));
    const { url } = await serve(route, github);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const res = await get(`${url}/api/${route}`, { method });
      expect(res.status, method).toBe(405);
      expect(res.headers.get('allow'), method).toBe('GET');
      expect(res.headers.get('cache-control'), method).toBe('no-store');
      expect(await res.json(), method).toEqual({ error: { code: 'INVALID_REQUEST', message: 'Méthode non autorisée pour cette adresse.', retryable: false } });
    }
    expect(github.calls).toHaveLength(0);
    expect(logged()).toEqual([]);
  });
});

describe('variables étrangères aux versions : jamais lues, jamais recopiées', () => {
  const FOREIGN = {
    CLERK_SECRET_KEY: 'sk_test_SECRET_CLERK_KEY_0123456789',
    CLERK_JWT_KEY: 'jwt-secret-value',
    CLERK_WEBHOOK_SECRET: 'whsec_SECRET_WEBHOOK_0123456789',
    VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_PUBLISHABLE',
    SUPABASE_URL: 'https://secret-project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-SECRET-0123456789',
    AI_API_KEY: 'ai-key-SECRET-0123456789',
    AI_BASE_URL: 'pas une adresse',
    AI_PRESET: 'inconnu',
    AI_MODEL: '',
    AI_TIMEOUT_SECONDS: 'beaucoup',
    MAGISTRA_AUTH: 'personal',
    MAGISTRA_STORE: 'ailleurs',
    RATE_LIMIT_PER_MINUTE: 'beaucoup-trop',
    MAGISTRA_DATA_DIR: '/interdit/secret',
    VERCEL: '1',
    NODE_ENV: 'production',
  };

  it('une configuration de comptes ou d’IA invalide ne produit aucun journal de configuration et n’apparaît dans aucune réponse', async () => {
    // Avec la configuration complète du serveur, ces variables produiraient des avertissements au démarrage.
    expect(loadConfig(FOREIGN).problems.length).toBeGreaterThan(0);
    Object.assign(process.env, FOREIGN);
    const github = fakeGitHub(() => json(release()));
    for (const route of ['windows-release', 'download'] as const) {
      const { url } = await serve(route, github);
      const res = await get(`${url}/api/${route}`);
      const text = `${await res.text()}${JSON.stringify([...res.headers])}`;
      expect(res.status).toBe(route === 'download' ? 302 : 200);
      for (const value of Object.values(FOREIGN)) if (value.length >= 8) expect(text, value).not.toContain(value);
      await server?.close();
      server = undefined;
    }
    expect(logged()).toEqual([]);
    // Aucune variable étrangère dans les requêtes vers GitHub non plus.
    expect(JSON.stringify(github.calls.map(c => [...c.headers]))).not.toMatch(/SECRET/);
  });

  it('GITHUB_TOKEN : envoyé à api.github.com seulement, jamais renvoyé ni journalisé', async () => {
    process.env.GITHUB_TOKEN = TOKEN;
    const github = fakeGitHub(() => json(release()));
    const { url } = await serve('windows-release', github);
    const res = await get(`${url}/api/windows-release`);
    const text = `${await res.text()}${JSON.stringify([...res.headers])}`;
    expect(github.calls[0].headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(text).not.toContain('S3cr3t');
    expect(logged().join('\n')).not.toContain('S3cr3t');
  });

  it('GITHUB_TOKEN ou MAGISTRA_RELEASES_REPO invalide : une seule ligne de journal (la cause, jamais la valeur), valeur ignorée', async () => {
    process.env.GITHUB_TOKEN = 'ghp_abc\r\nX-Injection: 1';
    process.env.MAGISTRA_RELEASES_REPO = 'https://evil.example/x';
    const github = fakeGitHub(() => json(release()));
    const { url } = await serve('windows-release', github);
    await get(`${url}/api/windows-release`);
    await get(`${url}/api/windows-release`);
    const lines = logged();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('MAGISTRA_RELEASES_REPO');
    expect(lines[1]).toContain('GITHUB_TOKEN invalide');
    expect(lines.join('\n')).not.toMatch(/evil\.example|X-Injection|ghp_abc/);
    expect(github.calls[0].url).toBe(API);
    expect(github.calls[0].headers.get('authorization')).toBeNull();
  });

  it('dépôt configuré (MAGISTRA_RELEASES_REPO) : utilisé pour l’API et pour le repli de /telecharger', async () => {
    process.env.MAGISTRA_RELEASES_REPO = 'univ-exemple/magistra';
    const github: FakeGitHub = Object.assign(async (url: string) => {
      github.calls.push({ url, headers: new Headers() });
      return json({}, 500);
    }, { calls: [] as FakeGitHub['calls'] });
    const { url } = await serve('download', github);
    const res = await get(`${url}/telecharger`);
    expect(github.calls.map(c => c.url)).toEqual(['https://api.github.com/repos/univ-exemple/magistra/releases/latest']);
    expect(res.headers.get('location')).toBe('https://github.com/univ-exemple/magistra/releases/latest/download/Magistra-Setup.exe');
  });
});

describe('erreur inattendue : aucune fuite', () => {
  it('500 générique, sans trace ni message d’origine, cause réduite à un nom au journal', async () => {
    const boom = new Error('secret GITHUB_TOKEN=ghp_xxx at /srv/app/server/windowsRelease.js:12:5');
    const handler = createPublicRouteHandler('windows-release', { env: {}, fetch: fakeGitHub(() => json(release())), now: () => { throw boom; } });
    server = await listen((req, res) => void handler(req, res));
    const res = await get(`${server.url}/api/windows-release`);
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(text)).toEqual({ error: { code: 'INTERNAL', message: 'Erreur inattendue. Réessayez.', retryable: true } });
    expect(text).not.toMatch(/secret|ghp_|\/srv\/|windowsRelease/);
    expect(logged()).toEqual(['[magistra] Erreur INTERNAL (Error).']);
  });
});

describe('aucun code inutile : seuls la distribution Windows, ses noms de fichiers et les erreurs métier sont chargés', () => {
  const FILES = ['api/windows-release.ts', 'api/download.ts'];

  /** Importations qui subsistent après compilation : tout sauf « import type » (conservateur pour les « type » en ligne). */
  function runtimeImports(file: string): string[] {
    const text = readFileSync(path.join(root, file), 'utf8');
    const specifiers: string[] = [];
    for (const m of text.matchAll(/^(?:import|export)\s+(?!type\s)[^;'"]*?from\s+['"]([^'"]+)['"]/gms)) specifiers.push(m[1]);
    for (const m of text.matchAll(/^import\s+['"]([^'"]+)['"]/gm)) specifiers.push(m[1]);
    for (const m of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.push(m[1]);
    for (const m of text.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.push(m[1]);
    return specifiers;
  }

  function closure(entry: string): { files: string[]; external: string[] } {
    const seen = new Set<string>();
    const external = new Set<string>();
    const queue = [entry];
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const specifier of runtimeImports(file)) {
        if (!specifier.startsWith('.')) external.add(specifier);
        else queue.push(path.posix.join(path.posix.dirname(file), specifier).replace(/\.js$/, '.ts'));
      }
    }
    return { files: [...seen].sort(), external: [...external].sort() };
  }

  it.each(FILES)('%s : aucun module d’un autre service ni dépendance npm', file => {
    const { files, external } = closure(file);
    expect(files).toEqual([file, 'server/windowsRelease.ts', 'shared/errors.ts', 'shared/updateAssets.ts'].sort());
    expect(external).toEqual([]);
  });

  it('server/windowsRelease.ts ne lit dans l’environnement que MAGISTRA_RELEASES_REPO et GITHUB_TOKEN', () => {
    const source = readFileSync(path.join(root, 'server/windowsRelease.ts'), 'utf8');
    const names = new Set([...source.matchAll(/\benv\??\.([A-Z][A-Z0-9_]*)/g)].map(m => m[1]));
    expect([...names].sort()).toEqual(['GITHUB_TOKEN', 'MAGISTRA_RELEASES_REPO']);
    expect(source).not.toMatch(/process\.env\.[A-Z]/);
    expect(source).not.toMatch(/process\.env\[/);
  });
});

describe('mêmes réponses que le serveur complet (npm start, npm run dev)', () => {
  type Scenario = [string, () => Response | Promise<Response>, Record<string, string>?];
  const scenarios: Scenario[] = [
    ['version publiée', () => json(release())],
    ['aucune version', () => json({ message: 'Not Found' }, 404)],
    ['GitHub en erreur', () => json({}, 500)],
    ['brouillon', () => json({ ...release(), draft: true })],
    ['installateur pas encore joint', () => json({ ...release(), assets: [] })],
    ['dépôt invalide dans l’environnement', () => json(release()), { MAGISTRA_RELEASES_REPO: 'pas un dépôt' }],
    ['autre dépôt dans l’environnement', () => json({}, 500), { MAGISTRA_RELEASES_REPO: 'univ-exemple/magistra' }],
  ];

  interface Seen { status: number; location: string | null; cache: string | null; allow: string | null; body: string }

  async function seen(res: Response): Promise<Seen> {
    return {
      status: res.status,
      location: res.headers.get('location'),
      cache: res.headers.get('cache-control'),
      allow: res.headers.get('allow'),
      body: await res.text(),
    };
  }

  it.each(scenarios)('%s', async (_name, respond, env = {}) => {
    const releaseUrl = (repo: string) => `https://api.github.com/repos/${repo}/releases/latest`;
    const repo = env.MAGISTRA_RELEASES_REPO && env.MAGISTRA_RELEASES_REPO.includes('/') && !env.MAGISTRA_RELEASES_REPO.includes(' ')
      ? env.MAGISTRA_RELEASES_REPO : REPO;
    const answer = (url: string) => (url === releaseUrl(repo) ? respond() : Promise.reject(new Error(`adresse inattendue : ${url}`)));
    Object.assign(process.env, env);
    const complete = testDeps({ env, overrides: { releasesFetch: async url => answer(url) } });
    const full = await listen((req, res) => void handleNodeRequest(req, res, { deps: complete }));
    try {
      for (const [route, paths] of [['windows-release', ['/api/windows-release']], ['download', ['/api/download', '/telecharger']]] as const) {
        const site = await serve(route, async url => answer(url));
        for (const pathname of paths) {
          expect(await seen(await get(`${site.url}${pathname}`)), `${route} ${pathname}`).toEqual(await seen(await get(`${full.url}${pathname}`)));
        }
        expect(await seen(await get(`${site.url}/api/${route}`, { method: 'POST' })), `${route} POST`)
          .toEqual(await seen(await get(`${full.url}/api/${route}`, { method: 'POST' })));
        await site.close();
        server = undefined;
      }
    } finally {
      await full.close();
    }
  });

  it('configuration des versions : mêmes dépôt et jeton que la configuration complète, mêmes causes signalées', () => {
    const envs: Record<string, string>[] = [
      {},
      { MAGISTRA_RELEASES_REPO: 'univ-exemple/magistra', GITHUB_TOKEN: TOKEN },
      { MAGISTRA_RELEASES_REPO: '  Univ-Exemple/magistra.fork_2  ', GITHUB_TOKEN: `  ${TOKEN}  ` },
      { MAGISTRA_RELEASES_REPO: 'https://evil.example/x', GITHUB_TOKEN: 'ghp_abc\r\nX-Injection: 1' },
      { MAGISTRA_RELEASES_REPO: '   ', GITHUB_TOKEN: '   ' },
      { MAGISTRA_RELEASES_REPO: 'a/b/c', GITHUB_TOKEN: 'court' },
      { MAGISTRA_RELEASES_REPO: 'owner/..', GITHUB_TOKEN: 'x'.repeat(300) },
    ];
    for (const env of envs) {
      const full = loadConfig(env);
      const mine = loadWindowsReleaseSettings(env);
      expect(mine.settings, JSON.stringify(env)).toEqual(full.releases);
      expect(mine.problems, JSON.stringify(env)).toEqual(full.problems.filter(p => /MAGISTRA_RELEASES_REPO|GITHUB_TOKEN/.test(p)));
    }
  });
});
