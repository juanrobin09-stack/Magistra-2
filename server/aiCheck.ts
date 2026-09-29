// Vérification de la configuration de Magistra et de l'IA branchée, en français, pour l'administrateur :
//
//   npm run ai:check [-- options]          (compilé à la volée par l'esbuild du dépôt)
//   node dist-server/ai-check.js [options] (après « npm run build:server », sans dépendances de développement)
//
// Options :
//   --dev             fichiers lus comme « npm run dev » : .env, .env.local, .env.development, .env.development.local
//   --start           fichiers lus comme « npm start » : .env, ou MAGISTRA_ENV_FILE (par défaut)
//   --vercel          vérification pour Vercel : une adresse locale ou privée est une erreur, pas de détection locale
//                     (à combiner avec --env-file après « vercel env pull --environment=production .env.prod.local »)
//   --env-file <f>    lit ce fichier (option répétable)
//   --no-generate     n'envoie pas la génération d'essai
//   --help            aide
//
// Étapes : mode du site (Clerk, personnel ou démonstration), stockage, configuration de l'IA (préréglage, détection
// automatique), joignabilité classée par cause, présence du modèle (avec la liste des modèles disponibles), taille
// de contexte, puis une génération d'essai de 16 tokens au plus, ANNONCÉE et désactivable, avec le temps mesuré.
// Aucune clé n'est jamais affichée. Aucun fichier n'est créé. Code de sortie : 0 si tout est prêt, 1 sinon,
// 2 si les options sont invalides.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { createProvider, type ProviderConfig } from '../shared/ai/factory.js';
import { installedModelForTier, tierForModel } from '../shared/ai/models.js';
import { sameModel } from '../shared/ai/ollama.js';
import { ollamaDestination, remoteHostOf } from '../shared/ai/ollamaRemote.js';
import { modelListed } from '../shared/ai/openaiCompatible.js';
import { addressKind, describeAIEndpoint, getPreset } from '../shared/ai/presets.js';
import type { FetchLike, ModelInfo } from '../shared/ai/provider.js';
import { abortedByTimeout, networkFailureKind } from '../shared/ai/streams.js';
import { isMagistraError } from '../shared/errors.js';
import { loadConfig, type Env } from './config.js';
import { LocalAIDetector, LOCAL_AI_HINT, type LocalAIDetectorOptions } from './localAI.js';
import { resolveAuth, type ListenContext } from './personal.js';

export type CheckTarget = 'dev' | 'start' | 'vercel';

export interface CheckOptions {
  target: CheckTarget;
  envFiles: string[];
  generate: boolean;
  help: boolean;
}

export interface CheckIO {
  /** Variables du terminal (prioritaires sur les fichiers). */
  env: Env;
  cwd: string;
  out: (line: string) => void;
  fetch?: FetchLike;
  now?: () => number;
  /** Détection locale (tests). */
  localAI?: LocalAIDetectorOptions;
  /** Délai des sondes réseau (ms). */
  probeTimeoutMs?: number;
  /**
   * Racine du projet (dossier de données par défaut <racine>/.magistra-data). Indispensable quand ce module est
   * compilé à la volée hors du projet (node_modules/.cache/magistra/) : sa propre adresse ne désigne plus la racine.
   */
  projectRoot?: string;
}

export const USAGE = [
  'Usage : npm run ai:check -- [--dev | --start | --vercel] [--env-file <fichier>] [--no-generate]',
  '  --dev           fichiers lus comme « npm run dev » (.env, .env.local, .env.development)',
  '  --start         fichiers lus comme « npm start » (.env) : par défaut',
  '  --vercel        vérification pour un site sur Vercel (adresse locale ou privée = erreur)',
  '  --env-file <f>  lit ce fichier (ex. .env.prod.local obtenu par « vercel env pull »)',
  '  --no-generate   pas de génération d\'essai (aucun texte envoyé au service d\'IA)',
];

