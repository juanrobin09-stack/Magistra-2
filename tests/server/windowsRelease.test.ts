// GET /api/windows-release : dernière version STABLE de l'application Windows lue sur GitHub (dépôt officiel), sans
// aucune version codée en dur ; brouillons et préversions ignorés, lien de téléchargement vérifié, SHA-256 (digest ou
// SHA256SUMS.txt), cache mémoire, jeton GitHub jamais renvoyé. Aucun accès réseau : GitHub est simulé.

import { afterEach, describe, expect, it } from 'vitest';
import type { FetchLike } from '../../shared/ai/provider.js';
import type { WindowsReleaseResponse } from '../../shared/apiContract.js';
import { loadConfig } from '../../server/config.js';
import {
  checksumFor, createWindowsReleaseCache, DEFAULT_RELEASES_REPO, fetchLatestWindowsRelease, parseReleasesRepo, verifiedDownloadUrl,
  WINDOWS_RELEASE_CACHE_CONTROL, WINDOWS_RELEASE_LIMITS, WINDOWS_RELEASE_UNAVAILABLE_CACHE_CONTROL, WINDOWS_REQUIREMENTS,
  type WindowsReleaseOptions,
} from '../../server/windowsRelease.js';
import { startApi, testDeps, type TestServer } from './helpers.js';

const REPO = 'juanrobin09-stack/magistra-2';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const TAG = 'v2.1.0';
const EXE = 'Magistra-Setup-2.1.0.exe';
const HEX = '0123456789abcdef'.repeat(4);
const OTHER_HEX = 'fedcba9876543210'.repeat(4);
const TOKEN = `ghp_${'S3cr3tJet0n'.repeat(3)}`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;

const download = (name: string, tag = TAG, repo = REPO) => `https://github.com/${repo}/releases/download/${tag}/${name}`;

function asset(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    url: `https://api.github.com/repos/${REPO}/releases/assets/1`,
    name,
    label: '',
    content_type: 'application/octet-stream',
    state: 'uploaded',
    size: 98_765_432,
    browser_download_url: download(name),
    ...extra,
  };
}

function release(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    html_url: `https://github.com/${REPO}/releases/tag/${TAG}`,
    tag_name: TAG,
    name: 'Magistra 2.1.0',
    draft: false,
    prerelease: false,
    created_at: '2026-09-20T13:55:00Z',
    published_at: '2026-09-20T14:03:12Z',
    body: 'Notes de version.',
    assets: [
      asset(EXE, { digest: `sha256:${HEX}` }),
      asset('Magistra-2.1.0-win-x64.zip', { size: 120_000_000 }),
      asset('SHA256SUMS.txt', { size: 170 }),
    ],
    ...extra,
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

function textResponse(text: string, status = 200): Response {
  return new Response(text, { status, headers: { 'Content-Type': 'application/octet-stream' } });
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { Location: location } });
}

interface FakeCall {
  url: string;
  headers: Headers;
  redirect?: RequestRedirect;
}

/** Faux GitHub : une réponse par adresse exacte ; toute autre adresse est une erreur de test. */
function fakeGitHub(routes: Record<string, () => Response | Promise<Response>>): FetchLike & { calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, headers: new Headers(init?.headers), redirect: init?.redirect });
    const route = routes[url];
    if (!route) throw new Error(`adresse inattendue : ${url}`);
    return route();
  };
  return Object.assign(fn, { calls });
}

function run(fetch: FetchLike, extra: Partial<WindowsReleaseOptions> = {}, logs: string[] = []): Promise<WindowsReleaseResponse> {
  return fetchLatestWindowsRelease({ fetch, repo: REPO, log: message => logs.push(message), ...extra });
}

const NONE: WindowsReleaseResponse = { available: false, reason: 'none', releasesUrl: RELEASES_PAGE };
const UNAVAILABLE: WindowsReleaseResponse = { available: false, reason: 'unavailable', releasesUrl: RELEASES_PAGE };

