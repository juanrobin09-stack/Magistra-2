import { describe, expect, it } from 'vitest';
import { AnthropicProvider } from '../../shared/ai/anthropic';
import { collect, jsonResponse, mockFetch, never, splitBytes, streamBody, streamResponse } from './helpers';

const MESSAGES = [{ role: 'system' as const, content: 'Enseigne en français.' }, { role: 'user' as const, content: '日本語' }];
const event = (body: object) => `data: ${JSON.stringify(body)}\n\n`;
const start = event({ type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 1 } } });
const delta = event({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Français 日本語' } });
const finish = event({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } });
const stop = event({ type: 'message_stop' });

function provider(fetch: ReturnType<typeof mockFetch>, extra = {}) {
  return new AnthropicProvider({ baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5', apiKey: 'test-private-key', fetch, ...extra });
}

describe('Anthropic Messages', () => {
  it('sépare system, utilise x-api-key et reconstitue les caractères Unicode dans un flux fragmenté', async () => {
    const fetch = mockFetch(() => streamResponse(streamBody(splitBytes(start + delta + finish + stop, 3))));
    expect(await provider(fetch).generate({ messages: MESSAGES, maxTokens: 1000, temperature: 0.4 })).toEqual({
      text: 'Français 日本語', model: 'claude-sonnet-5-5', finishReason: 'stop', usage: { promptTokens: 12, completionTokens: 8 },
    });
    expect(fetch.calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(fetch.calls[0].body).toEqual({ model: 'claude-sonnet-5-5', system: 'Enseigne en français.', messages: [MESSAGES[1]], stream: true, max_tokens: 1000 });
    const headers = new Headers(fetch.calls[0].init?.headers);
    expect(headers.get('x-api-key')).toBe('test-private-key');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
    expect(headers.has('authorization')).toBe(false);
  });

  it('ignore thinking et ping, conserve la troncature et ne valide pas un flux coupé', async () => {
    const hidden = event({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'raisonnement privé' } });
    const limited = event({ type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 1000 } });
    const fetch = mockFetch(() => streamResponse(streamBody([start + hidden + event({ type: 'ping' }) + delta + limited + stop])));
    expect(await provider(fetch).generate({ messages: MESSAGES })).toMatchObject({ text: 'Français 日本語', finishReason: 'length' });
    const cut = mockFetch(() => streamResponse(streamBody([start + delta + finish])));
    expect(await provider(cut).generate({ messages: MESSAGES })).toMatchObject({ finishReason: 'unknown' });
  });

  it('vérifie la clé sans génération et traduit son refus sans recopier des secrets', async () => {
    const fetch = mockFetch(() => jsonResponse({ data: [{ id: 'claude-sonnet-5-5' }] }));
    expect(await provider(fetch).health()).toEqual({ ok: true });
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0].url).toBe('https://api.anthropic.com/v1/models');
    expect(fetch.calls[0].init?.method).toBeUndefined();
    const denied = mockFetch(() => jsonResponse({ error: { type: 'authentication_error', message: 'test-private-key' } }, 401));
    const health = await provider(denied).health();
    expect(health).toMatchObject({ ok: false, error: { code: 'AI_AUTH_FAILED' } });
    expect(JSON.stringify(health)).not.toContain('test-private-key');
    await expect(provider(denied).generate({ messages: MESSAGES })).rejects.toMatchObject({ code: 'AI_AUTH_FAILED' });
  });

  it('traduit une erreur SSE et refuse une réponse qui ne contient aucun message', async () => {
    const fetch = mockFetch(() => streamResponse(streamBody([start + event({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } })])));
    await expect(provider(fetch).generate({ messages: MESSAGES })).rejects.toMatchObject({ code: 'AI_BUSY' });
    const malformed = mockFetch(() => streamResponse(streamBody(['data: invalid\n\n'])));
    await expect(provider(malformed).generate({ messages: MESSAGES })).rejects.toMatchObject({ code: 'AI_BAD_RESPONSE' });
  });

  it('annonce les crédits épuisés (400) et la surcharge temporaire (529)', async () => {
    const empty = mockFetch(() => jsonResponse({ error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } }, 400));
    await expect(provider(empty).generate({ messages: MESSAGES })).rejects.toMatchObject({ code: 'AI_QUOTA_EXCEEDED' });
    const overloaded = mockFetch(() => jsonResponse({ error: { type: 'overloaded_error' } }, 529));
    await expect(provider(overloaded).generate({ messages: MESSAGES })).rejects.toMatchObject({ code: 'AI_BUSY' });
  });

  it('respecte l’annulation et les délais, même si fetch ignore AbortSignal', async () => {
    const fetch = mockFetch(() => never<Response>());
    const controller = new AbortController();
    const running = collect(provider(fetch).stream({ messages: MESSAGES, signal: controller.signal }));
    controller.abort();
    await expect(running).rejects.toMatchObject({ code: 'GENERATION_ABORTED' });
    await expect(provider(fetch, { timeouts: { firstChunkMs: 15 } }).generate({ messages: MESSAGES })).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  });
});
