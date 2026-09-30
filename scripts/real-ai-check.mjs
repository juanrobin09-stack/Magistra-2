#!/usr/bin/env node
// Validation de Magistra avec une VRAIE IA (Ollama), sur un poste ou en CI (.github/workflows/real-ai.yml).
//
// Le cœur de Magistra (shared/) est compilé à la volée par esbuild, comme pour « npm run ai:check » : ce sont les
// VRAIS fournisseurs et la VRAIE chaîne de génération qui sont exercés, sans aucun faux serveur.
//
//   1. Ollama, API native (OllamaProvider : application Windows, AI_PROVIDER=ollama) : version (au moins
//      MIN_OLLAMA_VERSION), test de santé, liste des modèles, courte génération en français ;
//   2. le même Ollama par /v1 (OpenAICompatibleProvider : serveur compatible OpenAI, préréglages en ligne) :
//      test de santé, liste des modèles, courte génération en français ;
//   3. la chaîne complète runGeneration (demande validée comme par le serveur, préchargement du modèle, sélection
//      des passages d'un court document Markdown, prompt, flux, vérification des citations) : le texte final doit
//      contenir une citation [S1] vérifiée et la section « Sources utilisées » qui nomme le document.
//
// Usage :
//   npm run test:real-ai                          Ollama sur http://127.0.0.1:11434, modèle ministral-3:3b
//   REAL_AI_URL=http://127.0.0.1:11501 REAL_AI_MODEL=ministral-3:8b npm run test:real-ai
//   node scripts/real-ai-check.mjs [--url <adresse>] [--model <nom>] [--report <fichier.json>]
//
// Variables (les options de la ligne de commande l'emportent) :
//   REAL_AI_URL             adresse d'Ollama, SANS /v1 (défaut http://127.0.0.1:11434 ; un /v1 final est retiré)
//   REAL_AI_MODEL           modèle DÉJÀ installé (défaut ministral-3:3b : « ollama pull ministral-3:3b »)
//   REAL_AI_API_KEY         clé d'un proxy placé devant Ollama (facultative ; jamais affichée ni écrite)
//   REAL_AI_CONTEXT_TOKENS  taille de contexte demandée (défaut 12288). Réglez OLLAMA_CONTEXT_LENGTH sur la même
//                           valeur côté serveur : /v1 ne transmet pas la taille de contexte, et un écart obligerait
//                           Ollama à recharger le modèle entre les étapes.
//   REAL_AI_TIMEOUT_S       délai maximal de chaque étape, en secondes (défaut 900 : processeur seul, sans GPU)
//   REAL_AI_ATTEMPTS        essais de la chaîne complète quand le modèle ne cite pas le document (défaut 2 : un petit
//                           modèle peut oublier une citation ; un échec répété est signalé)
//   REAL_AI_REPORT          fichier JSON du rapport (comme --report)
//
// Aucun modèle n'est téléchargé et aucun fichier n'est créé hors du rapport demandé (le cœur compilé est effacé
// après chargement). Sous GitHub Actions, les échecs deviennent des annotations et un résumé est ajouté à la page
// de l'exécution. Code de sortie : 0 si tout passe, 1 sinon, 2 si les options sont invalides.

import { build } from 'esbuild';
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULTS = Object.freeze({
  url: 'http://127.0.0.1:11434',
  model: 'ministral-3:3b',
  contextTokens: 12_288,
  timeoutS: 900,
  attempts: 2,
});

export const USAGE = [
  'Usage : npm run test:real-ai -- [--url <adresse>] [--model <nom>] [--report <fichier.json>]',
  `  --url <adresse>     adresse d'Ollama sans /v1 (REAL_AI_URL, défaut ${DEFAULTS.url})`,
  `  --model <nom>       modèle déjà installé (REAL_AI_MODEL, défaut ${DEFAULTS.model})`,
  '  --report <fichier>  écrit le rapport JSON (REAL_AI_REPORT)',
  `  --timeout-s <n>     délai de chaque étape en secondes (REAL_AI_TIMEOUT_S, défaut ${DEFAULTS.timeoutS})`,
  `  --attempts <n>      essais de la chaîne complète (REAL_AI_ATTEMPTS, défaut ${DEFAULTS.attempts})`,
  '  Clé facultative d\'un proxy devant Ollama : variable REAL_AI_API_KEY (jamais affichée).',
];