describe('fetchLatestWindowsRelease — dernière version stable', () => {
  it('renvoie version, fichier, lien direct vérifié, taille, SHA-256, date, page et systèmes', async () => {
    const fetch = fakeGitHub({ [API]: () => jsonResponse(release()) });
    const result = await run(fetch);
    expect(result).toEqual({
      available: true,
      version: '2.1.0',
      fileName: EXE,
      downloadUrl: download(EXE),
      sizeBytes: 98_765_432,
      sha256: HEX,
      publishedAt: '2026-09-20T14:03:12.000Z',
      releaseUrl: `https://github.com/${REPO}/releases/tag/${TAG}`,
      requirements: WINDOWS_REQUIREMENTS,
    });
    expect(WINDOWS_REQUIREMENTS).toBe('Windows 10 ou 11 (64 bits)');
    // Une seule requête (le digest suffit), vers l'adresse fixe « latest » du dépôt officiel.
    expect(fetch.calls.map(c => c.url)).toEqual([API]);
    const [call] = fetch.calls;
    expect(call.redirect).toBe('manual');
    expect(call.headers.get('accept')).toBe('application/vnd.github+json');
    expect(call.headers.get('x-github-api-version')).toBe('2022-11-28');
    expect(call.headers.get('user-agent')).toMatch(/^Magistra/);
    expect(call.headers.get('authorization')).toBeNull();
  });

  it('aucune version n’est codée en dur : la version publiée fait foi', async () => {
    const tag = 'v3.0.12';
    const name = 'Magistra-Setup-3.0.12.exe';
    const fetch = fakeGitHub({
      [API]: () => jsonResponse(release({ tag_name: tag, assets: [asset(name, { browser_download_url: download(name, tag), size: 1_234, digest: `sha256:${OTHER_HEX}` })] })),
    });
    expect(await run(fetch)).toMatchObject({ available: true, version: '3.0.12', fileName: name, downloadUrl: download(name, tag), sizeBytes: 1_234, sha256: OTHER_HEX });
  });

  it('préversion ignorée : aucune version stable', async () => {
    const fetch = fakeGitHub({ [API]: () => jsonResponse(release({ prerelease: true })) });
    expect(await run(fetch)).toEqual(NONE);
  });

  it('brouillon ignoré (y compris champ « draft » absent ou non booléen)', async () => {
    for (const draft of [true, undefined, 'false', null]) {
      const fetch = fakeGitHub({ [API]: () => jsonResponse(release({ draft })) });
      expect(await run(fetch), String(draft)).toEqual(NONE);
    }
    const noPrerelease = fakeGitHub({ [API]: () => jsonResponse(release({ prerelease: undefined })) });
    expect(await run(noPrerelease)).toEqual(NONE);
  });

  it('étiquette invalide : réponse inattendue, rien n’est proposé', async () => {
    for (const tag_name of ['2.1.0', 'v2.1', 'v2.1.0-beta.1', 'v2.1.0+build', 'v02.1.0', 'V2.1.0', ' v2.1.0', 'nightly', 'v2.1.0.4', 210, null]) {
      const logs: string[] = [];
      const fetch = fakeGitHub({ [API]: () => jsonResponse(release({ tag_name })) });
      expect(await run(fetch, {}, logs), String(tag_name)).toEqual(UNAVAILABLE);
      expect(logs.join('\n')).toContain('étiquette de version inattendue');
    }
  });

  it('installateur absent, d’une autre version, incomplet ou de taille invalide : indisponible', async () => {
    const variants: unknown[][] = [
      [],
      [asset('Magistra-2.1.0-win-x64.zip'), asset('SHA256SUMS.txt')],
      [asset('Magistra-Setup-2.0.9.exe', { browser_download_url: download('Magistra-Setup-2.0.9.exe') })],
      [asset('magistra-setup-2.1.0.exe', { browser_download_url: download('magistra-setup-2.1.0.exe') })],
      [asset(`${EXE}.blockmap`, { browser_download_url: download(`${EXE}.blockmap`) })],
      [asset(EXE, { state: 'open' })],
      [asset(EXE, { size: 0 })],
      [asset(EXE, { size: -5 })],
      [asset(EXE, { size: 12.5 })],
      [asset(EXE, { size: '98765432' })],
      [asset(EXE, { size: 3 * 1024 ** 3 })],
      [asset(EXE), asset(EXE)],
      ['texte', null, 42],
    ];
    for (const assets of variants) {
      const fetch = fakeGitHub({ [API]: () => jsonResponse(release({ assets })) });
      expect(await run(fetch), JSON.stringify(assets).slice(0, 120)).toEqual(UNAVAILABLE);
    }
    const noAssets = fakeGitHub({ [API]: () => jsonResponse(release({ assets: undefined })) });
    expect(await run(noAssets)).toEqual(UNAVAILABLE);
    const noDate = fakeGitHub({ [API]: () => jsonResponse(release({ published_at: null })) });
    expect(await run(noDate)).toEqual(UNAVAILABLE);
    const notObject = fakeGitHub({ [API]: () => jsonResponse(['release']) });
    expect(await run(notObject)).toEqual(UNAVAILABLE);
  });

  it('lien de téléchargement d’un autre dépôt, d’un autre hôte ou suspect : refusé', async () => {
    const refused = [
      download(EXE, TAG, 'pirate/magistra-2'),
      download(EXE, TAG, 'juanrobin09-stack/magistra-3'),
      `https://objects.githubusercontent.com/github-production-release-asset/1/${EXE}`,
      `https://github.com.evil.example/${REPO}/releases/download/${TAG}/${EXE}`,
      `http://github.com/${REPO}/releases/download/${TAG}/${EXE}`,
      `https://GITHUB.com/${REPO}/releases/download/${TAG}/${EXE}`,
      `https://github.com:443/${REPO}/releases/download/${TAG}/${EXE}`,
      `https://github.com:8443/${REPO}/releases/download/${TAG}/${EXE}`,
      `https://user:mdp@github.com/${REPO}/releases/download/${TAG}/${EXE}`,
      `https://github.com/pirate/x/../../${REPO}/releases/download/${TAG}/${EXE}`,
      `https://github.com/${REPO}/releases/download/${TAG}/../v2.0.0/${EXE}`,
      `https://github.com/${REPO}/releases/download/${TAG}/%2e%2e/${EXE}`,
      `https://github.com/${REPO}/releases/download/${TAG}/Magistra%2DSetup-2.1.0.exe`,
      `https://github.com/${REPO}\\releases\\download\\${TAG}\\${EXE}`,
      `https://github.com/${REPO}/releases/download/v2.0.0/${EXE}`,
      `https://github.com/${REPO}/releases/download/${TAG}/Magistra-Setup-2.1.0.msi`,
      `https://github.com/${REPO}/releases/download/${TAG}/${EXE}?x=1`,
      `https://github.com/${REPO}/releases/download/${TAG}/${EXE}#frag`,
      `https://github.com/${REPO}/RELEASES/download/${TAG}/${EXE}`,
      `javascript:alert(1)//github.com/${REPO}/releases/download/${TAG}/${EXE}`,
      '',
      42,
      null,
    ];
    for (const browser_download_url of refused) {
      expect(verifiedDownloadUrl(browser_download_url, REPO, TAG, EXE), String(browser_download_url)).toBeNull();
      const fetch = fakeGitHub({ [API]: () => jsonResponse(release({ assets: [asset(EXE, { browser_download_url, digest: `sha256:${HEX}` })] })) });
      expect(await run(fetch), String(browser_download_url)).toEqual(UNAVAILABLE);
    }
    // Casse du propriétaire et du dépôt : indifférente pour GitHub (nom canonique renvoyé par l'API).
    const canonical = `https://github.com/JuanRobin09-Stack/Magistra-2/releases/download/${TAG}/${EXE}`;
    expect(verifiedDownloadUrl(canonical, REPO, TAG, EXE)).toBe(canonical);
    const fetch = fakeGitHub({ [API]: () => jsonResponse(release({ assets: [asset(EXE, { browser_download_url: canonical })] })) });
    expect(await run(fetch)).toMatchObject({ available: true, downloadUrl: canonical });
  });

  it('digest : « sha256:<64 hex> » seulement, normalisé en minuscules ; sinon SHA256SUMS.txt', async () => {
    const upper = fakeGitHub({ [API]: () => jsonResponse(release({ assets: [asset(EXE, { digest: `sha256:${HEX.toUpperCase()}` })] })) });
    expect(await run(upper)).toMatchObject({ available: true, sha256: HEX });

    for (const digest of [`sha512:${HEX}${HEX}`, `sha256:${HEX.slice(1)}`, `sha256:${'z'.repeat(64)}`, HEX, 42, null]) {
      const fetch = fakeGitHub({
        [API]: () => jsonResponse(release({ assets: [asset(EXE, { digest }), asset('SHA256SUMS.txt', { size: 170 })] })),
        [download('SHA256SUMS.txt')]: () => textResponse(`${OTHER_HEX}  ${EXE}\n`),
      });
      expect(await run(fetch), String(digest)).toMatchObject({ available: true, sha256: OTHER_HEX });
    }
  });
});

