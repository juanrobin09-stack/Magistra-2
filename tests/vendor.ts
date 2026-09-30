// Motif des mentions d'un fournisseur d'IA commercial retiré du projet (nom, modèle, préfixe de clé).
// Il est assemblé à partir de fragments pour que `git grep` sur ces noms ne trouve rien dans le dépôt,
// en dehors des documents d'audit (ANALYSE.md, CORRECTIONS.md) qui en retracent l'historique.
export const COMMERCIAL_VENDOR = new RegExp([['anthr', 'opic'], ['cla', 'ude'], ['sk-', 'ant']].map(p => p.join('')).join('|'), 'i');
