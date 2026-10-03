// Adresses du site public (shared/site.ts) : source unique du nom de domaine, liste des origines que l'application
// Windows reconnaît (OFFICIAL_WEB_ORIGINS, compilée dans l'application), robots.txt et plan du site produits à partir
// de cette adresse.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LEGAL_PATHS } from '@/lib/legal';
import {
  buildPairingUrl, isWellFormedOrigin, OFFICIAL_WEB_ORIGINS, originLabel, parseAppUrl,
} from '../../shared/localConnector';
import { buildRobotsTxt, buildSitemapXml, SITE_LEGACY_ORIGIN, SITE_ORIGIN, SITE_PATHS, siteUrl } from '../../shared/site';
import { originTraps, SITE_APEX_ORIGIN, unicodeTraps } from '../electron/officialOrigins';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
/** Code sans commentaires (les commentaires expliquent la liste, ils ne la définissent pas). */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('adresse officielle du site', () => {
  it('SITE_ORIGIN : « www » du domaine principal, origine exacte (https, ni port, ni chemin, ni barre finale)', () => {
    expect(SITE_ORIGIN).toBe('https://www.mag-istra.fr');
    expect(new URL(SITE_ORIGIN).origin).toBe(SITE_ORIGIN);
    expect(SITE_ORIGIN).not.toMatch(/[A-Z]|:\d|\/$|@|\*/);
    expect(isWellFormedOrigin(SITE_ORIGIN)).toBe(true);
    expect(siteUrl('/')).toBe('https://www.mag-istra.fr/');
    expect(siteUrl('/cgu')).toBe('https://www.mag-istra.fr/cgu');
  });

  it('SITE_LEGACY_ORIGIN : l’adresse Vercel du projet, qui reste valable', () => {
    expect(SITE_LEGACY_ORIGIN).toBe('https://magistra-2.vercel.app');
    expect(new URL(SITE_LEGACY_ORIGIN).origin).toBe(SITE_LEGACY_ORIGIN);
    expect(SITE_APEX_ORIGIN).toBe('https://mag-istra.fr');
  });

  it('plan du site : l’accueil seul ; les pages légales (noindex et lien canonique propre) n’y sont pas', () => {
    expect([...SITE_PATHS]).toEqual(['/']);
    const routes = [...read('src/site/SiteRoutes.tsx').matchAll(/<Route path="([^"]+)"/g)].map(m => m[1]).filter(route => route !== '*');
    // Le site a quatre routes ; une seule est à indexer.
    expect([...routes].sort()).toEqual(['/', ...Object.values(LEGAL_PATHS)].sort());
    for (const page of Object.values(LEGAL_PATHS)) expect(SITE_PATHS, page).not.toContain(page);
    expect(new Set(SITE_PATHS).size).toBe(SITE_PATHS.length);
    for (const page of SITE_PATHS) expect(page.startsWith('/')).toBe(true);
    // Un seul signal : l'adresse du plan du site est celle du lien canonique et d'og:url de la page statique (site/index.html).
    const index = read('site/index.html');
    expect(index).toContain(`<link rel="canonical" href="${siteUrl(SITE_PATHS[0])}" />`);
    expect(index).toContain(`<meta property="og:url" content="${siteUrl(SITE_PATHS[0])}" />`);
  });

  it('robots.txt : tout est autorisé, le plan du site est déclaré à l’adresse officielle', () => {
    expect(buildRobotsTxt()).toBe('User-agent: *\nAllow: /\n\nSitemap: https://www.mag-istra.fr/sitemap.xml\n');
    expect(buildRobotsTxt()).not.toMatch(/disallow/i);
  });

  it('sitemap.xml : une seule adresse (l’accueil), sous https://www.mag-istra.fr, sans date', () => {
    const xml = buildSitemapXml();
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + '  <url>\n    <loc>https://www.mag-istra.fr/</loc>\n  </url>\n'
      + '</urlset>\n',
    );
    expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1])).toEqual(SITE_PATHS.map(siteUrl));
    for (const page of Object.values(LEGAL_PATHS)) expect(xml).not.toContain(page);
    expect(xml).not.toContain('lastmod');
    expect(xml).not.toContain('vercel.app');
  });
});

