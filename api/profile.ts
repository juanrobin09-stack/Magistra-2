// Fonction Vercel — GET | PUT /api/profile → profil enseignant de l'utilisateur connecté.
// Toute la logique (authentification Clerk, validation, stockage) est dans server/.

import { createRouteHandler } from '../server/node.js';

export default createRouteHandler('profile');
