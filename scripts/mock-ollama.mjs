#!/usr/bin/env node
// Faux serveur Ollama (API native) pour les tests automatiques et la validation de l'application.
// Formats calqués sur Ollama v0.34.4 (server/routes.go, server/images.go, llm/llama_server.go).
//
//   GET  /api/version   → { version } (par défaut une version récente ; --version 0.12.0 simule un moteur trop ancien)
//   GET  /api/tags      → modèles « installés » (noms tels quels : « ministral-3:latest » est un alias du 8B)
//   POST /api/show      → détails d'un modèle (404 s'il est absent)
//   POST /api/pull      → flux NDJSON de progression réaliste, avec REPRISE après interruption ; moteur trop ancien
//                         pour les modèles Magistra (ou --pull-412) → ligne { error: "pull model manifest: 412: …" }
//   POST /api/chat      → messages [] : { done: true, done_reason: "load" } (préchargement, JSON unique) ;
//                         sinon flux NDJSON d'un texte Markdown plausible, citant [S1]… si des sources sont fournies.
//                         « think: false » est accepté (ignoré) ; « think: true » → 400 (ministral ne « réfléchit » pas).
//
// Usage : node scripts/mock-ollama.mjs [--port 11434] [--models ministral-3:14b,ministral-3:8b] [--version 0.12.0]
//         [--missing-model] [--oom] [--oom-format legacy|llama-server|gpu] [--unknown-pull] [--pull-412]
//         [--pull-ms 3000] [--chat-delay-ms 15] [--load-ms 0]
// En module : const server = await startMockOllama({ port: 0 }); … await server.close();
// server.state.chats : corps des /api/chat reçus (modèle, think, nombre de messages…), pour les vérifications.

import http from 'node:http';
import { isMainModule } from './mainModule.mjs';

/** Version annoncée par défaut : récente (≥ 0.13.1, minimum des modèles Magistra). */
export const MOCK_DEFAULT_VERSION = '0.34.4-mock';
/** Version minimale exigée par le « registre » pour les modèles Mistral 3 (comme la bibliothèque Ollama). */
const REGISTRY_MIN_VERSION = [0, 13, 1];

const KNOWN_SIZES = {
  'ministral-3:8b': 6_000_000_000,
  'ministral-3:latest': 6_000_000_000,
  'ministral-3:8b-instruct-2512-q4_k_m': 6_000_000_000,
  'ministral-3:14b': 9_100_000_000,
  'ministral-3:14b-instruct-2512-q4_k_m': 9_100_000_000,
  'mistral-small3.2:24b': 15_000_000_000,
  'mistral-small3.2:latest': 15_000_000_000,
  'mistral-small3.2:24b-instruct-2506-q4_k_m': 15_000_000_000,
};

/** Erreurs mémoire au format du moteur (Ollama v0.34 : llama-server, ordonnanceur ; anciennes versions). */
const OOM_MESSAGES = {
  legacy: 'model requires more system memory (12.3 GiB) than is available (4.1 GiB)',
  'llama-server': 'llama-server reported out-of-memory during startup: cudaMalloc failed: out of memory',
  gpu: 'unable to load full model on GPU',
};

const PULL_412 =
  'pull model manifest: 412: The model you are attempting to pull requires a newer version of Ollama. Please download the latest version at: https://ollama.com/download';

const REPLY = [
  '# Cours : {sujet}\n\n',
  '## Introduction\n\n',
  'Ce cours présente les notions essentielles{citation}. ',
  'Il s’appuie sur les documents fournis et propose une progression claire.\n\n',
  '## 1. Notions clés\n\n',
  '- **Définition** : le phénomène étudié repose sur des mécanismes identifiables{citation}.\n',
  '- **Exemple** : une situation concrète permet de l’illustrer.\n\n',
  '| Étape | Durée | Activité |\n|---|---|---|\n| 1 | 15 min | Mise en situation |\n| 2 | 30 min | Apports théoriques |\n\n',
  '## 2. Pour aller plus loin\n\n',
  'Les étudiants approfondiront ces points en travaux dirigés.\n',
];

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 5_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const norm = name => (name.includes(':') ? name : `${name}:latest`).toLowerCase();

