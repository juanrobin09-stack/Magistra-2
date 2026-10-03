// Adresses du site public (vitrine, hébergée sur Vercel) : SOURCE UNIQUE de son nom de domaine.
//
// Utilisée par la liste des origines que l'application Windows reconnaît (OFFICIAL_WEB_ORIGINS, shared/localConnector.ts),
// par la construction du site (robots.txt et plan du site, vite.site.config.ts), par scripts/verify-site.mjs (qui lit
// SITE_ORIGIN dans ce fichier : le lien canonique et l'adresse Open Graph de site/index.html doivent la reprendre à
// l'identique) et par les tests. Aucun autre fichier ne doit récrire le domaine : un changement de domaine se fait ici,
// dans site/index.html (lien canonique et og:url, vérifiés à la construction), puis par une nouvelle version de
// l'application (la liste des origines est compilée dans l'application).

/**
 * Adresse officielle du site : le domaine principal (« www »). C'est celle du lien canonique, du plan du site et de
 * robots.txt. Origine exacte (https, aucun port, aucun chemin ni barre finale) : elle sert aussi de valeur de comparaison.
 */
export const SITE_ORIGIN = 'https://www.mag-istra.fr';

/**
 * Adresse Vercel du projet : reste valable (alias) tant que le projet la porte. Les installations qui précèdent le
 * nouveau domaine ne connaissent que celle-ci.
 */
export const SITE_LEGACY_ORIGIN = 'https://magistra-2.vercel.app';

/**
 * Pages du plan du site (sitemap.xml) : l'accueil seul. Toutes les routes du site (accueil et pages légales,
 * src/site/SiteApp.tsx) sont servies par la même page statique, donc avec le même lien canonique et la même adresse
 * og:url : celles de l'accueil. Lister les pages légales comme pages distinctes contredirait ce lien canonique, et elles
 * n'ont pas à être indexées.
 */
export const SITE_PATHS: readonly string[] = ['/'];

/** Adresse complète d'une page du site (« / » → « https://www.mag-istra.fr/ »). */
export function siteUrl(sitePath: string): string {
  return `${SITE_ORIGIN}${sitePath}`;
}

/** robots.txt : tout est autorisé, le plan du site est déclaré. */
export function buildRobotsTxt(): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl('/sitemap.xml')}\n`;
}

/** sitemap.xml : une entrée par page de SITE_PATHS (l'accueil), sans date (une date figée serait fausse au déploiement suivant). */
export function buildSitemapXml(): string {
  const entries = SITE_PATHS.map(sitePath => `  <url>\n    <loc>${siteUrl(sitePath)}</loc>\n  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}
