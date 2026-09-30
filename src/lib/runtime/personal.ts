// Mode personnel : `npm run dev` / `npm start` sur le poste de l'enseignant, sans compte.
//
// Le serveur affiche dans le terminal un lien du type http://127.0.0.1:5173/#acces=<code>. Le code est lu
// dans le FRAGMENT de l'adresse (jamais envoyé au serveur par le navigateur, absent des journaux et de
// l'en-tête Referer), mémorisé dans ce navigateur (stockage propre à l'origine), puis effacé de l'adresse.
// Il accompagne ensuite chaque appel à l'API (Authorization: Bearer <code>).

import { createContext, useContext } from 'react';

/** Nom du paramètre du fragment (« #acces=… ») ; « token » est accepté aussi. */
export const ACCESS_FRAGMENT_PARAM = 'acces';
const FRAGMENT_PARAMS = [ACCESS_FRAGMENT_PARAM, 'token'];

/** Identifiant local de l'unique utilisateur du mode personnel (clé du cache du profil). */
export const PERSONAL_USER_ID = 'personal';

/** Code d'accès plausible : caractères sûrs d'un jeton (base64, base64url, hexadécimal), longueur raisonnable. */
const CODE_RE = /^[A-Za-z0-9._~+/=-]{16,512}$/;

type WindowLike = Pick<Window, 'location' | 'history' | 'localStorage'>;

function currentWindow(): WindowLike | null {
  return typeof window === 'undefined' ? null : window;
}

/** Clé de stockage propre à l'origine (schéma, hôte, port). */
export function accessStorageKey(origin: string): string {
  return `magistra_personal_access:${origin}`;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Sépare le code d'accès du reste d'un fragment (« #acces=abc&x=1 » → code « abc », reste « x=1 »).
 * `code` vaut undefined si le fragment ne contient pas de code d'accès.
 * (Lecture manuelle : URLSearchParams transformerait les « + » d'un jeton base64 en espaces.)
 */
export function splitAccessFragment(hash: string): { code?: string; rest: string } {
  const raw = hash.replace(/^#/, '');
  if (!raw) return { rest: '' };
  let code: string | undefined;
  const rest: string[] = [];
  for (const part of raw.split('&')) {
    const eq = part.indexOf('=');
    const name = eq >= 0 ? part.slice(0, eq) : part;
    if (FRAGMENT_PARAMS.includes(decode(name).trim().toLowerCase())) {
      if (code === undefined) code = decode(eq >= 0 ? part.slice(eq + 1) : '').trim();
    } else if (part) {
      rest.push(part);
    }
  }
  return { code, rest: rest.join('&') };
}

/**
 * Normalise ce que l'enseignant colle : le code seul, « acces=… », ou le lien complet du terminal.
 * Renvoie null si ce n'est pas un code plausible.
 */
export function normalizeAccessCode(input: string): string | null {
  let value = input.trim();
  const hashAt = value.indexOf('#');
  if (hashAt >= 0) {
    const { code } = splitAccessFragment(value.slice(hashAt));
    if (code === undefined) return null;
    value = code;
  } else if (FRAGMENT_PARAMS.some(name => value.toLowerCase().startsWith(`${name}=`))) {
    value = splitAccessFragment(value).code ?? '';
  }
  return CODE_RE.test(value) ? value : null;
}

export function loadAccessCode(win: WindowLike | null = currentWindow()): string | null {
  if (!win) return null;
  try {
    const stored = win.localStorage.getItem(accessStorageKey(win.location.origin));
    return stored ? normalizeAccessCode(stored) : null;
  } catch {
    return null;
  }
}

export function storeAccessCode(code: string, win: WindowLike | null = currentWindow()): boolean {
  if (!win) return false;
  try {
    win.localStorage.setItem(accessStorageKey(win.location.origin), code);
    return true;
  } catch {
    // Stockage indisponible (navigation privée stricte) : le code reste en mémoire pour cette visite.
    return false;
  }
}

export function clearAccessCode(win: WindowLike | null = currentWindow()): void {
  if (!win) return;
  try {
    win.localStorage.removeItem(accessStorageKey(win.location.origin));
  } catch {
    // ignore
  }
}

/** Code lu dans l'adresse au démarrage (utile si le stockage du navigateur est indisponible). */
let captured: string | null = null;

/**
 * Lit le code d'accès dans le fragment de l'adresse, le mémorise, puis l'EFFACE de l'adresse
 * (history.replaceState : ni l'historique ni un favori ne le conservent). Appelé avant le premier rendu.
 */
export function captureAccessFromUrl(win: WindowLike | null = currentWindow()): string | null {
  if (!win) return null;
  const { code, rest } = splitAccessFragment(win.location.hash);
  if (code === undefined) return null;
  try {
    const { pathname, search } = win.location;
    win.history.replaceState(win.history.state, '', `${pathname}${search}${rest ? `#${rest}` : ''}`);
  } catch {
    // Adresse non modifiable : sans conséquence pour le fonctionnement.
  }
  const normalized = code ? normalizeAccessCode(code) : null;
  if (normalized) {
    captured = normalized;
    storeAccessCode(normalized, win);
  }
  return normalized;
}

/** Code à utiliser au démarrage : celui du lien, sinon celui mémorisé dans ce navigateur. */
export function initialAccessCode(win: WindowLike | null = currentWindow()): string | null {
  return captured ?? loadAccessCode(win);
}

/** Réservé aux tests. */
export function resetCapturedAccessCode(): void {
  captured = null;
}

// ─── Contexte React ─────────────────────────────────────────────────────────

export interface PersonalAccess {
  /** Un code d'accès est connu (il peut encore être refusé par le serveur). */
  hasCode: boolean;
  /**
   * Enregistre le code saisi ou collé : 'invalid' s'il n'est pas lisible, 'same' s'il est identique au code
   * actuel (il faut alors relire le profil), 'changed' sinon (le profil est relu automatiquement).
   */
  submit(input: string): 'invalid' | 'same' | 'changed';
  /** Oublie le code mémorisé dans ce navigateur. */
  forget(): void;
}

export const PersonalAccessContext = createContext<PersonalAccess | null>(null);

/** null hors du mode personnel. */
export function usePersonalAccess(): PersonalAccess | null {
  return useContext(PersonalAccessContext);
}
