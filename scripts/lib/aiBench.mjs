// Outil du mainteneur (scripts/ai-bench.mjs) : mesure précise de la lenteur d'un Ollama, sans dépendance.
// Séparer le chargement du modèle, la lecture de la demande et la rédaction ; relever le placement (carte graphique,
// processeur) ; comparer plusieurs tailles de contexte (num_ctx) sur des demandes de tailles différentes.
//
// Aucune donnée réelle : les demandes sont des textes français SYNTHÉTIQUES. Fonctions pures (arguments, demandes,
// statistiques, tableau, lecture des mesures) exportées pour les tests ; runBench() fait les requêtes, par un `fetch`
// injectable. Les lectures des durées (nanosecondes) et de /api/ps reprennent les règles de shared/ai/timings.ts
// (tests/ci/aiBench.test.ts vérifie qu'elles donnent les mêmes résultats).

import { createHash } from 'node:crypto';

export const DEFAULTS = Object.freeze({
  url: 'http://127.0.0.1:11434',
  model: 'ministral-3:3b',
  ctx: Object.freeze([12_288]),
  runs: 1,
  scenarios: Object.freeze(['court']),
  numPredict: 128,
  timeoutS: 900,
});

/** Tailles de demande synthétiques, en jetons (estimation : ≈ 3,2 caractères par jeton, comme la pipeline). */
export const SCENARIOS = Object.freeze({ court: 300, moyen: 2_500, long: 8_000 });
export const CHARS_PER_TOKEN = 3.2;
/** Graine fixe et température 0 : sans changement de réglage, deux exécutions donnent le même texte. */
export const SEED = 42;
/** Au-delà, la seconde requête a rechargé le modèle (même contexte demandé : rien ne devrait être rechargé). */
export const RELOAD_THRESHOLD_MS = 500;
/** Marge gardée dans le contexte pour le gabarit de conversation (comme SAFETY_TOKENS de la pipeline). */
const SAFETY_TOKENS = 300;
const MAX_DURATION_MS = 24 * 3_600_000;
const MAX_DURATION_NS = MAX_DURATION_MS * 1_000_000;
const MAX_TOKENS = 100_000_000;
const MAX_TOKENS_PER_SECOND = 1_000_000;
const MAX_BYTES = 2 ** 50;

export const USAGE = [
  'Usage : node scripts/ai-bench.mjs [--url <adresse>] [--model <nom>] [--ctx 4096,8192,12288] [--runs <n>]',
  '                                  [--scenario court,moyen,long] [--json <fichier>] [--allow-remote]',
  `  --url <adresse>     Ollama à mesurer (défaut ${DEFAULTS.url}) ; une adresse qui n'est pas celle de cet ordinateur`,
  '                      est refusée sans --allow-remote',
  `  --model <nom>       modèle DÉJÀ installé (défaut ${DEFAULTS.model}) ; rien n'est jamais téléchargé`,
  `  --ctx <liste>       tailles de contexte (num_ctx) à comparer, séparées par des virgules (défaut ${DEFAULTS.ctx.join(',')})`,
  `  --runs <n>          exécutions par combinaison, médiane affichée (défaut ${DEFAULTS.runs})`,
  `  --scenario <liste>  court (~${SCENARIOS.court} jetons), moyen (~${SCENARIOS.moyen}), long (~${SCENARIOS.long}) ou tous (défaut ${DEFAULTS.scenarios.join(',')})`,
  `  --num-predict <n>   jetons de réponse au plus (défaut ${DEFAULTS.numPredict})`,
  '  --json <fichier>    écrit les mesures détaillées (jamais le texte produit : seulement son empreinte)',
  "  --allow-remote      autorise un Ollama qui n'est pas sur cet ordinateur (un texte de test synthétique lui est envoyé)",
  'Pour chaque combinaison, le modèle est déchargé, rechargé à froid (mesuré), puis une génération en flux (graine fixe,',
  "température 0) est mesurée : chargement, lecture de la demande, rédaction, premier mot, placement (/api/ps), empreinte",
  "du texte, et rechargement éventuel lors d'une seconde requête.",
];

// ─── Arguments ──────────────────────────────────────────────────────────────

function integer(raw, name, { min, max }) {
  const text = String(raw).trim();
  const n = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(n) || n < min || n > max) {
    throw new Error(`${name} doit être un nombre entier entre ${min} et ${max} (reçu « ${text.slice(0, 20)} »).`);
  }
  return n;
}

