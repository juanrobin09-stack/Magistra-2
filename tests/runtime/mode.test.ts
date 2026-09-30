// Découverte du mode d'exécution à l'exécution (GET /api/mode) : personnel, web (clé reçue ou du build),
// repli historique en cas d'échec (404, page HTML d'un hébergement statique, délai dépassé).

import { describe, expect, it, vi } from 'vitest';
import { API_ROUTES } from '@shared/apiContract';
import {
  discoverRuntimeConfig, fetchModeInfo, MODE_DISCOVERY_TIMEOUT_MS, parseModeInfo, resolveRuntimeConfig,
} from '@/lib/runtime/mode';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

const PK = 'pk_test_Y2xlcmsuZXhhbXBsZS5jb20k';

describe('parseModeInfo', () => {
  it('accepte les trois modes et ignore une clé qui n’est pas publiable', () => {
    expect(parseModeInfo({ auth: 'personal' })).toEqual({ auth: 'personal' });
    expect(parseModeInfo({ auth: 'clerk', clerkPublishableKey: PK })).toEqual({ auth: 'clerk', clerkPublishableKey: PK });
    expect(parseModeInfo({ auth: 'clerk', clerkPublishableKey: 'sk_test_secret' })).toEqual({ auth: 'clerk' });
    expect(parseModeInfo({ auth: 'none', adminContact: '  informatique@lycee.fr \n' })).toEqual({ auth: 'none', adminContact: 'informatique@lycee.fr' });
  });

  it('réponse illisible → null', () => {
    for (const bad of [null, 'personal', 42, {}, { auth: 'admin' }, { auth: 1 }]) expect(parseModeInfo(bad)).toBeNull();
  });

  it('contact trop long : tronqué', () => {
    const info = parseModeInfo({ auth: 'none', adminContact: 'x'.repeat(500) });
    expect(info?.adminContact?.length).toBe(200);
  });
});

describe('fiche du prestataire (GET /api/mode)', () => {
  const OVH = { label: 'OVHcloud AI Endpoints', thirdParty: true, country: 'France', privacyUrl: 'https://docs.ovhcloud.com/x' };

  it('validée champ par champ ; fiche mal formée ignorée', () => {
    expect(parseModeInfo({ auth: 'clerk', clerkPublishableKey: PK, providerInfo: { ...OVH, baseUrl: 'https://api.secrete/v1', apiKey: 'k' } }))
      .toEqual({ auth: 'clerk', clerkPublishableKey: PK, providerInfo: OVH });
    for (const bad of [null, 'OVH', { label: '' , thirdParty: true }, { label: 'x' }, { label: 'x', thirdParty: 'oui' }]) {
      expect(parseModeInfo({ auth: 'personal', providerInfo: bad })).toEqual({ auth: 'personal' });
    }
  });

  it('recopiée pour le site web et le mode personnel, jamais en démonstration', () => {
    expect(resolveRuntimeConfig({ auth: 'clerk', clerkPublishableKey: PK, providerInfo: OVH }, { hasBridge: false }))
      .toEqual({ mode: 'web', clerkPublishableKey: PK, providerInfo: OVH });
    expect(resolveRuntimeConfig({ auth: 'personal', providerInfo: OVH }, { hasBridge: false })).toEqual({ mode: 'personal', providerInfo: OVH });
    expect(resolveRuntimeConfig({ auth: 'none', providerInfo: OVH }, { hasBridge: false })).toEqual({ mode: 'demo' });
    expect(resolveRuntimeConfig({ auth: 'personal', providerInfo: OVH }, { hasBridge: true })).toEqual({ mode: 'local' });
  });
});

