// Pipeline unique de génération, utilisé par le serveur web ET par l'application Windows.
//
// demande validée → recherche (facultative) → sources numérotées → prompt → streaming
//                → citations vérifiées → sauvegarde → évènement final
//
// Les évènements produits (GenerationEvent) sont transmis tels quels au navigateur
// (flux NDJSON) ou à la fenêtre Electron (IPC).

import type { AIProvider } from './ai/provider.js';
import { getMatiereLabel, getToolLabel, type TypeContenu } from './catalog.js';
import { documentSourceRef, extractUrls, finalizeCitations } from './citations.js';
import { rankChunks } from './documents/retrieve.js';
import { MagistraError, toMagistraError, type ErrorCode } from './errors.js';
import { getLevelGroup, getNiveauLabel } from './levels.js';
import { unwrapDocumentFence } from './markdownFence.js';
import { buildMessages, estimateTokens, type PromptSource } from './prompts/index.js';
import { planResearch, runResearch, type ResearchConfig, type ResearchDeps, type ResearchOutcome } from './research/index.js';
import { modeUsesDocuments, type DocumentPassage, type GenerationEvent, type GenerationRecord, type GenerationRequest, type SourceRef } from './types.js';
import { displaySujet } from './validation.js';

export type NewGenerationRecord = Omit<GenerationRecord, 'id' | 'createdAt' | 'isFavorite'>;

