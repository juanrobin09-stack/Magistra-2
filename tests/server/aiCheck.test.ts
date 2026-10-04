// npm run ai:check : diagnostic en français, clé jamais affichée, code de sortie ≠ 0 en cas d'échec.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FetchLike } from '../../shared/ai/provider.js';
import { parseCheckArgs, runAiCheck } from '../../server/aiCheck.js';
import { closedPortUrl, startFakeAI, type FakeAI } from './fakeAI.js';

let cwd: string;
const fakes: FakeAI[] = [];
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), 'magistra-aicheck-'));
});
afterEach(async () => {
  rmSync(cwd, { recursive: true, force: true });
  await Promise.all(fakes.splice(0).map(f => f.close()));
});

async function fakeAI(options: Parameters<typeof startFakeAI>[0]): Promise<FakeAI> {
  const f = await startFakeAI(options);
  fakes.push(f);
  return f;
}

interface CheckExtra {
  localAI?: { ollamaUrl: string; lmStudioUrl: string };
  /** Remplace le réseau (prestataires en ligne : aucun appel réel pendant les tests). */
  fetch?: FetchLike;
  projectRoot?: string;
}

async function check(argv: string[], env: Record<string, string>, extra: CheckExtra = {}) {
  const lines: string[] = [];
  const closed = await closedPortUrl();
  const code = await runAiCheck(argv, {
    env: { MAGISTRA_DATA_DIR: path.join(cwd, 'donnees'), ...env },
    cwd,
    out: line => lines.push(line),
    localAI: extra.localAI ?? { ollamaUrl: closed, lmStudioUrl: closed },
    probeTimeoutMs: 3_000,
    ...(extra.fetch ? { fetch: extra.fetch } : {}),
    ...(extra.projectRoot ? { projectRoot: extra.projectRoot } : {}),
  });
  return { code, text: lines.join('\n') };
}

/** Réseau coupé : toute requête échoue comme une connexion refusée (et est comptée). */
function offlineFetch(): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const f: FetchLike = async input => {
    calls.push(input);
    throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
  };
  return Object.assign(f, { calls });
}

describe('options', () => {
  it('lecture des options', () => {
    expect(parseCheckArgs([])).toEqual({ target: 'start', envFiles: [], generate: true, help: false });
    expect(parseCheckArgs(['--vercel', '--env-file', '.env.prod.local', '--no-generate'])).toEqual({ target: 'vercel', envFiles: ['.env.prod.local'], generate: false, help: false });
    expect(() => parseCheckArgs(['--dev', '--vercel'])).toThrow();
    expect(() => parseCheckArgs(['--env-file'])).toThrow();
    expect(() => parseCheckArgs(['--inconnue'])).toThrow('Option inconnue');
  });

  it('option invalide : code 2 et aide', async () => {
    const { code, text } = await check(['--pouet'], {});
    expect(code).toBe(2);
    expect(text).toContain('Usage : npm run ai:check');
  });
});

