// Fonction Vercel — GET /api/download (et /telecharger, réécriture de vercel.json) : téléchargement de l'installateur
// Windows depuis le lien du site (redirection vers le fichier, jamais vers une page GitHub). Public, sans aucun secret.
// Toute la logique est dans server/windowsRelease.ts, qui ne charge ni la configuration des comptes, ni celle de l'IA.

import { createPublicRouteHandler } from '../server/windowsRelease.js';

export default createPublicRouteHandler('download');
