// Session réservée à la fenêtre Magistra (partition « magistra-ui », en mémoire).
//
// Pourquoi une session à part : le processus principal accède au réseau (Ollama, recherche documentaire,
// installateur) par net.fetch, qui passe par la session par défaut. La fenêtre, elle, ne contacte JAMAIS le
// réseau directement (tout passe par l'IPC) : dans sa propre session, toutes les requêtes http, https, ws et
// wss sont annulées sans condition — y compris celles des workers partagés (SharedWorker) et des service
// workers, qui ne sont rattachées à aucune page (pas de webContentsId). En développement, seul le serveur
// Vite reste joignable.
//
// L'interface n'enregistre rien dans le navigateur (données et réglages sont dans le processus principal) :
// une session en mémoire suffit. Module sans import d'Electron à l'exécution : testé avec une session simulée.

import type { Session } from 'electron';
import { APP_SCHEME, isAllowedWindowRequest, isTrustedUrl } from './security.js';

/** Partition de la fenêtre (sans « persist: » : session en mémoire, rien n'y est conservé d'un lancement à l'autre). */
export const WINDOW_PARTITION = 'magistra-ui';

/** Requêtes réseau interceptées dans la session de la fenêtre. */
export const NETWORK_URL_PATTERNS = ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'];

/** Sous-ensemble de la session Electron utilisé ici (facilite les tests). */
export type SessionLike = Pick<
  Session,
  | 'setPermissionRequestHandler'
  | 'setPermissionCheckHandler'
  | 'setDevicePermissionHandler'
  | 'setSpellCheckerEnabled'
  | 'setSpellCheckerLanguages'
  | 'setSpellCheckerDictionaryDownloadURL'
  | 'on'
  | 'webRequest'
  | 'protocol'
>;

export interface WindowSessionOptions {
  /** Origines de l'application (app://magistra, et le serveur Vite en développement). */
  origins: readonly string[];
  /** Serveur Vite (développement uniquement), seul hôte joignable par la fenêtre ; null dans l'application installée. */
  devServerUrl: string | null;
  /**
   * Gestionnaire du protocole app:// (absent en développement). Il est enregistré sur CETTE session :
   * `protocol.handle` du module Electron ne vaut que pour la session par défaut.
   */
  appProtocolHandler?: (request: Request) => Promise<Response>;
}

/** Refuse toute permission (session par défaut : aucune page ne doit l'utiliser). */
export function denyAllPermissions(ses: Pick<Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler' | 'setDevicePermissionHandler'>): void {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
}

/** Permissions, téléchargements, réseau et protocole app:// de la session de la fenêtre. */
export function configureWindowSession(ses: SessionLike, options: WindowSessionOptions): void {
  const { origins, devServerUrl } = options;
  // Tout est refusé, sauf l'écriture dans le presse-papiers (bouton « Copier ») pour l'application elle-même.
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(permission === 'clipboard-sanitized-write' && isTrustedUrl(details.requestingUrl, origins));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return permission === 'clipboard-sanitized-write' && isTrustedUrl(requestingOrigin, origins);
  });
  ses.setDevicePermissionHandler(() => false);
  // Le correcteur orthographique intégré télécharge ses dictionnaires sur les serveurs de Google (Windows, Linux) :
  // désactivé pour que l'application ne contacte aucun service tiers sans action de l'enseignant.
  ses.setSpellCheckerEnabled(false);
  ses.setSpellCheckerLanguages([]);
  // Garde-fou : même si Chromium tentait un téléchargement, il ne sortirait pas de l'ordinateur.
  ses.setSpellCheckerDictionaryDownloadURL('http://127.0.0.1:9/');
  // Seuls les exports produits par l'application (blob:/data:) peuvent être enregistrés.
  ses.on('will-download', (event, item) => {
    const url = item.getURL();
    const allowed = url.startsWith('data:') || (url.startsWith('blob:') && isTrustedUrl(url.slice('blob:'.length), origins));
    if (!allowed) event.preventDefault();
  });
  // La fenêtre ne contacte jamais le réseau directement (tout passe par l'IPC) : annulation sans condition sur
  // l'émetteur (page, worker dédié ou partagé, service worker), hormis le serveur Vite en développement.
  ses.webRequest.onBeforeRequest({ urls: NETWORK_URL_PATTERNS }, (details, callback) => {
    callback({ cancel: !isAllowedWindowRequest(details.url, devServerUrl) });
  });
  if (options.appProtocolHandler) ses.protocol.handle(APP_SCHEME, options.appProtocolHandler);
}
