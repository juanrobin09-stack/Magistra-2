import { MagistraError } from '../errors.js';
import { mapHttpError, mapNetworkError, unavailableError, type HttpErrorContext } from './errorMapping.js';
import { OpenAICompatibleProvider, toFinishReason, type OpenAICompatibleConfig } from './openaiCompatible.js';
import { addressKind } from './presets.js';
import { collectStream, type AIProvider, type ChatOptions, type FetchLike, type GenerateResult, type StreamEvent, type Usage } from './provider.js';
import { errorDetailFromBody, fetchWithTimeout, isNetworkError, linkSignals, readErrorDetail, readLines, readSSE, safeJsonParse, trimSlash } from './streams.js';

interface ClaudeEvent {
  type?: string;
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  delta?: { type?: string; text?: string; stop_reason?: string };
  content_block?: { type?: string; text?: string };
  usage?: { output_tokens?: number };
}

/** API Messages native : les consignes système sont séparées et seul le texte final est transmis à la pipeline. */
export class AnthropicProvider implements AIProvider {
  readonly kind = 'anthropic' as const;
  readonly local = false;
  readonly model: string;
  readonly label: string;
  readonly contextTokens: number;
  private readonly config: OpenAICompatibleConfig;
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly catalogue: OpenAICompatibleProvider;

  constructor(config: OpenAICompatibleConfig) {
    if (!config.baseUrl || !config.model) throw new MagistraError('AI_NOT_CONFIGURED');
    this.config = config;
    this.baseUrl = trimSlash(config.baseUrl);
    this.model = config.model;
    this.label = config.label || 'Anthropic (Claude)';
    this.contextTokens = config.contextTokens ?? 32_768;
    this.fetchImpl = config.fetch ?? ((input, init) => fetch(input, init));
    // GET /models utilise le même schéma { data: [{ id }] }, mais des en-têtes Anthropic.
    this.catalogue = new OpenAICompatibleProvider({ ...config, label: this.label, fetch: (url, init) => this.fetchImpl(url, { ...init, headers: this.headers() }) });
  }

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', ...(this.config.apiKey ? { 'x-api-key': this.config.apiKey } : {}) };
  }

  private get ctx(): HttpErrorContext {
    return { label: this.label, model: this.model, local: false, recipient: this.config.recipient, addressKind: addressKind(this.baseUrl), timeZone: this.config.timeZone, now: this.config.now };
  }

  health(signal?: AbortSignal) { return this.catalogue.health(signal); }
  listModels(signal?: AbortSignal) { return this.catalogue.listModels(signal); }
  generate(options: ChatOptions): Promise<GenerateResult> { return collectStream(this, options); }

  async *stream(options: ChatOptions): AsyncIterable<StreamEvent> {
    const { controller, dispose } = linkSignals(options.signal);
    const timeouts = { firstChunkMs: 180_000, idleMs: 90_000, ...this.config.timeouts };
    try {
      const system = options.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
      const res = await fetchWithTimeout(this.fetchImpl, `${this.baseUrl}/messages`, {
        method: 'POST', headers: this.headers(), body: JSON.stringify({
          model: this.model, stream: true, max_tokens: options.maxTokens ?? 4096,
          messages: options.messages.filter(m => m.role !== 'system'), ...(system ? { system } : {}),
          // Les modèles récents de Claude refusent temperature != 1 : conserver leur valeur par défaut.
        }),
      }, controller, timeouts.firstChunkMs);
      if (!res.ok) {
        const detail = await readErrorDetail(res);
        const status = res.status === 529 ? 429 : res.status === 400 && /credit balance|billing|insufficient credits/i.test(detail.message) ? 402 : res.status;
        throw mapHttpError(status, detail, this.ctx);
      }
      if (!res.body) throw new MagistraError('AI_BAD_RESPONSE');
      let finishReason: StreamEvent & { type: 'end' } = { type: 'end', finishReason: 'unknown' };
      const usage: Usage = {};
      let stopped = false;
      let sawStart = false;
      for await (const payload of readSSE(readLines(res.body, controller, timeouts, options.signal))) {
        const event = safeJsonParse(payload) as ClaudeEvent | undefined;
        if (!event || typeof event !== 'object') continue;
        if (event.type === 'error') {
          const detail = errorDetailFromBody(event, '');
          const overloaded = detail.codes.includes('overloaded_error');
          throw mapHttpError(overloaded ? 429 : 500, detail, this.ctx);
        }
        if (event.type === 'message_start') {
          sawStart = true;
          usage.promptTokens = event.message?.usage?.input_tokens;
          usage.completionTokens = event.message?.usage?.output_tokens;
        } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && typeof event.delta.text === 'string') {
          yield { type: 'delta', text: event.delta.text };
        } else if (event.type === 'content_block_start' && event.content_block?.type === 'text' && event.content_block.text) {
          yield { type: 'delta', text: event.content_block.text };
        } else if (event.type === 'message_delta') {
          finishReason = { type: 'end', finishReason: toFinishReason(event.delta?.stop_reason) ?? 'unknown' };
          if (typeof event.usage?.output_tokens === 'number') usage.completionTokens = event.usage.output_tokens;
        } else if (event.type === 'message_stop') {
          stopped = true;
          break;
        }
      }
      if (options.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
      if (!sawStart) throw new MagistraError('AI_BAD_RESPONSE');
      yield { ...finishReason, finishReason: stopped ? finishReason.finishReason : 'unknown', usage };
    } catch (err) {
      if (options.signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
      if (err instanceof MagistraError) throw err;
      if (isNetworkError(err)) throw mapNetworkError(err, this.ctx);
      throw unavailableError(this.ctx, err);
    } finally {
      dispose();
      controller.abort();
    }
  }
}