describe('fetchLatestWindowsRelease — SHA256SUMS.txt', () => {
  const withoutDigest = (extraAssets: unknown[] = [asset('SHA256SUMS.txt', { size: 170 })]) =>
    release({ assets: [asset(EXE), asset('Magistra-2.1.0-win-x64.zip'), ...extraAssets] });
  const sums = `${OTHER_HEX}  Magistra-2.1.0-win-x64.zip\n${HEX}  ${EXE}\n`;

  it('empreinte lue dans SHA256SUMS.txt (redirection vers le CDN de GitHub suivie), sans jeton transmis', async () => {
    const cdn = 'https://release-assets.githubusercontent.com/github-production-release-asset/123/abc?sp=r&sig=x';
    const fetch = fakeGitHub({
      [API]: () => jsonResponse(withoutDigest()),
      [download('SHA256SUMS.txt')]: () => redirect(cdn),
      [cdn]: () => textResponse(sums),
    });
    const result = await run(fetch, { token: TOKEN });
    expect(result).toMatchObject({ available: true, fileName: EXE, sha256: HEX });
    expect(fetch.calls.map(c => c.url)).toEqual([API, download('SHA256SUMS.txt'), cdn]);
    expect(fetch.calls[0].headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    for (const call of fetch.calls.slice(1)) {
      expect(call.headers.get('authorization')).toBeNull();
      expect(call.redirect).toBe('manual');
    }
  });

  it('SHA256SUMS.txt absent, sans la ligne de l’installateur, contradictoire ou illisible : empreinte omise, version proposée', async () => {
    const cases: [unknown[], (() => Response | Promise<Response>) | undefined][] = [
      [[], undefined],
      [[asset('SHA256SUMS.txt', { size: 170 })], () => textResponse(`${OTHER_HEX}  Magistra-2.1.0-win-x64.zip\n`)],
      [[asset('SHA256SUMS.txt', { size: 170 })], () => textResponse(`${HEX}  ${EXE}\n${OTHER_HEX}  ${EXE}\n`)],
      [[asset('SHA256SUMS.txt', { size: 170 })], () => textResponse('non trouvé', 404)],
      [[asset('SHA256SUMS.txt', { size: 170 })], () => Promise.reject(new Error('connexion coupée'))],
      [[asset('SHA256SUMS.txt', { size: 170 })], () => redirect('https://evil.example/SHA256SUMS.txt')],
      [[asset('SHA256SUMS.txt', { size: 170 })], () => redirect(`http://github.com/${REPO}/SHA256SUMS.txt`)],
      // Taille annoncée par GitHub au-delà de 64 Ko : le fichier n'est même pas téléchargé.
      [[asset('SHA256SUMS.txt', { size: WINDOWS_RELEASE_LIMITS.maxChecksumBytes + 1 })], () => textResponse(sums)],
      // Fichier d'un autre dépôt : refusé comme l'installateur.
      [[asset('SHA256SUMS.txt', { size: 170, browser_download_url: download('SHA256SUMS.txt', TAG, 'pirate/magistra-2') })], () => textResponse(sums)],
    ];
    for (const [extra, route] of cases) {
      const fetch = fakeGitHub({ [API]: () => jsonResponse(withoutDigest(extra)), ...(route ? { [download('SHA256SUMS.txt')]: route } : {}) });
      const result = await run(fetch);
      expect(result, JSON.stringify(extra).slice(0, 100)).toMatchObject({ available: true, version: '2.1.0', fileName: EXE });
      expect(result).not.toHaveProperty('sha256');
    }
  });

  it('SHA256SUMS.txt plus gros que prévu (en flux) : lecture interrompue, empreinte omise', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new TextEncoder().encode(`${HEX}  ${EXE}\n`.repeat(200)));
      },
    });
    const fetch = fakeGitHub({
      [API]: () => jsonResponse(withoutDigest()),
      [download('SHA256SUMS.txt')]: () => new Response(body, { status: 200 }),
    });
    const result = await run(fetch);
    expect(result).toMatchObject({ available: true });
    expect(result).not.toHaveProperty('sha256');
    expect(pulled).toBeLessThan(10);
  });

  it('checksumFor : format de sha256sum (texte ou binaire, CRLF), nom exact, ambiguïté refusée', () => {
    expect(checksumFor(`${HEX}  ${EXE}\n`, EXE)).toBe(HEX);
    expect(checksumFor(`${HEX.toUpperCase()} *${EXE}\r\n`, EXE)).toBe(HEX);
    expect(checksumFor(`# empreintes\n\n${OTHER_HEX}  autre.zip\r\n${HEX}  ${EXE}\r\n`, EXE)).toBe(HEX);
    expect(checksumFor(`${HEX}  ${EXE}\n${HEX}  ${EXE}\n`, EXE)).toBe(HEX);
    expect(checksumFor(`${HEX}  ${EXE}\n${OTHER_HEX}  ${EXE}\n`, EXE)).toBeUndefined();
    expect(checksumFor(`${HEX}  ${EXE}.blockmap\n`, EXE)).toBeUndefined();
    expect(checksumFor(`${HEX}  sous-dossier/${EXE}\n`, EXE)).toBeUndefined();
    expect(checksumFor(`${HEX.slice(2)}  ${EXE}\n`, EXE)).toBeUndefined();
    expect(checksumFor('', EXE)).toBeUndefined();
  });
});

