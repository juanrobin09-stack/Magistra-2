// Ce nom identifie le transport corrigé. Les versions <= 2.0.9 ne le reconnaissent
// pas et proposent leur bouton existant « Ouvrir la page de la nouvelle version ».
// Ne pas publier le nom historique avec les nouvelles versions : la 2.0.7/2.0.8
// proposerait à nouveau son téléchargement intégré défectueux.
export const UPDATE_CHECKSUMS_FILE = 'SHA256SUMS-v2.txt';
export const LEGACY_UPDATE_CHECKSUMS_FILE = 'SHA256SUMS.txt';
