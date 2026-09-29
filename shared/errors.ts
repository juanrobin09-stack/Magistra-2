// Erreurs métier compréhensibles par un enseignant.
// Aucune trace technique, aucun secret : seul le message ci-dessous est montré.

export type ErrorCode =
  | 'ENGINE_NOT_INSTALLED'
  | 'ENGINE_NOT_RUNNING'
  | 'MODEL_NOT_INSTALLED'
  | 'OUT_OF_MEMORY'
  | 'CONTEXT_TOO_LARGE'
  | 'AI_NOT_CONFIGURED'
  | 'AI_SERVER_UNAVAILABLE'
  | 'AI_AUTH_FAILED'
  | 'AI_BUSY'
  | 'AI_TIMEOUT'
  | 'AI_BAD_RESPONSE'
  | 'AI_QUOTA_EXCEEDED'
  | 'AI_SERVER_UNREACHABLE'
  | 'AI_STATUS_UNKNOWN'
  | 'ENGINE_OUTDATED'
  | 'GENERATION_ABORTED'
  | 'GENERATION_TRUNCATED'
  | 'GENERATION_BUSY'
  | 'DOCUMENT_UNREADABLE'
  | 'DOCUMENT_SCANNED'
  | 'DOCUMENT_UNSUPPORTED'
  | 'DOCUMENT_TOO_LARGE'
  | 'DOCUMENT_PROTECTED'
  | 'RESEARCH_UNAVAILABLE'
  | 'ACADEMIC_UNAVAILABLE'
  | 'INSTITUTIONAL_UNAVAILABLE'
  | 'INVALID_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'STORAGE_ERROR'
  | 'NETWORK_ERROR'
  | 'SERVER_MISCONFIGURED'
  | 'INTERNAL';

const MESSAGES: Record<ErrorCode, string> = {
  ENGINE_NOT_INSTALLED: "Le moteur d'intelligence artificielle locale n'est pas installé.",
  ENGINE_NOT_RUNNING: 'Moteur IA non démarré.',
  MODEL_NOT_INSTALLED: "Le modèle d'IA choisi n'est pas encore installé.",
  OUT_OF_MEMORY: 'Mémoire insuffisante pour ce modèle. Fermez d’autres applications ou choisissez un modèle plus léger.',
  CONTEXT_TOO_LARGE: 'Trop de contenu pour ce modèle : retirez des documents ou raccourcissez la demande.',
  AI_NOT_CONFIGURED: "Aucun serveur d'IA n'est configuré. L'administrateur doit renseigner AI_BASE_URL et AI_MODEL.",
  AI_SERVER_UNAVAILABLE: "Serveur d'IA indisponible. Réessayez dans quelques instants.",
  AI_AUTH_FAILED: "Le serveur d'IA a refusé l'accès. Contactez l'administrateur.",
  AI_BUSY: "Le serveur d'IA est surchargé. Réessayez dans quelques instants.",
  AI_TIMEOUT: "Le serveur d'IA n'a pas répondu à temps.",
  AI_BAD_RESPONSE: "Réponse inattendue du serveur d'IA.",
  AI_QUOTA_EXCEEDED: "Le quota du service d'IA (offre gratuite ou crédits) est atteint. Réessayez plus tard.",
  AI_SERVER_UNREACHABLE: "Le serveur d'IA est injoignable à l'adresse configurée.",
  AI_STATUS_UNKNOWN: "L'état du serveur d'IA n'a pas pu être vérifié : la génération reste possible.",
  ENGINE_OUTDATED: 'Le moteur IA (Ollama) est trop ancien pour ce modèle : mettez-le à jour.',
  GENERATION_ABORTED: 'Génération interrompue.',
  GENERATION_TRUNCATED: 'Le contenu a atteint la longueur maximale et peut être incomplet.',
  GENERATION_BUSY: 'Une génération est déjà en cours. Attendez sa fin ou arrêtez-la.',
  DOCUMENT_UNREADABLE: 'Document impossible à lire.',
  DOCUMENT_SCANNED: 'Ce PDF ne contient pas de texte (document scanné) : il ne peut pas être lu sans reconnaissance de caractères.',
  DOCUMENT_UNSUPPORTED: 'Format non pris en charge. Formats acceptés : PDF, DOCX, PPTX, TXT, MD.',
  DOCUMENT_TOO_LARGE: 'Document trop volumineux.',
  DOCUMENT_PROTECTED: 'Ce document est protégé par un mot de passe.',
  RESEARCH_UNAVAILABLE: 'Recherche Internet indisponible : génération à partir des autres sources.',
  ACADEMIC_UNAVAILABLE: 'Recherche académique indisponible : génération à partir des autres sources.',
  INSTITUTIONAL_UNAVAILABLE: 'Sources institutionnelles (Éduscol, BO) indisponibles : aucun moteur de recherche web configuré.',
  INVALID_REQUEST: 'Demande invalide.',
  UNAUTHENTICATED: 'Session expirée : reconnectez-vous.',
  FORBIDDEN: 'Accès refusé.',
  NOT_FOUND: 'Contenu introuvable.',
  RATE_LIMITED: 'Trop de demandes en peu de temps : patientez quelques secondes.',
  STORAGE_ERROR: "Impossible d'enregistrer dans l'historique.",
  NETWORK_ERROR: 'Connexion au serveur Magistra impossible. Vérifiez votre connexion.',
  SERVER_MISCONFIGURED: 'Le serveur Magistra est mal configuré. Contactez l’administrateur.',
  INTERNAL: 'Erreur inattendue. Réessayez.',
};

