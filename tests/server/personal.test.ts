// Mode personnel (npm run dev, npm start sans Clerk) : jeton secret obligatoire, contrôles Host / Origin,
// refus sur Vercel et hors boucle locale, génération réelle avec une IA locale détectée, historique persistant.

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockProvider } from '../../shared/ai/mock.js';
import type { ModeInfo, ServerStatus } from '../../shared/apiContract.js';
import type { HistoryPage } from '../../shared/types.js';
import { createServerDeps, describeStartup, type DepsOverrides } from '../../server/deps.js';
import { defaultDataDir, loadConfig } from '../../server/config.js';
import {
  ACCESS_TOKEN_FILE, DATA_DIR_ACL_WARNING, loadOrCreateAccessToken, parseWhoamiSid, PersonalAccess, PERSONAL_USER_ID, protectDataDir,
  resolveAuth, restrictDataDirAcl, sameSecret,
} from '../../server/personal.js';
import { closedPortUrl, startFakeAI, type FakeAI } from './fakeAI.js';
import { call, readNdjson, startApi, validRequest, type TestServer } from './helpers.js';

let dir: string;
let server: TestServer | undefined;
let fake: FakeAI | undefined;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'magistra-personnel-'));
});

afterEach(async () => {
  await server?.close();
  await fake?.close();
  server = undefined;
  fake = undefined;
  rmSync(dir, { recursive: true, force: true });
});

const offlineResearch: NonNullable<DepsOverrides['research']> = {
  config: { academic: false, wikipedia: false, timeoutMs: 1_000 },
  deps: { fetch: () => Promise.reject(new Error('réseau interdit pendant les tests')) },
};

/** Serveur API en mode personnel (comme « npm start » avec HOST=127.0.0.1), port réel enregistré. */
async function startPersonal(env: Record<string, string> = {}, overrides: DepsOverrides = {}) {
  const logs: string[] = [];
  const deps = createServerDeps(
    { MAGISTRA_DATA_DIR: dir, RATE_LIMIT_PER_MINUTE: '1000', ...env },
    { listen: { host: '127.0.0.1' }, research: offlineResearch, log: m => logs.push(m), ...overrides },
  );
  expect(deps.startupError).toBeUndefined();
  expect(deps.auth).toBe('personal');
  const api = await startApi(deps);
  deps.personal!.setPort(Number(new URL(api.url).port));
  const token = readFileSync(path.join(dir, ACCESS_TOKEN_FILE), 'utf8').trim();
  return { deps, api, token, logs };
}

/** Requête HTTP brute (en-têtes Host et Origin libres, ce que fetch interdit). */
function rawRequest(url: string, options: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ host: hostname, port, path: options.path, method: options.method ?? 'GET', headers: options.headers }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

