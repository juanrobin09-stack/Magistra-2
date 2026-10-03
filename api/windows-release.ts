// Fonction Vercel — GET /api/windows-release → installateur de la dernière version STABLE de l'application Windows
// (public, sans aucun secret ; réponse mise en cache par le CDN). Toute la logique (GitHub, vérifications) est dans
// server/windowsRelease.ts, qui ne charge ni la configuration des comptes, ni celle de l'IA : cette fonction n'a besoin
// d'aucune variable d'environnement (GITHUB_TOKEN et MAGISTRA_RELEASES_REPO sont facultatives).

import { createPublicRouteHandler } from '../server/windowsRelease.js';

export default createPublicRouteHandler('windows-release');
