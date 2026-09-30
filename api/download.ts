// Fonction Vercel — GET /api/download (et /telecharger, réécriture de vercel.json) : téléchargement de l'installateur
// Windows depuis le lien du site (redirection vers le fichier, jamais vers une page GitHub). Public, sans aucun secret.
// Toute la logique est dans server/ (handlers.ts : download).

import { createRouteHandler } from '../server/node.js';

export default createRouteHandler('download');
