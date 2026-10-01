// Informations légales de l'éditeur du site (mentions légales, politique de confidentialité).
//
// Aucune identité n'est écrite dans le code : elle vient de variables du BUILD (VITE_LEGAL_*, publiques par nature,
// affichées sur le site) — et, pour le contact, du MAGISTRA_ADMIN_CONTACT du serveur (GET /api/mode) à défaut.
// Une information absente reste visible comme « à compléter » dans les pages : un déploiement ne peut pas passer
// pour complet sans l'être.

export type LegalField = 'publisher' | 'director' | 'address' | 'contact' | 'host' | 'dataRegion';

/** Variable de build attendue pour chaque information (affichée à l'administrateur dans l'avis « à compléter »). */
export const LEGAL_ENV_NAMES: Record<LegalField, string> = {
  publisher: 'VITE_LEGAL_PUBLISHER',
  director: 'VITE_LEGAL_DIRECTOR',
  address: 'VITE_LEGAL_ADDRESS',
  contact: 'VITE_LEGAL_CONTACT',
  host: 'VITE_LEGAL_HOST',
  dataRegion: 'VITE_LEGAL_DATA_REGION',
};

/** Intitulé de chaque information, pour l'avis « à compléter ». */
export const LEGAL_LABELS: Record<LegalField, string> = {
  publisher: "Éditeur (nom ou raison sociale)",
  director: 'Directeur ou directrice de la publication',
  address: "Adresse de l'éditeur",
  contact: 'Contact (e-mail) pour les questions et les droits RGPD',
  host: "Hébergeur du site (nom et adresse)",
  dataRegion: 'Région de la base de données (Supabase)',
};

export const LEGAL_FIELDS = Object.keys(LEGAL_ENV_NAMES) as LegalField[];

export type LegalInfo = Record<LegalField, string | undefined> & {
  /** Informations non renseignées. */
  missing: LegalField[];
};

const MAX_LENGTH = 300;

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text;
}

/**
 * Lit les informations légales. `env` : variables du build (par défaut import.meta.env) ;
 * `fallbackContact` : contact de l'administrateur annoncé par le serveur, utilisé si VITE_LEGAL_CONTACT est absent.
 */
export function readLegalInfo(
  env: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>,
  fallbackContact?: string,
): LegalInfo {
  const info = {
    publisher: clean(env.VITE_LEGAL_PUBLISHER),
    director: clean(env.VITE_LEGAL_DIRECTOR),
    address: clean(env.VITE_LEGAL_ADDRESS),
    contact: clean(env.VITE_LEGAL_CONTACT) ?? clean(fallbackContact),
    host: clean(env.VITE_LEGAL_HOST),
    dataRegion: clean(env.VITE_LEGAL_DATA_REGION),
  } as LegalInfo;
  info.missing = LEGAL_FIELDS.filter(field => !info[field]);
  return info;
}

/** Adresse e-mail simple (pour proposer un lien « mailto: ») ; sinon le contact est affiché tel quel. */
export function emailOf(contact: string | undefined): string | null {
  if (!contact) return null;
  const match = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(contact);
  return match ? match[0] : null;
}

export type LegalPageKind = 'mentions' | 'confidentialite' | 'cgu';

export const LEGAL_PATHS: Record<LegalPageKind, string> = {
  mentions: '/mentions-legales',
  confidentialite: '/confidentialite',
  cgu: '/cgu',
};

export const LEGAL_TITLES: Record<LegalPageKind, string> = {
  mentions: 'Mentions légales',
  confidentialite: 'Politique de confidentialité',
  cgu: "Conditions d'utilisation",
};