/** Lit les options ; lève une Error (message en français) si elles sont invalides. */
export function parseCheckArgs(argv: readonly string[]): CheckOptions {
  const options: CheckOptions = { target: 'start', envFiles: [], generate: true, help: false };
  let targetSet = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dev' || arg === '--start' || arg === '--vercel') {
      if (targetSet && options.target !== arg.slice(2)) throw new Error('Choisissez une seule cible : --dev, --start ou --vercel.');
      options.target = arg.slice(2) as CheckTarget;
      targetSet = true;
    } else if (arg === '--env-file') {
      const file = argv[++i];
      if (!file || file.startsWith('--')) throw new Error('--env-file attend un nom de fichier.');
      options.envFiles.push(file);
    } else if (arg.startsWith('--env-file=')) {
      options.envFiles.push(arg.slice('--env-file='.length));
    } else if (arg === '--no-generate') {
      options.generate = false;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Option inconnue : ${arg.slice(0, 40)}`);
    }
  }
  return options;
}

/** Fichiers de configuration lus pour la cible (dans l'ordre : les suivants complètent et remplacent les précédents). */
export function envFilesFor(options: CheckOptions, env: Env): string[] {
  if (options.envFiles.length) return options.envFiles;
  if (options.target === 'dev') return ['.env', '.env.local', '.env.development', '.env.development.local'];
  if (options.target === 'start') return [env.MAGISTRA_ENV_FILE?.trim() || '.env'];
  return ['.env'];
}

type Mark = '✓' | '!' | '✗' | '•';

class Report {
  errors = 0;
  warnings = 0;
  constructor(private readonly out: (line: string) => void) {}
  section(title: string): void {
    this.out('');
    this.out(`── ${title}`);
  }
  line(mark: Mark, text: string): void {
    if (mark === '✗') this.errors++;
    if (mark === '!') this.warnings++;
    this.out(`  ${mark} ${text}`);
  }
  detail(text: string): void {
    this.out(`      ${text}`);
  }
}

function clean(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

function seconds(ms: number): string {
  return `${(ms / 1_000).toFixed(1).replace('.', ',')} s`;
}

type Probe =
  | { ok: true; status: number; body: unknown; ms: number }
  | { ok: false; status?: number; body?: unknown; reason: string; ms: number };

/** Requête de diagnostic : jamais de clé dans les messages, cause réseau classée. */
async function probe(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number, now: () => number): Promise<Probe> {
  const started = now();
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal });
    const text = await res.text().catch(() => '');
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // corps non JSON : conservé tel quel pour le diagnostic
    }
    const ms = now() - started;
    return res.ok ? { ok: true, status: res.status, body, ms } : { ok: false, status: res.status, body, reason: `HTTP ${res.status}`, ms };
  } catch (err) {
    const ms = now() - started;
    if (abortedByTimeout(signal) || (err as { name?: string })?.name === 'TimeoutError') {
      return { ok: false, reason: `délai dépassé (${Math.round(timeoutMs / 1_000)} s) : serveur trop lent, ou bloqué par un pare-feu`, ms };
    }
    const kind = networkFailureKind(err);
    const reason = kind === 'refused' ? 'connexion refusée : aucun service n\'écoute à cette adresse (serveur arrêté ? mauvais port ?)'
      : kind === 'dns' ? 'nom introuvable : vérifiez le nom du serveur dans AI_BASE_URL'
        : kind === 'unreachable' ? 'réseau ou hôte inaccessible depuis cette machine'
          : kind === 'tls' ? 'connexion sécurisée impossible (certificat HTTPS refusé)'
            : kind === 'bad_port' ? 'port interdit par sécurité : choisissez un autre port'
              : 'échec de la connexion';
    return { ok: false, reason, ms };
  }
}

function listNames(names: readonly string[], max = 15): string {
  if (!names.length) return '(aucun)';
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown}, … (${names.length} au total)` : shown;
}

function authHeaders(apiKey: string | undefined): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } : { Accept: 'application/json' };
}

