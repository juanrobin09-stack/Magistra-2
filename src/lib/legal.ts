// Informations légales de l'éditeur (mentions légales, politique de confidentialité, conditions d'utilisation).
//
// Valeurs par défaut : l'éditeur et directeur de la publication est l'auteur du projet, son contact est
// AUTHOR_CONTACT_EMAIL (shared/author.ts) et l'hébergeur du site est Vercel. Des variables du BUILD (VITE_LEGAL_*,
// publiques par nature, affichées sur le site) les remplacent ; pour le contact, celui de l'administrateur annoncé par le
// serveur (GET /api/mode) passe avant le défaut quand VITE_LEGAL_CONTACT est absente. L'adresse de l'éditeur et la région
// de la base de données n'ont pas de défaut : absentes, elles ne sont pas affichées (les pages n'ont jamais de trou).

import { AUTHOR_CONTACT_EMAIL, AUTHOR_NAME } from '@shared/author';
import type { PageMode } from '@/lib/runtime/types';

export type LegalField = 'publisher' | 'director' | 'address' | 'contact' | 'host' | 'dataRegion';

/** Variable de build qui remplace chaque information. */
export const LEGAL_ENV_NAMES: Record<LegalField, string> = {
  publisher: 'VITE_LEGAL_PUBLISHER',
  director: 'VITE_LEGAL_DIRECTOR',
  address: 'VITE_LEGAL_ADDRESS',
  contact: 'VITE_LEGAL_CONTACT',
  host: 'VITE_LEGAL_HOST',
  dataRegion: 'VITE_LEGAL_DATA_REGION',
};

/** Hébergeur du site quand VITE_LEGAL_HOST est absente : nom, pays et site (aucune adresse postale n'est inventée). */
export const LEGAL_DEFAULT_HOST = 'Vercel Inc., États-Unis (https://vercel.com)';

/**
 * Mention des éditeurs non professionnels (article 6, III, 2° de la loi n° 2004-575 du 21 juin 2004, LCEN) : seuls leur
 * nom et les coordonnées de l'hébergeur sont communiqués au public. Affichée à la place de l'adresse quand le build n'en
 * donne pas (VITE_LEGAL_ADDRESS) ; elle suppose un éditeur personne physique, hors activité professionnelle.
 */
export const LEGAL_NON_PROFESSIONAL_NOTICE =
  "L'éditeur, personne physique éditant le site à titre non professionnel, a communiqué ses éléments d'identification à l'hébergeur et ne publie pas son adresse personnelle (article 6, III, 2° de la loi n° 2004-575 du 21 juin 2004).";

export interface LegalInfo {
  /** Éditeur du site et de l'application (nom). */
  publisher: string;
  /** Directeur ou directrice de la publication. */
  director: string;
  /** Contact : une adresse e-mail, éventuellement accompagnée d'un texte (« Service X, aide@… »). */
  contact: string;
  /** Hébergeur du site (nom, pays, site) ; affiché là où le mode a un hébergeur (hasHosting). */
  host: string;
  /** Adresse de l'éditeur : seulement si le build la donne. */
  address?: string;
  /** Région de la base de données d'un hébergement personnel avec comptes : seulement si le build la donne. */
  dataRegion?: string;
}

const MAX_LENGTH = 300;

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text;
}

/**
 * Lit les informations légales. `env` : variables du build (par défaut import.meta.env) ; `fallbackContact` : contact de
 * l'administrateur annoncé par le serveur, utilisé si VITE_LEGAL_CONTACT est absente. Une valeur vide ou illisible
 * (blanc, autre type que du texte) équivaut à une variable absente.
 */
export function readLegalInfo(
  env: Record<string, unknown> = import.meta.env as unknown as Record<string, unknown>,
  fallbackContact?: string,
): LegalInfo {
  const read = (field: LegalField) => clean(env[LEGAL_ENV_NAMES[field]]);
  return {
    publisher: read('publisher') ?? AUTHOR_NAME,
    director: read('director') ?? AUTHOR_NAME,
    contact: read('contact') ?? clean(fallbackContact) ?? AUTHOR_CONTACT_EMAIL,
    host: read('host') ?? LEGAL_DEFAULT_HOST,
    address: read('address'),
    dataRegion: read('dataRegion'),
  };
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

/**
 * Hébergeur et base de données : seuls le site web (avec comptes) et le site vitrine ont un hébergeur ; seul le site web a
 * une base de données. En mode personnel les données sont dans le stockage fichier du serveur local, en démonstration
 * dans le navigateur, dans l'application Windows sur l'ordinateur. Une seule règle pour tous les textes : ils ne peuvent
 * pas diverger.
 */
export const hasHosting = (mode: PageMode): boolean => mode === 'web' || mode === 'showcase';
export const hasDatabase = (mode: PageMode): boolean => mode === 'web';
