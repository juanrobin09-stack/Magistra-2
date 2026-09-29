// Fonction Vercel — GET | PATCH | DELETE /api/generation?id=… → un contenu de l'utilisateur connecté ;
// POST /api/generation → enregistre une génération faite par Magistra locale (connecteur de l'application Windows).
// Toute la logique (authentification Clerk, validation, stockage) est dans server/.

import { createRouteHandler } from '../server/node.js';

export default createRouteHandler('generation');