describe('resolveRuntimeConfig', () => {
  it('le pont Electron a toujours la priorité', () => {
    expect(resolveRuntimeConfig({ auth: 'personal' }, { hasBridge: true, buildKey: PK })).toEqual({ mode: 'local' });
  });

  it('personal → mode personnel (même si une clé Clerk a été fournie au build)', () => {
    expect(resolveRuntimeConfig({ auth: 'personal', adminContact: 'moi' }, { hasBridge: false, buildKey: PK }))
      .toEqual({ mode: 'personal', adminContact: 'moi' });
  });

  it('clerk → web avec la clé reçue, sinon celle du build ; sans aucune clé → démonstration', () => {
    expect(resolveRuntimeConfig({ auth: 'clerk', clerkPublishableKey: PK }, { hasBridge: false })).toEqual({ mode: 'web', clerkPublishableKey: PK });
    expect(resolveRuntimeConfig({ auth: 'clerk' }, { hasBridge: false, buildKey: 'pk_test_build' }))
      .toEqual({ mode: 'web', clerkPublishableKey: 'pk_test_build' });
    expect(resolveRuntimeConfig({ auth: 'clerk' }, { hasBridge: false })).toEqual({ mode: 'demo' });
  });

  it('none ou échec → comportement historique (clé du build → web, sinon démonstration)', () => {
    expect(resolveRuntimeConfig(null, { hasBridge: false })).toEqual({ mode: 'demo' });
    expect(resolveRuntimeConfig({ auth: 'none' }, { hasBridge: false })).toEqual({ mode: 'demo' });
    expect(resolveRuntimeConfig(null, { hasBridge: false, buildKey: PK })).toEqual({ mode: 'web', clerkPublishableKey: PK });
  });
});

describe('fetchModeInfo', () => {
  it('GET /api/mode, sans jeton ni cache', async () => {
    const fetchImpl = vi.fn(async () => json({ auth: 'personal' }));
    expect(await fetchModeInfo(fetchImpl as unknown as typeof fetch)).toEqual({ auth: 'personal' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(API_ROUTES.mode);
    expect(init.method).toBe('GET');
    expect(init.cache).toBe('no-store');
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
  });

  it('404, 500, page HTML (hébergement statique), JSON illisible, erreur réseau → null', async () => {
    const cases: (() => Promise<Response>)[] = [
      async () => new Response('Not found', { status: 404 }),
      async () => json({ error: { code: 'SERVER_MISCONFIGURED' } }, 500),
      async () => new Response('<!doctype html><title>Magistra</title>', { status: 200, headers: { 'content-type': 'text/html' } }),
      async () => new Response('{pas du json', { status: 200, headers: { 'content-type': 'application/json' } }),
      async () => {
        throw new TypeError('Failed to fetch');
      },
    ];
    for (const impl of cases) expect(await fetchModeInfo(vi.fn(impl) as unknown as typeof fetch)).toBeNull();
  });

  it('délai dépassé (serveur qui ne répond pas) → null, sans bloquer le démarrage', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }));
      const pending = fetchModeInfo(fetchImpl as unknown as typeof fetch);
      await vi.advanceTimersByTimeAsync(MODE_DISCOVERY_TIMEOUT_MS + 10);
      expect(await pending).toBeNull();
      expect(MODE_DISCOVERY_TIMEOUT_MS).toBe(3000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('discoverRuntimeConfig', () => {
  it('application Windows : aucune requête', async () => {
    const fetchImpl = vi.fn();
    expect(await discoverRuntimeConfig({ hasBridge: true, fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ mode: 'local' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('site : le serveur décide', async () => {
    const fetchImpl = vi.fn(async () => json({ auth: 'clerk', clerkPublishableKey: PK, adminContact: 'dsi@exemple.fr' }));
    expect(await discoverRuntimeConfig({ hasBridge: false, buildKey: undefined, fetchImpl: fetchImpl as unknown as typeof fetch }))
      .toEqual({ mode: 'web', clerkPublishableKey: PK, adminContact: 'dsi@exemple.fr' });
  });

  it('vite preview / hébergement statique : démonstration comme avant', async () => {
    const fetchImpl = vi.fn(async () => json({ error: { code: 'SERVER_MISCONFIGURED' } }, 500));
    expect(await discoverRuntimeConfig({ hasBridge: false, buildKey: undefined, fetchImpl: fetchImpl as unknown as typeof fetch }))
      .toEqual({ mode: 'demo' });
  });
});
