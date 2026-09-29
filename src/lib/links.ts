// Liens publics affichés dans l'interface (aucun secret, aucune adresse interne).

/** Dépôt du projet. */
export const REPOSITORY_URL = 'https://github.com/juanrobin09-stack/magistra-2';

/** Dernière version publiée de l'application Windows (installateur). */
export const WINDOWS_DOWNLOAD_URL = `${REPOSITORY_URL}/releases/latest`;

/**
 * Section du README qui explique comment brancher une vraie IA (application Windows, `npm run dev`
 * avec Ollama, préréglage du site en ligne). Si l'ancre n'existe pas, GitHub affiche le début du README.
 */
export const README_AI_SECTION_URL = `${REPOSITORY_URL}#brancher-une-vraie-ia`;

/** Page officielle de téléchargement d'Ollama (moteur d'IA local, gratuit). */
export const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download';

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
