// Faux serveur d'IA pour les tests du serveur : API compatible OpenAI (/v1/models, /v1/chat/completions en SSE),
// API native d'Ollama (/api/version, /api/tags, /api/ps, /api/show, /api/chat en NDJSON) et API de LM Studio
// (/api/v0/models). Chaque partie ne répond que si elle est configurée (sinon 404).

import type { IncomingMessage, ServerResponse } from 'node:http';
import { listen } from './helpers.js';

export interface FakeRequest {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: string;
}

export interface FakeAIOptions {
  /** API compatible OpenAI : identifiants de /v1/models (absent = pas d'API OpenAI). */
  openaiModels?: { id: string; max_model_len?: number; aliases?: string[] }[];
  /** API native d'Ollama (absent = pas d'Ollama). */
  ollama?: {
    version: string; models: string[]; loaded?: string[]; contextLength?: number;
    /** Modèles relayés vers un autre hôte (champ remote_host de /api/tags, comme « ollama pull …-cloud »). */
    remote?: Record<string, string>;
  };
  /** API REST de LM Studio (/api/v0/models). */
  lmStudio?: { id: string; type: string; state: string; max_context_length?: number }[];
  /** Texte produit par les deux API de conversation. */
  reply?: string;
  /** Clé exigée (« Authorization: Bearer … ») : 401 sinon. */
  requireKey?: string;
  /** Statut forcé par chemin (« /v1/models » → 404…). */
  statusFor?: Record<string, number>;
  /** Attente avant la réponse, par chemin (ms). */
  delayFor?: Record<string, number>;
}

export interface FakeAI {
  url: string;
  requests: FakeRequest[];
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', c => (body += c));
    req.on('end', () => resolve(body));
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function startFakeAI(options: FakeAIOptions): Promise<FakeAI> {
  const requests: FakeRequest[] = [];
  const reply = options.reply ?? 'Bonjour';
  const server = await listen((req, res) => {
    void (async () => {
      const path = (req.url ?? '/').split('?')[0];
      const body = await readBody(req);
      requests.push({ method: req.method ?? 'GET', path, headers: req.headers, body });
      const delay = options.delayFor?.[path];
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (options.requireKey && req.headers.authorization !== `Bearer ${options.requireKey}`) {
        sendJson(res, 401, { error: { message: 'Invalid API key', type: 'invalid_request_error' } });
        return;
      }
      const forced = options.statusFor?.[path];
      if (forced) {
        sendJson(res, forced, { error: { message: `statut ${forced}` } });
        return;
      }
      const o = options.ollama;
      if (path === '/v1/models' && options.openaiModels) {
        sendJson(res, 200, { object: 'list', data: options.openaiModels.map(m => ({ object: 'model', ...m })) });
      } else if (path === '/v1/chat/completions' && options.openaiModels) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const piece of reply.match(/.{1,4}/gs) ?? []) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece }, finish_reason: null }] })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
        res.end('data: [DONE]\n\n');
      } else if (path === '/api/version' && o) {
        sendJson(res, 200, { version: o.version });
      } else if (path === '/api/tags' && o) {
        sendJson(res, 200, {
          models: o.models.map(name => ({
            name, model: name, size: 1_000, details: { family: 'mistral3' },
            ...(o.remote?.[name] ? { remote_host: o.remote[name], remote_model: name } : {}),
          })),
        });
      } else if (path === '/api/ps' && o) {
        sendJson(res, 200, { models: (o.loaded ?? []).map(name => ({ name, model: name })) });
      } else if (path === '/api/show' && o) {
        sendJson(res, 200, { model_info: { 'mistral3.context_length': o.contextLength ?? 262_144 } });
      } else if (path === '/api/chat' && o) {
        const parsed = JSON.parse(body || '{}') as { model?: string; messages?: unknown[] };
        if (!o.models.includes(parsed.model ?? '')) {
          sendJson(res, 404, { error: `model '${parsed.model}' not found` });
          return;
        }
        if (!parsed.messages?.length) {
          sendJson(res, 200, { model: parsed.model, done: true, done_reason: 'load' });
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        for (const piece of reply.match(/.{1,4}/gs) ?? []) res.write(`${JSON.stringify({ message: { role: 'assistant', content: piece }, done: false })}\n`);
        res.end(`${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 12, eval_count: 3 })}\n`);
      } else if (path === '/api/v0/models' && options.lmStudio) {
        sendJson(res, 200, { object: 'list', data: options.lmStudio.map(m => ({ object: 'model', ...m })) });
      } else {
        sendJson(res, 404, { error: 'not found' });
      }
    })();
  });
  return { url: server.url, requests, close: server.close };
}

/** Adresse d'un port fermé (pour simuler « rien n'écoute ici »). */
export async function closedPortUrl(): Promise<string> {
  const server = await listen((_req, res) => res.end());
  await server.close();
  return server.url;
}