function clean(value) {
  const v = typeof value === 'string' ? value.trim() : '';
  return v || undefined;
}

function positiveInt(raw, name, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} doit être un nombre entier entre ${min} et ${max} (reçu « ${String(raw).slice(0, 20)} »).`);
  return n;
}

/**
 * Adresse d'Ollama normalisée : http(s) uniquement, sans barre finale ni /v1 (ajouté pour l'étape compatible OpenAI).
 * Lève une Error (message en français) si l'adresse est illisible.
 */
export function normalizeBaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Adresse d'Ollama illisible (« ${String(raw).slice(0, 80)} ») : exemple http://127.0.0.1:11434.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error("L'adresse d'Ollama doit commencer par http:// ou https://.");
  url.search = '';
  url.hash = '';
  return url.href.replace(/\/+$/, '').replace(/\/v1$/i, '').replace(/\/+$/, '');
}

/** Adresse affichable : sans identifiants éventuels (http://utilisateur:motdepasse@hôte). */
export function displayUrl(raw) {
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    return url.href.replace(/\/+$/, '');
  } catch {
    return '(adresse illisible)';
  }
}

/** Lit les options (ligne de commande puis variables). Lève une Error (message en français) si elles sont invalides. */
export function parseArgs(argv, env = {}) {
  const opts = {
    url: clean(env.REAL_AI_URL) ?? DEFAULTS.url,
    model: clean(env.REAL_AI_MODEL) ?? DEFAULTS.model,
    apiKey: clean(env.REAL_AI_API_KEY),
    contextTokens: clean(env.REAL_AI_CONTEXT_TOKENS) ?? DEFAULTS.contextTokens,
    timeoutS: clean(env.REAL_AI_TIMEOUT_S) ?? DEFAULTS.timeoutS,
    attempts: clean(env.REAL_AI_ATTEMPTS) ?? DEFAULTS.attempts,
    report: clean(env.REAL_AI_REPORT),
    help: false,
  };
  const valueOf = (i, name) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`L'option ${name} attend une valeur.`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--url') opts.url = valueOf(i++, arg);
    else if (arg === '--model') opts.model = valueOf(i++, arg);
    else if (arg === '--report') opts.report = valueOf(i++, arg);
    else if (arg === '--timeout-s') opts.timeoutS = valueOf(i++, arg);
    else if (arg === '--attempts') opts.attempts = valueOf(i++, arg);
    else throw new Error(`Option inconnue : ${arg.slice(0, 40)}.`);
  }
  opts.baseUrl = normalizeBaseUrl(opts.url);
  opts.contextTokens = positiveInt(opts.contextTokens, 'REAL_AI_CONTEXT_TOKENS', { min: 2_048, max: 1_048_576 });
  opts.timeoutMs = positiveInt(opts.timeoutS, 'Le délai (REAL_AI_TIMEOUT_S)', { min: 5, max: 86_400 }) * 1000;
  opts.attempts = positiveInt(opts.attempts, 'Le nombre d\'essais (REAL_AI_ATTEMPTS)', { min: 1, max: 5 });
  if (!/^[\w.:/@+-]{1,200}$/.test(opts.model)) throw new Error(`Nom de modèle invalide : « ${opts.model.slice(0, 60)} ».`);
  return opts;
}

// ─── Vérifications de contenu (sans IA, testées à part) ────────────────────────

const FRENCH_WORDS = new Set([
  'le', 'la', 'les', 'des', 'de', 'du', 'un', 'une', 'et', 'est', 'en', 'pour', 'dans', 'que', 'qui', 'sur', 'au',
  'aux', 'par', 'avec', 'ce', 'cette', 'ces', 'il', 'elle', 'ils', 'elles', 'sont', 'leur', 'leurs', 'pas', 'plus',
  'nous', 'vous', 'se', 'sa', 'son', 'ses', 'ou', 'mais', 'comme', 'être', 'élèves', 'eau',
]);

