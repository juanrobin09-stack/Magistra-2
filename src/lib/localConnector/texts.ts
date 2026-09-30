// Textes de Magistra locale affichables sur le SITE WEB : filtre appliqué à tout message venu de l'application
// (état du moteur, erreurs et avertissements d'une génération locale) avant l'affichage.
//
// L'application filtre déjà ses messages (electron/connector/status.ts) ; ce filtre est une seconde barrière
// (application ancienne, message générique d'un code qui cite le moteur…) : jamais d'adresse (localhost,
// 127.0.0.1…), jamais de port, jamais de chemin, jamais le nom du moteur (« Ollama »).

import { defaultMessage, type ErrorCode } from '@shared/errors';
import { LOCAL_ENGINE_SITE_MESSAGES } from '@shared/localConnector';

/**
 * Motifs jamais affichés à propos de Magistra locale : nom du moteur, adresse de la boucle locale, adresse IP, port
 * (« :11434 », « le port 11434 »), URL, chemins (C:\…, ~\…, ~/…).
 */
const HIDDEN_PATTERNS: readonly RegExp[] = [
  /ollama/i,
  /\blocalhost\b/i,
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/,
  /\[?::1\]?/,
  /[A-Za-z0-9\])]:\d{2,5}\b/,
  /\bport\s+\d{2,5}\b/i,
  /\b[a-z][a-z0-9+.-]{1,20}:\/\//i,
  /\b[A-Za-z]:[\\/]/,
  /~[\\/]/,
];

const GENERIC_NOT_READY =
  "L'intelligence locale de Magistra n'est pas prête : ouvrez l'application Magistra pour la préparer.";

export function isDisplayableText(text: string): boolean {
  return HIDDEN_PATTERNS.every(re => !re.test(text));
}

/** Message de Magistra locale affichable : le message reçu s'il est sûr, sinon un texte neutre pour son code. */
export function localEngineMessage(code: ErrorCode, message: string | undefined): string {
  const text = message?.trim() ?? '';
  if (text && isDisplayableText(text)) return text;
  const neutral = LOCAL_ENGINE_SITE_MESSAGES[code];
  if (neutral) return neutral;
  const fallback = defaultMessage(code);
  return isDisplayableText(fallback) ? fallback : GENERIC_NOT_READY;
}
