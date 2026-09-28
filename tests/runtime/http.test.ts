import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerationEvent } from '@shared/types';
import { authedJson, NOT_A_STREAM_MESSAGE, readEventStream } from '@/lib/runtime/http';

function stream(text: string, type = 'application/x-ndjson; charset=utf-8', status = 200): Response {
  return new Response(text, { status, headers: { 'content-type': type } });
}

async function collect(res: Response, signal = new AbortController().signal) {
  const events: GenerationEvent[] = [];
  let error: unknown = null;
  try {
    await readEventStream(res, e => events.push(e), signal);
  } catch (err) {
    error = err;
  }
  return { events, error: error as { code?: string; message?: string; retryable?: boolean } | null };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readEventStream', () => {
  it('flux NDJSON valide : évènements transmis dans l’ordre', async () => {
    const lines = [
      { type: 'status', stage: 'generating', message: 'Rédaction…' },
      { type: 'delta', text: 'Bonjour' },
      { type: 'done', content: 'Bonjour', sources: [], truncated: false, internetUsed: false, saved: true, id: 'a', model: 'm' },
    ];
    const { events, error } = await collect(stream(lines.map(l => JSON.stringify(l)).join('\n')));
    expect(error).toBeNull();
    expect(events.map(e => e.type)).toEqual(['status', 'delta', 'done']);
  });

  it('page HTML servie en 200 (réécriture SPA de /api) : « service inaccessible », pas « connexion interrompue »', async () => {
    const { events, error } = await collect(stream('<!doctype html><html><body>Magistra</body></html>', 'text/html'));
    expect(events).toEqual([]);
    expect(error).toMatchObject({ code: 'SERVER_MISCONFIGURED', message: NOT_A_STREAM_MESSAGE, retryable: false });
  });

  it('JSON sans évènements reconnus, même annoncé en NDJSON : « service inaccessible »', async () => {
    const { error } = await collect(stream('{"hello":"world"}\n{"type":"inconnu"}'));
    expect(error).toMatchObject({ code: 'SERVER_MISCONFIGURED' });
  });

  it('flux coupé après quelques évènements : erreur réseau réessayable', async () => {
    const { events } = await collect(stream(JSON.stringify({ type: 'delta', text: 'Début' })));
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'NETWORK_ERROR', retryable: true });
  });
});

describe('erreurs HTTP', () => {
  it('502 / 503 non JSON : service momentanément indisponible, réessayable (pas « mal configuré »)', async () => {
    for (const status of [502, 503]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad gateway</html>', { status, headers: { 'content-type': 'text/html' } })));
      await expect(authedJson(async () => 'jeton', '/api/status')).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
    }
  });

  it('erreur JSON du serveur : code et message du serveur conservés', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'RATE_LIMITED', message: 'Trop de demandes.' } }, { status: 429 })));
    await expect(authedJson(async () => 'jeton', '/api/generate')).rejects.toMatchObject({ code: 'RATE_LIMITED', message: 'Trop de demandes.' });
  });
});