/** Vrai si le texte ressemble à du français (mots courants, accents). Heuristique volontairement simple. */
export function looksFrench(text) {
  const words = String(text).toLowerCase().match(/[a-zàâäçéèêëîïôöùûüÿœæ]+/g) ?? [];
  const hits = words.filter(w => FRENCH_WORDS.has(w)).length;
  return hits >= 3 || (hits >= 1 && /[éèàçùêâ]/i.test(text));
}

const SOURCES_HEADING = '## Sources utilisées';

/**
 * Citations d'un contenu final (après finalizeCitations), pour `providedCount` sources fournies :
 *  - cited : numéros [Sn] valides cités dans le corps du texte (hors « Sources utilisées ») ;
 *  - citedInBody : au moins une citation valide ; citesS1 : « [S1] » en fait partie ;
 *  - sourcesSection : la section « Sources utilisées » est présente ;
 *  - listsDocument : cette section contient une ligne « [Sn] <nom du document> » ;
 *  - strayCitations : numéros [Sn] du corps qui ne correspondent à aucune source fournie (doivent avoir été retirés).
 */
export function inspectCitations(content, docName, providedCount = 1) {
  const text = String(content);
  const at = text.indexOf(SOURCES_HEADING);
  const body = at >= 0 ? text.slice(0, at) : text;
  const list = at >= 0 ? text.slice(at) : '';
  const numbers = [...body.matchAll(/\[S(\d+)\]/g)].map(m => Number(m[1]));
  const cited = [...new Set(numbers.filter(n => n >= 1 && n <= providedCount))].sort((a, b) => a - b);
  return {
    cited,
    citedInBody: cited.length > 0,
    citesS1: cited.includes(1),
    sourcesSection: at >= 0,
    listsDocument: list.split('\n').some(line => /\[S\d+\]/.test(line) && line.includes(docName)),
    strayCitations: [...new Set(numbers.filter(n => n < 1 || n > providedCount))],
  };
}

// ─── Document et demande de la chaîne complète ────────────────────────────────

// Document texte (.txt) : ses paragraphes contigus forment un seul passage (« lignes 1 à 16 »), donc une seule
// source, [S1]. Extrait par extractDocument, comme un fichier ajouté dans « Générer ».
export const DOC_NAME = 'cycle-de-l-eau.txt';
export const DOC_TEXT = `Le cycle de l'eau (document de la classe de CM1)

Les grandes étapes. Sous l'effet de la chaleur du Soleil, l'eau des océans, des lacs et des rivières s'évapore :
elle devient de la vapeur d'eau, invisible, qui monte dans l'atmosphère. En altitude, l'air est plus froid : la
vapeur se condense en fines gouttelettes qui forment les nuages. Quand les gouttes deviennent trop lourdes, elles
tombent : ce sont les précipitations (pluie, neige, grêle).

Le retour de l'eau vers la mer. Une partie de l'eau de pluie ruisselle sur le sol jusqu'aux rivières, qui
rejoignent la mer. Une autre partie s'infiltre dans le sol et alimente les nappes souterraines. Le cycle recommence
sans cesse : la quantité d'eau sur la Terre reste la même.

Expérience réalisée en classe. Nous avons posé un couvercle froid au-dessus d'une casserole d'eau chaude : des
gouttes se sont formées sous le couvercle puis sont retombées. Cette expérience montre la condensation et les
précipitations.
`;

const CONSIGNES = 'Cours très court : quinze lignes au plus. Appuie chaque idée sur le document fourni et cite-le.';

const SHORT_MESSAGES = [
  { role: 'system', content: 'Tu es Magistra, un assistant pédagogique. Réponds toujours en français, en deux phrases courtes.' },
  { role: 'user', content: "Propose un objectif d'apprentissage pour une séance sur les fractions en CM1." },
];

