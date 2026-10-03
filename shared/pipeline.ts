// Pipeline unique de génération, utilisé par le serveur web ET par l'application Windows.
//
// demande validée → recherche (facultative) → sources numérotées → prompt → streaming
//                → mise en page (texte à trous, QCM) → citations vérifiées → nombre d'éléments contrôlé
//                → sauvegarde → évènement final
//
// Les évènements produits (GenerationEvent) sont transmis tels quels au navigateur
// (flux NDJSON) ou à la fenêtre Electron (IPC).

import type { AIProvider, Usage } from './ai/provider.js';
import { cleanEnginePlacement, cleanEngineTimings } from './ai/timings.js';
import { getMatiereLabel, getToolLabel, type TypeContenu } from './catalog.js';
import { documentSourceRef, extractUrls, finalizeCitations } from './citations.js';
import { buildClozeDocument, ClozeStream, isClozeRequest } from './cloze.js';
import { rankChunks } from './documents/retrieve.js';
import { MagistraError, toMagistraError, type ErrorCode } from './errors.js';
import { normalizeExerciseLayout } from './exerciseLayout.js';
import { getLevelGroup, getNiveauLabel } from './levels.js';
import { unwrapDocumentFence } from './markdownFence.js';
import { checkCopyQuotes, checkOutputStructure } from './outputChecks.js';
import { buildMessages, estimateTokens, generationTemperature, targetLanguageOf, type PromptSource } from './prompts/index.js';
import { planResearch, runResearch, type ResearchConfig, type ResearchDeps, type ResearchOutcome } from './research/index.js';
import type { ResearchSource } from './research/types.js';
import { normalizeFrenchTypography } from './typography.js';
import {
  modeUsesDocuments, type DocumentPassage, type GenerationEvent, type GenerationMetrics, type GenerationRecordDraft, type GenerationRequest,
  type SourceRef,
} from './types.js';
import { displaySujet, RECORD_LIMITS } from './validation.js';

export type NewGenerationRecord = GenerationRecordDraft;

export interface PipelineDeps {
  provider: AIProvider;
  research?: { config: ResearchConfig; deps: ResearchDeps };
  /** Enregistre la génération ; absent = pas de sauvegarde. */
  save?: (record: NewGenerationRecord) => Promise<{ id: string }>;
  /**
   * Sans `save` : joindre la génération prête à enregistrer à l'évènement « done » (champ `record`). Utilisé par le
   * connecteur local de l'application Windows : c'est le site qui l'enregistre dans l'historique du compte.
   */
  includeRecord?: boolean;
  signal?: AbortSignal;
  /** Plafond de tokens produits. */
  maxOutputTokens?: number;
  /** Délai maximal accordé à la sauvegarde (60 s par défaut) : au-delà, le contenu est rendu sans être enregistré. */
  saveTimeoutMs?: number;
  /**
   * Attentes avant chaque nouvel essai automatique (serveur d'IA surchargé ou indisponible). Le nombre
   * d'éléments fixe le nombre de nouveaux essais ; un délai conseillé par le serveur (Retry-After ≤ 15 s,
   * MagistraError.retryAfterMs) remplace l'attente prévue. [] = aucun nouvel essai.
   */
  retryDelaysMs?: readonly number[];
  /**
   * Précharger le modèle avant la rédaction (fournisseurs qui l'implémentent : Ollama), avec le statut
   * « Chargement du modèle… » (étape loading_model). Utile pour le moteur local : l'attente du premier mot
   * ne compte plus le chargement. Désactivé par défaut.
   */
  preloadModel?: boolean;
  /** Horloge en millisecondes (tests) : défaut performance.now(). Sert aux seules mesures de vitesse (GenerationMetrics). */
  now?: () => number;
}

/**
 * Surcharge ou indisponibilité PASSAGÈRE du serveur d'IA AVANT tout texte produit : Magistra réessaie
 * automatiquement, avec une attente croissante (ou celle conseillée par le serveur), avant d'afficher l'erreur.
 * Jamais après le premier mot (le texte serait dupliqué) ni après « Arrêter ».
 * Volontairement absents : AI_SERVER_UNREACHABLE (adresse injoignable : réessayer ne sert à rien),
 * AI_QUOTA_EXCEEDED (quota : attendre la reprise annoncée), ENGINE_OUTDATED.
 */
