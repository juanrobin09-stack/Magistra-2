// Fonction Vercel — GET /api/status → état du serveur d'IA et des sources de recherche (sans aucun secret).
// Toute la logique (authentification Clerk, validation, stockage) est dans server/.

import { createRouteHandler } from '../server/node.js';

export default createRouteHandler('status');
