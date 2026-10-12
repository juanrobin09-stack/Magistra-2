import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SITE_ORIGIN, SITE_PATHS } from '../../shared/site';
import { SITE_SEO, SITE_TITLE, SITE_STRUCTURED_DATA, SITE_IMAGE_PATH, siteStructuredDataJson } from '../../shared/siteSeo';
import { SITE_GUIDES } from '../../shared/siteGuides';

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

  it.each(Object.keys(SITE_SEO).filter(route => route !== '/'))('%s : métadonnées propres, contenu et indexation cohérente', route => {
    const html = read(`${route.slice(1)}.html`);
    expect(html).toContain(`href="${SITE_ORIGIN}${route}"`);
    expect(html).toContain(`content="${SITE_SEO[route].index ? 'index, follow, max-image-preview:large' : 'noindex, follow'}"`);
    expect(html).toContain(`content="${SITE_ORIGIN}${SITE_IMAGE_PATH}"`);
    expect(verify.checkPrerenderedPage(html, { siteOrigin: SITE_ORIGIN, pagePath: route })).toEqual([]);
  });

  it('les données structurées ne fabriquent ni avis ni notes', () => {
    const data = JSON.parse(/<script type="application\/ld\+json">([^<]+)<\/script>/.exec(read('index.html'))![1]);
    expect(data).toEqual(SITE_STRUCTURED_DATA);
    expect(JSON.stringify(data)).not.toMatch(/aggregateRating|reviewCount|ratingValue/);
    expect(data['@graph'][1].offers.price).toBe('0');
  });

  it('chaque contenu indexable possède un titre et une description uniques', () => {
    expect(SITE_PATHS).toHaveLength(14);
    expect(new Set(SITE_PATHS.map(route => SITE_SEO[route].title)).size).toBe(SITE_PATHS.length);
    expect(new Set(SITE_PATHS.map(route => SITE_SEO[route].description)).size).toBe(SITE_PATHS.length);
    expect(read('sitemap.xml').match(/<loc>/g)).toHaveLength(SITE_PATHS.length);
  });

  it.each(SITE_GUIDES)('$path : article, fil d’Ariane et contenu visibles cohérents', guide => {
    const html = read(`${guide.path.slice(1)}.html`);
    const json = /<script type="application\/ld\+json">([^<]+)<\/script>/.exec(html)![1];
    expect(json).toBe(siteStructuredDataJson(guide.path));
    const data = JSON.parse(json);
    expect(data['@graph'][0]).toMatchObject({ '@type': 'Article', url: `${SITE_ORIGIN}${guide.path}`, headline: guide.heading });
    expect(data['@graph'][1]['@type']).toBe('BreadcrumbList');
    expect(data['@graph'][1].itemListElement.at(-1).item).toBe(`${SITE_ORIGIN}${guide.path}`);
    expect(json).not.toMatch(/aggregateRating|ratingValue|reviewCount|FAQPage/);
  });

  it('refuse le schéma valide d’une autre page même si son empreinte CSP est autorisée', () => {
    const guide = SITE_GUIDES[0];
    const html = read(`${guide.path.slice(1)}.html`).replace(/(<script type="application\/ld\+json">)[^<]+(<\/script>)/, `$1${siteStructuredDataJson('/')}$2`);
    expect(verify.checkPrerenderedPage(html, { siteOrigin: SITE_ORIGIN, pagePath: guide.path }).join(' ')).toContain('JSON-LD');
  });

  it('les métadonnées modifiées et les pages indexées à tort sont refusées', () => {
    const html = read('404.html').replace('content="noindex, follow"', 'content="index, follow, max-image-preview:large"');
    expect(verify.checkPrerenderedPage(html, { siteOrigin: SITE_ORIGIN, pagePath: '/404' }).join(' ')).toContain('robots');
    const altered = read('index.html').replace(`<title>${SITE_TITLE}</title>`, '<title>Autre produit</title>');
    expect(verify.checkPrerenderedPage(altered, { siteOrigin: SITE_ORIGIN }).join(' ')).toContain('titre');
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
