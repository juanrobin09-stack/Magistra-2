// Liens publics affichés dans l'interface (aucun secret, aucune adresse interne).

/** Dépôt du projet. */
export const REPOSITORY_URL = 'https://github.com/juanrobin09-stack/magistra-2';

/** Dernière version publiée de l'application Windows (installateur). */
export const WINDOWS_DOWNLOAD_URL = `${REPOSITORY_URL}/releases/latest`;

/**
 * Mode d'emploi de l'administrateur et du développeur dans le README : brancher une vraie IA (préréglage du site en
 * ligne, `npm run dev` avec Ollama, détails de l'application Windows). L'enseignant, lui, n'a que les trois étapes
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
