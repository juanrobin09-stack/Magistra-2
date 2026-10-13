// Informations légales de l'éditeur (mentions légales, politique de confidentialité, conditions d'utilisation).
//
// Valeurs par défaut : l'éditeur et directeur de la publication est l'auteur du projet, son contact est
// AUTHOR_CONTACT_EMAIL (shared/author.ts) et l'hébergeur du site est Vercel (nom ET adresse). Des variables du BUILD
// (VITE_LEGAL_*, publiques par nature, affichées sur le site) les remplacent ; dans l'application servie par un serveur
// Magistra (modes web et personnel), le contact de l'administrateur annoncé par ce serveur (GET /api/mode) passe avant le
// défaut quand VITE_LEGAL_CONTACT est absente : le site vitrine n'interroge jamais ce serveur, il n'a donc que
// VITE_LEGAL_CONTACT ou le défaut. L'adresse de l'éditeur et la région de la base de données n'ont pas de défaut :
// absentes, elles ne sont pas affichées (les pages n'ont jamais de trou).

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

/**
 * Hébergeur du site quand VITE_LEGAL_HOST est absente : nom, adresse postale, pays et site de Vercel Inc. Le régime des
 * éditeurs non professionnels (LEGAL_NON_PROFESSIONAL_NOTICE) exige de publier le nom ET l'adresse de l'hébergeur ;
 * cette adresse est celle que Vercel Inc. publie dans ses propres mentions.
 */
export const LEGAL_DEFAULT_HOST = 'Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis (https://vercel.com)';

/**
 * Mention des éditeurs non professionnels (article 6, III, 2° de la loi n° 2004-575 du 21 juin 2004, LCEN) : seuls leur
 * nom et les coordonnées de l'hébergeur sont communiqués au public. Elle suppose un éditeur personne physique, hors
 * activité professionnelle : showsNonProfessionalNotice décide de l'afficher.
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
    // Les pages ajoutent leur point final : un point déjà présent dans la variable ne doit pas le doubler.
    host: read('host')?.replace(/[.\s]+$/, '') || LEGAL_DEFAULT_HOST,
    address: read('address'),
    dataRegion: read('dataRegion'),
  };
}

/**
 * La phrase LCEN n'est vraie que pour l'éditeur par défaut, personne physique : l'éditeur ET le directeur de la
 * publication sont ceux par défaut (VITE_LEGAL_PUBLISHER et VITE_LEGAL_DIRECTOR absentes, ou égales à l'auteur) ET le
 * build ne donne aucune adresse (VITE_LEGAL_ADDRESS). Éditeur ou directeur surchargé (association, société…) sans
 * adresse : la phrase ne s'affiche pas, et aucune ligne « Adresse » n'est inventée.
 */
export function showsNonProfessionalNotice(info: Pick<LegalInfo, 'publisher' | 'director' | 'address'>): boolean {
  return !info.address && info.publisher === AUTHOR_NAME && info.director === AUTHOR_NAME;
}

/**
 * Adresse https de l'hébergeur dans son texte (« … (https://vercel.com), … ») : sa position, et l'adresse SANS la
 * ponctuation qui la suit dans la phrase (virgule, point, point-virgule, deux-points, « ! », « ? », parenthèse
 * fermante). null : aucune adresse https.
 */
export function findHostUrl(host: string): { index: number; url: string } | null {
  const found = /https:\/\/[^\s),;]+/.exec(host);
  if (!found) return null;
  return { index: found.index, url: found[0].replace(/[.,;:!?]+$/, '') };
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
 * Hébergement et base des données de travail : seuls les modes web et vitrine ont un hébergeur ; seul le mode web stocke
 * les profils et documents dans une base distante. Les compteurs Windows facultatifs sont décrits séparément.
 * En mode personnel les données sont dans le stockage fichier du serveur local, en démonstration
 * dans le navigateur, dans l'application Windows sur l'ordinateur. Une seule règle pour tous les textes : ils ne peuvent
 * pas diverger.
 */
export const hasHosting = (mode: PageMode): boolean => mode === 'web' || mode === 'showcase';
export const hasDatabase = (mode: PageMode): boolean => mode === 'web';
