// Simulation réseau uniquement pour Playwright. Aucun appel réel aux API payantes, même au redémarrage.
'use strict';
const { net } = require('electron');
const original = net.fetch.bind(net);
const endpoints = new Set(['api.openai.com', 'api.mistral.ai', 'generativelanguage.googleapis.com', 'api.anthropic.com']);
globalThis.__personalAPIRequests = [];
const text = '# Cours API : les fractions\n\n## Introduction\n\nCe cours présente les notions essentielles et propose une progression claire.\n\n## 1. Notions clés\n\nUne fraction représente une partie d’un tout. Le numérateur indique le nombre de parts choisies ; le dénominateur indique le nombre total de parts égales.\n\n- **Définition** : une fraction est le quotient de deux nombres.\n- **Exemple** : deux parts sur quatre s’écrivent 2/4, soit une moitié.\n\n| Étape | Durée | Activité |\n|---|---|---|\n| 1 | 15 min | Mise en situation |\n| 2 | 30 min | Apports théoriques |\n\n## 2. Pour aller plus loin\n\nLes étudiants approfondiront ces points en travaux dirigés.\n';
const sse = body => `data: ${JSON.stringify(body)}\n\n`;
net.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (!endpoints.has(url.hostname)) return original(input, init);
  const headers = new Headers(init.headers);
  const authenticated = headers.get('x-api-key') === 'e2e-test-personal-key' || headers.get('authorization') === 'Bearer e2e-test-personal-key';
  globalThis.__personalAPIRequests.push({ host: url.hostname, path: url.pathname, method: init.method || 'GET', authenticated, redirect: init.redirect });
  if (!authenticated) return Response.json({ error: { type: 'authentication_error', message: 'API key refused' } }, { status: 401 });
  if (url.pathname.endsWith('/models')) return Response.json({ data: ['gpt-4.1-mini', 'mistral-small-latest', 'gemini-3.8-flash', 'claude-sonnet-5-5'].map(id => ({ id })) });
  const native = url.hostname === 'api.anthropic.com';
  const body = native
    ? sse({ type: 'message_start', message: { usage: { input_tokens: 100 } } }) + sse({ type: 'content_block_delta', delta: { type: 'text_delta', text } }) + sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 150 } }) + sse({ type: 'message_stop' })
    : sse({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n';
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
};
