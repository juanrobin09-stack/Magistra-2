// Liens publics affichés dans l'interface (aucun secret, aucune adresse interne).

/** Téléchargements publics, séparés du dépôt de code privé. */
export const REPOSITORY_URL = 'https://github.com/juanrobin09-stack/magistra-downloads';

/**
 * Installateur de la dernière version STABLE de l'application Windows, sous son nom fixe (release.yml le publie à côté
 * de Magistra-Setup-X.Y.Z.exe) : le clic télécharge le fichier lui-même, sans page intermédiaire. GitHub exclut
 * d'office de « latest » les brouillons et les préversions. Sert quand la version exacte n'est pas connue (GitHub
 * momentanément injoignable depuis le serveur, hébergement sans API).
 */
export const WINDOWS_DOWNLOAD_URL = `${REPOSITORY_URL}/releases/latest/download/Magistra-Setup.exe`;

/** Page des versions (notes, fichiers, empreintes) : un lien d'information, jamais le bouton de téléchargement. */
export const WINDOWS_RELEASES_URL = `${REPOSITORY_URL}/releases`;

/**
 * Guide public de mise en route de l’IA dans l’application Windows. L'enseignant, lui, n'a que les trois étapes
 * de l'application Windows, affichées dans l'interface. Même ancre que les notes de version (release.yml). Si l'ancre
 * n'existe pas, GitHub affiche le début du README.
 */
export const README_AI_SECTION_URL = `${REPOSITORY_URL}#brancher-une-vraie-ia`;

/**
 * Adresse externe sûre à afficher comme lien : https uniquement (jamais javascript:, data:…).
 * Renvoie l'adresse normalisée, ou null.
 */
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
