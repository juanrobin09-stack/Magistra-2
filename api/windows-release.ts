// Fonction Vercel — GET /api/windows-release → installateur de la dernière version STABLE de l'application Windows
// (public, sans aucun secret ; réponse mise en cache par le CDN). Toute la logique (GitHub, vérifications) est dans server/.

import { createRouteHandler } from '../server/node.js';

export default createRouteHandler('windows-release');
