// Client de l'API (site web et mode personnel) : vraie cause quand l'IA n'est pas prête,
// prestataire annoncé, jeton envoyé en « Authorization: Bearer », 401 du mode personnel expliqué.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerStatus } from '@shared/apiContract';
import type { GenerationEvent } from '@shared/types';
import { ApiDataStore, ApiGenerationClient, PERSONAL_UNAUTHENTICATED_MESSAGE, serverCapabilities } from '@/lib/runtime/web';

afterEach(() => {
  vi.unstubAllGlobals();
});

const RESEARCH = { academic: true, web: false, institutional: false, wikipedia: true };

function status(ai: ServerStatus['ai']): ServerStatus {
  return { ai, research: RESEARCH, maxDocumentChars: 30_000 };
}

const OVH = {
  label: 'OVHcloud AI Endpoints',
  thirdParty: true,
  country: 'France (centre de données de Gravelines)',
  retention: 'Aucune conservation des données (annoncé par OVHcloud)',
  training: "Aucune utilisation des textes pour l'entraînement (annoncé par OVHcloud)",
  privacyUrl: 'https://docs.ovhcloud.com/en/guides/public-cloud/ai-machine-learning/ai-endpoints-capabilities',
};

describe('serverCapabilities', () => {
  it('IA non prête : le code et le message précis sont conservés (notReady)', () => {
    const caps = serverCapabilities(status({
      ok: false, label: "Serveur d'IA", code: 'AI_AUTH_FAILED', message: "L'administrateur doit vérifier AI_API_KEY.",
    }));
    expect(caps.ready).toBe(false);
    expect(caps.notReady).toEqual({ code: 'AI_AUTH_FAILED', message: "L'administrateur doit vérifier AI_API_KEY." });
    expect(caps.aiWarning).toBeUndefined();
  });

  it('« trustedCatalogue » : transmis tel quel par un serveur actuel, jamais inventé pour un ancien serveur', () => {
    const ai = { ok: true, label: 'x' } as const;
    const current = serverCapabilities({ ai, research: { ...RESEARCH, institutional: true, web: true, trustedCatalogue: true }, maxDocumentChars: 30_000 });
    expect(current.research).toEqual({ academic: true, web: true, institutional: true, wikipedia: true, trustedCatalogue: true });
    const older = serverCapabilities(status(ai));
    expect(older.research).toEqual({ academic: true, web: false, institutional: false, wikipedia: true });
    expect(older.research).not.toHaveProperty('trustedCatalogue');
  });

  it('IA non prête sans code (ancien serveur) : cause générique, jamais vide', () => {
    const caps = serverCapabilities(status({ ok: false, label: "Serveur d'IA" }));
    expect(caps.notReady?.code).toBe('AI_SERVER_UNAVAILABLE');
    expect(caps.notReady?.message).toMatch(/\S/);
  });

  it('état non vérifié : prête, avec un avertissement', () => {
    const caps = serverCapabilities(status({
      ok: true, label: 'x', warning: { code: 'AI_STATUS_UNKNOWN', message: "L'état n'a pas pu être vérifié." },
    }));
    expect(caps.ready).toBe(true);
    expect(caps.notReady).toBeUndefined();
    expect(caps.aiWarning).toEqual({ code: 'AI_STATUS_UNKNOWN', message: "L'état n'a pas pu être vérifié." });
  });

  it('prestataire tiers : annoncé clairement (nom, pays, conservation, entraînement), jamais « restent chez vous »', () => {
    const caps = serverCapabilities(status({ ok: true, label: 'OVHcloud AI Endpoints', providerInfo: OVH }));
    expect(caps.providerInfo).toEqual(OVH);
    expect(caps.engineLabel).toBe('OVHcloud AI Endpoints');
    const msg = caps.privacy.message;
    expect(msg).toContain('Les demandes et les extraits de vos documents sont envoyés à « OVHcloud AI Endpoints » (France, centre de données de Gravelines) pour la génération.');
    expect(msg).toContain('Aucune conservation des données (annoncé par OVHcloud).');
    expect(msg).toContain("Aucune utilisation des textes pour l'entraînement (annoncé par OVHcloud).");
    expect(msg).not.toMatch(/restent (chez vous|sur cet ordinateur)/);
  });

  it('fiche prestataire illisible : ignorée (message historique avec le libellé)', () => {
    const caps = serverCapabilities(status({ ok: true, label: 'Mon serveur', providerInfo: { label: '', thirdParty: 'oui' } as never }));
    expect(caps.providerInfo).toBeUndefined();
    expect(caps.privacy.message).toContain('(Mon serveur)');
  });
});

function recordFetch(responses: (url: string) => Response) {
  const calls: { url: string; auth: string | null }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, auth: new Headers(init.headers).get('Authorization') });
    return responses(url);
  }));
  return calls;
}

function json(body: unknown, statusCode = 200): Response {
  return new Response(JSON.stringify(body), { status: statusCode, headers: { 'content-type': 'application/json' } });
}

describe('mode personnel : jeton d’accès', () => {
  it('chaque appel porte « Authorization: Bearer <code> »', async () => {
    const calls = recordFetch(url => (url.startsWith('/api/status')
      ? json(status({ ok: true, label: 'IA locale du serveur Magistra' }))
      : json({ profile: null })));
    const getToken = async () => 'code-personnel-1234567890';
    await new ApiDataStore(getToken, 'personal', 'personal').getProfile();
    await new ApiGenerationClient(getToken, 'personal').capabilities();
    expect(calls.map(c => c.auth)).toEqual(['Bearer code-personnel-1234567890', 'Bearer code-personnel-1234567890']);
  });

  it('401 : message du mode personnel (code d’accès), pas « session expirée »', async () => {
    recordFetch(() => json({ error: { code: 'UNAUTHENTICATED', message: 'Session expirée : reconnectez-vous.', retryable: false } }, 401));
    const getToken = async () => 'code-personnel-1234567890';
    await expect(new ApiDataStore(getToken, 'personal', 'personal').getProfile())
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED', message: PERSONAL_UNAUTHENTICATED_MESSAGE });
    const events: GenerationEvent[] = [];
    await new ApiGenerationClient(getToken, 'personal').generate({} as never, e => events.push(e), new AbortController().signal);
    expect(events).toEqual([{ type: 'error', code: 'UNAUTHENTICATED', message: PERSONAL_UNAUTHENTICATED_MESSAGE, retryable: false }]);
  });

  it('site web : le 401 garde le message habituel', async () => {
    recordFetch(() => json({ error: { code: 'UNAUTHENTICATED', message: 'Session expirée : reconnectez-vous.', retryable: false } }, 401));
    await expect(new ApiDataStore(async () => 'jeton', 'user_1').getProfile())
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED', message: 'Session expirée : reconnectez-vous.' });
  });

  it('sans code : aucune requête envoyée', async () => {
    const calls = recordFetch(() => json({}));
    await expect(new ApiGenerationClient(async () => null, 'personal').capabilities())
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED', message: PERSONAL_UNAUTHENTICATED_MESSAGE });
    expect(calls).toHaveLength(0);
  });
});
