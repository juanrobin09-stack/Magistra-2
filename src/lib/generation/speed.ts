// « Détails de vitesse » d'une génération : mise en texte des mesures (GenerationMetrics) jointes à l'évènement « done ».
// Logique pure, testable sans React. Les mesures peuvent venir d'une autre application (connecteur local) : tout est
// revalidé avant l'affichage, un champ absent ou invalide est omis (jamais « NaN s »), et rien n'est affirmé sans mesure.

import { cleanEngineTimings, cleanEnginePlacement, MAX_ENGINE_DURATION_MS, type EnginePlacement } from '@shared/ai/timings';

export interface SpeedRow {
  label: string;
  value: string;
}

export interface SpeedView {
  /** « Rédigé en 48 s » (absent si la durée totale n'est pas connue). */
  headline?: string;
  /** « Premier mot après 12 s » (absent si inconnu). */
  firstWord?: string;
  rows: SpeedRow[];
  /** Explication prudente en une phrase du placement (processeur ou partagé) ; rien quand la carte graphique suffit. */
  explanation?: string;
}

/** Au-dessous, le chargement ou la préparation n'est pas une attente à signaler. */
const NOTICEABLE_MS = 1_000;
const LOADED_MS = 500;
/** En dessous, une vitesse en jetons par seconde ne veut rien dire (quelques jetons : la durée est celle du démarrage). */
const MIN_TOKENS_FOR_SPEED = 16;

/** Valeur de la ligne « Chargement du modèle » : durée réelle du chargement et part que l'enseignant a attendue. */
function loadingValue(loadedMs: number | undefined, waitedMs: number | undefined): string {
  const waited = waitedMs ?? 0;
  const loaded = Math.max(loadedMs ?? 0, waited);
  if (loaded < LOADED_MS) return 'aucune attente (modèle déjà en mémoire)';
  // Le chargement a commencé avec la préparation de la demande : la part recouverte n'a pas été attendue.
  if (waited + LOADED_MS <= loaded) {
    return waited < LOADED_MS
      ? `${formatDuration(loaded)}, sans attente (pendant la préparation de la demande)`
      : `${formatDuration(loaded)}, dont ${formatDuration(waited)} d’attente (le reste pendant la préparation de la demande)`;
  }
  return formatDuration(loaded);
}

export const CPU_EXPLANATION = "Cet ordinateur calcule avec le processeur : la rédaction est plus lente qu'avec une carte graphique compatible.";
export const MIXED_EXPLANATION =
  "D'après le moteur, le modèle ne tient qu'en partie dans la mémoire de la carte graphique : une partie du calcul se fait sur le processeur, ce qui ralentit.";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function duration(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_ENGINE_DURATION_MS ? value : undefined;
}

/** Nombre à la française : espace insécable entre les milliers, virgule décimale. */
export function formatNumber(value: number, decimals = 0): string {
  const fixed = value.toFixed(decimals);
  const [int, frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return frac ? `${grouped},${frac}` : grouped;
}

/** Un chiffre après la virgule, sans « ,0 » inutile : 4,2 ; 9. */
function formatTenths(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? formatNumber(rounded) : formatNumber(rounded, 1);
}

/** « 4,2 s », « 48 s », « 2 min 05 s » ; « moins d'une seconde » au-dessous de 1 s. */
export function formatDuration(ms: number): string {
  if (ms < 1_000) return "moins d'une seconde";
  const seconds = ms / 1_000;
  if (seconds < 10) return `${formatTenths(seconds)} s`;
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded} s`;
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${String(rest).padStart(2, '0')} s`;
}

function enoughForSpeed(count: number | undefined): boolean {
  return count !== undefined && count >= MIN_TOKENS_FOR_SPEED;
}

function tokens(n: number): string {
  return `${formatNumber(n)} ${n > 1 ? 'jetons' : 'jeton'}`;
}

