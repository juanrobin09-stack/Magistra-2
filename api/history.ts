// Fonction Vercel — GET /api/history?favorites=1&cursor=…&limit=… → page d'historique de l'utilisateur connecté.
// Toute la logique (authentification Clerk, validation, stockage) est dans server/.

import { createRouteHandler } from '../server/node.js';

export default createRouteHandler('history');
