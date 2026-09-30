import type { ErrorCode } from '../errors.js';
import type { SourceKind } from '../types.js';

/** Source réelle récupérée dynamiquement (jamais inventée par le modèle). */
export interface ResearchSource {
  kind: Exclude<SourceKind, 'document'>;
  title: string;
  authors?: string[];
  year?: number;
  venue?: string;
  doi?: string;
  url?: string;
  /** Texte transmis au modèle (résumé, extrait pertinent de la page). */
  text: string;
}

export interface ResearchConfig {
  /** HAL + Crossref (API publiques, sans clé). */
  academic: boolean;
  /** URL d'une instance SearXNG (recherche web), facultative. */
  searxngUrl?: string;
  /** Wikipédia en français (API publique). */
  wikipedia: boolean;
  /** Adresse de contact transmise à Crossref (« polite pool »), facultative. */
  crossrefMailto?: string;
  /** Délai maximal par requête externe. */
  timeoutMs: number;
}

export interface ResearchWarning {
  code: ErrorCode;
  message: string;
}

export interface ResearchOutcome {
  sources: ResearchSource[];
  /** Vrai si des informations ont effectivement été récupérées sur Internet. */
  internetUsed: boolean;
  warnings: ResearchWarning[];
}

export interface FetchedPage {
  url: string;
  title?: string;
  text: string;
}

export interface ResearchDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /**
   * Récupération sécurisée d'une page web (protection SSRF, taille bornée).
   * Fournie par le serveur ou l'application Windows ; absente dans le navigateur.
   */
  fetchPage?: (url: string, signal?: AbortSignal) => Promise<FetchedPage | null>;
}

export const DEFAULT_RESEARCH_CONFIG: ResearchConfig = {
  academic: true,
  wikipedia: true,
  timeoutMs: 8_000,
};
