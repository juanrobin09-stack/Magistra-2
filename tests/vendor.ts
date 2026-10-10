// Motif des mentions d'un fournisseur d'IA commercial (nom, modèle, préfixe de clé).
// La vitrine, les prompts, le serveur et les modèles locaux n'en imposent aucun. Les références dans
// l'intégration API personnelle optionnelle et sa documentation sont autorisées par deploy.test.ts.
export const COMMERCIAL_VENDOR = new RegExp([['anthr', 'opic'], ['cla', 'ude'], ['sk-', 'ant']].map(p => p.join('')).join('|'), 'i');
