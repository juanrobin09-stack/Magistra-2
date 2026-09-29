// Fonction Vercel — GET /api/mode → mode d'authentification (public, sans aucun secret : clé PUBLIABLE Clerk au plus).
// Toute la logique est dans server/ ; sur Vercel, le mode personnel est toujours refusé.

import { createRouteHandler } from '../server/node.js';

export default createRouteHandler('mode');