describe('diagnostic', () => {
  it('aucune configuration : message clair et code de sortie 1, aucun fichier créé', async () => {
    const { code, text } = await check(['--no-generate'], {});
    expect(code).toBe(1);
    expect(text).toContain('Aucune IA locale détectée');
    expect(text).toContain('AI_PRESET=ovhcloud');
    expect(text).toContain('Démonstration');
    expect(text).toMatch(/Résultat : \d+ problèmes? à corriger/);
  });

  it('serveur autonome en démonstration : le stockage n’est pas compté comme un second problème (non-régression)', async () => {
    // Constaté avec un vrai Ollama : « npm run ai:check » sans .env annonçait 2 problèmes, dont un « Supabase
    // manquant » trompeur ; le seul remède est HOST=127.0.0.1 (mode personnel), qui règle aussi le stockage.
    const ollama = await fakeAI({ ollama: { version: '0.34.4', models: ['ministral-3:8b'] } });
    const { code, text } = await check(['--no-generate'], {}, { localAI: { ollamaUrl: ollama.url, lmStudioUrl: await closedPortUrl() } });
    expect(code).toBe(1);
    expect(text).toContain('Démonstration');
    expect(text).not.toContain('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY manquants');
    expect(text).toContain('Sans objet en démonstration. En mode personnel (HOST=127.0.0.1)');
    expect(text).toContain('Magistra Léger');
    expect(text).toContain('Résultat : 1 problème à corriger.');
    // Avec HOST=127.0.0.1 : tout est prêt.
    const personal = await check(['--no-generate'], { HOST: '127.0.0.1' }, { localAI: { ollamaUrl: ollama.url, lmStudioUrl: await closedPortUrl() } });
    expect(personal.code).toBe(0);
    expect(personal.text).toContain('Résultat : tout est prêt.');
  });

  it('serveur compatible OpenAI joignable, modèle présent, génération d’essai annoncée ; clé jamais affichée', async () => {
    const ai = await fakeAI({ openaiModels: [{ id: 'mistral-small', max_model_len: 65_536 }], reply: 'Bonjour !', requireKey: 'cle-tres-secrete' });
    const { code, text } = await check([], {
      HOST: '127.0.0.1', AI_BASE_URL: `${ai.url}/v1`, AI_MODEL: 'mistral-small', AI_API_KEY: 'cle-tres-secrete', AI_SERVER_LABEL: 'Serveur du lycée',
    });
    expect(text).not.toContain('cle-tres-secrete');
    expect(text).toContain('renseignée (masquée)');
    expect(text).toContain('Mode personnel');
    expect(text).toContain('Serveur d\'IA joignable');
    expect(text).toContain('Modèle « mistral-small » proposé par le serveur');
    expect(text).toContain('Envoi d\'un court message d\'essai');
    expect(text).toMatch(/Réponse reçue en \d+,\d s : « Bonjour ! »/);
    expect(code).toBe(0);
    const chat = ai.requests.find(r => r.path === '/v1/chat/completions');
    expect(JSON.parse(chat!.body)).toMatchObject({ max_tokens: 16 });
  });

  it('--no-generate : aucun texte envoyé au service d’IA', async () => {
    const ai = await fakeAI({ openaiModels: [{ id: 'm' }] });
    const { code, text } = await check(['--no-generate'], { HOST: '127.0.0.1', AI_BASE_URL: `${ai.url}/v1`, AI_MODEL: 'm' });
    expect(code).toBe(0);
    expect(text).toContain('Non effectuée (--no-generate)');
    expect(ai.requests.some(r => r.path.includes('chat'))).toBe(false);
  });

  it('causes classées : connexion refusée, clé refusée, modèle absent (liste des modèles), contexte de vLLM', async () => {
    const closed = await closedPortUrl();
    const refused = await check(['--no-generate'], { HOST: '127.0.0.1', AI_BASE_URL: `${closed}/v1`, AI_MODEL: 'm' });
    expect(refused.code).toBe(1);
    expect(refused.text).toContain('connexion refusée');

    const locked = await fakeAI({ openaiModels: [{ id: 'm' }], requireKey: 'bonne-cle' });
    const denied = await check(['--no-generate'], { HOST: '127.0.0.1', AI_BASE_URL: `${locked.url}/v1`, AI_MODEL: 'm', AI_API_KEY: 'mauvaise-cle' });
    expect(denied.code).toBe(1);
    expect(denied.text).toContain('vérifiez AI_API_KEY');
    expect(denied.text).not.toContain('mauvaise-cle');

    const vllm = await fakeAI({ openaiModels: [{ id: 'mistral-small', max_model_len: 16_384 }, { id: 'autre' }] });
    const missing = await check(['--no-generate'], { HOST: '127.0.0.1', AI_BASE_URL: `${vllm.url}/v1`, AI_MODEL: 'inexistant' });
    expect(missing.code).toBe(1);
    expect(missing.text).toContain('Modèles disponibles : mistral-small, autre');
    const tooSmall = await check(['--no-generate'], { HOST: '127.0.0.1', AI_BASE_URL: `${vllm.url}/v1`, AI_MODEL: 'mistral-small' });
    expect(tooSmall.code).toBe(1);
    expect(tooSmall.text).toContain('AI_CONTEXT_TOKENS=16384');
  });

  it('Ollama derrière /v1 : conseil AI_PROVIDER=ollama ou OLLAMA_CONTEXT_LENGTH', async () => {
    const ai = await fakeAI({ openaiModels: [{ id: 'ministral-3:8b' }], ollama: { version: '0.34.4', models: ['ministral-3:8b'] } });
    const { text } = await check(['--no-generate'], { HOST: '127.0.0.1', AI_BASE_URL: `${ai.url}/v1`, AI_MODEL: 'ministral-3:8b' });
    expect(text).toContain('Ollama détecté derrière /v1');
    expect(text).toContain(`AI_PROVIDER=ollama avec AI_BASE_URL=${ai.url}`);
  });

  it('Ollama natif : modèle installé sous un alias → AI_MODEL conseillé ; génération réelle sinon', async () => {
    const ai = await fakeAI({ ollama: { version: '0.34.4', models: ['ministral-3:latest'] }, reply: 'Bonjour.' });
    const alias = await check(['--no-generate'], { HOST: '127.0.0.1', AI_PROVIDER: 'ollama', AI_BASE_URL: ai.url, AI_MODEL: 'ministral-3:8b' });
    expect(alias.code).toBe(1);
    expect(alias.text).toContain('AI_MODEL=ministral-3:latest');
    const ok = await check([], { HOST: '127.0.0.1', AI_PROVIDER: 'ollama', AI_BASE_URL: ai.url, AI_MODEL: 'ministral-3:latest' });
    expect(ok.text).toContain('Ollama 0.34.4 joignable');
    expect(ok.text).toContain('num_ctx');
    expect(ok.text).toContain('« Bonjour. »');
    expect(ok.code).toBe(0);
  });

  it('détection automatique d’une IA locale', async () => {
    const ollama = await fakeAI({ ollama: { version: '0.34.4', models: ['ministral-3:8b'] }, reply: 'Bonjour' });
    const { code, text } = await check([], { HOST: '127.0.0.1' }, { localAI: { ollamaUrl: ollama.url, lmStudioUrl: await closedPortUrl() } });
    expect(text).toContain('(détection automatique)');
    expect(text).toContain('aucun texte n\'est envoyé à un service d\'IA en ligne');
    expect(code).toBe(0);
  });

  it('--vercel : adresse locale ou privée = erreur ; pas de détection locale ; fichier de « vercel env pull »', async () => {
    writeFileSync(path.join(cwd, '.env.prod.local'), [
      'VERCEL="1"', 'VITE_CLERK_PUBLISHABLE_KEY="pk_test_Y2xlcmsuZXhlbXBsZS5mciQ"', 'CLERK_SECRET_KEY="sk_test_x"',
      'SUPABASE_URL="https://abc.supabase.co"', 'SUPABASE_SERVICE_ROLE_KEY="cle-service-secrete"',
      'AI_BASE_URL="http://192.168.1.20:8000/v1"', 'AI_MODEL="m"',
    ].join('\n'));
    const { code, text } = await check(['--env-file', '.env.prod.local', '--no-generate'], {});
    expect(code).toBe(1);
    expect(text).toContain('site hébergé sur Vercel');
    expect(text).toContain('Configuration lue : .env.prod.local');
    expect(text).toContain('Comptes Clerk');
    expect(text).toContain('adresse locale ou privée');
    expect(text).not.toContain('cle-service-secrete');
    expect(text).not.toContain('sk_test_x');
  });

  it('--vercel : clé « Sensitive » vide après « vercel env pull » → conseil', async () => {
    const { code, text } = await check(['--vercel', '--no-generate'], { AI_PRESET: 'mistral', CLERK_SECRET_KEY: 'sk_test_x' });
    expect(code).toBe(1);
    expect(text).toContain('AI_API_KEY');
    expect(text).toContain('Sensitive');
  });

  it('prestataire en ligne : envoi des textes annoncé (pays, conservation, entraînement)', async () => {
    const network = offlineFetch();
    const { code, text } = await check(['--dev', '--no-generate'], { AI_PRESET: 'ovhcloud' }, { fetch: network });
    expect(text).toContain('seront envoyés à OVHcloud AI Endpoints');
    expect(text).toMatch(/Pays : France/);
    // Joignabilité classée par cause (ici : réseau coupé), sans jamais contacter le vrai service pendant les tests.
    expect(network.calls).toEqual(['https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/models']);
    expect(text).toContain('connexion refusée');
    expect(code).toBe(1);
  });

  it('dossier de données : <racine du projet>/.magistra-data, même quand l’outil est compilé ailleurs', async () => {
    const root = path.join(cwd, 'projet');
    const { text } = await check(['--dev', '--no-generate'], { MAGISTRA_DATA_DIR: '' }, { projectRoot: root });
    expect(text).toContain(`Fichiers sur ce serveur : ${path.join(root, '.magistra-data')}`);
  });

  it('--dev : lit .env puis .env.local ; les variables du terminal restent prioritaires', async () => {
    writeFileSync(path.join(cwd, '.env'), 'AI_PRESET=albert\nAI_API_KEY=cle-du-fichier\n');
    writeFileSync(path.join(cwd, '.env.local'), 'AI_PRESET=ovhcloud\n');
    const { text } = await check(['--dev', '--no-generate'], { AI_SERVER_LABEL: 'Libellé du terminal' }, { fetch: offlineFetch() });
    expect(text).toContain('Configuration lue : .env, .env.local');
    expect(text).toContain('Préréglage « ovhcloud » : Libellé du terminal');
    expect(text).not.toContain('cle-du-fichier');
  });

  it('sans option ni HOST (démonstration pour « npm start ») : la commande pour « npm run dev » est indiquée', async () => {
    const { text } = await check(['--no-generate'], {});
    expect(text).toContain('Démonstration');
    expect(text).toContain('npm run ai:check -- --dev');
    const dev = await check(['--dev', '--no-generate'], {});
    expect(dev.text).toContain('Mode personnel');
    expect(dev.text).not.toContain('Démonstration');
  });

  it('AI_API_KEY seule : jamais envoyée à l’IA détectée, « renseignée mais non utilisée »', async () => {
    const ollama = await fakeAI({ ollama: { version: '0.34.4', models: ['ministral-3:8b'] }, reply: 'Bonjour' });
    const { text } = await check([], { HOST: '127.0.0.1', AI_API_KEY: 'sk-CLE-PAYANTE-42' }, { localAI: { ollamaUrl: ollama.url, lmStudioUrl: await closedPortUrl() } });
    expect(text).toContain('la clé n\'est pas utilisée');
    expect(text).toContain('renseignée mais non utilisée');
    expect(text).not.toContain('sk-CLE-PAYANTE-42');
    expect(ollama.requests.length).toBeGreaterThan(0);
    expect(ollama.requests.map(r => r.headers.authorization).filter(Boolean)).toEqual([]);
  });

  it('modèle « cloud » ou relayé par Ollama : envoi à un service en ligne annoncé, jamais « aucun texte n’est envoyé »', async () => {
    const ollama = await fakeAI({
      ollama: { version: '0.34.4', models: ['gpt-oss:20b-cloud', 'assistant:latest'], remote: { 'assistant:latest': 'https://ollama.com:443' } },
      reply: 'Réponse du NUAGE.',
    });
    const cloud = await check(['--no-generate'], { HOST: '127.0.0.1', AI_PROVIDER: 'ollama', AI_BASE_URL: ollama.url, AI_MODEL: 'gpt-oss:20b-cloud' });
    expect(cloud.text).toContain('seront envoyés à Ollama Cloud');
    expect(cloud.text).not.toContain('aucun texte n\'est envoyé à un service d\'IA en ligne.');
    const relayed = await check(['--no-generate'], { HOST: '127.0.0.1', AI_PROVIDER: 'ollama', AI_BASE_URL: ollama.url, AI_MODEL: 'assistant:latest' });
    expect(relayed.text).toContain('n\'est pas exécuté par ce serveur Ollama');
    expect(relayed.text).toContain('Ollama Cloud');
    // Détection automatique : aucun des deux n'est retenu.
    const detected = await check(['--no-generate'], { HOST: '127.0.0.1' }, { localAI: { ollamaUrl: ollama.url, lmStudioUrl: await closedPortUrl() } });
    expect(detected.text).toContain('seuls des modèles en ligne (Ollama Cloud)');
    expect(detected.code).toBe(1);
  });
});