export const TRANSIENT_AI_ERRORS: readonly ErrorCode[] = ['AI_BUSY', 'AI_SERVER_UNAVAILABLE'];
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000];
/** Au-delà de cette attente conseillée par le serveur, pas de nouvel essai automatique (l'erreur est affichée). */
export const MAX_AUTO_RETRY_WAIT_MS = 15_000;

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new MagistraError('GENERATION_ABORTED'));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new MagistraError('GENERATION_ABORTED'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const CHARS_PER_TOKEN = 3.2;
/** Marge de sécurité (estimation des tokens, gabarit de conversation du modèle). */
const SAFETY_TOKENS = 300;
/** En dessous, la réponse serait trop courte pour être utile : mieux vaut signaler une demande trop longue. */
const MIN_OUTPUT_TOKENS = 1_024;
/** Taille minimale d'un extrait tronqué pour qu'il reste utile. */
const MIN_PASSAGE_CHARS = 400;
/** Outils pour lesquels une recherche documentaire a du sens. */
const RESEARCH_TOOLS: ReadonlySet<TypeContenu> = new Set<TypeContenu>([
  'cours', 'exercices', 'evaluation', 'sequence', 'fiche_prep', 'progression', 'differenciation',
]);

function messagesTokens(messages: { content: string }[]): number {
  // + gabarit de conversation (rôles, balises spéciales).
  return messages.reduce((n, m) => n + estimateTokens(m.content) + 8, 0);
}

/**
 * Calcule la place disponible pour les sources, selon la taille de contexte du modèle.
 * Garantit : prompt (hors sources) + sources + sortie ≤ contextTokens.
 * `fits` est faux si la demande seule (texte collé, consignes…) ne laisse pas assez de place à la réponse.
 */
export function computeBudgets(provider: AIProvider, req: GenerationRequest, maxOutputTokens?: number) {
  const ctx = provider.contextTokens;
  const base = buildMessages({ ...req, documents: undefined }, []);
  // Le prompt avec sources est un peu plus long (règles d'utilisation des sources, en-tête du bloc).
  const baseTokens = messagesTokens(base) + 250;
  const wanted = Math.max(1, Math.min(maxOutputTokens ?? 6_000, Math.floor(ctx * 0.4)));
  const minOutputTokens = Math.min(MIN_OUTPUT_TOKENS, wanted);
  const output = Math.max(0, Math.min(wanted, ctx - baseTokens - SAFETY_TOKENS));
  const sourcesTokens = Math.max(0, ctx - output - baseTokens - SAFETY_TOKENS);
  return {
    outputTokens: output,
    sourcesChars: Math.floor(sourcesTokens * CHARS_PER_TOKEN),
    promptTokens: baseTokens,
    minOutputTokens,
    fits: output >= minOutputTokens,
  };
}

/**
 * Requête envoyée aux services de recherche : sujet et discipline uniquement — jamais le texte des documents, des
 * consignes ni les objectifs (texte libre : il peut nommer des élèves ; l'interface annonce « votre sujet et vos
 * mots-clés »).
 */
function researchQueryText(req: GenerationRequest): string {
  return [req.sujet, req.discipline]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Requête de classement des passages de documents (local, jamais envoyée) : la recherche + les objectifs. */
function rankingQueryText(req: GenerationRequest): string {
  return [researchQueryText(req), req.objectifs?.slice(0, 120)]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Requête de classement des passages des documents (local, jamais envoyée) : celle ci-dessus et les consignes ; pour la
 * différenciation et la correction, dont le sujet est facultatif, le début du texte à adapter ou de la copie la complète
 * quand le sujet et les objectifs tiennent en moins de 40 caractères (sinon la requête se réduirait à « SVT »).
 */
function passageQueryText(req: GenerationRequest): string {
  const base = `${rankingQueryText(req)} ${req.consignes ?? ''}`.replace(/\s+/g, ' ').trim();
  if (`${req.sujet ?? ''} ${req.objectifs ?? ''}`.trim().length >= 40) return base;
  const excerpt = (req.contenuSource ?? req.texteEleve ?? '').slice(0, 1_200).replace(/\s+/g, ' ').trim().slice(0, 300);
  return excerpt ? `${base} ${excerpt}`.trim() : base;
}

/** Coût (en caractères) d'un passage dans le prompt : texte + ligne de description + délimiteurs. */
function passageCost(p: DocumentPassage): number {
  return p.text.length + p.docName.length + 90;
}

/** Coupe un texte à une frontière de paragraphe ou de phrase, et signale la coupure. */
function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, Math.max(0, max - 6));
  const cut = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('. '), slice.lastIndexOf('\n'));
  return `${cut > max * 0.5 ? slice.slice(0, cut + 1) : slice}`.trimEnd() + ' […]';
}

