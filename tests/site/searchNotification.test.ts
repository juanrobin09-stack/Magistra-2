import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { INDEXNOW_KEY, INDEXNOW_PATH } from '../../shared/siteIndexing';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const notifier = await import(pathToFileURL(path.join(root, 'scripts/notify-search-engines.mjs')).href);
const source = {
  SITE_ORIGIN: 'https://www.example.com', SITE_PATHS: ['/', '/ressources'],
  SITE_SEO: { '/': { index: true }, '/ressources': { index: true }, '/cgu': { index: false } },
  INDEXNOW_KEY, INDEXNOW_PATH,
};
const keyLocation = `${source.SITE_ORIGIN}${INDEXNOW_PATH}`;
const page = (url: string, robots = 'index, follow') => new Response(
  `<html><head><link href="${url}" rel="canonical"><meta content="${robots}" name="robots"></head><body><main><h1>Un guide utile</h1></main></body></html>`,
  { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
);
const mockSite = (status = 200) => vi.fn(async (url: string, _options?: RequestInit) => {
  if (url === keyLocation) return new Response(`${INDEXNOW_KEY}\n`, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  if (url === notifier.INDEXNOW_ENDPOINT) return new Response('', { status });
  return page(url);
});

describe('Notification des moteurs : validation préalable et aperçu sans réseau', () => {
  it('reste un aperçu local sans option, sans envoyer de requête', async () => {
    const fetchImpl = vi.fn();
    const result = await notifier.notifySearchEngines({ source, fetchImpl });
    expect(result).toMatchObject({ mode: 'dry-run', urlCount: 2, keyLocation, submitted: false });
    expect(result.urls).toEqual(['https://www.example.com/', 'https://www.example.com/ressources']);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([200, 202])('vérifie la clé et toutes les pages avant un POST accepté %s', async status => {
    const fetchImpl = mockSite(status);
    const result = await notifier.notifySearchEngines({ submit: true, source, fetchImpl });
    expect(result).toMatchObject({ submitted: true, status, keyFileVerified: true, canonicalPagesVerified: 2, indexingGuaranteed: false });
    expect(result.state).toBe(status === 200 ? 'received' : 'key-validation-pending');
    expect(fetchImpl.mock.calls.map(call => call[0])).toEqual([keyLocation, 'https://www.example.com/', 'https://www.example.com/ressources', notifier.INDEXNOW_ENDPOINT]);
    const options = fetchImpl.mock.calls.at(-1)![1] as RequestInit;
    expect(options).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(options.body as string)).toEqual({ host: 'www.example.com', key: INDEXNOW_KEY, keyLocation, urlList: result.urls });
  });

  it('refuse une route exclue de l’index avant toute requête', async () => {
    const fetchImpl = vi.fn();
    await expect(notifier.notifySearchEngines({ submit: true, source: { ...source, SITE_PATHS: ['/cgu'] }, fetchImpl })).rejects.toMatchObject({ code: 'INVALID_ROUTE' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuse un fichier de validation différent sans notifier IndexNow', async () => {
    const fetchImpl = vi.fn(async () => new Response('mauvaise-cle', { headers: { 'content-type': 'text/plain' } }));
    await expect(notifier.notifySearchEngines({ submit: true, source, fetchImpl })).rejects.toMatchObject({ code: 'KEY_MISMATCH' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['PAGE_NOT_PUBLISHED', () => new Response('Introuvable', { status: 404, headers: { 'content-type': 'text/html' } })],
    ['CANONICAL_MISMATCH', () => page('https://www.example.com/autre-page')],
    ['PAGE_NOT_INDEXABLE', () => page('https://www.example.com/', 'noindex, follow')],
    ['PAGE_NOT_INDEXABLE', () => page('https://www.example.com/', 'none')],
    ['PAGE_EMPTY', () => new Response('<html><head><link href="https://www.example.com/" rel="canonical"><meta name="robots" content="index,follow"></head><body><main></main></body></html>', { headers: { 'content-type': 'text/html' } })],
  ])('refuse %s avant toute notification', async (code, response) => {
    const site = mockSite();
    const fetchImpl = vi.fn(async (url: string) => url === keyLocation ? site(url) : response());
    await expect(notifier.notifySearchEngines({ submit: true, source, fetchImpl })).rejects.toMatchObject({ code });
    expect(fetchImpl.mock.calls.some(call => call[0] === notifier.INDEXNOW_ENDPOINT)).toBe(false);
  });

  it('respecte aussi une interdiction HTTP X-Robots-Tag', async () => {
    const site = mockSite();
    const fetchImpl = vi.fn(async (url: string) => {
      const response = await site(url);
      if (url !== keyLocation) response.headers.set('x-robots-tag', 'googlebot: noindex');
      return response;
    });
    await expect(notifier.notifySearchEngines({ submit: true, source, fetchImpl })).rejects.toMatchObject({ code: 'PAGE_NOT_INDEXABLE' });
    expect(fetchImpl.mock.calls.some(call => call[0] === notifier.INDEXNOW_ENDPOINT)).toBe(false);
  });

  it('remonte une erreur réseau et une réponse de refus sans les masquer', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('Connexion interrompue'); });
    await expect(notifier.notifySearchEngines({ submit: true, source, fetchImpl })).rejects.toMatchObject({ code: 'REQUEST_FAILED' });
    await expect(notifier.notifySearchEngines({ submit: true, source, fetchImpl: mockSite(429) })).rejects.toMatchObject({ code: 'SUBMISSION_REJECTED' });
  });
});
