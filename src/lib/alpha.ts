// Configuration de la version Alpha privée de Magistra.
// Tout est codé en dur ici volontairement : pas de variable d'environnement,
// pas de base de données, pas de configuration externe.

// Pour désactiver le mode Alpha (badge, compteur, limite de générations),
// il suffit de passer ALPHA_MODE à false — tout le reste du code s'adapte automatiquement.
export const ALPHA_MODE = true;

// Nombre maximum de générations IA autorisées par compte pendant la phase Alpha.
// Pour changer la limite, modifier uniquement cette valeur.
export const ALPHA_MAX_GENERATIONS = 10;

// Adresse e-mail qui reçoit les retours envoyés via le bouton "Envoyer un retour".
// Pour changer le destinataire, modifier uniquement cette valeur.
export const ALPHA_FEEDBACK_EMAIL = 'juanrobin09@gmail.com';