/** Réduit les passages de documents au budget, en gardant les plus pertinents (dans l'ordre de lecture). */
function fitPassages(passages: DocumentPassage[], query: string, budget: number): { passages: DocumentPassage[]; reduced: boolean } {
  const total = passages.reduce((n, p) => n + passageCost(p), 0);
  if (total <= budget) return { passages, reduced: false };
  const ranked = rankChunks(passages.map((p, i) => ({ ...p, order: i })), query).sort((a, b) => b.score - a.score || a.order - b.order);
  const keep = new Map<number, DocumentPassage>();
  let used = 0;
  for (const p of ranked) {
    const cost = passageCost(p);
    if (used + cost > budget) {
      // Un passage pertinent trop long pour la place restante n'est pas écarté au profit de passages moins pertinents :
      // on en garde le début (localisation marquée « (extrait) »), et le budget est alors épuisé.
      const room = budget - used - (cost - p.text.length);
      if (p.score > 0 && room >= MIN_PASSAGE_CHARS) {
        keep.set(p.order, { ...passages[p.order], text: truncateText(p.text, room), locator: { ...passages[p.order].locator, partial: true } });
        break;
      }
      continue;
    }
    keep.set(p.order, passages[p.order]);
    used += cost;
  }
  if (keep.size === 0 && ranked.length > 0) {
    // Aucun passage entier ne tient : on garde le début du plus pertinent.
    const best = passages[ranked[0].order];
    const room = budget - (passageCost(best) - best.text.length);
    if (room >= MIN_PASSAGE_CHARS) {
      // Seul le début du passage est transmis : la localisation est marquée « (extrait) ».
      keep.set(ranked[0].order, { ...best, text: truncateText(best.text, room), locator: { ...best.locator, partial: true } });
    }
  }
  return { passages: [...keep.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p), reduced: true };
}

/** Texte borné à `max` caractères (UTF-16, comme la validation), terminé par « … » s'il a été coupé ; vide → undefined. */
function clipMeta(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Une seule ligne : les titres viennent de tiers (pages web, notices) ; un saut de ligne y ajouterait des titres,
  // des listes ou des instructions au document et au prompt.
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 1);
  // Jamais une moitié de caractère (paire de substitution coupée).
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/**
 * Référence d'une source de RECHERCHE, métadonnées bornées comme l'enregistrement de l'historique (RECORD_LIMITS de
 * validateGenerationRecordDraft) : un titre de thèse ou un intitulé d'actes démesuré est raccourci, une adresse ou un
 * DOI hors format est omis. Sinon POST /api/generation refuserait toute la génération faite par Magistra locale.
 */
function researchSourceRef(n: number, s: ResearchSource): SourceRef {
  const authors = s.authors
    ?.slice(0, RECORD_LIMITS.maxAuthors)
    .map(a => clipMeta(a, RECORD_LIMITS.author))
    .filter((a): a is string => a !== undefined);
  const year = typeof s.year === 'number' && Number.isInteger(s.year) && s.year >= 0 && s.year <= 9_999 ? s.year : undefined;
  const doi = typeof s.doi === 'string' && s.doi.trim() && s.doi.trim().length <= RECORD_LIMITS.doi && !/\s/.test(s.doi.trim()) ? s.doi.trim() : undefined;
  const url = typeof s.url === 'string' && s.url.length <= RECORD_LIMITS.url && /^https?:\/\/\S+$/i.test(s.url) ? s.url : undefined;
  return {
    n,
    kind: s.kind,
    title: clipMeta(s.title, RECORD_LIMITS.sourceTitle) ?? 'Source sans titre',
    authors: authors?.length ? authors : undefined,
    year,
    venue: clipMeta(s.venue, RECORD_LIMITS.venue),
    doi,
    url,
  };
}