/** Exécute la vérification ; renvoie le code de sortie. */
export async function runAiCheck(argv: readonly string[], io: CheckIO): Promise<number> {
  const out = io.out;
  let options: CheckOptions;
  try {
    options = parseCheckArgs(argv);
  } catch (err) {
    out(`Erreur : ${(err as Error).message}`);
    for (const line of USAGE) out(line);
    return 2;
  }
  if (options.help) {
    for (const line of USAGE) out(line);
    return 0;
  }
  const fetchImpl: FetchLike = io.fetch ?? ((input, init) => fetch(input, init));
  const now = io.now ?? (() => Date.now());
  const probeMs = io.probeTimeoutMs ?? 15_000;
  const report = new Report(out);

  // ─── Fichiers de configuration ───
  const files = envFilesFor(options, io.env);
  const fromFiles: Env = {};
  const read: string[] = [];
  for (const file of files) {
    const full = path.resolve(io.cwd, file);
    if (!existsSync(full)) {
      if (options.envFiles.length) report.line('✗', `Fichier introuvable : ${file}`);
      continue;
    }
    try {
      Object.assign(fromFiles, parseEnv(readFileSync(full, 'utf8')));
      read.push(file);
    } catch {
      report.line('✗', `Fichier illisible : ${file}`);
    }
  }
  // Les variables du terminal restent prioritaires (comme « npm start » et Vite).
  const env: Env = { ...fromFiles, ...io.env };
  // Fichier obtenu par « vercel env pull » (VERCEL=1) : vérification comme sur Vercel.
  if (env.VERCEL === '1' && options.target !== 'vercel') options = { ...options, target: 'vercel' };
  if (options.target === 'vercel') env.VERCEL = '1';
  if (options.target === 'dev') env.NODE_ENV = 'development';

  const targetText = options.target === 'dev' ? 'npm run dev' : options.target === 'vercel' ? 'site hébergé sur Vercel' : 'serveur autonome (npm start)';
  out(`Magistra — vérification de l'IA — ${targetText}`);
  out(`Configuration lue : ${read.length ? read.join(', ') : 'aucun fichier (variables du terminal uniquement)'}.`);

  const config = loadConfig(env, io.projectRoot ? { projectRoot: io.projectRoot } : {});
  const ai = config.ai;

  // ─── Mode du site ───
  report.section('Mode du site');
  const ctx: ListenContext = options.target === 'dev'
    ? { dev: true, host: 'localhost' }
    : options.target === 'start' ? { host: clean(env.HOST) ?? null } : {};
  const auth = resolveAuth(env, ctx);
  if (auth.mode === 'clerk') {
    const secret = clean(env.CLERK_SECRET_KEY) || clean(env.CLERK_JWT_KEY);
    report.line(secret ? '✓' : '✗', secret
      ? 'Comptes Clerk : chaque enseignant se connecte avec son compte.'
      : 'Clé Clerk publique présente, mais ni CLERK_SECRET_KEY ni CLERK_JWT_KEY : le serveur ne peut pas vérifier les sessions.');
    if (!config.clerkPublishableKey) {
      report.line(options.target === 'vercel' ? '✗' : '!', 'VITE_CLERK_PUBLISHABLE_KEY absente ou invalide : sans elle, la page de connexion ne peut pas s\'afficher.');
    }
  } else if (auth.mode === 'personal') {
    report.line('✓', 'Mode personnel (sans compte) : un seul utilisateur, accès réservé à cet ordinateur.');
    report.detail('L\'adresse d\'accès, avec sa clé secrète (#acces=…), s\'affiche dans le terminal au démarrage.');
  } else if (auth.refusal) {
    report.line('✗', auth.refusal);
  } else {
    report.line('✗', 'Démonstration : aucune authentification, l\'interface n\'utilisera aucune IA.');
    report.detail(options.target === 'vercel'
      ? 'Pour un site en ligne, configurez Clerk (VITE_CLERK_PUBLISHABLE_KEY et CLERK_SECRET_KEY).'
      : 'Sur cet ordinateur : copiez .env.example en .env (il contient HOST=127.0.0.1, soit le mode personnel) ou lancez « npm run dev » ; '
        + 'pour un accès depuis le réseau : configurez Clerk.');
    // Sans option, la vérification vise « npm start » : « npm run dev » (mode personnel sans .env) se vérifie avec --dev.
    if (options.target === 'start' && !clean(env.HOST)) {
      report.detail('Si vous utilisez « npm run dev » (et non « npm start ») : vérifiez plutôt avec « npm run ai:check -- --dev ».');
    }
  }

  // ─── Stockage ───
  report.section('Stockage de l\'historique');
  const storeKind = config.storeExplicit ? config.store : auth.mode === 'personal' ? 'file' : config.store;
  if (storeKind === 'file') {
    report.line('✓', `Fichiers sur ce serveur : ${config.dataDir}`);
  } else if (storeKind === 'memory') {
    report.line('!', 'En mémoire (MAGISTRA_STORE=memory) : l\'historique est perdu à chaque redémarrage.');
  } else if (config.supabase) {
    let host = config.supabase.url;
    try {
      host = new URL(config.supabase.url).host;
    } catch {
      // adresse déjà validée par loadConfig
    }
    report.line('✓', `Supabase (${host}) : pensez à exécuter supabase-schema.sql (réexécutable).`);
  } else if (options.target === 'dev') {
    report.line('!', 'Supabase non configuré : historique en mémoire le temps de la session (développement).');
  } else if (auth.mode === 'none' && !auth.refusal && options.target === 'start') {
    // Démonstration : déjà signalée ci-dessus ; son remède (HOST=127.0.0.1, mode personnel) règle aussi le stockage.
    report.line('•', `Sans objet en démonstration. En mode personnel (HOST=127.0.0.1), l'historique sera enregistré dans : ${config.dataDir}`);
  } else {
    report.line('✗', 'SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY manquants (ou MAGISTRA_STORE=file sur un serveur autonome).');
  }

  // ─── Configuration de l'IA ───
  report.section('Configuration de l\'IA');
  for (const problem of config.problems.filter(p => /AI_|Ollama/.test(p))) report.line('!', problem);
  let provider: ProviderConfig | null = ai.provider;
  let label = ai.label;
  let providerInfo = ai.providerInfo;
  if (!provider && ai.autodetect) {
    const detector = new LocalAIDetector({
      ...io.localAI,
      contextTokens: ai.explicit.contextTokens,
      label: ai.explicit.label,
      timeZone: config.defaultTimeZone,
    });
    const found = await detector.detect();
    if (!found.found) {
      report.line('✗', found.summary);
      report.detail(`Autre possibilité : un service d'IA en ligne, par exemple AI_PRESET=ovhcloud (gratuit, sans compte) — voir .env.example.`);
      return finish(report, out);
    }
    report.line('✓', `${found.summary} (détection automatique)`);
    for (const warning of found.warnings) report.line('!', warning);
    provider = found.provider;
    label = found.label;
    providerInfo = undefined;
  } else if (!provider) {
    report.line('✗', ai.unavailable?.message ?? "Aucun serveur d'IA n'est configuré.");
    if (!ai.autodetect && options.target !== 'vercel' && !clean(env.AI_PRESET) && !clean(env.AI_BASE_URL) && !clean(env.AI_MODEL)) {
      report.detail(`Sur cet ordinateur : ${LOCAL_AI_HINT} (détection automatique si AI_AUTODETECT n'est pas à false).`);
    }
    if (options.target === 'vercel' && ai.unavailable?.message.includes('AI_API_KEY')) {
      report.detail('Si AI_API_KEY est marquée « Sensitive » dans Vercel, « vercel env pull » la laisse vide : '
        + 'fournissez-la dans le terminal (AI_API_KEY=… npm run ai:check -- --vercel --env-file .env.prod.local).');
    }
    return finish(report, out);
  } else {
    report.line('✓', `${ai.preset ? `Préréglage « ${ai.preset} » : ` : ''}${label}`);
  }
  const baseUrl = provider.baseUrl ?? '';
  const apiKey = provider.apiKey;
  const contextTokens = provider.contextTokens ?? ai.contextTokens;
  report.detail(`Type : ${provider.kind === 'ollama' ? 'Ollama (API native, contexte réglable)' : 'API compatible OpenAI'}`);
  report.detail(`Adresse : ${baseUrl}`);
  report.detail(`Modèle : ${provider.model}`);
  report.detail(`Clé d'accès (AI_API_KEY) : ${apiKey ? 'renseignée (masquée)'
    : ai.explicit.apiKey ? 'renseignée mais non utilisée (IA locale détectée automatiquement)' : 'aucune'}`);
  report.detail(`Contexte : ${contextTokens} tokens ; longueur maximale produite : ${ai.maxOutputTokens} tokens`);
  if (options.target === 'vercel') {
    const kind = addressKind(baseUrl);
    if (kind === 'loopback' || kind === 'private') report.line('✗', 'Adresse locale ou privée : Vercel ne pourra jamais la joindre.');
  }
  const info = providerInfo ?? (baseUrl ? describeAIEndpoint(baseUrl).privacy : undefined);
  if (info?.thirdParty) {
    report.line('•', `Les demandes et extraits de documents des enseignants seront envoyés à ${providerInfo?.label ?? label} — l'interface l'annonce.`);
    report.detail(`Pays : ${info.country ?? 'non précisé'} ; conservation : ${info.retention ?? 'non précisée'} ; entraînement : ${info.training ?? 'non précisé'}.`);
    const url = providerInfo?.privacyUrl ?? (info as { url?: string }).url;
    if (url) report.detail(`Conditions : ${url}`);
  } else if (provider.kind === 'ollama') {
    report.line('•', 'IA locale ou du réseau de l\'établissement : aucun texte n\'est envoyé à un service d\'IA en ligne, '
      + 'si le modèle est exécuté par ce serveur Ollama (vérifié ci-dessous).');
  } else {
    report.line('•', 'IA locale ou du réseau de l\'établissement : aucun texte n\'est envoyé à un service d\'IA en ligne.');
  }

  // ─── Joignabilité, modèle et contexte ───
  report.section('Joignabilité et modèle');
  let modelMissing = false;
  if (provider.kind === 'ollama') {
    const version = await probe(fetchImpl, `${baseUrl}/api/version`, { headers: authHeaders(apiKey) }, probeMs, now);
    if (!version.ok) {
      report.line('✗', `Ollama injoignable à ${baseUrl} : ${describeFailure(version, 'ollama')}`);
      return finish(report, out);
    }
    const v = (version.body as { version?: unknown })?.version;
    report.line('✓', `Ollama ${typeof v === 'string' ? v : '(version inconnue)'} joignable (${version.ms} ms).`);
    const tags = await probe(fetchImpl, `${baseUrl}/api/tags`, { headers: authHeaders(apiKey) }, probeMs, now);
    const entries = tags.ok && Array.isArray((tags.body as { models?: unknown })?.models)
      ? ((tags.body as { models: { name?: unknown }[] }).models)
        .map(m => ({ name: typeof m?.name === 'string' ? m.name : '', remoteHost: remoteHostOf(m) }))
        .filter(m => m.name)
      : [];
    const names = entries.map(m => m.name);
    const entry = entries.find(m => sameModel(m.name, provider!.model));
    if (!tags.ok) {
      report.line('!', `Liste des modèles indisponible : ${describeFailure(tags, 'ollama')}`);
    } else if (entry) {
      report.line('✓', `Modèle « ${provider.model} » installé.`);
      // Modèle à hôte distant (OLLAMA_REMOTES) : Ollama ne l'exécute pas lui-même, il relaie les textes.
      const remote = entry.remoteHost ? ollamaDestination(entry.name, entry.remoteHost) : undefined;
      if (remote) {
        report.line(remote.thirdParty ? '!' : '•', `Ce modèle n'est pas exécuté par ce serveur Ollama : il relaie les demandes et extraits de documents `
          + `vers « ${remote.label} »${remote.thirdParty ? ' (service en ligne)' : ''}. L'interface l'annonce aux enseignants.`);
      }
    } else {
      modelMissing = true;
      const tier = tierForModel(provider.model);
      const alias = tier ? installedModelForTier(tier, names) : undefined;
      report.line('✗', alias
        ? `Modèle « ${provider.model} » absent sous ce nom, mais installé sous le nom « ${alias} » : AI_MODEL=${alias}.`
        : `Modèle « ${provider.model} » non installé : « ollama pull ${provider.model} » sur le serveur Ollama.`);
      report.detail(`Modèles installés : ${listNames(names)}`);
    }
    // Contexte maximal du modèle (/api/show) comparé au contexte demandé (num_ctx).
    if (!modelMissing) {
      const show = await probe(fetchImpl, `${baseUrl}/api/show`, {
        method: 'POST', headers: { ...authHeaders(apiKey), 'Content-Type': 'application/json' }, body: JSON.stringify({ model: provider.model }),
      }, probeMs, now);
      const modelInfo = show.ok ? (show.body as { model_info?: Record<string, unknown> })?.model_info : undefined;
      const max = modelInfo ? Object.entries(modelInfo).find(([k, value]) => k.endsWith('.context_length') && typeof value === 'number')?.[1] as number | undefined : undefined;
      if (max && max < contextTokens) {
        report.line('!', `Le modèle accepte au plus ${max} tokens de contexte : réglez AI_CONTEXT_TOKENS=${max}.`);
      } else {
        report.line('✓', `Contexte demandé à Ollama (num_ctx) : ${contextTokens} tokens${max ? ` (maximum du modèle : ${max})` : ''}.`);
      }
    }
  } else {
    const list = await probe(fetchImpl, `${baseUrl}/models`, { headers: authHeaders(apiKey) }, probeMs, now);
    if (!list.ok && list.status === undefined) {
      report.line('✗', `Serveur d'IA injoignable à ${baseUrl} : ${list.reason}.`);
      if (options.target !== 'vercel' && (addressKind(baseUrl) === 'loopback' || addressKind(baseUrl) === 'private')) {
        report.detail('Adresse locale ou privée : elle n\'est joignable que depuis cette machine ou ce réseau (jamais depuis Vercel).');
      }
      return finish(report, out);
    }
    if (!list.ok) {
      const status = list.status ?? 0;
      if (status === 401 || status === 403) {
        report.line('✗', `Accès refusé (HTTP ${status}) : vérifiez AI_API_KEY${getPreset(ai.preset)?.apiKey === 'required' ? ' (clé obligatoire pour ce service)' : ''}.`);
        return finish(report, out);
      }
      if (status === 404) report.line('!', 'Liste des modèles introuvable (HTTP 404) : AI_BASE_URL se termine généralement par /v1. La génération d\'essai tranchera.');
      else if (status === 429) report.line('!', 'Le service limite le nombre de demandes (HTTP 429 : quota ou offre gratuite). Réessayez plus tard.');
      else report.line(status >= 500 ? '✗' : '!', `Liste des modèles : réponse HTTP ${status}.`);
    } else {
      report.line('✓', `Serveur d'IA joignable (${list.ms} ms).`);
      const data = (list.body as { data?: { id?: unknown; aliases?: unknown; max_model_len?: unknown }[] })?.data;
      const entries = Array.isArray(data) ? data.filter(m => typeof m?.id === 'string') : [];
      const models: ModelInfo[] = entries.map(m => ({
        name: m.id as string,
        ...(Array.isArray(m.aliases) ? { aliases: m.aliases.filter((a): a is string => typeof a === 'string') } : {}),
      }));
      if (!models.length) {
        report.line('!', 'Le serveur ne liste aucun modèle : la génération d\'essai tranchera.');
      } else if (modelListed(models, provider.model)) {
        report.line('✓', `Modèle « ${provider.model} » proposé par le serveur.`);
        const entry = entries.find(m => modelListed([{ name: m.id as string }], provider!.model));
        const maxLen = typeof entry?.max_model_len === 'number' ? entry.max_model_len : undefined;
        if (maxLen && maxLen < contextTokens) {
          report.line('✗', `Le serveur limite ce modèle à ${maxLen} tokens de contexte (max_model_len) : réglez AI_CONTEXT_TOKENS=${maxLen}.`);
        } else if (maxLen) {
          report.line('✓', `Contexte : ${contextTokens} tokens demandés, ${maxLen} acceptés par le serveur.`);
        }
      } else {
        modelMissing = true;
        report.line(options.generate ? '!' : '✗', `Modèle « ${provider.model} » absent de la liste du serveur (alias possible : la génération d'essai tranchera).`);
        report.detail(`Modèles disponibles : ${listNames(models.map(m => m.name))}`);
      }
    }
    // Ollama derrière /v1 : le contexte (num_ctx) n'est pas transmis par l'API compatible OpenAI.
    const endpoint = describeAIEndpoint(baseUrl);
    if (endpoint.kind !== 'preset' && endpoint.kind !== 'known') {
      let origin: string;
      try {
        origin = new URL(baseUrl).origin;
      } catch {
        origin = '';
      }
      const ollama = origin ? await probe(fetchImpl, `${origin}/api/version`, { headers: authHeaders(apiKey) }, Math.min(probeMs, 3_000), now) : null;
      if (ollama?.ok && typeof (ollama.body as { version?: unknown })?.version === 'string') {
        report.line('!', 'Ollama détecté derrière /v1 : la taille de contexte n\'est pas transmise et Ollama tronque les demandes à son contexte '
          + `par défaut (souvent 4 096 tokens). Utilisez AI_PROVIDER=ollama avec AI_BASE_URL=${origin}, ou réglez OLLAMA_CONTEXT_LENGTH=${contextTokens} sur le serveur Ollama.`);
      }
    }
  }

  // ─── Génération d'essai ───
  report.section('Génération d\'essai');
  if (!options.generate) {
    report.line('•', 'Non effectuée (--no-generate) : aucun texte n\'a été envoyé au service d\'IA.');
    return finish(report, out);
  }
  report.line('•', `Envoi d'un court message d'essai (« Réponds seulement : Bonjour. », 16 tokens au plus) à ${label}. Désactivable avec --no-generate.`);
  const ai2 = createProvider({ ...provider, recipient: 'administrateur' }, io.fetch);
  const local = addressKind(baseUrl) === 'loopback' || addressKind(baseUrl) === 'private';
  const started = now();
  try {
    const result = await ai2.generate({
      messages: [{ role: 'user', content: 'Réponds seulement : Bonjour.' }],
      maxTokens: 16,
      temperature: 0,
      signal: AbortSignal.timeout(local ? 600_000 : 120_000),
    });
    const elapsed = now() - started;
    const text = result.text.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!text) {
      report.line('✗', `Réponse vide du modèle (${seconds(elapsed)}).`);
    } else {
      report.line('✓', `Réponse reçue en ${seconds(elapsed)} : « ${text} »`);
      if (modelMissing && provider.kind !== 'ollama') {
        report.line('•', 'Le modèle répond malgré son absence de la liste : c\'est un alias accepté par le serveur.');
      }
      if (elapsed > 60_000) report.line('!', 'Réponse lente (plus d\'une minute pour quelques mots) : une vraie génération risque d\'être très longue.');
    }
  } catch (err) {
    const message = isMagistraError(err) ? `${err.message} [${err.code}]` : 'Échec inattendu de la génération d\'essai.';
    report.line('✗', message);
  }
  return finish(report, out);
}

