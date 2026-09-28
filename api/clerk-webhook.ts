// Fonction Vercel — POST /api/clerk-webhook : webhook Clerk (Svix), évènement « user.deleted ».
// Authentifié par signature (CLERK_WEBHOOK_SECRET), jamais par jeton de session. Logique : server/.

import { createRouteHandler } from '../server/node.js';

export default createRouteHandler('clerk-webhook');