/** Même règle que shared/ai/loopback.ts (localhost, ::1, 127.x.x.x complet) ; tests/ci/aiBench.test.ts vérifie l'accord. */
export function isLoopbackUrl(url) {
  let host;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '::1') return true;
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return m !== null && m.slice(1).every(octet => Number(octet) <= 255);
}

/** Adresse normalisée (http ou https, sans barre finale ni /v1). Lève une Error en français si elle est inutilisable. */
export function normalizeBaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Adresse d'Ollama illisible (« ${String(raw).slice(0, 80)} ») : exemple http://127.0.0.1:11434.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error("L'adresse d'Ollama doit commencer par http:// ou https://.");
  if (url.username || url.password) throw new Error("L'adresse d'Ollama ne doit contenir ni identifiant ni mot de passe.");
  url.search = '';
  url.hash = '';
  return url.href.replace(/\/+$/, '').replace(/\/v1$/i, '').replace(/\/+$/, '');
}

/** Lit les options. Lève une Error (message en français) si elles sont invalides ; `help` demande l'aide seule. */
export function parseArgs(argv) {
  const opts = {
    url: DEFAULTS.url,
    model: DEFAULTS.model,
    ctx: [...DEFAULTS.ctx],
    runs: DEFAULTS.runs,
    scenarios: [...DEFAULTS.scenarios],
    numPredict: DEFAULTS.numPredict,
    json: undefined,
    allowRemote: false,
    timeoutMs: DEFAULTS.timeoutS * 1000,
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
    else if (arg === '--allow-remote') opts.allowRemote = true;
    else if (arg === '--url') opts.url = valueOf(i++, arg);
    else if (arg === '--model') opts.model = valueOf(i++, arg);
    else if (arg === '--ctx') opts.ctx = parseContextList(valueOf(i++, arg));
    else if (arg === '--runs') opts.runs = integer(valueOf(i++, arg), "Le nombre d'exécutions (--runs)", { min: 1, max: 20 });
    else if (arg === '--scenario') opts.scenarios = parseScenarios(valueOf(i++, arg));
    else if (arg === '--num-predict') opts.numPredict = integer(valueOf(i++, arg), 'Le nombre de jetons de réponse (--num-predict)', { min: 16, max: 2_048 });
    else if (arg === '--json') opts.json = valueOf(i++, arg);
    else throw new Error(`Option inconnue : ${arg.slice(0, 40)}.`);
  }
  if (opts.help) return opts;
  opts.baseUrl = normalizeBaseUrl(opts.url);
  if (!isLoopbackUrl(opts.baseUrl) && !opts.allowRemote) {
    throw new Error(
      `L'adresse ${opts.baseUrl} n'est pas celle de cet ordinateur : par défaut, seul le moteur local est mesuré. `
      + 'Ajoutez --allow-remote pour mesurer un serveur distant (il recevra un texte de test synthétique, sans aucune donnée réelle).',
    );
  }
  if (!/^[\w.:/@+-]{1,200}$/.test(opts.model)) throw new Error(`Nom de modèle invalide : « ${opts.model.slice(0, 60)} ».`);
  return opts;
}

function parseContextList(raw) {
  const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error("L'option --ctx attend au moins une taille (exemple : 4096,8192,12288).");
  const sizes = [...new Set(parts.map(p => integer(p, 'Une taille de contexte (--ctx)', { min: 512, max: 1_048_576 })))];
  if (sizes.length > 8) throw new Error('Au plus 8 tailles de contexte à la fois (--ctx).');
  return sizes;
}

function parseScenarios(raw) {
  const parts = raw.split(',').map(p => p.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 0) throw new Error("L'option --scenario attend court, moyen, long ou tous.");
  const names = parts.includes('tous') ? Object.keys(SCENARIOS) : parts;
  for (const name of names) {
    if (!Object.hasOwn(SCENARIOS, name)) throw new Error(`Scénario inconnu : « ${name.slice(0, 20)} » (court, moyen, long ou tous).`);
  }
  return [...new Set(names)];
}

// ─── Demandes synthétiques ──────────────────────────────────────────────────