/** Vrai si `version` (« 0.12.0 », « 0.34.4-mock ») est inférieure au minimum du registre ; faux si illisible. */
function olderThanRegistryMin(version) {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(version ?? ''));
  if (!m) return false;
  const v = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  if (v.every(n => n === 0)) return false;
  for (let i = 0; i < 3; i++) if (v[i] !== REGISTRY_MIN_VERSION[i]) return v[i] < REGISTRY_MIN_VERSION[i];
  return false;
}

/** Modèles Mistral 3 de la bibliothèque (ceux qui exigent Ollama 0.13.1). */
const needsRecentEngine = name => /^(ministral-3|mistral-small3\.2)[:]/.test(name);

/**
 * Démarre le faux serveur. Les options (erreurs, délais, version) sont relues à chaque requête : les modifier
 * sur l'objet passé change le comportement du serveur en cours de route.
 * @param {{ port?: number, host?: string, models?: string[], missingModel?: boolean, oom?: boolean,
 *   oomFormat?: 'legacy' | 'llama-server' | 'gpu', unknownPull?: boolean, pull412?: boolean, pullMs?: number,
 *   chatDelayMs?: number, loadMs?: number, version?: string }} [options]
 */
export async function startMockOllama(options = {}) {
  const state = {
    models: new Set((options.models ?? ['ministral-3:14b']).map(norm)),
    /** Progression conservée des téléchargements interrompus (reprise). */
    partial: new Map(),
    requests: [],
    /** Corps utiles des /api/chat reçus : { model, think, messages (nombre), stream, keepAlive, numCtx }. */
    chats: [],
  };
  // Options relues à chaque requête : un test peut les modifier pendant que le serveur tourne.
  const pullMsNow = () => options.pullMs ?? 2_000;
  const chatDelayMsNow = () => options.chatDelayMs ?? 15;
  const versionNow = () => options.version ?? MOCK_DEFAULT_VERSION;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    state.requests.push(`${req.method} ${url.pathname}`);
    try {
      if (req.method === 'GET' && url.pathname === '/api/version') return json(res, 200, { version: versionNow() });

      if (req.method === 'GET' && url.pathname === '/api/tags') {
        return json(res, 200, {
          models: [...state.models].map(name => ({
            name,
            model: name,
            size: KNOWN_SIZES[name] ?? 4_000_000_000,
            details: { family: 'mistral', parameter_size: name.split(':')[1]?.toUpperCase() ?? '8B' },
          })),
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/show') {
        const body = await readBody(req);
        const name = norm(String(body.model ?? body.name ?? ''));
        if (!state.models.has(name)) return json(res, 404, { error: `model '${name}' not found` });
        return json(res, 200, { details: { family: 'mistral' }, model_info: { 'general.context_length': 32768 } });
      }

      if (req.method === 'POST' && url.pathname === '/api/pull') {
        const body = await readBody(req);
        const name = norm(String(body.model ?? body.name ?? ''));
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        const send = obj => res.write(`${JSON.stringify(obj)}\n`);
        send({ status: 'pulling manifest' });
        if (options.unknownPull || !(name in KNOWN_SIZES || name.startsWith('test'))) {
          send({ error: 'pull model manifest: file does not exist' });
          return res.end();
        }
        // Registre : un Ollama trop ancien pour ce modèle reçoit 412 (en ligne NDJSON, après « pulling manifest »).
        if (options.pull412 || (needsRecentEngine(name) && olderThanRegistryMin(versionNow()))) {
          send({ error: PULL_412 });
          return res.end();
        }
        const total = KNOWN_SIZES[name] ?? 1_000_000_000;
        const layers = [
          { digest: 'sha256:aaaa1111', total: Math.round(total * 0.98) },
          { digest: 'sha256:bbbb2222', total: 12_000 },
          { digest: 'sha256:cccc3333', total: Math.round(total * 0.02) - 12_000 },
        ];
        const done = state.partial.get(name) ?? {};
        let closed = false;
        req.on('close', () => {
          closed = true;
        });
        res.on('close', () => {
          closed = true;
        });
        const steps = 10;
        const pullMs = pullMsNow();
        for (const layer of layers) {
          let completed = done[layer.digest] ?? 0;
          send({ status: `pulling ${layer.digest.slice(7, 19)}`, digest: layer.digest, total: layer.total, completed });
          while (completed < layer.total) {
            if (closed) {
              state.partial.set(name, done);
              return;
            }
            await sleep(pullMs / (steps * layers.length));
            completed = Math.min(layer.total, completed + Math.ceil(layer.total / steps));
            done[layer.digest] = completed;
            send({ status: `pulling ${layer.digest.slice(7, 19)}`, digest: layer.digest, total: layer.total, completed });
          }
        }
        state.partial.delete(name);
        send({ status: 'verifying sha256 digest' });
        send({ status: 'writing manifest' });
        send({ status: 'success' });
        state.models.add(name);
        return res.end();
      }

      if (req.method === 'POST' && url.pathname === '/api/chat') {
        const body = await readBody(req);
        const name = norm(String(body.model ?? ''));
        const messages = Array.isArray(body.messages) ? body.messages : [];
        state.chats.push({
          model: String(body.model ?? ''),
          think: body.think,
          messages: messages.length,
          stream: body.stream,
          keepAlive: body.keep_alive,
          numCtx: body.options?.num_ctx,
        });
        if (options.missingModel || !state.models.has(name)) {
          return json(res, 404, { error: `model '${body.model}' not found, try pulling it first` });
        }
        // Ministral 3 n'a pas la capacité « thinking » : think=true est refusé, think=false (ou absent) accepté.
        if (body.think === true) return json(res, 400, { error: `"${body.model}" does not support thinking` });
        if (options.oom || options.oomFormat) {
          return json(res, 500, { error: OOM_MESSAGES[options.oomFormat ?? 'legacy'] ?? OOM_MESSAGES.legacy });
        }
        if (options.loadMs) await sleep(options.loadMs);
        // Préchargement : aucun message → le modèle est chargé, réponse JSON unique (pas de flux), comme Ollama.
        if (messages.length === 0) {
          return json(res, 200, {
            model: body.model,
            created_at: new Date().toISOString(),
            message: { role: 'assistant', content: '' },
            done: true,
            done_reason: 'load',
          });
        }
        const user = String(messages.filter(m => m.role === 'user').at(-1)?.content ?? '');
        const cited = [...new Set([...user.matchAll(/\[S(\d{1,3})\]/g)].map(m => Number(m[1])))].filter(n => n > 0).sort((a, b) => a - b);
        const sujet = /- Sujet : (.+)/.exec(user)?.[1]?.trim() ?? 'Notions fondamentales';
        let i = 0;
        const text = REPLY.join('')
          .replace('{sujet}', sujet)
          .replace(/\{citation\}/g, () => (cited.length ? ` [S${cited[i++ % cited.length]}]` : ''));
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        let aborted = false;
        res.on('close', () => {
          aborted = true;
        });
        const tokens = text.match(/[\s\S]{1,12}/g) ?? [];
        for (const token of tokens) {
          if (aborted) return;
          res.write(`${JSON.stringify({ model: body.model, message: { role: 'assistant', content: token }, done: false })}\n`);
          const chatDelayMs = chatDelayMsNow();
          if (chatDelayMs) await sleep(chatDelayMs);
        }
        res.write(`${JSON.stringify({ model: body.model, message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: Math.ceil(user.length / 3.2), eval_count: tokens.length })}\n`);
        return res.end();
      }

      return json(res, 404, { error: 'not found' });
    } catch (err) {
      if (!res.headersSent) json(res, 400, { error: String(err?.message ?? err) });
      else res.end();
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 11434, options.host ?? '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    state,
    close: () =>
      new Promise(resolve => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--port') opts.port = Number(next());
    else if (arg === '--models') opts.models = next().split(',').map(s => s.trim()).filter(Boolean);
    else if (arg === '--no-models') opts.models = [];
    else if (arg === '--version') opts.version = next();
    else if (arg === '--missing-model') opts.missingModel = true;
    else if (arg === '--oom') opts.oom = true;
    else if (arg === '--oom-format') opts.oomFormat = next();
    else if (arg === '--unknown-pull') opts.unknownPull = true;
    else if (arg === '--pull-412') opts.pull412 = true;
    else if (arg === '--pull-ms') opts.pullMs = Number(next());
    else if (arg === '--chat-delay-ms') opts.chatDelayMs = Number(next());
    else if (arg === '--load-ms') opts.loadMs = Number(next());
  }
  return opts;
}

if (isMainModule(import.meta.url)) {
  const server = await startMockOllama(parseArgs(process.argv.slice(2)));
  // Première ligne lisible par les scripts de test : l'adresse effective (utile avec --port 0).
  console.log(`MOCK_OLLAMA_URL ${server.url}`);
  const stop = () => server.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
