import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SITE_ORIGIN } from '../../shared/site';
import { SITE_SEO, SITE_TITLE, SITE_STRUCTURED_DATA } from '../../shared/siteSeo';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const verify = await import(pathToFileURL(path.join(root, 'scripts/verify-prerender.mjs')).href) as {
  checkPrerenderedPage(html: string, options: { siteOrigin: string; pagePath?: string }): string[];
};
const read = (file: string) => readFileSync(path.join(root, 'dist-site', file), 'utf8');

describe.skipIf(!existsSync(path.join(root, 'dist-site', '404.html')))('SEO des pages construites', () => {
  it('présentation complète et FAQ accessibles sans exécuter JavaScript', () => {
    const html = read('index.html');
    expect(html).toContain(`<title>${SITE_TITLE}</title>`);
    expect(html).toMatch(/<h1\b[^>]*>L&#x27;IA qui prépare/);
    expect(html).toContain('Magistra est un assistant pédagogique gratuit');
    expect(html).toContain('Magistra est-il vraiment gratuit');
    expect(html).toContain('href="/telecharger"');
    expect(verify.checkPrerenderedPage(html, { siteOrigin: SITE_ORIGIN })).toEqual([]);
  });

  it.each(Object.keys(SITE_SEO).filter(route => route !== '/'))('%s : métadonnées propres, contenu et noindex', route => {
    const html = read(`${route.slice(1)}.html`);
    expect(html).toContain(`href="${SITE_ORIGIN}${route}"`);
    expect(html).toContain('content="noindex, follow"');
    expect(verify.checkPrerenderedPage(html, { siteOrigin: SITE_ORIGIN, pagePath: route })).toEqual([]);
  });

  it('les données structurées ne fabriquent ni avis ni notes', () => {
    const data = JSON.parse(/<script type="application\/ld\+json">([^<]+)<\/script>/.exec(read('index.html'))![1]);
    expect(data).toEqual(SITE_STRUCTURED_DATA);
    expect(JSON.stringify(data)).not.toMatch(/aggregateRating|reviewCount|ratingValue/);
    expect(data['@graph'][1].offers.price).toBe('0');
  });

  it.each([
    '<script>alert(1)</script>',
    '<script type="module" src="https://evil.example/payload.js"></script>',
    '<svg><use href="https://evil.example/icon.svg#x" /></svg>',
    '<img src="https://evil.example/pixel">',
    '<a href="javascript:alert(1)">piège</a>',
    '<div style="background:url(https://evil.example/pixel)">piège</div>',
    '<span onmouseover="alert(1)">piège</span>',
    '<base href="https://evil.example/">',
    '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    '<noscript><style title="</noscript><img src=https://evil.example/pixel>">x</style></noscript>',
  ])('le contrôle refuse une injection dans le HTML pré-rendu : %s', payload => {
    const html = read('index.html').replace('</main>', `${payload}</main>`);
    expect(verify.checkPrerenderedPage(html, { siteOrigin: SITE_ORIGIN }).length).toBeGreaterThan(0);
  });

  it('refuse un JSON-LD modifié hors de son empreinte CSP', () => {
    const html = read('index.html').replace('"price":"0"', '"price":"999"');
    expect(verify.checkPrerenderedPage(html, { siteOrigin: SITE_ORIGIN }).join(' ')).toContain('JSON-LD');
  });
});