// ─── Cœur de Magistra compilé à la volée ──────────────────────────────────────

const CORE_ENTRY = `
export { createProvider } from './shared/ai/factory.js';
export { MIN_OLLAMA_VERSION, ollamaVersionStatus } from './shared/ai/models.js';
export { OllamaClient, sameModel } from './shared/ai/ollama.js';
export { runGeneration } from './shared/pipeline.js';
export { extractDocument } from './shared/documents/extract.js';
export { selectPassages } from './shared/documents/retrieve.js';
export { validateGenerationRequest } from './shared/validation.js';
`;

/** Compile les modules utiles de shared/ (TypeScript) avec l'esbuild du dépôt, puis les charge. */
export async function loadCore() {
  const dir = path.join(root, 'node_modules', '.cache', 'magistra');
  mkdirSync(dir, { recursive: true });
  // Nom propre à ce processus : deux vérifications simultanées ne se gênent pas.
  const outfile = path.join(dir, `real-ai-core-${process.pid}-${Date.now()}.mjs`);
  await build({
    stdin: { contents: CORE_ENTRY, resolveDir: root, sourcefile: 'real-ai-core.ts', loader: 'ts' },
    absWorkingDir: root,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    packages: 'external',
    legalComments: 'none',
    sourcemap: 'inline',
    logLevel: 'warning',
    outfile,
  });
  try {
    return await import(pathToFileURL(outfile).href);
  } finally {
    rmSync(outfile, { force: true });
  }
}

// ─── Rapport ──────────────────────────────────────────────────────────────────

