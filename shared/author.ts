// Attribution de l'auteur : « Magistra, créé par Juan Robin ». Le nom et la phrase d'attribution sont fixes (page
// d'accueil du site et de l'application, pied de page, Réglages) ; seul le lien vers le profil professionnel se règle
// au build (VITE_AUTHOR_PROFILE_URL) et il n'est jamais retenu sans contrôle : https seulement, sans identifiants,
// sans caractère de contrôle, 300 caractères au plus. Toute autre valeur, ou l'absence, donne le profil par défaut.
// Module pur (aucun DOM, aucun accès à import.meta.env) : l'environnement lu est un paramètre.

export const AUTHOR_NAME = 'Juan Robin';
export const AUTHOR_CREDIT = `Magistra, créé par ${AUTHOR_NAME}`;

/** Profil affiché quand VITE_AUTHOR_PROFILE_URL est absente ou refusée. */
export const AUTHOR_DEFAULT_PROFILE_URL = 'https://github.com/juanrobin09-stack';

const MAX_URL_LENGTH = 300;

export interface AuthorProfile {
  /** Adresse https normalisée, sans identifiants. */
  url: string;
  /** « Profil LinkedIn », « Profil GitHub » ou « Profil professionnel ». */
  label: string;
}

/** Vrai pour `domain` lui-même et ses sous-domaines (« fr.linkedin.com »), jamais pour « evil-linkedin.com ». */
function isDomainOrSub(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function labelFor(hostname: string): string {
  if (isDomainOrSub(hostname, 'linkedin.com')) return 'Profil LinkedIn';
  if (isDomainOrSub(hostname, 'github.com')) return 'Profil GitHub';
  return 'Profil professionnel';
}

/** Adresse https sûre (normalisée), ou null. */
function safeProfileUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  // eslint-disable-next-line no-control-regex
  if (!raw || raw.length > MAX_URL_LENGTH || /[\u0000- \u007f]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return null;
    return url.href.length <= MAX_URL_LENGTH ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Lien vers le profil de l'auteur et son étiquette. `env` : variables du build (import.meta.env côté interface) ;
 * seule VITE_AUTHOR_PROFILE_URL est lue.
 */
export function authorProfile(env: Record<string, unknown> = {}): AuthorProfile {
  const url = safeProfileUrl(env.VITE_AUTHOR_PROFILE_URL) ?? AUTHOR_DEFAULT_PROFILE_URL;
  return { url, label: labelFor(new URL(url).hostname) };
}