describe('choix du mode d’authentification', () => {
  it('auto : Clerk si des clés existent, sinon mode personnel en développement et en autonome sur la boucle locale', () => {
    expect(resolveAuth({ CLERK_SECRET_KEY: 'sk_test_x' }, { dev: true, host: 'localhost' }).mode).toBe('clerk');
    expect(resolveAuth({ VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_x', CLERK_SECRET_KEY: 'sk_test_x' }, { host: '127.0.0.1' }).mode).toBe('clerk');
    expect(resolveAuth({}, { dev: true, host: 'localhost' }).mode).toBe('personal');
    expect(resolveAuth({}, { host: '127.0.0.1' }).mode).toBe('personal');
    expect(resolveAuth({}, { host: '::1' }).mode).toBe('personal');
    // HOST vide (toutes les interfaces) ou adresse du réseau : jamais de mode personnel automatique.
    expect(resolveAuth({}, { host: null })).toMatchObject({ mode: 'none', note: expect.stringContaining('HOST=127.0.0.1') });
    expect(resolveAuth({}, { host: '0.0.0.0' }).mode).toBe('none');
    expect(resolveAuth({}, { host: '192.168.1.20' }).mode).toBe('none');
    // Fonction Vercel ou hébergeur inconnu : jamais.
    expect(resolveAuth({ VERCEL: '1' }, { host: '127.0.0.1' }).mode).toBe('none');
    expect(resolveAuth({}, {}).mode).toBe('none');
  });

  it('.env d’une ancienne version (clé Clerk PUBLIABLE seule) : mode personnel sur la boucle locale, Clerk ailleurs', () => {
    const legacy = { VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_Y2xlcmsuZXhhbXBsZS5jb20k', ANCIENNE_CLE_IA: 'cle-ancienne-FAUSSE' };
    expect(resolveAuth(legacy, { dev: true, host: 'localhost' })).toMatchObject({ mode: 'personal', note: expect.stringContaining('CLERK_SECRET_KEY') });
    expect(resolveAuth(legacy, { host: '127.0.0.1' }).mode).toBe('personal');
    expect(resolveAuth({ VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_YOUR_KEY_HERE' }, { dev: true, host: 'localhost' }).mode).toBe('personal');
    // Jamais sur Vercel, jamais sur le réseau, jamais si Clerk est demandé ou complet.
    expect(resolveAuth({ ...legacy, VERCEL: '1' }, {}).mode).toBe('clerk');
    expect(resolveAuth(legacy, { host: '0.0.0.0' }).mode).toBe('clerk');
    expect(resolveAuth(legacy, { host: null }).mode).toBe('clerk');
    expect(resolveAuth({ ...legacy, MAGISTRA_AUTH: 'clerk' }, { dev: true, host: 'localhost' }).mode).toBe('clerk');
    expect(resolveAuth({ ...legacy, CLERK_SECRET_KEY: 'sk_test_x' }, { dev: true, host: 'localhost' }).mode).toBe('clerk');
    expect(resolveAuth({ ...legacy, CLERK_JWT_KEY: 'pem' }, { host: '::1' }).mode).toBe('clerk');
  });

  it('.env d’une ancienne version avec npm run dev : jeton créé, adresse #acces= affichée, aucune clé journalisée', async () => {
    const logs: string[] = [];
    const deps = createServerDeps(
      { VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_Y2xlcmsuZXhhbXBsZS5jb20k', ANCIENNE_CLE_IA: 'cle-ancienne-FAUSSE', MAGISTRA_DATA_DIR: dir, AI_AUTODETECT: 'false' },
      { dev: true, listen: { host: 'localhost', port: 5173 }, log: m => logs.push(m) },
    );
    expect(deps.auth).toBe('personal');
    expect(deps.modeInfo).toEqual({ auth: 'personal' });
    expect((await describeStartup(deps, 5173)).join('\n')).toContain('#acces=');
    expect(logs.join('\n')).toContain('Clé publiable Clerk sans CLERK_SECRET_KEY');
    expect(logs.join('\n')).not.toMatch(/cle-ancienne|CLERK_SECRET_KEY \(ou CLERK_JWT_KEY\) manquante/);
  });

  it('MAGISTRA_AUTH=personal : refusé sur Vercel, hors boucle locale et hors npm run dev / npm start', () => {
    expect(resolveAuth({ MAGISTRA_AUTH: 'personal', VERCEL: '1' }, { host: '127.0.0.1' })).toMatchObject({ mode: 'none', refusal: expect.stringContaining('Vercel') });
    expect(resolveAuth({ MAGISTRA_AUTH: 'personal' }, { host: '0.0.0.0' })).toMatchObject({ mode: 'none', refusal: expect.stringContaining('HOST=127.0.0.1') });
    expect(resolveAuth({ MAGISTRA_AUTH: 'personal' }, { host: null })).toMatchObject({ mode: 'none', refusal: expect.any(String) });
    expect(resolveAuth({ MAGISTRA_AUTH: 'personal' }, {})).toMatchObject({ mode: 'none', refusal: expect.any(String) });
    expect(resolveAuth({ MAGISTRA_AUTH: 'personal', CLERK_SECRET_KEY: 'sk_test_x' }, { host: 'localhost' }).mode).toBe('personal');
    expect(resolveAuth({ MAGISTRA_AUTH: 'clerk' }, { dev: true, host: 'localhost' }).mode).toBe('clerk');
  });

  it('VERCEL=1 + MAGISTRA_AUTH=personal : démarrage refusé, aucun jeton créé', () => {
    const deps = createServerDeps({ MAGISTRA_AUTH: 'personal', VERCEL: '1', MAGISTRA_DATA_DIR: dir }, { listen: { host: '127.0.0.1' }, log: () => {} });
    expect(deps.startupError).toContain('Vercel');
    expect(deps.auth).toBe('none');
    expect(deps.personal).toBeNull();
    expect(deps.verifier).toBeNull();
    expect(() => statSync(path.join(dir, ACCESS_TOKEN_FILE))).toThrow();
  });

  it('HOST=0.0.0.0 + MAGISTRA_AUTH=personal : démarrage refusé', async () => {
    const deps = createServerDeps({ MAGISTRA_AUTH: 'personal', MAGISTRA_DATA_DIR: dir }, { listen: { host: '0.0.0.0' }, log: () => {} });
    expect(deps.startupError).toMatch(/Mode personnel refusé/);
    expect(deps.personal).toBeNull();
    expect(await describeStartup(deps)).toEqual([expect.stringContaining('DÉMARRAGE REFUSÉ')]);
  });
});

describe('jeton d’accès', () => {
  it('256 bits aléatoires, fichier lisible par son seul propriétaire, réutilisé au redémarrage', () => {
    const first = loadOrCreateAccessToken(dir);
    expect(first.created).toBe(true);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    if (process.platform !== 'win32') expect(statSync(first.file).mode & 0o777).toBe(0o600);
    const second = loadOrCreateAccessToken(dir);
    expect(second).toMatchObject({ token: first.token, created: false });
    expect(loadOrCreateAccessToken(mkdtempSync(path.join(dir, 'autre-'))).token).not.toBe(first.token);
  });

  it('fichier abîmé : remplacé par un nouveau jeton', () => {
    writeFileSync(path.join(dir, ACCESS_TOKEN_FILE), 'court');
    const result = loadOrCreateAccessToken(dir);
    expect(result.created).toBe(true);
    expect(readFileSync(result.file, 'utf8').trim()).toBe(result.token);
  });

  it('comparaison en temps constant, quelle que soit la longueur', async () => {
    const token = loadOrCreateAccessToken(dir).token;
    expect(sameSecret(token, token)).toBe(true);
    expect(sameSecret(`${token}x`, token)).toBe(false);
    expect(sameSecret('', token)).toBe(false);
    const access = new PersonalAccess(token);
    await expect(access.verifier(token)).resolves.toBe(PERSONAL_USER_ID);
    await expect(access.verifier(token.slice(0, -1))).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('adresse d’accès : jeton dans le fragment « #acces= » (jamais envoyé au serveur)', () => {
    const token = loadOrCreateAccessToken(dir).token;
    expect(new PersonalAccess(token, { port: 5173 }).accessUrl()).toBe(`http://localhost:5173/#acces=${token}`);
  });

  it('contrôles complémentaires : connexion locale, Host local avec le bon port, Origin identique', () => {
    const access = new PersonalAccess(loadOrCreateAccessToken(dir).token, { port: 3000 });
    const ok = { method: 'POST', headers: { host: 'localhost:3000', origin: 'http://localhost:3000' }, remoteAddress: '127.0.0.1' };
    expect(() => access.checkRequest(ok)).not.toThrow();
    expect(() => access.checkRequest({ ...ok, headers: { host: '[::1]:3000' }, remoteAddress: '::ffff:127.0.0.1' })).not.toThrow();
    const refused = [
      { ...ok, remoteAddress: '192.168.1.30' },
      { ...ok, headers: { host: 'attaquant.example:3000' } },
      { ...ok, headers: { host: 'localhost:3001' } },
      { ...ok, headers: {} },
      { ...ok, headers: { host: 'localhost:3000', origin: 'http://attaquant.example' } },
      { ...ok, headers: { host: 'localhost:3000', origin: 'null' } },
      { ...ok, headers: { host: 'localhost:3000', origin: 'http://127.0.0.1:3000' } },
    ];
    for (const req of refused) expect(() => access.checkRequest(req), JSON.stringify(req)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
});

describe('API en mode personnel', () => {
  it('GET /api/mode : public, « personal », sans aucun secret', async () => {
    const { api, token } = await startPersonal({ MAGISTRA_ADMIN_CONTACT: 'support@lycee.fr' });
    server = api;
    const res = await fetch(`${api.url}/api/mode`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(JSON.parse(raw) as ModeInfo).toEqual({ auth: 'personal', adminContact: 'support@lycee.fr' });
    expect(raw).not.toContain(token);
  });

  it('sans jeton ou avec un mauvais jeton : 401 avec un message qui explique où trouver l’adresse', async () => {
    const { api, token } = await startPersonal();
    server = api;
    const none = await call(api.url, '/api/status');
    expect(none.status).toBe(401);
    const body = (await none.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('UNAUTHENTICATED');
    expect(body.error.message).toContain('#acces=');
    expect((await call(api.url, '/api/status', `${token.slice(1)}A`)).status).toBe(401);
    expect((await call(api.url, '/api/history', 'token-A')).status).toBe(401);
    expect((await call(api.url, '/api/status', token)).status).toBe(200);
  });

  it('Host étranger (DNS rebinding) : 403 même avec le bon jeton', async () => {
    const { api, token } = await startPersonal();
    server = api;
    const res = await rawRequest(api.url, { path: '/api/status', headers: { Host: 'attaquant.example', Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error.code).toBe('FORBIDDEN');
    const mode = await rawRequest(api.url, { path: '/api/mode', headers: { Host: `attaquant.example:${new URL(api.url).port}` } });
    expect(mode.status).toBe(403);
  });

  it('POST depuis un autre site (Origin étranger) : 403 ; même origine : accepté', async () => {
    const { api, token } = await startPersonal({}, { providerFactory: () => new MockProvider({ reply: '# Cours\n\nContenu.' }) });
    server = api;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const foreign = await rawRequest(api.url, {
      method: 'POST', path: '/api/generate', body: JSON.stringify(validRequest),
      headers: { ...headers, Host: new URL(api.url).host, Origin: 'http://attaquant.example' },
    });
    expect(foreign.status).toBe(403);
    const same = await rawRequest(api.url, {
      method: 'POST', path: '/api/generate', body: JSON.stringify(validRequest),
      headers: { ...headers, Host: new URL(api.url).host, Origin: api.url },
    });
    expect(same.status).toBe(200);
    expect(same.body).toContain('"type":"done"');
  });

  it('génération réussie avec le jeton et une IA locale détectée (faux Ollama), historique conservé après redémarrage', async () => {
    fake = await startFakeAI({ ollama: { version: '0.34.4', models: ['ministral-3:latest', 'nomic-embed-text:latest'] }, reply: '# Les graphes\n\nUn graphe orienté.' });
    const localAI = { ollamaUrl: fake.url, lmStudioUrl: await closedPortUrl(), totalRamGB: 16 };
    const first = await startPersonal({}, { localAI });
    server = first.api;

    const status = (await (await call(first.api.url, '/api/status', first.token)).json()) as ServerStatus;
    expect(status.ai).toMatchObject({ ok: true, label: 'IA locale (Ollama – Magistra Léger)', model: 'ministral-3:latest' });
    expect(status.ai.providerInfo).toMatchObject({ thirdParty: false });
    expect(JSON.stringify(status)).not.toContain(fake.url);

    const res = await call(first.api.url, '/api/generate', first.token, { method: 'POST', body: JSON.stringify(validRequest) });
    expect(res.status).toBe(200);
    const events = await readNdjson(res);
    const done = events.find(e => e.type === 'done');
    expect(done).toMatchObject({ type: 'done', saved: true, model: 'ministral-3:latest' });
    // Ollama natif : contexte du niveau transmis (num_ctx) et modèle préchargé (« Chargement du modèle… »).
    const chats = fake.requests.filter(r => r.path === '/api/chat').map(r => JSON.parse(r.body) as { messages: unknown[]; options?: { num_ctx?: number } });
    expect(chats[0].messages).toEqual([]);
    expect(chats.at(-1)?.options?.num_ctx).toBe(12_288);
    expect(events.some(e => e.type === 'status' && e.stage === 'loading_model')).toBe(true);

    await first.api.close();
    server = undefined;
    // « Redémarrage » : nouvelles dépendances sur le même dossier de données → même jeton, même historique.
    const second = await startPersonal({}, { localAI });
    server = second.api;
    expect(second.token).toBe(first.token);
    const history = (await (await call(second.api.url, '/api/history', second.token)).json()) as HistoryPage;
    expect(history.items.map(i => i.sujet)).toEqual([validRequest.sujet]);
  });

  it('mode personnel : historique en fichiers par défaut, Clerk ignoré dans le journal', async () => {
    const { deps, api, logs } = await startPersonal();
    server = api;
    expect(deps.store?.kind).toBe('file');
    expect(logs.join('\n')).not.toMatch(/CLERK_SECRET_KEY|SUPABASE/);
    expect(deps.modeInfo).toEqual({ auth: 'personal' });
    const lines = await describeStartup(deps, 4321);
    expect(lines.join('\n')).toContain('http://localhost:4321/#acces=');
  });
});

describe('Windows : dossier de données dans le profil et droits réservés à l’utilisateur', () => {
  const root = 'C:\\Magistra';

  it('dossier par défaut : %LOCALAPPDATA%\\Magistra\\serveur ; ancien dossier du projet conservé ; Linux inchangé', () => {
    const none = () => false;
    expect(defaultDataDir({ LOCALAPPDATA: 'C:\\Users\\Élève Prof\\AppData\\Local' }, { platform: 'win32', projectRoot: root, exists: none }))
      .toBe('C:\\Users\\Élève Prof\\AppData\\Local\\Magistra\\serveur');
    expect(defaultDataDir({}, { platform: 'win32', projectRoot: root, exists: none, homedir: 'C:\\Users\\prof' }))
      .toBe('C:\\Users\\prof\\AppData\\Local\\Magistra\\serveur');
    // Historique et jeton existants : jamais « perdus ».
    expect(defaultDataDir({ LOCALAPPDATA: 'C:\\Users\\prof\\AppData\\Local' }, { platform: 'win32', projectRoot: root, exists: d => d === 'C:\\Magistra\\.magistra-data' }))
      .toBe('C:\\Magistra\\.magistra-data');
    expect(loadConfig({ LOCALAPPDATA: 'C:\\L' }, { platform: 'win32', projectRoot: root, exists: none }).dataDir).toBe('C:\\L\\Magistra\\serveur');
    expect(loadConfig({ LOCALAPPDATA: 'C:\\L' }, { platform: 'linux', projectRoot: '/srv/magistra' }).dataDir).toBe('/srv/magistra/.magistra-data');
  });

  it('SID lu dans la sortie de whoami (compte local, domaine, Entra ID) ; sortie illisible rejetée', () => {
    expect(parseWhoamiSid('"poste-12\\prof","S-1-5-21-1004336348-1177238915-682003330-1001"\r\n')).toBe('S-1-5-21-1004336348-1177238915-682003330-1001');
    expect(parseWhoamiSid('"azuread\\marie.dupont","S-1-12-1-111-222-333-444"')).toBe('S-1-12-1-111-222-333-444');
    expect(parseWhoamiSid('Accès refusé.')).toBeUndefined();
    expect(parseWhoamiSid('')).toBeUndefined();
  });

  it('icacls appelé par son chemin absolu, sans shell : héritage coupé, utilisateur + SYSTEM + Administrateurs', () => {
    const calls: { file: string; args: readonly string[] }[] = [];
    const run = (file: string, args: readonly string[]) => {
      calls.push({ file, args });
      return file.endsWith('whoami.exe') ? '"poste\\prof","S-1-5-21-1-2-3-1001"' : 'Fichiers correctement traités : 1';
    };
    const dataDir = 'C:\\Magistra\\.magistra-data';
    expect(restrictDataDirAcl(dataDir, { platform: 'win32', env: { SystemRoot: 'D:\\WINDOWS' }, run })).toBeUndefined();
    expect(calls).toEqual([
      { file: 'D:\\WINDOWS\\System32\\whoami.exe', args: ['/user', '/fo', 'csv', '/nh'] },
      {
        file: 'D:\\WINDOWS\\System32\\icacls.exe',
        args: [dataDir, '/inheritance:r', '/grant:r', '*S-1-5-21-1-2-3-1001:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '/Q'],
      },
    ]);
    // Sans SystemRoot : C:\Windows.
    calls.length = 0;
    restrictDataDirAcl(dataDir, { platform: 'win32', env: {}, run });
    expect(calls[0].file).toBe('C:\\Windows\\System32\\whoami.exe');
  });

  it('échec (icacls refusé, SID introuvable) : avertissement clair, sans chemin ni trace technique ; jamais bloquant', () => {
    const failing = (file: string) => {
      if (file.endsWith('icacls.exe')) throw new Error('Accès refusé : C:\\Magistra\\.magistra-data');
      return '"poste\\prof","S-1-5-21-1-2-3-1001"';
    };
    const warning = restrictDataDirAcl('C:\\Magistra\\.magistra-data', { platform: 'win32', env: {}, run: failing });
    expect(warning).toBe(DATA_DIR_ACL_WARNING);
    expect(warning).not.toContain('C:\\');
    expect(restrictDataDirAcl('C:\\x', { platform: 'win32', env: {}, run: () => 'rien' })).toBe(DATA_DIR_ACL_WARNING);
  });

  it('hors Windows : aucun programme lancé, rien de créé (droits POSIX inchangés)', () => {
    const run = () => {
      throw new Error('ne doit pas être appelé');
    };
    expect(restrictDataDirAcl(dir, { platform: 'linux', run })).toBeUndefined();
    expect(protectDataDir(path.join(dir, 'absent'), { platform: 'linux', run })).toBeUndefined();
    expect(() => statSync(path.join(dir, 'absent'))).toThrow();
  });
});
