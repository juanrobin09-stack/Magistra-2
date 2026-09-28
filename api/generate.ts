// Fonction Vercel — POST /api/generate → flux NDJSON d'évènements de génération (durée max. : voir vercel.json).
// Toute la logique (authentification Clerk, validation, stockage) est dans server/.

import { createRouteHandler } from '../server/node.js';

export default createRouteHandler('generate');
