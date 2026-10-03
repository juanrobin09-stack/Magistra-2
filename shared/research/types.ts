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
  /** HAL + Crossref + OpenAlex (API publiques, sans clé). */
  academic: boolean;
  /** URL d'une instance SearXNG (recherche web), facultative. */
  searxngUrl?: string;
  /** Wikipédia en français (API publique) : encyclopédie, et références vers les sites officiels sans SearXNG. */
  wikipedia: boolean;
  /**
   * Seuls les sites du catalogue des sites vérifiés sont retenus (défaut : vrai). Faux seulement sur décision de
   * l'administrateur d'un serveur auto-hébergé (RESEARCH_TRUSTED_ONLY=false) : le web général est alors admis.
   */
  trustedOnly?: boolean;
  /** Adresse de contact transmise à Crossref et à OpenAlex (paramètre « mailto », accès prioritaire), facultative. */
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

/** Options facultatives d'une récupération de page. */
export interface FetchPageOptions {
  /**
   * Prédicat évalué AVANT la première connexion et AVANT chaque saut de redirection : faux, la page est refusée (null)
   * sans aucune connexion, pas même une résolution DNS. Une redirection n'est ainsi jamais suivie vers un hôte que
   * l'appelant n'a pas admis : rien n'est contacté chez lui (adresse IP, user-agent, sujet cherché).
   */
  allowUrl?: (url: URL) => boolean;
}

export interface ResearchDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  /**
   * Récupération sécurisée d'une page web (protection SSRF, taille bornée).
   * Fournie par le serveur ou l'application Windows ; absente dans le navigateur.
   */
  fetchPage?: (url: string, signal?: AbortSignal, options?: FetchPageOptions) => Promise<FetchedPage | null>;
}

export const DEFAULT_RESEARCH_CONFIG: ResearchConfig = {
  academic: true,
  wikipedia: true,
  trustedOnly: true,
  timeoutMs: 8_000,
};