describe('fetchLatestWindowsRelease — GitHub sans version ou en erreur', () => {
  it('aucune release publiée (404) : « none » et page des versions en repli', async () => {
    const fetch = fakeGitHub({ [API]: () => jsonResponse({ message: 'Not Found' }, 404) });
    expect(await run(fetch)).toEqual(NONE);
  });

  it('GitHub en erreur, injoignable, lent ou illisible : « unavailable », jamais d’exception', async () => {
    const hanging: FetchLike = (_url, init) => new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    });
    const cases: [string, FetchLike][] = [
      ['500', fakeGitHub({ [API]: () => jsonResponse({ message: 'Server Error' }, 500) })],
      ['502', fakeGitHub({ [API]: () => textResponse('<html>Bad gateway</html>', 502) })],
      ['réseau', () => Promise.reject(new TypeError('fetch failed'))],
      ['délai', hanging],
      ['JSON invalide', fakeGitHub({ [API]: () => textResponse('{"tag_name": "v2.1.0"') })],
      ['trop gros (annoncé)', fakeGitHub({ [API]: () => new Response('{}', { headers: { 'Content-Length': String(WINDOWS_RELEASE_LIMITS.maxReleaseBytes + 1) } }) })],
      ['trop gros (flux)', fakeGitHub({ [API]: () => textResponse(JSON.stringify(release({ body: 'x'.repeat(WINDOWS_RELEASE_LIMITS.maxReleaseBytes) }))) })],
      ['redirection hors de l’API', fakeGitHub({ [API]: () => redirect('https://evil.example/releases/latest', 301) })],
      ['redirection sans adresse', fakeGitHub({ [API]: () => new Response(null, { status: 301 }) })],
      ['redirection http', fakeGitHub({ [API]: () => redirect('http://api.github.com/repos/x/y/releases/latest', 301) })],
    ];
    for (const [label, fetch] of cases) {
      const logs: string[] = [];
      expect(await run(fetch, { timeoutMs: 50 }, logs), label).toEqual(UNAVAILABLE);
      expect(logs.length, label).toBeGreaterThan(0);
      expect(logs.join('\n'), label).toMatch(/^Version Windows indisponible : /);
    }
  });

  it('boucle de redirections : 3 au plus, puis indisponible', async () => {
    let n = 0;
    const loop: FetchLike = async () => redirect(`https://api.github.com/repositories/1/releases/latest?n=${n++}`, 301);
    expect(await run(loop)).toEqual(UNAVAILABLE);
    expect(n).toBe(WINDOWS_RELEASE_LIMITS.maxRedirects + 1);
  });

  it('dépôt renommé : redirection suivie à l’intérieur de api.github.com, jeton conservé pour l’API seulement', async () => {
    // Après un renommage, GitHub renvoie des liens au NOUVEAU propriétaire/nom (html_url, browser_download_url).
    const NEW = 'magistra-edu/magistra';
    const moved = 'https://api.github.com/repositories/987654/releases/latest';
    const renamed = release({
      html_url: `https://github.com/${NEW}/releases/tag/${TAG}`,
      assets: [asset(EXE, { digest: `sha256:${HEX}`, browser_download_url: download(EXE, TAG, NEW) })],
    });
    const fetch = fakeGitHub({ [API]: () => redirect(moved, 301), [moved]: () => jsonResponse(renamed) });
    expect(await run(fetch, { token: TOKEN })).toMatchObject({
      available: true, version: '2.1.0', downloadUrl: download(EXE, TAG, NEW), releaseUrl: `https://github.com/${NEW}/releases/tag/${TAG}`,
    });
    expect(fetch.calls.map(c => [c.url, c.headers.get('authorization')])).toEqual([[API, `Bearer ${TOKEN}`], [moved, `Bearer ${TOKEN}`]]);
  });

  it('dépôt renommé : dépôt canonique lu dans html_url seulement s’il est exact ; sans redirection, jamais d’autre dépôt', async () => {
    const NEW = 'magistra-edu/magistra';
    const moved = 'https://api.github.com/repositories/987654/releases/latest';
    const withLinks = (htmlUrl: unknown) => release({
      html_url: htmlUrl,
      assets: [asset(EXE, { digest: `sha256:${HEX}`, browser_download_url: download(EXE, TAG, NEW) })],
    });
    for (const htmlUrl of [
      undefined, 42, `https://evil.example/${NEW}/releases/tag/${TAG}`, `https://github.com/${NEW}/releases/tag/v9.9.9`,
      `https://github.com/${NEW}/releases/tag/${TAG}?x=1`, `https://github.com/${NEW}/../x/releases/tag/${TAG}`,
      `https://github.com/-bad/repo/releases/tag/${TAG}`, `https://github.com/${NEW}/releases/${TAG}`, `http://github.com/${NEW}/releases/tag/${TAG}`,
    ]) {
      const fetch = fakeGitHub({ [API]: () => redirect(moved, 301), [moved]: () => jsonResponse(withLinks(htmlUrl)) });
      expect(await run(fetch), String(htmlUrl)).toEqual(UNAVAILABLE);
    }
    // html_url d'un autre dépôt, liens au bon nom mais pour un AUTRE dépôt que celui de html_url : refusés.
    const mismatch = release({ html_url: `https://github.com/autre/depot/releases/tag/${TAG}`, assets: [asset(EXE, { browser_download_url: download(EXE, TAG, NEW) })] });
    expect(await run(fakeGitHub({ [API]: () => redirect(moved, 301), [moved]: () => jsonResponse(mismatch) }))).toEqual(UNAVAILABLE);
    // Sans redirection : le dépôt configuré fait foi (un html_url différent ne change rien, les liens doivent y être).
    expect(await run(fakeGitHub({ [API]: () => jsonResponse(withLinks(`https://github.com/${NEW}/releases/tag/${TAG}`)) }))).toEqual(UNAVAILABLE);
  });

  it('limite de l’API GitHub atteinte : cause journalisée, avec le conseil GITHUB_TOKEN seulement sans jeton', async () => {
    const limited = () => jsonResponse({ message: 'API rate limit exceeded' }, 403, { 'X-RateLimit-Remaining': '0' });
    const logs: string[] = [];
    expect(await run(fakeGitHub({ [API]: limited }), {}, logs)).toEqual(UNAVAILABLE);
    expect(logs.join('\n')).toContain("limite de requêtes de l'API GitHub atteinte (renseignez GITHUB_TOKEN");
    const withToken: string[] = [];
    await run(fakeGitHub({ [API]: limited }), { token: TOKEN }, withToken);
    expect(withToken.join('\n')).toContain("limite de requêtes de l'API GitHub atteinte");
    expect(withToken.join('\n')).not.toContain('renseignez');
    expect(withToken.join('\n')).not.toContain(TOKEN);
  });

  it('les journaux ne recopient rien de ce que GitHub renvoie', async () => {
    const logs: string[] = [];
    const fetch = fakeGitHub({ [API]: () => jsonResponse(release({ tag_name: '<script>INJECTION</script>' })) });
    await run(fetch, {}, logs);
    expect(logs.join('\n')).not.toContain('INJECTION');
  });
});