/** Échappement des annotations GitHub Actions (::error::…). */
function ghEscape(text) {
  return String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

class Recorder {
  constructor(out, { secrets = [], github = false } = {}) {
    this.out = out;
    this.secrets = secrets.filter(s => s && s.length >= 4);
    this.github = github;
    this.checks = [];
    this.current = '';
  }
  /** Retire toute occurrence d'un secret (clé du proxy) d'un texte affiché ou écrit. */
  redact(text) {
    let s = String(text);
    for (const secret of this.secrets) s = s.split(secret).join('•••');
    return s;
  }
  section(title) {
    this.current = title;
    this.out('');
    this.out(`── ${title}`);
  }
  record(status, name, detail, ms) {
    const mark = status === 'ok' ? '✓' : status === 'warn' ? '!' : '✗';
    const text = this.redact(detail ? `${name} : ${detail}` : name);
    this.checks.push({ section: this.current, name, status, detail: detail ? this.redact(detail) : undefined, ...(ms !== undefined ? { ms } : {}) });
    this.out(`  ${mark} ${text}${ms !== undefined ? ` (${formatMs(ms)})` : ''}`);
    if (this.github && status === 'fail') this.out(`::error title=Vraie IA — ${ghEscape(this.current)}::${ghEscape(text)}`);
    if (this.github && status === 'warn') this.out(`::warning title=Vraie IA — ${ghEscape(this.current)}::${ghEscape(text)}`);
  }
  ok(name, detail, ms) { this.record('ok', name, detail, ms); }
  warn(name, detail, ms) { this.record('warn', name, detail, ms); }
  fail(name, detail, ms) { this.record('fail', name, detail, ms); }
  detail(text) { this.out(`      ${this.redact(text)}`); }
  get failures() { return this.checks.filter(c => c.status === 'fail').length; }
  get warnings() { return this.checks.filter(c => c.status === 'warn').length; }
}

function formatMs(ms) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

/** Message lisible d'une erreur (MagistraError : message français et code ; délai dépassé : explicite). */
function describeError(err, timeoutMs) {
  if (err && typeof err === 'object' && typeof err.code === 'string' && typeof err.message === 'string') {
    if (err.code === 'GENERATION_ABORTED') return `délai de ${Math.round(timeoutMs / 1000)} s dépassé (GENERATION_ABORTED)`;
    return `${err.message} (${err.code})`;
  }
  if (err && err.name === 'TimeoutError') return `délai de ${Math.round(timeoutMs / 1000)} s dépassé`;
  return err instanceof Error ? err.message : String(err);
}

function excerpt(text, max = 160) {
  const one = String(text).replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

// ─── Étapes ───────────────────────────────────────────────────────────────────

async function checkHealth(rec, provider, timeoutMs) {
  const t0 = Date.now();
  const health = await provider.health(AbortSignal.timeout(Math.min(timeoutMs, 120_000)));
  const ms = Date.now() - t0;
  if (!health.ok) {
    rec.fail('Test de santé', `${health.error?.message ?? 'échec'} (${health.error?.code ?? 'inconnu'})`, ms);
    return false;
  }
  if (health.warning?.code === 'AI_STATUS_UNKNOWN') {
    rec.fail('Test de santé', `état non vérifié : ${health.warning.message}`, ms);
    return false;
  }
  if (health.warning) rec.warn('Test de santé', `${health.warning.message} (${health.warning.code})`, ms);
  else rec.ok('Test de santé', health.version ? `prêt (Ollama ${health.version})` : 'prêt', ms);
  return true;
}

async function checkModels(rec, core, provider, model, timeoutMs) {
  const t0 = Date.now();
  try {
    const models = await provider.listModels(AbortSignal.timeout(Math.min(timeoutMs, 120_000)));
    const names = models.map(m => m.name);
    const found = names.find(n => core.sameModel(n, model));
    if (found) rec.ok('Liste des modèles', `« ${found} » présent (${names.length} modèle${names.length > 1 ? 's' : ''})`, Date.now() - t0);
    else rec.fail('Liste des modèles', `« ${model} » absent ; modèles disponibles : ${names.slice(0, 12).join(', ') || 'aucun'}. Installez-le : ollama pull ${model}`, Date.now() - t0);
    return names;
  } catch (err) {
    rec.fail('Liste des modèles', describeError(err, timeoutMs), Date.now() - t0);
    return [];
  }
}

async function checkShortGeneration(rec, provider, timeoutMs) {
  const t0 = Date.now();
  let first;
  let text = '';
  let end;
  try {
    for await (const ev of provider.stream({ messages: SHORT_MESSAGES, maxTokens: 96, temperature: 0.2, signal: AbortSignal.timeout(timeoutMs) })) {
      if (ev.type === 'delta') {
        if (first === undefined && ev.text.trim()) first = Date.now() - t0;
        text += ev.text;
      } else {
        end = ev;
      }
    }
  } catch (err) {
    rec.fail('Génération courte', describeError(err, timeoutMs), Date.now() - t0);
    return { text };
  }
  const ms = Date.now() - t0;
  const timing = `${first !== undefined ? `premier mot à ${formatMs(first)}, ` : ''}fin « ${end?.finishReason ?? 'absente'} »`;
  if (text.trim().length < 20) rec.fail('Génération courte', `texte vide ou trop court (« ${excerpt(text, 60)} ») ; ${timing}`, ms);
  else if (!end) rec.fail('Génération courte', `flux interrompu sans fin de génération ; ${timing}`, ms);
  else if (!looksFrench(text)) rec.fail('Génération courte', `la réponse ne semble pas rédigée en français : « ${excerpt(text)} »`, ms);
  else {
    const record = end.finishReason === 'unknown' ? rec.warn.bind(rec) : rec.ok.bind(rec);
    record('Génération courte en français', timing, ms);
    rec.detail(`« ${excerpt(text)} »`);
  }
  return { text, finishReason: end?.finishReason, firstTokenMs: first, ms };
}

async function checkPipeline(rec, core, opts, attempt) {
  const doc = await core.extractDocument({ id: 'doc-cycle-eau', name: DOC_NAME, bytes: new TextEncoder().encode(DOC_TEXT) });
  const passages = core.selectPassages([doc], "Le cycle de l'eau", { budgetChars: 20_000 });
  // Même validation que le serveur (POST /api/generate) et l'application Windows.
  const req = core.validateGenerationRequest({
    type: 'cours',
    niveau: 'cm1',
    matiere: 'sciences_primaire',
    sujet: "Le cycle de l'eau",
    duree: '45 min',
    consignes: CONSIGNES,
    researchMode: 'documents',
    documents: passages,
  });
  // Comme l'application Windows : moteur de ce poste, préchargement du modèle (« Chargement du modèle… »).
  const provider = core.createProvider({
    kind: 'ollama', baseUrl: opts.baseUrl, model: opts.model, apiKey: opts.apiKey, contextTokens: opts.contextTokens, recipient: 'poste',
  });
  const t0 = Date.now();
  const stages = [];
  const warnings = [];
  let sources;
  let done;
  let error;
  let first;
  try {
    for await (const ev of core.runGeneration(req, { provider, preloadModel: true, maxOutputTokens: 600, signal: AbortSignal.timeout(opts.timeoutMs) })) {
      if (ev.type === 'status') stages.push(ev.stage);
      else if (ev.type === 'sources') sources = ev.sources;
      else if (ev.type === 'warning') warnings.push(ev);
      else if (ev.type === 'delta') { if (first === undefined) first = Date.now() - t0; }
      else if (ev.type === 'done') done = ev;
      else if (ev.type === 'error') error = ev;
    }
  } catch (err) {
    error = { code: err?.code ?? 'ERREUR', message: describeError(err, opts.timeoutMs) };
  }
  const ms = Date.now() - t0;
  const label = opts.attempts > 1 ? ` (essai ${attempt}/${opts.attempts})` : '';
  if (error) {
    rec.fail(`Chaîne complète${label}`, `${error.message} (${error.code})`, ms);
    return { retry: false, ms };
  }
  if (!done) {
    rec.fail(`Chaîne complète${label}`, 'aucun évènement final (done) reçu', ms);
    return { retry: false, ms };
  }
  const citations = inspectCitations(done.content, DOC_NAME, sources?.length ?? 0);
  const result = {
    ms, firstTokenMs: first, stages: [...new Set(stages)], warnings: warnings.map(w => w.code), truncated: done.truncated,
    chars: done.content.length, citations, content: done.content,
  };

  // Évènements attendus de la chaîne (identiques pour le web et Windows).
  if (sources?.length === 1 && sources[0].kind === 'document' && sources[0].docName === DOC_NAME) rec.ok('Sources numérotées', `[S1] ${DOC_NAME}`);
  else rec.fail('Sources numérotées', `attendu : une seule source, [S1] ${DOC_NAME} ; reçu : ${(sources ?? []).map(s => `[S${s.n}] ${s.docName ?? s.title}`).join(', ') || 'aucune'}`);
  const expectedStages = ['loading_model', 'generating', 'finalizing'];
  const missing = expectedStages.filter(s => !stages.includes(s));
  if (missing.length === 0) rec.ok('Étapes', result.stages.join(' → '));
  else rec.fail('Étapes', `manquantes : ${missing.join(', ')} (reçues : ${result.stages.join(', ') || 'aucune'})`);
  for (const w of warnings) rec.detail(`avertissement de la chaîne : ${w.message} (${w.code})`);

  const timing = `${first !== undefined ? `premier mot à ${formatMs(first)}, ` : ''}${done.content.length} caractères${done.truncated ? ', longueur maximale atteinte' : ''}`;
  if (!looksFrench(done.content)) rec.fail(`Texte produit${label}`, `ne semble pas rédigé en français : « ${excerpt(done.content)} »`, ms);
  else rec.ok(`Texte produit${label}`, timing, ms);

  if (citations.strayCitations.length) rec.fail('Citations inventées retirées', `restent dans le texte : ${citations.strayCitations.map(n => `[S${n}]`).join(', ')}`);
  if (!citations.citesS1) {
    const retry = attempt < opts.attempts;
    (retry ? rec.warn.bind(rec) : rec.fail.bind(rec))(
      `Citation [S1] vérifiée${label}`,
      retry ? 'le modèle n\'a pas cité le document : nouvel essai' : 'le modèle n\'a jamais cité le document ([S1] absent du texte)',
    );
    rec.detail(`début du texte : « ${excerpt(done.content, 240)} »`);
    return { retry, ...result };
  }
  const occurrences = (done.content.split(SOURCES_HEADING)[0].match(/\[S1\]/g) ?? []).length;
  rec.ok('Citation [S1] vérifiée dans le texte', `${occurrences} occurrence${occurrences > 1 ? 's' : ''}`);
  const line = done.content.split('\n').find(l => l.includes('[S1]') && l.includes(DOC_NAME));
  if (citations.sourcesSection && citations.listsDocument) rec.ok('Section « Sources utilisées »', line ? line.replace(/^[-*]\s*/, '').trim() : DOC_NAME);
  else rec.fail('Section « Sources utilisées »', citations.sourcesSection ? `le document ${DOC_NAME} n'y figure pas` : 'section absente du texte final');
  return { retry: false, ...result };
}

// ─── Programme principal ──────────────────────────────────────────────────────

/**
 * Lance toutes les vérifications. Renvoie le code de sortie (0, 1 ou 2).
 * io.env : variables (process.env par défaut) ; io.out : sortie ligne à ligne (console.log par défaut).
 */
export async function main(argv = process.argv.slice(2), io = {}) {
  const env = io.env ?? process.env;
  const out = io.out ?? (line => console.log(line));
  let opts;
  try {
    opts = parseArgs(argv, env);
  } catch (err) {
    out(`Erreur : ${err.message}`);
    for (const line of USAGE) out(line);
    return 2;
  }
  if (opts.help) {
    for (const line of USAGE) out(line);
    return 0;
  }

  const github = env.GITHUB_ACTIONS === 'true';
  const rec = new Recorder(out, { secrets: [opts.apiKey], github });
  const report = {
    date: new Date().toISOString(),
    url: displayUrl(opts.baseUrl),
    model: opts.model,
    contextTokens: opts.contextTokens,
    timeoutS: opts.timeoutMs / 1000,
    checks: rec.checks,
    samples: {},
  };
  out(`Magistra — validation avec une vraie IA — ${displayUrl(opts.baseUrl)}, modèle ${opts.model}`);
  out(`Délai de chaque étape : ${Math.round(opts.timeoutMs / 1000)} s. Contexte demandé : ${opts.contextTokens} tokens.${opts.apiKey ? ' Clé de proxy : fournie (masquée).' : ''}`);

  let core;
  try {
    core = await loadCore();
  } catch (err) {
    out(`Erreur : compilation du cœur de Magistra impossible (${err instanceof Error ? err.message.split('\n')[0] : String(err)}). Lancez « npm ci ».`);
    return 1;
  }

  // 1. API native d'Ollama.
  rec.section('1. Ollama, API native (OllamaProvider)');
  let reachable = true;
  const client = new core.OllamaClient(opts.baseUrl, undefined, { apiKey: opts.apiKey, label: "Serveur d'IA", recipient: 'administrateur' });
  const t0 = Date.now();
  try {
    const version = await client.checkVersion(AbortSignal.timeout(Math.min(opts.timeoutMs, 60_000)), Math.min(opts.timeoutMs, 60_000));
    report.ollamaVersion = version;
    const status = core.ollamaVersionStatus(version);
    if (status === 'ok') rec.ok('Version d\'Ollama', `${version} (minimum ${core.MIN_OLLAMA_VERSION})`, Date.now() - t0);
    else if (status === 'outdated') rec.fail('Version d\'Ollama', `${version} : trop ancienne pour les modèles de Magistra (minimum ${core.MIN_OLLAMA_VERSION}). Mettez Ollama à jour.`, Date.now() - t0);
    else rec.warn('Version d\'Ollama', `« ${version} » : illisible, impossible de la comparer au minimum ${core.MIN_OLLAMA_VERSION}`, Date.now() - t0);
  } catch (err) {
    reachable = false;
    const code = err?.code;
    // Les messages du cœur s'adressent à l'administrateur du site : ici, on parle à celui qui lance la vérification.
    const detail = code === 'AI_SERVER_UNREACHABLE' || code === 'ENGINE_NOT_RUNNING' || code === 'AI_TIMEOUT'
      ? `Ollama ne répond pas à ${displayUrl(opts.baseUrl)} (${code}) : démarrez-le (« ollama serve ») ou corrigez REAL_AI_URL`
      : describeError(err, opts.timeoutMs);
    rec.fail('Version d\'Ollama', detail, Date.now() - t0);
  }

  if (reachable) {
    // Configuration du site web avec AI_PROVIDER=ollama (destinataire des conseils : l'administrateur).
    const native = core.createProvider({
      kind: 'ollama', baseUrl: opts.baseUrl, model: opts.model, apiKey: opts.apiKey, contextTokens: opts.contextTokens, recipient: 'administrateur',
    });
    const healthy = await checkHealth(rec, native, opts.timeoutMs);
    await checkModels(rec, core, native, opts.model, opts.timeoutMs);
    if (healthy) report.samples.native = await checkShortGeneration(rec, native, opts.timeoutMs);

    // 2. Même serveur par /v1 (compatible OpenAI), comme un serveur vLLM ou un préréglage en ligne.
    rec.section('2. Même Ollama par /v1 (OpenAICompatibleProvider)');
    const v1 = core.createProvider({
      kind: 'openai-compatible', baseUrl: `${opts.baseUrl}/v1`, model: opts.model, apiKey: opts.apiKey, label: "Serveur d'IA", recipient: 'administrateur',
    });
    if (await checkHealth(rec, v1, opts.timeoutMs)) {
      await checkModels(rec, core, v1, opts.model, opts.timeoutMs);
      report.samples.v1 = await checkShortGeneration(rec, v1, opts.timeoutMs);
    }

    // 3. Chaîne complète, avec un document et la vérification des citations.
    if (healthy) {
      rec.section('3. Chaîne complète runGeneration (document texte, citations vérifiées)');
      for (let attempt = 1; attempt <= opts.attempts; attempt++) {
        const result = await checkPipeline(rec, core, opts, attempt);
        report.samples.pipeline = { ...result, content: result.content?.slice(0, 6_000) };
        if (!result.retry) break;
      }
      if (report.samples.pipeline?.content) {
        out('');
        out('── Texte final (extrait)');
        for (const line of report.samples.pipeline.content.split('\n').slice(0, 40)) out(`    ${rec.redact(line)}`);
      }
    }
  }

  out('');
  const failures = rec.failures;
  const warnings = rec.warnings;
  out(failures === 0
    ? `Résultat : tout fonctionne avec la vraie IA${warnings ? ` (${warnings} avertissement${warnings > 1 ? 's' : ''})` : ''}.`
    : `Résultat : ${failures} échec${failures > 1 ? 's' : ''}${warnings ? `, ${warnings} avertissement${warnings > 1 ? 's' : ''}` : ''}.`);
  report.result = { failures, warnings };

  if (opts.report) {
    try {
      const file = path.resolve(opts.report);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, `${rec.redact(JSON.stringify(report, null, 2))}\n`);
      out(`Rapport : ${file}`);
    } catch (err) {
      out(`Rapport non écrit : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (github && env.GITHUB_STEP_SUMMARY) {
    try {
      const icon = { ok: '✓', warn: '!', fail: '✗' };
      const rows = rec.checks.map(c => `| ${icon[c.status]} | ${c.section.replace(/\|/g, '/')} | ${c.name.replace(/\|/g, '/')} | ${(c.detail ?? '').replace(/\|/g, '/').replace(/\n/g, ' ')} |`);
      appendFileSync(env.GITHUB_STEP_SUMMARY, [
        `### Validation avec une vraie IA — ${opts.model}${report.ollamaVersion ? ` (Ollama ${report.ollamaVersion})` : ''}`,
        '',
        '| | Étape | Vérification | Détail |',
        '|---|---|---|---|',
        ...rows,
        '',
      ].map(l => rec.redact(l)).join('\n'));
    } catch {
      // Résumé facultatif.
    }
  }
  return failures === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
