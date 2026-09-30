// Nom du navigateur affiché dans les réglages de l'application (« Google Chrome », « Microsoft Edge »…), déduit de
// l'en-tête User-Agent de la requête d'appairage. Purement indicatif : l'en-tête n'est jamais une preuve d'identité
// (la sécurité repose sur la clé de l'appairage) et il n'est jamais conservé tel quel.

/** Libellés possibles : l'en-tête User-Agent n'est jamais conservé ni affiché tel quel. */
export type BrowserLabel = 'Google Chrome' | 'Microsoft Edge' | 'Mozilla Firefox' | 'Navigateur';

const MAX_UA_LENGTH = 1_000;

export function browserFromUserAgent(userAgent: unknown): BrowserLabel {
  if (typeof userAgent !== 'string' || !userAgent || userAgent.length > MAX_UA_LENGTH) return 'Navigateur';
  // Edge et Opera s'annoncent aussi comme « Chrome/… » : leurs marqueurs propres sont examinés d'abord.
  if (/\bEdg(?:e|A|iOS)?\/\d/.test(userAgent)) return 'Microsoft Edge';
  if (/\b(?:OPR|Opera|OPiOS|YaBrowser|SamsungBrowser|Vivaldi|UCBrowser)\/\d/.test(userAgent)) return 'Navigateur';
  if (/\bFirefox\/\d/.test(userAgent) || /\bFxiOS\/\d/.test(userAgent)) return 'Mozilla Firefox';
  if (/\b(?:Chrome|CriOS)\/\d/.test(userAgent) && !/\bChromium\/\d/.test(userAgent)) return 'Google Chrome';
  return 'Navigateur';
}