function describeFailure(result: Probe, api: 'ollama' | 'openai'): string {
  if (result.ok) return 'aucune erreur';
  if (result.status === 401 || result.status === 403) return `accès refusé (HTTP ${result.status}) : vérifiez AI_API_KEY (proxy à clé devant Ollama).`;
  if (result.status === 404) {
    return api === 'ollama'
      ? 'service introuvable (HTTP 404) : pour AI_PROVIDER=ollama, l\'adresse ne se termine pas par /v1 et désigne un serveur Ollama.'
      : 'service introuvable (HTTP 404).';
  }
  return `${result.reason}.`;
}

function finish(report: Report, out: (line: string) => void): number {
  out('');
  if (report.errors) {
    out(`Résultat : ${report.errors} problème${report.errors > 1 ? 's' : ''} à corriger${report.warnings ? `, ${report.warnings} avertissement${report.warnings > 1 ? 's' : ''}` : ''}.`);
    return 1;
  }
  out(report.warnings
    ? `Résultat : IA prête, avec ${report.warnings} avertissement${report.warnings > 1 ? 's' : ''} à lire ci-dessus.`
    : 'Résultat : tout est prêt.');
  return 0;
}

/**
 * Point d'entrée (npm run ai:check, node dist-server/ai-check.js). `projectRoot` : racine du projet, transmise par
 * scripts/build-server.mjs (module compilé dans node_modules/.cache) ; sinon déduite de l'emplacement du module.
 */
export async function main(argv: readonly string[] = process.argv.slice(2), options: { projectRoot?: string } = {}): Promise<number> {
  return runAiCheck(argv, {
    env: { ...process.env }, cwd: process.cwd(), out: line => console.log(line), ...(options.projectRoot ? { projectRoot: options.projectRoot } : {}),
  });
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(realpathSync(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  void main().then(code => {
    process.exitCode = code;
  });
}