/** « 1 200 jetons · 3 s · 400 jetons/s » : seulement les mesures connues ; `cached` : jetons déjà en mémoire, non relus. */
function workDetail(count: number | undefined, ms: number | undefined, perSecond: number | undefined, cached?: number): string | undefined {
  const parts = [
    count !== undefined ? `${tokens(count)}${cached ? ` (${formatNumber(cached)} déjà en mémoire)` : ''}` : undefined,
    ms !== undefined ? formatDuration(ms) : undefined,
    perSecond !== undefined ? `${perSecond < 100 ? formatTenths(perSecond) : formatNumber(Math.round(perSecond))} jetons/s` : undefined,
  ].filter((p): p is string => p !== undefined);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** « sur la carte graphique », « sur le processeur », « partagé : 40 % carte graphique, le reste sur le processeur ». */
export function placementLabel(placement: EnginePlacement): string {
  if (placement.processor === 'gpu') return 'sur la carte graphique';
  if (placement.processor === 'cpu') return 'sur le processeur';
  return `partagé : ${placement.gpuPercent} % carte graphique, le reste sur le processeur`;
}

function placementExplanation(placement: EnginePlacement): string | undefined {
  if (placement.processor === 'cpu') return CPU_EXPLANATION;
  if (placement.processor === 'mixed') return MIXED_EXPLANATION;
  return undefined;
}

/**
 * Texte des détails de vitesse, ou undefined quand il n'y a rien à montrer : les mesures du moteur manquent (serveur
 * distant, démonstration, application plus ancienne) ou sont inexploitables.
 */
export function speedView(metrics: unknown): SpeedView | undefined {
  const m = record(metrics);
  if (!m) return undefined;
  const engine = cleanEngineTimings(m.engine);
  if (!engine) return undefined;
  const placement = cleanEnginePlacement(m.placement);
  const totalMs = duration(m.totalMs) ?? engine.totalMs;
  const firstWordMs = duration(m.firstWordMs);
  const prepMs = duration(m.prepMs);
  const waitMs = duration(m.waitModelMs);
  const preloadLoadMs = duration(m.preloadLoadMs);

  const rows: SpeedRow[] = [];
  if (prepMs !== undefined && prepMs >= NOTICEABLE_MS) rows.push({ label: 'Préparation de la demande', value: formatDuration(prepMs) });
  if (engine.loadMs !== undefined || waitMs !== undefined || preloadLoadMs !== undefined) {
    const engineLoad = engine.loadMs ?? 0;
    const loadedMs = engine.loadMs !== undefined || preloadLoadMs !== undefined ? engineLoad + (preloadLoadMs ?? 0) : undefined;
    const waitedMs = engine.loadMs !== undefined || waitMs !== undefined ? engineLoad + (waitMs ?? 0) : undefined;
    rows.push({ label: 'Chargement du modèle', value: loadingValue(loadedMs, waitedMs) });
  }
  // Jetons déjà en mémoire d'une requête précédente : non relus, donc hors du nombre de jetons lus et de la vitesse.
  const cached = engine.promptTokens !== undefined && engine.promptCachedTokens !== undefined && engine.promptCachedTokens <= engine.promptTokens
    ? engine.promptCachedTokens
    : undefined;
  const readTokens = engine.promptTokens === undefined ? undefined : engine.promptTokens - (cached ?? 0);
  const read = workDetail(readTokens, engine.promptMs, enoughForSpeed(readTokens) ? engine.promptTokensPerSecond : undefined, cached);
  if (read) rows.push({ label: 'Lecture de la demande', value: read });
  const write = workDetail(engine.outputTokens, engine.outputMs, enoughForSpeed(engine.outputTokens) ? engine.tokensPerSecond : undefined);
  if (write) rows.push({ label: 'Rédaction', value: write });
  if (placement) rows.push({ label: 'Calcul', value: placementLabel(placement) });

  return {
    ...(totalMs !== undefined ? { headline: `Rédigé en ${formatDuration(totalMs)}` } : {}),
    ...(firstWordMs !== undefined
      ? { firstWord: firstWordMs < 1_000 ? "Premier mot en moins d'une seconde" : `Premier mot après ${formatDuration(firstWordMs)}` }
      : {}),
    rows,
    ...(placement && placementExplanation(placement) ? { explanation: placementExplanation(placement) } : {}),
  };
}
