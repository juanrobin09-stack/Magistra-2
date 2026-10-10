import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PERSONAL_PROVIDERS } from '../../shared/ai/personalProviders';
import { makeManager } from './fakeOllama';
import { sanitizeAIConfigUpdate } from '../../electron/validate';
import { jsonResponse, mockFetch, sseChunk, streamBody, streamResponse } from '../shared/helpers';

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'magistra-personal-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe.each(PERSONAL_PROVIDERS)('$label dans le processus principal', preset => {
  it('génère sans Ollama, garde la clé chiffrée et annonce le fournisseur qui reçoit les documents', async () => {
    const fetch = mockFetch(url => {
      if (url.endsWith('/models')) return jsonResponse({ data: [{ id: preset.model }] });
      const sse = preset.kind === 'anthropic'
        ? [{ type: 'message_start' }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Cours 日本語' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }].map(e => `data: ${JSON.stringify(e)}\n\n`).join('')
        : sseChunk('Cours 日本語', 'stop') + 'data: [DONE]\n\n';
      return streamResponse(streamBody([sse]));
    });
    const { manager, config, spawned } = await makeManager(dir, { ollama: { running: false, models: [], pullRequests: [] }, netFetch: fetch });
    const status = await manager.setConfig(sanitizeAIConfigUpdate({ mode: 'remote', remote: { ...preset, apiKey: 'test-key-never-plaintext' } }));
    expect(status.ready).toBe(true);
    expect(status.config.remote?.hasApiKey).toBe(true);
    expect(JSON.stringify(status)).not.toContain('test-key-never-plaintext');
    expect(readFileSync(config.file, 'utf8')).not.toContain('test-key-never-plaintext');
    const description = await manager.describeActive();
    expect(description.privacy.level).toBe('remote');
    expect(description.providerInfo?.label).toBe(preset.label);
    const provider = await manager.resolveProvider();
    expect(await provider.generate({ messages: [{ role: 'user', content: 'Document choisi' }], maxTokens: 300 })).toMatchObject({ text: 'Cours 日本語', finishReason: 'stop' });
    const request = fetch.calls.at(-1)!;
    expect(request.url).toBe(`${preset.baseUrl}/${preset.kind === 'anthropic' ? 'messages' : 'chat/completions'}`);
    expect(request.init?.redirect).toBe('manual');
    expect(spawned).toEqual([]);
    expect((await manager.setConfig({ mode: 'local' })).config.remote?.hasApiKey).toBe(true);
    expect((await manager.setConfig({ mode: 'local', remote: null })).config.remote).toBeUndefined();
    expect(config.getApiKey()).toBeUndefined();
  });

  it('refuse les redirections avant de transmettre une clé ailleurs', async () => {
    const fetch = mockFetch(() => new Response('', { status: 302, headers: { Location: 'http://other.example/' } }));
    const { manager } = await makeManager(dir, { ollama: { running: false, models: [], pullRequests: [] }, netFetch: fetch });
    expect((await manager.setConfig({ mode: 'remote', remote: { ...preset, apiKey: 'test-key' } })).ready).toBe(false);
    const providerCalls = fetch.calls.filter(c => c.url.startsWith(preset.baseUrl));
    expect(providerCalls).toHaveLength(1);
    expect(providerCalls[0].init?.redirect).toBe('manual');
  });
});
