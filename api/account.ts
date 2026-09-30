// Fonction Vercel — DELETE /api/account → suppression de toutes les données de l'utilisateur connecté.
// Toute la logique (authentification Clerk, validation, stockage) est dans server/.

import { createRouteHandler } from '../server/node.js';

export default createRouteHandler('account');