describe('fetchLatestWindowsRelease — cache mémoire', () => {
  it('une requête vers GitHub toutes les 10 minutes au plus', async () => {
    let t = 1_000_000;
    const cache = createWindowsReleaseCache();
    const fetch = fakeGitHub({ [API]: () => jsonResponse(release()) });
    const opts = { cache, now: () => t };
    const first = await run(fetch, opts);
    t += WINDOWS_RELEASE_LIMITS.cacheTtlMs - 1;
    expect(await run(fetch, opts)).toEqual(first);
    expect(fetch.calls).toHaveLength(1);
    t += 1;
    await run(fetch, opts);
    expect(fetch.calls).toHaveLength(2);
  });

  it('requêtes simultanées regroupées en une seule', async () => {
    let release_: () => void = () => undefined;
    const gate = new Promise<void>(resolve => (release_ = resolve));
    const fetch = fakeGitHub({ [API]: async () => { await gate; return jsonResponse(release()); } });
    const cache = createWindowsReleaseCache();
    const pending = [run(fetch, { cache }), run(fetch, { cache }), run(fetch, { cache })];
    release_();
    const results = await Promise.all(pending);
    expect(fetch.calls).toHaveLength(1);
    expect(new Set(results.map(r => JSON.stringify(r))).size).toBe(1);
    expect(cache.pending).toBeUndefined();
  });

  it('GitHub en panne : dernière réponse valide resservie (24 h au plus), nouvel essai après une minute', async () => {
    let t = 0;
    let up = true;
    const cache = createWindowsReleaseCache();
    const fetch = fakeGitHub({ [API]: () => (up ? jsonResponse(release()) : jsonResponse({}, 503)) });
    const opts = { cache, now: () => t };
    const good = await run(fetch, opts);
    expect(good.available).toBe(true);

    up = false;
    t += WINDOWS_RELEASE_LIMITS.cacheTtlMs;
    expect(await run(fetch, opts)).toEqual(good);
    expect(fetch.calls).toHaveLength(2);
    t += WINDOWS_RELEASE_LIMITS.failureTtlMs - 1;
    await run(fetch, opts);
    expect(fetch.calls).toHaveLength(2);
    t += 1;
    expect(await run(fetch, opts)).toEqual(good);
    expect(fetch.calls).toHaveLength(3);

    // Au-delà de 24 h sans réponse valide : l'indisponibilité est annoncée (lien vers la page des versions).
    t += WINDOWS_RELEASE_LIMITS.staleMaxMs;
    expect(await run(fetch, opts)).toEqual(UNAVAILABLE);

    up = true;
    t += WINDOWS_RELEASE_LIMITS.failureTtlMs;
    expect(await run(fetch, opts)).toEqual(good);
  });

  it('indisponible sans réponse antérieure : mis en cache une minute seulement', async () => {
    let t = 0;
    const cache = createWindowsReleaseCache();
    const fetch = fakeGitHub({ [API]: () => jsonResponse({}, 500) });
    expect(await run(fetch, { cache, now: () => t })).toEqual(UNAVAILABLE);
    t += WINDOWS_RELEASE_LIMITS.failureTtlMs - 1;
    await run(fetch, { cache, now: () => t });
    expect(fetch.calls).toHaveLength(1);
    t += 1;
    await run(fetch, { cache, now: () => t });
    expect(fetch.calls).toHaveLength(2);
  });

  it('un autre dépôt ne réutilise pas le cache', async () => {
    const other = 'univ-exemple/magistra';
    const otherApi = `https://api.github.com/repos/${other}/releases/latest`;
    const cache = createWindowsReleaseCache();
    const fetch = fakeGitHub({ [API]: () => jsonResponse(release()), [otherApi]: () => jsonResponse({}, 404) });
    expect((await run(fetch, { cache })).available).toBe(true);
    expect(await run(fetch, { cache, repo: other })).toEqual({ available: false, reason: 'none', releasesUrl: `https://github.com/${other}/releases` });
    expect(fetch.calls.map(c => c.url)).toEqual([API, otherApi]);
  });
});

