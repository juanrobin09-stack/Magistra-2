// Règles de sécurité du processus principal : origine de l'application, vérification de l'expéditeur IPC,
// liens externes. Module pur (aucun import d'Electron à l'exécution) : il est testé sans fenêtre.

import type { WebContents, WebFrameMain } from 'electron';

/** Schéma et hôte servant l'interface empaquetée (protocole personnalisé, sans serveur HTTP). */
export const APP_SCHEME = 'app';
export const APP_HOST = 'magistra';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_URL = `${APP_ORIGIN}/`;

/**
 * Politique de sécurité du contenu envoyée avec TOUTES les réponses app:// (pages HTML, mais aussi scripts :
 * un worker tient sa politique de l'en-tête de son propre script, pas de la page qui le crée).
 * L'interface ne contacte jamais Internet directement : tout passe par le pont IPC.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Origine « schéma://hôte[:port] » d'une URL. Contrairement à `URL.origin` (qui vaut « null » pour
 * les schémas non spéciaux comme app://), cette fonction traite app:// comme une origine normale.
 */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.host) return null;
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return null;
  }
}

/** URL du serveur de développement Vite, acceptée uniquement sur la boucle locale. */
export function parseDevServerUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Origines autorisées à utiliser le pont : l'application, et le serveur Vite en développement. */
export function trustedOrigins(devServerUrl: string | null): string[] {
  const origins = [APP_ORIGIN];
  const dev = devServerUrl ? originOf(devServerUrl) : null;
  if (dev) origins.push(dev);
  return origins;
}

export function isTrustedUrl(url: string, origins: readonly string[]): boolean {
  const origin = originOf(url);
  return origin !== null && origins.includes(origin);
}

/**
 * Requête réseau (http, https, ws, wss) émise dans la session de la fenêtre : autorisée ou non.
 * Application installée (aucun serveur de développement) : jamais — la fenêtre passe toujours par l'IPC.
 * Développement : uniquement le serveur Vite, en HTTP et par son WebSocket de rechargement à chaud.
 */
export function isAllowedWindowRequest(url: string, devServerUrl: string | null): boolean {
  const dev = devServerUrl ? originOf(devServerUrl) : null;
  if (!dev) return false;
  // Le WebSocket de Vite (ws://, wss://) partage l'hôte et le port du serveur (http://, https://).
  const origin = originOf(url.replace(/^ws(s?):/i, 'http$1:'));
  return origin === dev;
}

/** Sous-ensemble de l'évènement IPC utilisé pour la vérification (facilite les tests). */
export interface SenderEventLike {
  sender: Pick<WebContents, 'id'> | null | undefined;
  senderFrame: Pick<WebFrameMain, 'url' | 'parent' | 'frameTreeNodeId'> | null | undefined;
}

export interface TrustedWindowLike {
  webContents: Pick<WebContents, 'id' | 'isDestroyed'> & { mainFrame: Pick<WebFrameMain, 'frameTreeNodeId'> };
  isDestroyed(): boolean;
}

/**
 * Vérifie qu'un message IPC provient du cadre principal de la fenêtre Magistra, avec l'origine de l'application.
 * Refuse : autre fenêtre, sous-cadre (iframe), cadre détruit, origine étrangère (site externe, file://…).
 */
export function isTrustedSender(event: SenderEventLike, win: TrustedWindowLike | null, origins: readonly string[]): boolean {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return false;
  const frame = event.senderFrame;
  if (!frame || !event.sender) return false;
  if (event.sender.id !== win.webContents.id) return false;
  if (frame.parent !== null) return false;
  if (frame.frameTreeNodeId !== win.webContents.mainFrame.frameTreeNodeId) return false;
  return isTrustedUrl(frame.url, origins);
}

/**
 * Lien externe autorisé à s'ouvrir dans le navigateur du système : http(s) uniquement,
 * sans identifiants intégrés, longueur bornée. Jamais file:, javascript:, data:, smb:…
 */
export function isSafeExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;
  if (hasControlChars(value) || /\s/.test(value)) return false;
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (!u.hostname) return false;
    if (u.username || u.password) return false;
    return true;
  } catch {
    return false;
  }
}

/** Vrai si la chaîne contient un caractère de contrôle (U+0000 à U+001F, U+007F). */
export function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Retire les caractères nuls (jamais légitimes dans un texte enregistré). */
export function stripNul(value: string): string {
  return value.split(String.fromCharCode(0)).join('');
}

/** Adresse de boucle locale (Ollama sur cet ordinateur) : prédicat unique, partagé avec l'interface et les fournisseurs. */
export { isLoopbackHostname as isLoopbackHost } from '../shared/ai/loopback.js';
