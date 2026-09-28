// Fonction Vercel — GET /api/stats?tz=Europe/Paris → statistiques exactes de l'utilisateur connecté.
// Toute la logique (authentification Clerk, validation, stockage) est dans server/.

import { createRouteHandler } from '../server/node.js';

export default createRouteHandler('stats');