describe('dépôt des versions (MAGISTRA_RELEASES_REPO) et jeton (GITHUB_TOKEN)', () => {
  it('parseReleasesRepo : « propriétaire/dépôt » GitHub uniquement', () => {
    expect(parseReleasesRepo(DEFAULT_RELEASES_REPO)).toBe(REPO);
    expect(parseReleasesRepo(' Univ-Exemple/magistra.fork_2 ')).toBe('Univ-Exemple/magistra.fork_2');
    for (const bad of ['', 'magistra', 'a/b/c', '/magistra', 'owner/', '-owner/repo', 'owner-/repo', 'ow--ner/repo', 'owner/..', 'owner/.',
      'owner/re po', 'owner/repo?x', 'owner/re%2fpo', 'https://github.com/owner/repo', `${'a'.repeat(40)}/repo`, `owner/${'r'.repeat(101)}`, 42, null]) {
      expect(parseReleasesRepo(bad), String(bad)).toBeNull();
    }
  });

  it('configuration : dépôt officiel par défaut, dépôt invalide ou jeton invalide signalés sans être recopiés', () => {
    expect(loadConfig({}).releases).toEqual({ repo: DEFAULT_RELEASES_REPO });
    expect(loadConfig({ MAGISTRA_RELEASES_REPO: 'univ-exemple/magistra', GITHUB_TOKEN: TOKEN }).releases).toEqual({ repo: 'univ-exemple/magistra', token: TOKEN });
    const bad = loadConfig({ MAGISTRA_RELEASES_REPO: 'https://evil.example/x', GITHUB_TOKEN: 'ghp_abc\r\nX-Injection: 1' });
    expect(bad.releases).toEqual({ repo: DEFAULT_RELEASES_REPO });
    const problems = bad.problems.join('\n');
    expect(problems).toContain('MAGISTRA_RELEASES_REPO');
    expect(problems).toContain('GITHUB_TOKEN invalide');
    expect(problems).not.toContain('evil.example');
    expect(problems).not.toContain('X-Injection');
  });
});

