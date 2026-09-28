// Fonction Vercel — GET | PATCH | DELETE /api/generation?id=… → un contenu de l'utilisateur connecté.
// Toute la logique (authentification Clerk, validation, stockage) est dans server/.

import { createRouteHandler } from '../server/node.js';

export default createRouteHandler('generation');