export interface PipelineDeps {
  provider: AIProvider;
  research?: { config: ResearchConfig; deps: ResearchDeps };
  /** Enregistre la génération ; absent = pas de sauvegarde. */
  save?: (record: NewGenerationRecord) => Promise<{ id: string }>;
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

/** Requête de recherche : sujet, discipline et objectifs uniquement — jamais le texte des documents ni des consignes. */
function researchQueryText(req: GenerationRequest): string {
  return [req.sujet, req.discipline, req.objectifs?.slice(0, 120)]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
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
    if (used + cost > budget) continue;
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

const DOCS_REDUCED_WARNING = 'Vos documents dépassent la capacité du modèle : seuls les passages les plus pertinents ont été utilisés.';

export async function* runGeneration(req: GenerationRequest, deps: PipelineDeps): AsyncGenerator<GenerationEvent> {
  const { provider, signal } = deps;
  let text = '';
  let providedForPartial: SourceRef[] = [];
  let allowedUrls: string[] = [];
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
    const toolUsesResearch = RESEARCH_TOOLS.has(req.type);
    const wantsResearch = networkMode && toolUsesResearch && hasTopic;

    // ─── Sources : documents de l'enseignant d'abord ─────────────────────
    const docs = modeUsesDocuments(req.researchMode) ? req.documents ?? [] : [];
    if (docs.length > 0) yield { type: 'status', stage: 'context', message: 'Sélection des passages utiles de vos documents…' };
    const docBudget = wantsResearch && deps.research ? Math.floor(budgets.sourcesChars * 0.6) : budgets.sourcesChars;
    const fitted = fitPassages(docs, `${query} ${req.consignes ?? ''}`, docBudget);
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
        const n = sources.length + 1;
        const ref: SourceRef = { n, kind: s.kind, title: s.title, authors: s.authors, year: s.year, venue: s.venue, doi: s.doi, url: s.url };
        sources.push({ ref, text: s.text });
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
    allowedUrls = [
      ...sources.flatMap(s => extractUrls(s.text)),
      ...[req.sujet, req.objectifs, req.consignes, req.contenuSource, req.texteEleve].flatMap(t => (t ? extractUrls(t) : [])),
    ];
    yield { type: 'sources', sources: provided, internetUsed };

    // ─── Chargement du modèle (facultatif) ───────────────────────────────
    let preloaded = false;
    if (deps.preloadModel && typeof provider.preload === 'function') {
      yield { type: 'status', stage: 'loading_model', message: 'Chargement du modèle…' };
      try {
        await provider.preload({ signal });
        preloaded = true;
      } catch (err) {
        // Une panne passagère est laissée aux nouveaux essais de la rédaction ; le reste est affiché tout de suite.
        if (!(err instanceof MagistraError && TRANSIENT_AI_ERRORS.includes(err.code))) throw err;
      }
      if (signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
    }

    // ─── Génération en flux ──────────────────────────────────────────────
    yield {
      type: 'status',
      stage: 'generating',
      message: !provider.local
        ? 'Rédaction en cours…'
        : preloaded
          ? 'Le modèle rédige…'
          : 'Le modèle rédige… (le premier lancement peut prendre une minute, le temps de charger le modèle)',
    };
    providedForPartial = provided;
    let finishReason: 'stop' | 'length' | 'unknown' = 'unknown';
    const retryDelays = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    for (let attempt = 0; ; attempt++) {
      try {
        for await (const event of provider.stream({ messages, maxTokens: outputTokens, signal })) {
          if (signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
          if (event.type === 'delta') {
            if (!event.text) continue;
            text += event.text;
            yield { type: 'delta', text: event.text };
          } else {
            finishReason = event.finishReason;
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
    if (signal?.aborted) throw new MagistraError('GENERATION_ABORTED');
    if (!text.trim()) throw new MagistraError('AI_BAD_RESPONSE', "Le modèle n'a produit aucun contenu. Réessayez.");

    // ─── Finalisation : citations vérifiées ──────────────────────────────
    yield { type: 'status', stage: 'finalizing', message: 'Vérification des citations…' };
    // Un document entier entouré de « ```markdown » serait vu comme du code : aucune citation vérifiée.
    const final = finalizeCitations(unwrapDocumentFence(text, { complete: finishReason === 'stop' }), provided, { allowedUrls, flagUncited: true });
    const truncated = finishReason !== 'stop';
    if (finishReason === 'length') {
      yield { type: 'warning', code: 'GENERATION_TRUNCATED', message: 'Le contenu a atteint la longueur maximale et peut être incomplet.' };
    } else if (finishReason === 'unknown') {
      yield { type: 'warning', code: 'GENERATION_TRUNCATED', message: "La réponse du modèle s'est arrêtée avant la fin : le contenu peut être incomplet." };
    }

    // ─── Sauvegarde ──────────────────────────────────────────────────────
    let saved = false;
    let id: string | undefined;
    if (deps.save) {
      try {
        const niveauLabel = getNiveauLabel(req.niveau);
        const result = await withTimeout(deps.save({
          type: req.type,
          niveau: req.niveau,
          matiere: req.matiere,
          discipline: req.discipline,
          sujet: displaySujet(req, getToolLabel(req.type, req.niveau), niveauLabel, getMatiereLabel(req.matiere)),
          contenu: final.content,
          sources: final.used,
          params: recordParams(req),
          truncated,
          internetUsed,
          model: provider.model,
        }), deps.saveTimeoutMs ?? 60_000);
        if (!result || typeof result.id !== 'string') throw new MagistraError('STORAGE_ERROR');
        saved = true;
        id = result.id;
      } catch {
        yield { type: 'warning', code: 'STORAGE_ERROR', message: "Le contenu est affiché mais n'a pas pu être enregistré dans l'historique. Copiez-le ou exportez-le." };
      }
    }

    yield { type: 'done', content: final.content, sources: final.used, truncated, internetUsed, saved, id, model: provider.model };
  } catch (err) {
    const e = signal?.aborted ? new MagistraError('GENERATION_ABORTED') : toMagistraError(err);
    // Le texte déjà produit n'est jamais rendu brut : ses citations sont vérifiées comme en fin normale.
    const partial = text.trim() ? finalizeCitations(unwrapDocumentFence(text), providedForPartial, { allowedUrls }).content : undefined;
    yield { type: 'error', code: e.code, message: e.message, retryable: e.retryable, ...(partial ? { partial } : {}) };
  }
}