const SENTENCES = [
  "Le cycle de l'eau décrit le trajet de l'eau entre les océans, l'atmosphère et les sols.",
  "Les élèves observent que la vapeur d'eau se condense lorsque l'air se refroidit en altitude.",
  "Une fraction représente le partage d'un tout en parts égales : le dénominateur indique le nombre de parts.",
  'Pour comparer deux fractions, on peut les ramener au même dénominateur avant de les ranger.',
  'La Révolution française débute en 1789 avec la convocation des États généraux et la prise de la Bastille.',
  'Un récit comporte une situation initiale, un élément déclencheur, des péripéties et une situation finale.',
  "Le verbe s'accorde avec son sujet en personne et en nombre, même lorsque le sujet est placé après lui.",
  'La photosynthèse permet aux plantes vertes de fabriquer de la matière organique grâce à la lumière.',
  "Un triangle rectangle possède un angle droit ; le carré de l'hypoténuse égale la somme des carrés des deux autres côtés.",
  "Les énergies renouvelables, comme le solaire et l'éolien, ne s'épuisent pas à l'échelle humaine.",
  "Pour résoudre un problème, on lit l'énoncé, on repère les données utiles, puis on choisit une méthode.",
  "La carte d'un pays montre ses frontières, ses villes principales, ses fleuves et son relief.",
  "En musique, la pulsation est le battement régulier sur lequel s'appuient le rythme et la mélodie.",
  'Un écosystème rassemble des êtres vivants et le milieu dans lequel ils vivent, avec leurs échanges.',
  'Les élèves rédigent un court texte argumentatif en donnant leur opinion puis deux arguments illustrés.',
  "Le Moyen Âge s'étend de la fin de l'Empire romain d'Occident à la fin du quinzième siècle.",
  'Une expérience scientifique suit une démarche : question, hypothèse, protocole, observation, conclusion.',
  "Les nombres décimaux s'écrivent avec une virgule qui sépare la partie entière de la partie décimale.",
  "Dans une phrase, le complément circonstanciel précise le lieu, le temps ou la manière de l'action.",
  'La respiration permet au corps d\'absorber le dioxygène nécessaire au fonctionnement des organes.',
  "Le périmètre d'un rectangle est le double de la somme de sa longueur et de sa largeur.",
  'Un texte documentaire informe le lecteur à l\'aide de titres, de schémas et de légendes.',
  "Le climat d'une région résulte de la moyenne des conditions météorologiques observées pendant trente ans.",
  'Pour mémoriser une leçon, on alterne relecture, reformulation à voix haute et exercices d\'application.',
];

const SYSTEM_PROMPT = 'Tu es un assistant pédagogique. Réponds en français, de façon claire et concise.';
const TASK = 'Consigne : résume ce document en quelques phrases, puis propose trois questions de compréhension.';

/** Estimation du nombre de jetons d'une conversation (≈ 3,2 caractères par jeton, 8 jetons de gabarit par message). */
export function estimateTokens(messages) {
  return messages.reduce((n, m) => n + Math.ceil(m.content.length / CHARS_PER_TOKEN) + 8, 0);
}

/**
 * Demande synthétique d'un scénario : un « document de cours » de paragraphes numérotés (phrases françaises tirées d'une
 * liste fixe) assez long pour approcher la taille visée, puis une consigne. Déterministe : même scénario, même texte.
 */
