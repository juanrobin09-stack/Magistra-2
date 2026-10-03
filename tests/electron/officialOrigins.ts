// Origines « presque » officielles : tout ce que l'application doit refuser alors qu'elle accepte, caractère pour
// caractère, les origines de OFFICIAL_WEB_ORIGINS. Partagé par les tests du connecteur (serveur HTTP, URL magistra://pair,
// appairage, navigateurs autorisés), de la politique de liens et du site. Fichier d'aide : aucun test ici.

import { domainToASCII } from 'node:url';
import { SITE_ORIGIN } from '../../shared/site';

/** Adresse du domaine principal sans « www » (non servie par le projet : redirigée vers « www » chez l'hébergeur). */
export const SITE_APEX_ORIGIN = SITE_ORIGIN.replace('://www.', '://');

/** Remplace la première occurrence de `from` par `to` (échoue bruyamment si le nom d'hôte a changé : le test serait faux). */
function swap(host: string, from: string, to: string): string {
  if (!host.includes(from)) throw new Error(`« ${from} » absent de ${host} : ajustez officialOrigins.ts`);
  return host.replace(from, to);
}

/**
 * Valeurs d'en-tête Origin qu'un navigateur ou un programme peut envoyer (caractères d'un en-tête HTTP : ASCII, ou
 * Latin-1 pour un octet isolé) et qui ne sont PAS exactement `origin`. Aucune ne doit être acceptée.
 */
export function headerTraps(origin: string): string[] {
  const host = new URL(origin).host;
  const upper = origin.toUpperCase();
  const mixed = `https://${host.replace(/^./, c => c.toUpperCase())}`;
  // Homographes : un caractère d'un autre alphabet (a cyrillique) ou accentué. Un navigateur n'envoie que la forme
  // punycode (« xn-- »), un programme quelconque peut envoyer un octet Latin-1.
  const cyrillic = domainToASCII(swap(host, 'a', '\u0430'));
  const dotless = domainToASCII(swap(host, 'i', '\u0131'));
  return [
    // schéma et port
    `http://${host}`, `${origin}:443`, `${origin}:8443`, `${origin}:80`, `${origin}:`, `${origin}:0`, `ftp://${host}`, `wss://${host}`,
    // identifiants intégrés (l'hôte réel est alors celui d'après « @ »)
    `https://user@${host}`, `https://user:mot@${host}`, `https://${host}@evil.example`, `https://evil.example@${host}`, `https://${host}:443@evil.example`,
    // sous-domaines, suffixe collé, préfixe collé, hôte tronqué
    `https://sub.${host}`, `https://a.b.${host}`, `${origin}.evil.example`, `${origin}.evil.example:8443`, `https://evil-${host}`, `https://evil${host}`,
    `https://${host.slice(1)}`, `https://${host.slice(0, -1)}`, `https://${host}x`, `https://${host.replace(/\./g, '-')}`,
    // casse, point final, chemin, requête, fragment
    upper, `HTTPS://${host}`, `https://${host.toUpperCase()}`, mixed, `https://${host}.`, `${origin}/`, `${origin}/chemin`, `${origin}?x=1`, `${origin}#x`, `${origin}\\`,
    // schéma absent ou mal écrit
    host, `//${host}`, `https:${host}`, `https:/${host}`, `https:\\\\${host}`, `https//${host}`, `https:///${host}`,
    // homographes et punycode
    `https://${cyrillic}`, `https://${dotless}`, `https://${host.replace('i', '\u00ed')}`, `https://xn--${host}`, `https://${host.replace(/^[^.]+/, 'xn--')}`,
    // plusieurs origines dans une seule valeur
    `${origin}, https://evil.example`, `https://evil.example, ${origin}`, `${origin},${origin}`, `${origin} ${origin}`, `${origin}\t${origin}`,
    // valeurs particulières
    'null', '', 'file://', 'file:///C:/', 'app://magistra', 'app://magistra/', 'about:blank', 'data:text/html,x', 'https://', 'https://.', 'https://localhost', '*',
  ];
}

/**
 * Les variantes propres à l'une ou l'autre origine officielle : l'autre adresse officielle (une demande ouverte pour l'une ne
 * s'applique jamais à l'autre), l'apex, et des adresses voisines du même hébergeur (déploiements de prévisualisation Vercel).
 */
export function neighbourTraps(origin: string): string[] {
  if (origin === SITE_ORIGIN) {
    return [
      SITE_APEX_ORIGIN, `${SITE_APEX_ORIGIN}:443`, 'https://mag-istra.fr.', 'https://www.magistra.fr', 'https://www.mag-istra.com', 'https://www.mag-istra.eu',
      'https://www.mag-istra.fr.vercel.app', 'https://mag-istra.vercel.app', 'https://app.mag-istra.fr', 'https://api.mag-istra.fr', 'https://m.mag-istra.fr',
      'https://ww.mag-istra.fr', 'https://www2.mag-istra.fr', 'https://wwww.mag-istra.fr', 'https://www-mag-istra.fr',
    ];
  }
  return [
    'https://magistra.vercel.app', 'https://www.magistra-2.vercel.app', 'https://magistra-2.vercel.app.evil.example', 'https://magistra-2-git-master-evil.vercel.app',
    'https://magistra-2-abc123.vercel.app', 'https://preview-magistra-2.vercel.app', 'https://vercel.app', 'https://magistra-3.vercel.app',
  ];
}

/** Toutes les valeurs d'en-tête Origin à refuser pour cette origine officielle (sans doublon, jamais l'origine elle-même). */
export function originTraps(origin: string): string[] {
  return [...new Set([...headerTraps(origin), ...neighbourTraps(origin)])].filter(value => value !== origin);
}

/**
 * Formes Unicode d'une origine (un humain, un programme ou un lien piégé les écrit ainsi ; un navigateur envoie la forme
 * punycode) : elles ne sont JAMAIS la forme exacte attendue. Pour les contrôles qui ne passent pas par un en-tête HTTP
 * (URL magistra://pair).
 */
export function unicodeTraps(origin: string): string[] {
  const host = new URL(origin).host;
  return [
    `https://${swap(host, 'i', '\u0131')}`, // i sans point
    `https://${swap(host, 'a', '\u0430')}`, // a cyrillique
    `https://${swap(host, 'r', '\u0433')}`, // « г » cyrillique
    `https://${host.replace('-', '\u2010')}`, // trait d'union Unicode
    `https://${host.replace('.', '\u3002')}`, // point d'idéogramme
    `https://${host.replace(/^.../, letters => [...letters].map(c => (/[a-z]/.test(c) ? String.fromCharCode(c.charCodeAt(0) + 0xfee0) : c)).join(''))}`, // trois premières lettres en pleine chasse (« ｗｗｗ »), ramenées à l'ASCII par l'analyse d'URL
    `https://${host}\u200b`, // espace de largeur nulle
    `https://\u200b${host}`,
  ];
}