function recordParams(req: GenerationRequest): Record<string, unknown> {
  const params: Record<string, unknown> = {
    researchMode: req.researchMode,
    duree: req.duree,
    objectifs: req.objectifs,
    consignes: req.consignes,
    difficulte: req.difficulte,
    format: req.format,
    trimestre: req.trimestre,
    profilEleve: req.profilEleve,
    nombreAppreciations: req.nombreAppreciations,
    profilsDifferenciation: req.profilsDifferenciation,
    typeLettre: req.typeLettre,
    contenuSource: req.contenuSource,
    modalite: req.modalite,
    typeEvaluation: req.typeEvaluation,
    bareme: req.bareme,
    sansCorrige: req.sansCorrige,
    nombreExercices: req.nombreExercices,
    nombreSeances: req.nombreSeances,
    ton: req.ton,
    besoins: req.besoins,
    // Le travail d'élève n'est pas conservé (donnée personnelle) : seule sa longueur est notée.
    texteEleveLength: req.texteEleve ? req.texteEleve.length : undefined,
    documents: req.documents ? [...new Set(req.documents.map(d => d.docName))] : undefined,
  };
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new MagistraError('STORAGE_ERROR')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

interface MetricsInput {
  totalMs: number;
  prepMs?: number;
  waitModelMs?: number;
  preloadLoadMs?: number;
  firstWordMs?: number;
  usage?: Usage;
  promptTokens: number;
  outputBudgetTokens: number;
}

/**
 * Mesures jointes à « done » : uniquement des nombres et des énumérations (jamais de texte). Les durées du moteur et
 * le placement ne sont donnés que pour le moteur de cet ordinateur ; ce qu'un fournisseur renvoie est filtré champ par champ.
 */
function buildMetrics(provider: AIProvider, m: MetricsInput): GenerationMetrics {
  const engine = provider.local ? cleanEngineTimings(m.usage?.timings) : undefined;
  const placement = provider.local ? cleanEnginePlacement(m.usage?.placement) : undefined;
  const contextTokens = Number.isFinite(provider.contextTokens) ? Math.max(0, Math.round(provider.contextTokens)) : 0;
  return {
    totalMs: m.totalMs,
    ...(m.prepMs !== undefined ? { prepMs: m.prepMs } : {}),
    ...(m.waitModelMs !== undefined ? { waitModelMs: m.waitModelMs } : {}),
    ...(provider.local && m.preloadLoadMs !== undefined ? { preloadLoadMs: m.preloadLoadMs } : {}),
    ...(m.firstWordMs !== undefined ? { firstWordMs: m.firstWordMs } : {}),
    ...(engine ? { engine } : {}),
    ...(placement ? { placement } : {}),
    contextTokens,
    promptTokens: m.promptTokens,
    outputBudgetTokens: m.outputBudgetTokens,
  };
}

const DOCS_REDUCED_WARNING = 'Vos documents dépassent la capacité du modèle : seuls les passages les plus pertinents ont été utilisés.';

export async function* runGeneration(req: GenerationRequest, deps: PipelineDeps): AsyncGenerator<GenerationEvent> {
  const { provider, signal } = deps;
  const now = deps.now ?? (() => performance.now());
  const startedAt = now();
  const elapsedSince = (from: number) => Math.max(0, Math.round(now() - from));
  let text = '';
  let providedForPartial: SourceRef[] = [];
  let allowedUrls: string[] = [];
  let allowedExactUrls: string[] = [];
  // Texte à trous : le modèle marque les mots à trouver ([[mot]]) ; Magistra pose les blancs numérotés, la banque de
  // mots et le corrigé (shared/cloze.ts), à l'affichage en direct comme dans le document final.
  const cloze = isClozeRequest(req) ? { max: req.nombreExercices, withKey: !req.sansCorrige } : null;
  // Choix de QCM et questions numérotées écrits ligne à ligne : mis en liste et séparés (shared/exerciseLayout.ts),
  // sinon ils s'afficheraient en un seul paragraphe. Document final comme texte partiel (enregistrés, exportés ainsi).
  const shape = (body: string) => normalizeExerciseLayout(cloze ? buildClozeDocument(body, cloze) : body);
  // Espaces insécables de la typographie française : sur le document final seulement (jamais sur les morceaux affichés
  // en direct), sauf quand le contenu est écrit dans une langue étudiée (ponctuation de la langue cible) : les
  // appréciations et les lettres aux parents d'une matière de langue restent en français, donc typographiées.
  const typeset = (body: string) => (targetLanguageOf(req) ? body : normalizeFrenchTypography(body));
  try {
    if (signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
    const budgets = computeBudgets(provider, req, deps.maxOutputTokens);
    if (!budgets.fits) {
      throw new MagistraError('CONTEXT_TOO_LARGE',
        'La demande est trop longue pour ce modèle : raccourcissez le texte collé (travail à corriger, contenu à adapter) ou les consignes.');
    }
    const group = getLevelGroup(req.niveau);
    const plan = planResearch(req.researchMode, group);
    const networkMode = plan.academic || plan.web || plan.institutional || plan.wikipedia;
    const query = researchQueryText(req);
    const hasTopic = Boolean(req.sujet?.trim());
    // Chargement du modèle (Ollama) lancé tout de suite, pendant la sélection des passages et la recherche : l'attente
    // du premier mot ne le compte plus. Un échec est repris plus bas ; jamais de rejet non géré si la recherche, ou
    // « Arrêter », met fin à la génération avant.
    let preload: Promise<void> | undefined;
    let preloadLoadMs: number | undefined;
    if (deps.preloadModel && typeof provider.preload === 'function') {
      preload = Promise.resolve()
        .then(() => provider.preload!({ signal }))
        .then(result => {
          if (result && typeof result.loadMs === 'number') preloadLoadMs = result.loadMs;
        });
      preload.catch(() => {});
    }
    const toolUsesResearch = RESEARCH_TOOLS.has(req.type);
    const wantsResearch = networkMode && toolUsesResearch && hasTopic;

    // ─── Sources : documents de l'enseignant d'abord ─────────────────────
    const docs = modeUsesDocuments(req.researchMode) ? req.documents ?? [] : [];
    if (docs.length > 0) yield { type: 'status', stage: 'context', message: 'Sélection des passages utiles de vos documents…' };
    const docBudget = wantsResearch && deps.research ? Math.floor(budgets.sourcesChars * 0.6) : budgets.sourcesChars;
    const fitted = fitPassages(docs, passageQueryText(req), docBudget);
    let docsWarned = false;
    if (docs.length > 0 && fitted.reduced) {
      docsWarned = true;
      yield { type: 'warning', code: 'CONTEXT_TOO_LARGE', message: DOCS_REDUCED_WARNING };
    }
    const sources: PromptSource[] = fitted.passages.map((p, i) => ({ ref: documentSourceRef(p, i + 1), text: p.text }));
    let docCount = sources.length;

    // ─── Recherche dynamique (académique / Internet) ─────────────────────
    let internetUsed = false;
    if (networkMode && !toolUsesResearch) {
      yield { type: 'warning', code: 'RESEARCH_UNAVAILABLE', message: "La recherche en ligne n'est pas utilisée pour cet outil : génération à partir de vos consignes." };
    } else if (networkMode && !hasTopic) {
      yield { type: 'warning', code: 'RESEARCH_UNAVAILABLE', message: 'Recherche en ligne non effectuée : indiquez un sujet pour permettre la recherche de sources.' };
    } else if (wantsResearch && !deps.research) {
      yield { type: 'warning', code: 'RESEARCH_UNAVAILABLE', message: 'La recherche en ligne n’est pas disponible ici : génération à partir des autres sources.' };
    } else if (wantsResearch && deps.research) {
      yield { type: 'status', stage: 'research', message: plan.academic && !plan.web ? 'Recherche de publications académiques…' : 'Recherche de sources en ligne…' };
      const usedChars = fitted.passages.reduce((n, p) => n + passageCost(p), 0);
      let outcome: ResearchOutcome;
      try {
        outcome = await runResearch(
          { text: query, topic: req.sujet, mode: req.researchMode, group },
          deps.research.config,
          deps.research.deps,
          { budgetChars: Math.max(0, budgets.sourcesChars - usedChars), signal },
        );
      } catch {
        // Une panne imprévue de la recherche ne doit jamais empêcher la génération.
        outcome = { sources: [], internetUsed: false, warnings: [{ code: 'RESEARCH_UNAVAILABLE', message: 'Recherche en ligne indisponible : génération à partir des autres sources.' }] };
      }
      if (signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
      for (const w of outcome.warnings) yield { type: 'warning', code: w.code, message: w.message };
      for (const s of outcome.sources) {
        sources.push({ ref: researchSourceRef(sources.length + 1, s), text: s.text });
      }
    }

    // ─── Contrôle final du budget : prompt complet + sortie ≤ contexte ───
    let messages = buildMessages(req, sources);
    let outputTokens = budgets.outputTokens;
    while (sources.length > 0 && messagesTokens(messages) + outputTokens + SAFETY_TOKENS > provider.contextTokens) {
      // Les sources les moins prioritaires sont en fin de liste (recherche, puis derniers passages).
      sources.pop();
      if (sources.length < docCount) {
        docCount = sources.length;
        if (!docsWarned) {
          docsWarned = true;
          yield { type: 'warning', code: 'CONTEXT_TOO_LARGE', message: DOCS_REDUCED_WARNING };
        }
      }
      messages = buildMessages(req, sources);
    }
    const promptTokens = messagesTokens(messages);
    if (promptTokens + outputTokens + SAFETY_TOKENS > provider.contextTokens) {
      outputTokens = provider.contextTokens - promptTokens - SAFETY_TOKENS;
      if (outputTokens < budgets.minOutputTokens) throw new MagistraError('CONTEXT_TOO_LARGE');
    }
    internetUsed = sources.some(s => s.ref.kind !== 'document');

    const provided = sources.map(s => s.ref);
    // Liens légitimes en plus de ceux des sources : ceux des extraits transmis et de la demande de l'enseignant.
    // Texte de documents : même règle que les sources (le site, ou une page plus précise). Texte de pages web ou
    // d'encyclopédie : adresse exacte seulement (une page qui cite « https://exemple.fr » n'autorise pas tout son site).
    allowedUrls = [
      ...sources.filter(s => s.ref.kind === 'document').flatMap(s => extractUrls(s.text)),
      ...[req.sujet, req.objectifs, req.consignes, req.contenuSource, req.texteEleve].flatMap(t => (t ? extractUrls(t) : [])),
    ];
    allowedExactUrls = sources.filter(s => s.ref.kind !== 'document').flatMap(s => extractUrls(s.text));
    const prepMs = elapsedSince(startedAt);
    yield { type: 'sources', sources: provided, internetUsed };

    // ─── Chargement du modèle (facultatif) ───────────────────────────────
    let preloaded = false;
    let waitModelMs: number | undefined;
    if (preload) {
      yield { type: 'status', stage: 'loading_model', message: 'Chargement du modèle…' };
      const waitStartedAt = now();
      try {
        await preload;
        preloaded = true;
      } catch (err) {
        // Une panne passagère est laissée aux nouveaux essais de la rédaction ; le reste est affiché tout de suite.
        if (!(err instanceof MagistraError && TRANSIENT_AI_ERRORS.includes(err.code))) throw err;
      }
      waitModelMs = elapsedSince(waitStartedAt);
      if (signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
    }

    // ─── Génération en flux ──────────────────────────────────────────────
    yield {
      type: 'status',
      stage: 'generating',
      message: !provider.local
        ? 'Rédaction en cours…'
        : preloaded
          ? 'Le modèle lit votre demande puis rédige… (sur un ordinateur sans carte graphique, cela peut prendre jusqu’à une minute avant l’apparition des premiers mots)'
          : 'Le modèle rédige… (le premier lancement peut prendre une minute, le temps de charger le modèle)',
    };
    providedForPartial = provided;
    let finishReason: 'stop' | 'length' | 'unknown' = 'unknown';
    let usage: Usage | undefined;
    let firstWordMs: number | undefined;
    const retryDelays = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    const live = cloze ? new ClozeStream(cloze.max) : null;
    for (let attempt = 0; ; attempt++) {
      try {
        for await (const event of provider.stream({ messages, maxTokens: outputTokens, temperature: generationTemperature(req.type), signal })) {
          if (signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
          if (event.type === 'delta') {
            if (!event.text) continue;
            if (firstWordMs === undefined) firstWordMs = elapsedSince(startedAt);
            text += event.text;
            const shown = live ? live.push(event.text) : event.text;
            if (shown) yield { type: 'delta', text: shown };
          } else {
            finishReason = event.finishReason;
            usage = event.usage;
          }
        }
        break;
      } catch (err) {
        const transient = err instanceof MagistraError && TRANSIENT_AI_ERRORS.includes(err.code);
        if (!transient || text || signal?.aborted || attempt >= retryDelays.length) throw err;
        // Délai conseillé par le serveur (Retry-After) s'il est court ; au-delà, inutile d'attendre ici.
        const advised = (err as MagistraError).retryAfterMs;
        if (advised !== undefined && advised > MAX_AUTO_RETRY_WAIT_MS) throw err;
        const wait = advised ?? retryDelays[attempt];
        yield {
          type: 'status',
          stage: 'generating',
          message: `${provider.local ? 'Le moteur IA est' : "Le serveur d'IA est"} momentanément occupé : nouvel essai automatique dans ${Math.max(1, Math.round(wait / 1000))} s…`,
        };
        await abortableSleep(wait, signal);
      }
    }
    const held = live?.end();
    if (held) yield { type: 'delta', text: held };
    if (signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
    if (!text.trim()) throw new MagistraError('AI_BAD_RESPONSE', "Le modèle n'a produit aucun contenu. Réessayez.");

    // ─── Finalisation : citations vérifiées ──────────────────────────────
    yield { type: 'status', stage: 'finalizing', message: 'Vérification des citations…' };
    // Un document entier entouré de « ```markdown » serait vu comme du code : aucune citation vérifiée.
    const shaped = typeset(shape(unwrapDocumentFence(text, { complete: finishReason === 'stop' })));
    const final = finalizeCitations(shaped, provided, { allowedUrls, allowedExactUrls, flagUncited: true });
    const truncated = finishReason !== 'stop';
    if (finishReason === 'length') {
      yield { type: 'warning', code: 'GENERATION_TRUNCATED', message: 'Le contenu a atteint la longueur maximale et peut être incomplet.' };
    } else if (finishReason === 'unknown') {
      yield { type: 'warning', code: 'GENERATION_TRUNCATED', message: "La réponse du modèle s'est arrêtée avant la fin : le contenu peut être incomplet." };
    } else {
      // Réponse complète : nombre d'exercices, de questions, de séances… comparé à la demande (jamais bloquant).
      for (const message of checkOutputStructure(req, shaped)) yield { type: 'warning', code: 'CONTENT_CHECK', message };
      // Correction annotée : les passages cités entre guillemets doivent figurer tels quels dans le travail fourni.
      if (req.type === 'corrige' && req.texteEleve) {
        for (const message of checkCopyQuotes(shaped, req.texteEleve, [req.sujet, req.consignes, req.objectifs, ...sources.map(s => s.text)])) {
          yield { type: 'warning', code: 'CONTENT_CHECK', message };
        }
      }
    }

    // ─── Sauvegarde ──────────────────────────────────────────────────────
    let saved = false;
    let id: string | undefined;
    // Nom du modèle borné comme l'enregistrement (RECORD_LIMITS) : un nom plus long ne fait jamais refuser la génération.
    const recordModel = clipMeta(provider.model, RECORD_LIMITS.model);
    const record: NewGenerationRecord = {
      type: req.type,
      niveau: req.niveau,
      matiere: req.matiere,
      discipline: req.discipline,
      sujet: displaySujet(req, getToolLabel(req.type, req.niveau), getNiveauLabel(req.niveau), getMatiereLabel(req.matiere)),
      contenu: final.content,
      sources: final.used,
      params: recordParams(req),
      truncated,
      internetUsed,
      ...(recordModel ? { model: recordModel } : {}),
    };
    if (deps.save) {
      try {
        const result = await withTimeout(deps.save(record), deps.saveTimeoutMs ?? 60_000);
        if (!result || typeof result.id !== 'string') throw new MagistraError('STORAGE_ERROR');
        saved = true;
        id = result.id;
      } catch {
        yield { type: 'warning', code: 'STORAGE_ERROR', message: "Le contenu est affiché mais n'a pas pu être enregistré dans l'historique. Copiez-le ou exportez-le." };
      }
    }

    const metrics = buildMetrics(provider, {
      totalMs: elapsedSince(startedAt), prepMs, waitModelMs, preloadLoadMs, firstWordMs, usage, promptTokens, outputBudgetTokens: outputTokens,
    });
    yield {
      type: 'done', content: final.content, sources: final.used, truncated, internetUsed, saved, id, model: provider.model, metrics,
      ...(!deps.save && deps.includeRecord ? { record } : {}),
    };
  } catch (err) {
    const e = signal?.aborted ? new MagistraError('GENERATION_ABORTED') : toMagistraError(err);
    // Le texte déjà produit n'est jamais rendu brut : ses citations sont vérifiées comme en fin normale.
    const partial = text.trim() ? finalizeCitations(typeset(shape(unwrapDocumentFence(text))), providedForPartial, { allowedUrls, allowedExactUrls }).content : undefined;
    yield { type: 'error', code: e.code, message: e.message, retryable: e.retryable, ...(partial ? { partial } : {}) };
  }
}