describe('GET /api/windows-release (route publique)', () => {
  let server: TestServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('publique, sans jeton de session ; mise en cache HTTP ; jeton GitHub jamais renvoyé', async () => {
    const fetch = fakeGitHub({ [API]: () => jsonResponse(release()) });
    const logs: string[] = [];
    const deps = testDeps({ env: { GITHUB_TOKEN: TOKEN }, overrides: { releasesFetch: fetch, log: m => logs.push(m) } });
    server = await startApi(deps);
    const res = await globalThis.fetch(`${server.url}/api/windows-release`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(WINDOWS_RELEASE_CACHE_CONTROL);
    expect(WINDOWS_RELEASE_CACHE_CONTROL).toBe('public, max-age=300, s-maxage=600, stale-while-revalidate=86400');
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ available: true, version: '2.1.0', fileName: EXE, sha256: HEX });
    // Le jeton part vers api.github.com, et nulle part ailleurs : ni dans la réponse, ni dans ses en-têtes, ni dans le journal.
    expect(fetch.calls[0].headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('S3cr3t');
    expect(JSON.stringify([...res.headers])).not.toContain('S3cr3t');
    expect(logs.join('\n')).not.toContain('S3cr3t');

    // Deuxième visite : cache de l'instance, aucune nouvelle requête vers GitHub.
    const again = await globalThis.fetch(`${server.url}/api/windows-release`);
    expect(await again.json()).toEqual(JSON.parse(text));
    expect(fetch.calls).toHaveLength(1);
  });

  it('GitHub indisponible : 200 avec repli, cache HTTP court', async () => {
    const fetch = fakeGitHub({ [API]: () => jsonResponse({}, 500) });
    server = await startApi(testDeps({ overrides: { releasesFetch: fetch } }));
    const res = await globalThis.fetch(`${server.url}/api/windows-release/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe(WINDOWS_RELEASE_UNAVAILABLE_CACHE_CONTROL);
    expect(await res.json()).toEqual(UNAVAILABLE);
  });

  it('aucune version stable : 200, « none », cache HTTP normal', async () => {
    const fetch = fakeGitHub({ [API]: () => jsonResponse({ message: 'Not Found' }, 404) });
    server = await startApi(testDeps({ overrides: { releasesFetch: fetch } }));
    const res = await globalThis.fetch(`${server.url}/api/windows-release`);
    expect(res.headers.get('cache-control')).toBe(WINDOWS_RELEASE_CACHE_CONTROL);
    expect(await res.json()).toEqual(NONE);
  });

  it('dépôt configuré (MAGISTRA_RELEASES_REPO) utilisé pour l’API et le repli', async () => {
    const other = 'univ-exemple/magistra';
    const otherApi = `https://api.github.com/repos/${other}/releases/latest`;
    const fetch = fakeGitHub({ [otherApi]: () => jsonResponse({}, 404) });
    server = await startApi(testDeps({ env: { MAGISTRA_RELEASES_REPO: other }, overrides: { releasesFetch: fetch } }));
    const res = await globalThis.fetch(`${server.url}/api/windows-release`);
    expect(await res.json()).toEqual({ available: false, reason: 'none', releasesUrl: `https://github.com/${other}/releases` });
    expect(fetch.calls.map(c => c.url)).toEqual([otherApi]);
  });

  it('GET uniquement (405 sinon), sans jamais interroger GitHub', async () => {
    const fetch = fakeGitHub({ [API]: () => jsonResponse(release()) });
    server = await startApi(testDeps({ overrides: { releasesFetch: fetch } }));
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await globalThis.fetch(`${server.url}/api/windows-release`, { method });
      expect(res.status, method).toBe(405);
      expect(res.headers.get('allow')).toBe('GET');
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect(fetch.calls).toHaveLength(0);
  });
});