export function buildPrompt(scenario) {
  if (!Object.hasOwn(SCENARIOS, scenario)) throw new Error(`Scénario inconnu : ${String(scenario).slice(0, 20)}.`);
  const fixed = SYSTEM_PROMPT.length + TASK.length + 40;
  const targetChars = Math.max(0, Math.round(SCENARIOS[scenario] * CHARS_PER_TOKEN) - fixed);
  let doc = '';
  for (let i = 0; doc.length < targetChars; i++) doc += `Paragraphe ${i + 1}. ${SENTENCES[i % SENTENCES.length]}\n\n`;
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Voici un document de cours.\n\n${doc}${TASK}` },
  ];
  return { messages, estimatedTokens: estimateTokens(messages) };
}

/** Raison pour laquelle une combinaison n'est pas mesurée (demande + réponse + marge au-delà du contexte), sinon undefined. */
export function skipReason(ctx, estimatedTokens, numPredict) {
  const needed = estimatedTokens + numPredict + SAFETY_TOKENS;
  return needed > ctx ? `ignoré : la demande (~${estimatedTokens} jetons) et la réponse ne tiennent pas dans ${ctx} jetons de contexte` : undefined;
}

/** Empreinte courte (SHA-256) d'un texte : compare des productions sans les conserver. */
export function textFingerprint(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex').slice(0, 12);
}

// ─── Lecture des mesures d'Ollama (règles de shared/ai/timings.ts) ──────────

const isRecord = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const nanoseconds = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_DURATION_NS ? v : undefined);
const tokenCount = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_TOKENS ? Math.round(v) : undefined);
const nanosToMs = ns => (ns === undefined ? undefined : Math.round(ns / 1_000_000));

function perSecond(tokens, ns) {
  if (tokens === undefined || tokens <= 0 || ns === undefined || ns <= 0) return undefined;
  const rate = tokens / (ns / 1_000_000_000);
  return Number.isFinite(rate) && rate <= MAX_TOKENS_PER_SECOND ? Math.round(rate * 10) / 10 : undefined;
}

/** Durées du dernier objet NDJSON de /api/chat (nanosecondes → millisecondes) ; undefined si aucune durée exploitable. */
export function timingsFromFinal(chunk) {
  if (!isRecord(chunk)) return undefined;
  const total = nanoseconds(chunk.total_duration);
  const load = nanoseconds(chunk.load_duration);
  const promptNs = nanoseconds(chunk.prompt_eval_duration);
  const outputNs = nanoseconds(chunk.eval_duration);
  if (total === undefined && load === undefined && promptNs === undefined && outputNs === undefined) return undefined;
  const promptTokens = tokenCount(chunk.prompt_eval_count);
  const reported = tokenCount(chunk.prompt_eval_cached_count);
  const cached = promptTokens !== undefined && reported !== undefined && reported > 0 && reported <= promptTokens ? reported : undefined;
  const outputTokens = tokenCount(chunk.eval_count);
  const out = {
    totalMs: nanosToMs(total),
    loadMs: nanosToMs(load),
    promptTokens,
    promptCachedTokens: cached,
    promptMs: nanosToMs(promptNs),
    promptTokensPerSecond: perSecond(promptTokens === undefined ? undefined : promptTokens - (cached ?? 0), promptNs),
    outputTokens,
    outputMs: nanosToMs(outputNs),
    tokensPerSecond: perSecond(outputTokens, outputNs),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

const normalizeModel = name => {
  const n = name.trim().toLowerCase().replace(/^registry\.ollama\.ai\/library\//, '').replace(/^library\//, '');
  return n.slice(n.lastIndexOf('/') + 1).includes(':') ? n : `${n}:latest`;
};

/** Même nom de modèle (« x » = « x:latest », casse ignorée). */
export function sameModel(a, b) {
  return normalizeModel(a) === normalizeModel(b);
}

/** Placement du modèle d'après GET /api/ps (processor 'gpu' | 'cpu' | 'mixed', gpuPercent, tailles, contexte) ; sinon undefined. */
export function placementFromPs(psBody, model) {
  if (!isRecord(psBody) || !Array.isArray(psBody.models) || typeof model !== 'string' || !model.trim()) return undefined;
  const bytes = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_BYTES ? Math.round(v) : undefined);
  for (const entry of psBody.models) {
    if (!isRecord(entry)) continue;
    const names = [entry.name, entry.model].filter(n => typeof n === 'string' && n.trim() !== '');
    if (!names.some(n => sameModel(n, model))) continue;
    const sizeBytes = bytes(entry.size);
    if (sizeBytes === undefined || sizeBytes <= 0) return undefined;
    const sizeVramBytes = entry.size_vram === undefined || entry.size_vram === null ? 0 : bytes(entry.size_vram);
    if (sizeVramBytes === undefined) return undefined;
    const processor = sizeVramBytes >= sizeBytes ? 'gpu' : sizeVramBytes <= 0 ? 'cpu' : 'mixed';
    const share = Math.min(1, sizeVramBytes / sizeBytes);
    const gpuPercent = processor === 'gpu' ? 100 : processor === 'cpu' ? 0 : Math.min(99, Math.max(1, Math.round(share * 100)));
    const contextTokens = tokenCount(entry.context_length) || undefined;
    return { processor, gpuPercent, sizeBytes, sizeVramBytes, ...(contextTokens !== undefined ? { contextTokens } : {}) };
  }
  return undefined;
}

// ─── Statistiques et tableau ────────────────────────────────────────────────

/** Médiane des valeurs numériques finies (les autres sont ignorées) ; undefined s'il n'y en a aucune. */
export function median(values) {
  const sorted = values.filter(v => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Valeur la plus fréquente (égalité : la première rencontrée) ; undefined si la liste est vide. */
export function mostCommon(values) {
  const counts = new Map();
  for (const v of values) if (v !== undefined) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** Une exécution a rechargé le modèle si la seconde requête a dû le charger (durée de chargement au-delà du seuil). */
export function reloadDetected(secondLoadMs) {
  return typeof secondLoadMs === 'number' && Number.isFinite(secondLoadMs) && secondLoadMs > RELOAD_THRESHOLD_MS;
}

/**
 * Synthèse d'une combinaison (contexte, scénario) à partir de ses exécutions : médianes des durées et des vitesses,
 * placement le plus fréquent, empreintes distinctes, rechargement détecté dans au moins une exécution.
 */
export function summarizeRuns(runs) {
  const ok = runs.filter(r => !r.error);
  const processor = mostCommon(ok.map(r => r.placement?.processor));
  const fingerprints = ok.map(r => r.fingerprint).filter(Boolean);
  return {
    runs: runs.length,
    okRuns: ok.length,
    loadMs: median(ok.map(r => r.loadMs)),
    promptTokens: median(ok.map(r => r.timings?.promptTokens)),
    promptCachedTokens: median(ok.map(r => r.timings?.promptCachedTokens)),
    promptMs: median(ok.map(r => r.timings?.promptMs)),
    promptTokensPerSecond: median(ok.map(r => r.timings?.promptTokensPerSecond)),
    outputTokens: median(ok.map(r => r.timings?.outputTokens)),
    outputMs: median(ok.map(r => r.timings?.outputMs)),
    tokensPerSecond: median(ok.map(r => r.timings?.tokensPerSecond)),
    firstWordMs: median(ok.map(r => r.firstWordMs)),
    totalMs: median(ok.map(r => r.wallMs)),
    placement: ok.find(r => r.placement?.processor === processor)?.placement,
    fingerprint: fingerprints[0],
    distinctFingerprints: new Set(fingerprints).size,
    reload: ok.some(r => reloadDetected(r.secondLoadMs)),
  };
}

function seconds(ms) {
  return ms === undefined ? '–' : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

function amount(tokens, ms, rate) {
  if (tokens === undefined && ms === undefined) return '–';
  const parts = [
    tokens === undefined ? undefined : `${Math.round(tokens)} j`,
    ms === undefined ? undefined : seconds(ms),
    rate === undefined ? undefined : `${rate.toFixed(1)} j/s`,
  ];
  return parts.filter(Boolean).join(' · ');
}

/** « carte graphique », « processeur », « partagé (40 % carte) » ; « inconnu » quand /api/ps n'a rien donné. */
export function placementText(placement) {
  if (!placement) return 'inconnu';
  if (placement.processor === 'gpu') return 'carte graphique';
  if (placement.processor === 'cpu') return 'processeur';
  return `partagé (${placement.gpuPercent} % carte)`;
}

export const TABLE_HEADERS = ['contexte', 'scénario', 'chargement', 'lecture', 'rédaction', '1er mot', 'calcul', 'empreinte', 'rechargé'];

/** Lignes du tableau : une par combinaison, à partir de { ctx, scenario, estimatedTokens, skipped?, summary }. */
export function tableRows(results) {
  return results.map(r => {
    const base = [String(r.ctx), `${r.scenario} (~${r.estimatedTokens})`];
    if (r.skipped) return [...base, r.skipped, '', '', '', '', '', ''];
    const s = r.summary;
    if (s.okRuns === 0) return [...base, `échec : ${r.error ?? 'aucune mesure'}`, '', '', '', '', '', ''];
    const fingerprint = s.fingerprint ? `${s.fingerprint}${s.distinctFingerprints > 1 ? ` (+${s.distinctFingerprints - 1})` : ''}` : '–';
    return [
      ...base,
      seconds(s.loadMs),
      `${amount(s.promptTokens === undefined ? undefined : s.promptTokens - (s.promptCachedTokens ?? 0), s.promptMs, s.promptTokensPerSecond)}${
        s.promptCachedTokens ? ` (+${Math.round(s.promptCachedTokens)} en mémoire)` : ''}`,
      amount(s.outputTokens, s.outputMs, s.tokensPerSecond),
      seconds(s.firstWordMs),
      placementText(s.placement),
      fingerprint,
      s.reload ? 'oui' : 'non',
    ];
  });
}

/** Tableau texte aligné (colonnes séparées par « | »). */
export function formatTable(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length)));
  const line = cells => cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join(' | ').trimEnd();
  return [line(headers), widths.map(w => '-'.repeat(w)).join('-+-'), ...rows.map(line)].join('\n');
}

/** Découpe un flux de texte en lignes complètes (NDJSON) : push() rend les lignes terminées, flush() le reste. */
export function createLineSplitter() {
  let rest = '';
  return {
    push(chunk) {
      rest += chunk;
      const lines = rest.split('\n');
      rest = lines.pop() ?? '';
      return lines;
    },
    flush() {
      const last = rest;
      rest = '';
      return last ? [last] : [];
    },
  };
}

// ─── Mesures (requêtes) ─────────────────────────────────────────────────────

const defaultIo = () => ({
  fetch: (url, init) => fetch(url, init),
  now: () => performance.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  log: () => undefined,
});

class BenchError extends Error {}

async function call(io, opts, path, { method = 'GET', body, timeoutMs } = {}) {
  const signal = AbortSignal.timeout(timeoutMs ?? opts.timeoutMs);
  let res;
  try {
    res = await io.fetch(`${opts.baseUrl}${path}`, {
      method,
      signal,
      ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    const reason = String(err?.cause?.code ?? err?.message ?? err).slice(0, 80);
    throw new BenchError(signal.aborted ? `${path} : délai dépassé.` : `${path} : Ollama ne répond pas (${reason}).`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    let message = detail.slice(0, 160);
    try {
      const parsed = JSON.parse(detail);
      if (typeof parsed?.error === 'string') message = parsed.error.slice(0, 160);
    } catch {
      // Texte brut : gardé tel quel.
    }
    throw new BenchError(`${path} : HTTP ${res.status}${message ? ` (${message})` : ''}.`);
  }
  return res;
}

async function json(io, opts, path, init) {
  const res = await call(io, opts, path, init);
  try {
    return await res.json();
  } catch {
    throw new BenchError(`${path} : réponse illisible.`);
  }
}

/** Version, présence du modèle : un message clair avant toute mesure. Ne télécharge jamais rien. */
async function preflight(io, opts) {
  const version = await json(io, opts, '/api/version', { timeoutMs: 5_000 });
  const tags = await json(io, opts, '/api/tags', { timeoutMs: 10_000 });
  const names = (Array.isArray(tags?.models) ? tags.models : []).map(m => m?.name ?? m?.model).filter(n => typeof n === 'string');
  if (!names.some(n => sameModel(n, opts.model))) {
    throw new BenchError(`Le modèle ${opts.model} n'est pas installé sur ce moteur (« ollama pull ${opts.model} » ; rien n'est téléchargé par cet outil).`);
  }
  return typeof version?.version === 'string' ? version.version : 'inconnue';
}

async function placementNow(io, opts) {
  try {
    return placementFromPs(await json(io, opts, '/api/ps', { timeoutMs: 3_000 }), opts.model);
  } catch {
    return undefined;
  }
}

/** Décharge le modèle (keep_alive 0) puis attend qu'il ne soit plus listé par /api/ps (au plus quelques secondes). */
async function unload(io, opts) {
  await json(io, opts, '/api/generate', { method: 'POST', body: { model: opts.model, keep_alive: 0 }, timeoutMs: 60_000 });
  for (let i = 0; i < 20; i++) {
    let body;
    try {
      body = await json(io, opts, '/api/ps', { timeoutMs: 3_000 });
    } catch {
      await io.sleep(300);
      return;
    }
    const listed = Array.isArray(body?.models) && body.models.some(m => [m?.name, m?.model].some(n => typeof n === 'string' && sameModel(n, opts.model)));
    if (!listed) return;
    await io.sleep(250);
  }
}

function chatBody(opts, ctx, messages, numPredict) {
  return {
    model: opts.model,
    messages,
    stream: true,
    think: false,
    keep_alive: '5m',
    options: { num_ctx: ctx, num_predict: numPredict, temperature: 0, seed: SEED },
  };
}

/** Génération en flux : texte, délai avant le premier mot, dernier objet (durées). */
async function streamChat(io, opts, body) {
  const startedAt = io.now();
  const res = await call(io, opts, '/api/chat', { method: 'POST', body });
  if (!res.body) throw new BenchError('/api/chat : réponse sans corps.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const splitter = createLineSplitter();
  let text = '';
  let firstWordMs;
  let final;
  const handle = line => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(msg)) return;
    if (typeof msg.error === 'string') throw new BenchError(`/api/chat : ${msg.error.slice(0, 160)}.`);
    const piece = msg.message?.content;
    if (typeof piece === 'string' && piece.length > 0) {
      if (firstWordMs === undefined) firstWordMs = Math.round(io.now() - startedAt);
      text += piece;
    }
    if (msg.done === true) final = msg;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of splitter.push(decoder.decode(value, { stream: true }))) handle(line);
  }
  for (const line of splitter.push(decoder.decode())) handle(line);
  for (const line of splitter.flush()) handle(line);
  return { text, firstWordMs, final, wallMs: Math.round(io.now() - startedAt) };
}

/** Une exécution : déchargement, chargement à froid, génération en flux, placement, seconde requête (rechargement ?). */
async function measureOnce(io, opts, ctx, prompt) {
  await unload(io, opts);
  const loadStartedAt = io.now();
  const loaded = await json(io, opts, '/api/chat', {
    method: 'POST',
    body: { model: opts.model, messages: [], stream: false, keep_alive: '5m', options: { num_ctx: ctx } },
    timeoutMs: opts.timeoutMs,
  });
  const loadWallMs = Math.round(io.now() - loadStartedAt);
  const loadDuration = timingsFromFinal(loaded)?.loadMs;

  const first = await streamChat(io, opts, chatBody(opts, ctx, prompt.messages, opts.numPredict));
  const timings = timingsFromFinal(first.final);
  const placement = await placementNow(io, opts);

  // Seconde requête, mêmes réglages : si le moteur doit recharger le modèle, load_duration le montre.
  const second = await streamChat(io, opts, chatBody(opts, ctx, prompt.messages, 1));
  const secondLoadMs = timingsFromFinal(second.final)?.loadMs;

  return {
    loadMs: loadDuration ?? loadWallMs,
    loadWallMs,
    firstWordMs: first.firstWordMs,
    wallMs: first.wallMs,
    timings,
    placement,
    fingerprint: first.text ? textFingerprint(first.text) : undefined,
    outputChars: first.text.length,
    secondLoadMs,
  };
}

/**
 * Mesure toutes les combinaisons (contexte × scénario). `io` (tests) : { fetch, now, sleep, log }. Une exécution qui
 * échoue est notée (`error`), les autres continuent ; une erreur de préparation (moteur arrêté, modèle absent) est levée.
 * Résultat : { version, results: [{ ctx, scenario, estimatedTokens, skipped?, runs, summary, error? }] }.
 */
export async function runBench(opts, ioOverrides = {}) {
  const io = { ...defaultIo(), ...ioOverrides };
  const version = await preflight(io, opts);
  const results = [];
  for (const ctx of opts.ctx) {
    for (const scenario of opts.scenarios) {
      const prompt = buildPrompt(scenario);
      const skipped = skipReason(ctx, prompt.estimatedTokens, opts.numPredict);
      if (skipped) {
        results.push({ ctx, scenario, estimatedTokens: prompt.estimatedTokens, skipped, runs: [], summary: summarizeRuns([]) });
        continue;
      }
      const runs = [];
      for (let i = 0; i < opts.runs; i++) {
        io.log(`contexte ${ctx}, ${scenario} : exécution ${i + 1}/${opts.runs}…`);
        try {
          runs.push(await measureOnce(io, opts, ctx, prompt));
        } catch (err) {
          runs.push({ error: err instanceof BenchError ? err.message : 'mesure impossible.' });
        }
      }
      const failed = runs.find(r => r.error);
      results.push({
        ctx, scenario, estimatedTokens: prompt.estimatedTokens, runs, summary: summarizeRuns(runs), ...(failed ? { error: failed.error } : {}),
      });
    }
  }
  return { version, results };
}

/** Rapport JSON : paramètres et mesures détaillées, jamais le texte produit ni l'adresse du moteur. */
export function buildReport(opts, version, results, now = new Date()) {
  return {
    generatedAt: now.toISOString(),
    engineVersion: version,
    model: opts.model,
    local: isLoopbackUrl(opts.baseUrl),
    ctx: opts.ctx,
    runs: opts.runs,
    scenarios: opts.scenarios,
    numPredict: opts.numPredict,
    seed: SEED,
    results,
  };
}
