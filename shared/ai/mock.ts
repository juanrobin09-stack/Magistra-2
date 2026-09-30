// Fournisseur simulé, utilisé par les tests automatiques.

import { MagistraError } from '../errors.js';
import {
  collectStream, type AIProvider, type ChatMessage, type ChatOptions, type FinishReason, type GenerateResult,
  type HealthStatus, type ModelInfo, type StreamEvent,
} from './provider.js';

export interface MockProviderOptions {
  reply?: string | ((messages: ChatMessage[]) => string);
  chunkSize?: number;
  delayMs?: number;
  finishReason?: FinishReason;
  failWith?: MagistraError;
  /** Lève `failWith` après ce nombre de morceaux (panne en cours de génération). */
  failAfterChunks?: number;
  model?: string;
  local?: boolean;
  contextTokens?: number;
  /** État renvoyé par health() (ex. { ok: true, warning: { code: 'AI_STATUS_UNKNOWN', … } }), prioritaire sur failWith. */
  healthStatus?: HealthStatus;
}

export class MockProvider implements AIProvider {
  readonly kind = 'mock' as const;
  readonly model: string;
  readonly label = 'IA simulée';
  readonly local: boolean;
  readonly contextTokens: number;
  readonly calls: ChatOptions[] = [];
  private readonly opts: MockProviderOptions;

  constructor(opts: MockProviderOptions = {}) {
    this.opts = opts;
    this.model = opts.model ?? 'mock-model';
    this.local = opts.local ?? true;
    this.contextTokens = opts.contextTokens ?? 16_384;
  }

  async *stream(options: ChatOptions): AsyncIterable<StreamEvent> {
    this.calls.push(options);
    if (this.opts.failWith && this.opts.failAfterChunks === undefined) throw this.opts.failWith;
    const reply = typeof this.opts.reply === 'function'
      ? this.opts.reply(options.messages)
      : this.opts.reply ?? 'Contenu simulé.';
    const size = Math.max(1, this.opts.chunkSize ?? 16);
    let sent = 0;
    for (let i = 0; i < reply.length; i += size) {
      if (options.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
      if (this.opts.failWith && sent === this.opts.failAfterChunks) throw this.opts.failWith;
      if (this.opts.delayMs) await new Promise(r => setTimeout(r, this.opts.delayMs));
      yield { type: 'delta', text: reply.slice(i, i + size) };
      sent++;
    }
    if (this.opts.failWith) throw this.opts.failWith;
    if (options.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
    yield { type: 'end', finishReason: this.opts.finishReason ?? 'stop' };
  }

  generate(options: ChatOptions): Promise<GenerateResult> {
    return collectStream(this, options);
  }

  async health(): Promise<HealthStatus> {
    if (this.opts.healthStatus) return this.opts.healthStatus;
    return this.opts.failWith
      ? { ok: false, error: { code: this.opts.failWith.code, message: this.opts.failWith.message } }
      : { ok: true, version: 'mock' };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ name: this.model }];
  }
}