/**
 * Codes pour lesquels l'interface propose « Réessayer » (nouvel essai À LA DEMANDE de l'enseignant).
 * Les nouveaux essais AUTOMATIQUES sont une autre notion : voir TRANSIENT_AI_ERRORS (shared/pipeline.ts),
 * qui ne contient ni AI_QUOTA_EXCEEDED, ni AI_SERVER_UNREACHABLE, ni ENGINE_OUTDATED.
 *  - AI_QUOTA_EXCEEDED : réessayable plus tard (le message indique quand, si le fournisseur le dit) ;
 *  - AI_SERVER_UNREACHABLE : réessayable à la main (serveur rallumé, adresse corrigée), jamais automatiquement ;
 *  - ENGINE_OUTDATED : non réessayable (il faut d'abord mettre le moteur à jour) ;
 *  - AI_STATUS_UNKNOWN : n'est pas une erreur (état non vérifié, non bloquant) : jamais levé.
 */
const RETRYABLE: ErrorCode[] = [
  'ENGINE_NOT_RUNNING', 'AI_SERVER_UNAVAILABLE', 'AI_BUSY', 'AI_TIMEOUT', 'AI_BAD_RESPONSE',
  'GENERATION_ABORTED', 'RATE_LIMITED', 'NETWORK_ERROR', 'INTERNAL', 'OUT_OF_MEMORY', 'GENERATION_BUSY',
  'AI_QUOTA_EXCEEDED', 'AI_SERVER_UNREACHABLE',
];

const HTTP_STATUS: Partial<Record<ErrorCode, number>> = {
  INVALID_REQUEST: 400,
  DOCUMENT_TOO_LARGE: 413,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  AI_NOT_CONFIGURED: 503,
  AI_SERVER_UNAVAILABLE: 503,
  AI_BUSY: 503,
  AI_TIMEOUT: 504,
  AI_BAD_RESPONSE: 502,
  AI_AUTH_FAILED: 502,
  AI_QUOTA_EXCEEDED: 429,
  AI_SERVER_UNREACHABLE: 502,
  AI_STATUS_UNKNOWN: 503,
  ENGINE_OUTDATED: 503,
  SERVER_MISCONFIGURED: 500,
  STORAGE_ERROR: 500,
  INTERNAL: 500,
};

export function defaultMessage(code: ErrorCode): string {
  return MESSAGES[code];
}

export interface MagistraErrorOptions {
  /** Erreur d'origine (diagnostic seulement : jamais montrée ni sérialisée). */
  cause?: unknown;
  /**
   * Attente conseillée par le fournisseur d'IA avant un nouvel essai, en millisecondes
   * (en-tête Retry-After, x-ratelimit-reset…). Lue par la pipeline pour un AI_BUSY court (≤ 15 s) ;
   * informative pour AI_QUOTA_EXCEEDED. Jamais sérialisée (toJSON) : le message dit déjà quand réessayer.
   */
  retryAfterMs?: number;
}

export class MagistraError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly status: number;
  /** Voir MagistraErrorOptions.retryAfterMs. */
  readonly retryAfterMs?: number;

  constructor(code: ErrorCode, message?: string, options?: MagistraErrorOptions) {
    super(message ?? MESSAGES[code]);
    this.name = 'MagistraError';
    this.code = code;
    this.retryable = RETRYABLE.includes(code);
    this.status = HTTP_STATUS[code] ?? 500;
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
    if (options?.retryAfterMs !== undefined && Number.isFinite(options.retryAfterMs) && options.retryAfterMs >= 0) {
      this.retryAfterMs = Math.round(options.retryAfterMs);
    }
  }

  toJSON(): { code: ErrorCode; message: string; retryable: boolean } {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}

export function isMagistraError(err: unknown): err is MagistraError {
  return err instanceof MagistraError
    || (typeof err === 'object' && err !== null && (err as { name?: string }).name === 'MagistraError' && typeof (err as { code?: unknown }).code === 'string');
}

export function isAbortError(err: unknown): boolean {
  return typeof err === 'object' && err !== null
    && ((err as { name?: string }).name === 'AbortError' || (err as { code?: string }).code === 'ABORT_ERR');
}

/** Convertit n'importe quelle erreur en MagistraError sans jamais propager de détail technique. */
export function toMagistraError(err: unknown, fallback: ErrorCode = 'INTERNAL'): MagistraError {
  if (err instanceof MagistraError) return err;
  if (isMagistraError(err)) {
    // Objet « MagistraError » sérialisé (IPC, JSON) : on reconstruit une vraie instance.
    const { code, message } = err as { code: string; message?: unknown };
    return isErrorCode(code)
      ? new MagistraError(code, typeof message === 'string' && message ? message : undefined)
      : new MagistraError(fallback);
  }
  if (isAbortError(err)) return new MagistraError('GENERATION_ABORTED');
  return new MagistraError(fallback, undefined, { cause: err });
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MESSAGES, value);
}