describe('OFFICIAL_WEB_ORIGINS (compilée dans l’application)', () => {
  it('liste exacte : l’adresse Vercel et le domaine « www », sans autre entrée', () => {
    expect([...OFFICIAL_WEB_ORIGINS]).toEqual(['https://magistra-2.vercel.app', 'https://www.mag-istra.fr']);
    expect([...OFFICIAL_WEB_ORIGINS]).toEqual([SITE_LEGACY_ORIGIN, SITE_ORIGIN]);
  });

  it('chaque entrée : origine https exacte, minuscules, ni joker, ni port, ni chemin, ni identifiants ; aucun doublon', () => {
    for (const origin of OFFICIAL_WEB_ORIGINS) {
      expect(origin).toMatch(/^https:\/\/[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/);
      expect(new URL(origin).origin).toBe(origin);
      expect(isWellFormedOrigin(origin)).toBe(true);
      // Après « https:// » : un nom d'hôte seul (ni joker, ni identifiants, ni port, ni chemin, ni point final).
      expect(origin.replace('https://', '')).not.toMatch(/[*@:/?#\s]|^\.|\.$/);
    }
    expect(new Set(OFFICIAL_WEB_ORIGINS).size).toBe(OFFICIAL_WEB_ORIGINS.length);
  });

  it('ni l’apex (non servi par le projet), ni une adresse locale, ni un sous-domaine, ni http', () => {
    expect(OFFICIAL_WEB_ORIGINS).not.toContain(SITE_APEX_ORIGIN);
    expect(OFFICIAL_WEB_ORIGINS.filter(origin => /localhost|127\.0\.0\.1|^http:/.test(origin))).toEqual([]);
    for (const origin of OFFICIAL_WEB_ORIGINS) expect(OFFICIAL_WEB_ORIGINS.some(other => other !== origin && new URL(other).host.endsWith(`.${new URL(origin).host}`))).toBe(false);
  });

  it('liste figée (aucune modification possible à l’exécution)', () => {
    expect(Object.isFrozen(OFFICIAL_WEB_ORIGINS)).toBe(true);
    expect(() => (OFFICIAL_WEB_ORIGINS as string[]).push('https://evil.example')).toThrow(TypeError);
    expect([...OFFICIAL_WEB_ORIGINS]).toHaveLength(2);
  });

  it('l’application ne reconnaît que cette liste (plus, en développement seulement, la boucle locale)', () => {
    const main = read('electron/main.ts');
    expect(main).toContain('allowedOrigins: [...OFFICIAL_WEB_ORIGINS, ...(devOptions.connectorDevOrigins ?? [])],');
    expect(main.match(/OFFICIAL_WEB_ORIGINS/g)).toHaveLength(2);
    // Ni le service ni le serveur n'ont de liste d'origine à eux : ils reçoivent celle de main.ts.
    for (const file of ['electron/connector/service.ts', 'electron/connector/server.ts', 'electron/connector/pairing.ts', 'electron/connector/clients.ts']) {
      expect(code(read(file)), file).not.toMatch(/vercel\.app|mag-istra|OFFICIAL_WEB_ORIGINS/);
    }
  });

  it('le nom de domaine n’est écrit que dans shared/site.ts (aucun autre code source ne le récrit)', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const relative = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(relative);
        else if (/\.(?:ts|tsx|mjs|js|json|css)$/.test(entry.name)) files.push(relative);
      }
    };
    for (const dir of ['shared', 'electron', 'server', 'api', 'src', 'scripts']) walk(dir);
    files.push(...['vite.config.ts', 'vite.site.config.ts', 'vitest.config.ts', 'playwright.config.ts', 'electron-builder.json', 'vercel.json', 'package.json'].filter(file => existsSync(path.join(root, file))));
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.filter(file => file !== 'shared/site.ts' && /mag-istra|magistra-2\.vercel\.app/i.test(code(read(file))));
    expect(offenders).toEqual([]);
    expect(code(read('shared/site.ts'))).toContain("'https://www.mag-istra.fr'");
    expect(code(read('shared/site.ts'))).toContain("'https://magistra-2.vercel.app'");
  });
});

describe('URL magistra://pair et origines officielles', () => {
  const pair = (origin: string) => buildPairingUrl({ pairingId: 'AAAAAAAAAAAAAAAAAAAAAA', challenge: 'B'.repeat(43), origin });

  it.each(OFFICIAL_WEB_ORIGINS)('%s : analysée à l’identique, nom d’hôte affiché sans adresse de la boucle locale', origin => {
    expect(parseAppUrl(pair(origin))).toEqual({ kind: 'pair', pairingId: 'AAAAAAAAAAAAAAAAAAAAAA', challenge: 'B'.repeat(43), origin });
    expect(originLabel(origin)).toBe(origin.replace('https://', ''));
  });

  it.each(OFFICIAL_WEB_ORIGINS)('variantes piégées de %s : jamais l’origine officielle', origin => {
    const accepted: string[] = [];
    for (const trap of [...originTraps(origin), ...unicodeTraps(origin)]) {
      const parsed = parseAppUrl(pair(trap));
      if (parsed?.kind === 'pair') accepted.push(parsed.origin);
    }
    // Quelques variantes restent « bien formées » (autre hôte, autre port) : l'application les ignore, faute d'être dans la liste.
    expect(accepted.filter(value => OFFICIAL_WEB_ORIGINS.includes(value))).toEqual([]);
    expect(accepted.length).toBeLessThan(originTraps(origin).length);
  });

  it.each(OFFICIAL_WEB_ORIGINS)('%s : casse, http, port par défaut, chemin, identifiants et formes Unicode ne sont même pas des origines bien formées', origin => {
    const host = origin.replace('https://', '');
    for (const trap of [
      `http://${host}`, origin.toUpperCase(), `HTTPS://${host}`, `https://${host.toUpperCase()}`, `${origin}:443`, `${origin}/`, `${origin}/chemin`,
      `https://user@${host}`, `https://user:mot@${host}`, `${origin}?x=1`, `${origin}#x`, ...unicodeTraps(origin),
    ]) {
      expect(isWellFormedOrigin(trap), trap).toBe(false);
      expect(parseAppUrl(pair(trap)), trap).toBeNull();
    }
  });

  it('le domaine apex, un sous-domaine, un autre port ou un suffixe collé sont bien formés mais ne sont pas dans la liste', () => {
    for (const origin of [SITE_APEX_ORIGIN, 'https://sub.www.mag-istra.fr', 'https://www.mag-istra.fr:8443', 'https://www.mag-istra.fr.evil.example', 'https://evil-www.mag-istra.fr']) {
      expect(isWellFormedOrigin(origin), origin).toBe(true);
      expect(parseAppUrl(pair(origin)), origin).toMatchObject({ kind: 'pair', origin });
      expect(OFFICIAL_WEB_ORIGINS.includes(origin), origin).toBe(false);
    }
  });
});
