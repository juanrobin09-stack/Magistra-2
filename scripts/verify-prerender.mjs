// Contrôle du HTML React pré-rendu avec un vrai parseur HTML (aucun script ni ressource n’est exécuté).
// Le gabarit minimal garde son contrôle historique ; ce contrôle couvre les pages complètes.
import { JSDOM } from 'jsdom';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { siteSeoSource } from './site-seo-source.mjs';

const ASSET = /^\/assets\/[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;
const TAGS = new Set('html head body title meta link script noscript main nav header footer section article div span h1 h2 h3 h4 p strong em br a ol ul li code small details summary button svg path rect circle ellipse line polygon polyline g'.split(' '));
const ATTRS = new Set('lang charset name property content rel href type sizes crossorigin src id class role style target disabled open width height viewBox fill d cx cy r x y x1 x2 y1 y2 rx ry points xmlns stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset fill-rule clip-rule opacity transform focusable'.toLowerCase().split(' '));
const META = new Set('description author viewport theme-color color-scheme robots google-site-verification twitter:card twitter:title twitter:description twitter:image twitter:image:alt'.split(' '));
const OG = new Set('og:type og:site_name og:title og:description og:url og:locale og:image og:image:width og:image:height og:image:type og:image:alt'.split(' '));

export function checkPrerenderedPage(html, { siteOrigin, pagePath = '/' } = {}) {
  const errors = [];
  const dom = new JSDOM(html); // pas de runScripts, ni de resources: usable
  const doc = dom.window.document;
  const fail = message => errors.push(`${pagePath} : ${message}`);
  const canonicalPath = Object.hasOwn(siteSeoSource.SITE_SEO, pagePath) ? pagePath : '/404';
  const page = siteSeoSource.SITE_SEO[canonicalPath];
  const canonical = `${siteOrigin}${canonicalPath}`;
  const expectedJson = siteSeoSource.siteStructuredDataJson(canonicalPath);
  const csp = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).headers
    .flatMap(rule => rule.headers).find(header => header.key.toLowerCase() === 'content-security-policy')?.value ?? '';
  try {
    if (!/^\s*<!doctype html>/i.test(html) || doc.documentElement.lang !== 'fr') fail('doctype HTML et langue française requis');
    // Le bloc noscript fixe a exactement la même lecture, que JavaScript soit activé ou non.
    if (!html.includes('<noscript><a href="/telecharger">Télécharger Magistra pour Windows</a>.</noscript>') || (html.match(/<noscript\b/gi)?.length ?? 0) !== 1) fail('noscript différent du lien de téléchargement autorisé');
    for (const [selector, count] of [['title', 1], ['#root', 1], ['main', 1], ['h1', 1], ['link[rel="canonical"]', 1], ['meta[name="description"]', 1], ['meta[name="robots"]', 1], ['meta[property="og:url"]', 1]]) {
      if (doc.querySelectorAll(selector).length !== count) fail(`un seul ${selector} est requis`);
    }
    if (doc.querySelector('link[rel="canonical"]')?.getAttribute('href') !== canonical) fail('URL canonique incorrecte');
    if (doc.querySelector('meta[property="og:url"]')?.getAttribute('content') !== canonical) fail('og:url incorrect');
    if (doc.title !== page.title || doc.querySelector('meta[name="description"]')?.content !== page.description) fail('titre ou description différent des sources SEO');
    for (const [selector, expected] of [
      ['meta[property="og:title"]', page.title], ['meta[property="og:description"]', page.description],
      ['meta[property="og:type"]', page.type], ['meta[name="twitter:title"]', page.title],
      ['meta[name="twitter:description"]', page.description], ['meta[name="twitter:card"]', 'summary_large_image'],
      ['meta[property="og:image"]', `${siteOrigin}${siteSeoSource.SITE_IMAGE_PATH}`],
      ['meta[name="twitter:image"]', `${siteOrigin}${siteSeoSource.SITE_IMAGE_PATH}`],
      ['meta[property="og:image:alt"]', siteSeoSource.SITE_IMAGE_ALT], ['meta[name="twitter:image:alt"]', siteSeoSource.SITE_IMAGE_ALT],
      ['meta[property="og:image:width"]', '1200'], ['meta[property="og:image:height"]', '630'],
    ]) {
      if (doc.querySelectorAll(selector).length !== 1 || doc.querySelector(selector)?.content !== expected) fail(`métadonnée incorrecte : ${selector}`);
    }
    if (doc.querySelectorAll('link[rel="icon"]').length !== 1 || doc.querySelector('link[rel="icon"]')?.getAttribute('href') !== siteSeoSource.SITE_ICON_PATH) fail('favicon incorrect');
    const robots = doc.querySelector('meta[name="robots"]')?.getAttribute('content');
    if (robots !== (page.index ? siteSeoSource.SITE_ROBOTS : 'noindex, follow')) fail('directive robots incorrecte');
    if ((doc.querySelector('main')?.textContent?.trim().length ?? 0) < 60) fail('contenu principal absent');
    if (!doc.querySelector('script[type="module"][src]')) fail('module du site absent');
    const root = doc.querySelector('#root');
    if (root?.parentElement !== doc.body) fail('racine React hors du body');

    for (const el of doc.querySelectorAll('*')) {
      const tag = el.localName;
      if (!TAGS.has(tag)) { fail(`balise non autorisée : ${tag}`); continue; }
      for (const attr of el.attributes) {
        const name = attr.name.toLowerCase();
        if (!ATTRS.has(name) && !/^aria-[a-z-]+$/.test(name) && !/^data-[a-z-]+$/.test(name)) fail(`attribut non autorisé : ${tag}.${name}`);
        if (name.startsWith('on') || /[\p{Cc}]/u.test(attr.value)) fail(`attribut dangereux : ${tag}.${name}`);
        if (name === 'style' && !/^font-family:var\(--font-(?:display|mono)\);?$/.test(attr.value)) fail('style en ligne non autorisé');
        if (['fill', 'stroke', 'transform'].includes(name) && /url|[&\\]/i.test(attr.value)) fail('ressource SVG externe interdite');
        if (name === 'href' && !['a', 'link'].includes(tag)) fail(`href interdit sur ${tag}`);
        if (name === 'src' && tag !== 'script') fail(`src interdit sur ${tag}`);
      }
      if (tag === 'a') {
        const href = el.getAttribute('href') ?? '';
        const local = /^(?:\/(?!\/)[a-z0-9/#-]*|#[a-z][a-z0-9_-]*)$/i.test(href);
        let safe = local || /^mailto:[^\s<>"?]+@[^\s<>"?]+$/.test(href) || href === 'magistra://open';
        try { const url = new URL(href); safe ||= url.protocol === 'https:' && !url.username && !url.password && !/[\\\p{Cc}\s]/u.test(href); } catch { /* lien local */ }
        if (!safe) fail(`lien non autorisé : ${href}`);
        if (el.target === '_blank' && !el.rel.split(/\s+/).includes('noopener')) fail('lien externe sans noopener');
      }
      if (tag === 'button' && el.getAttribute('type') !== 'button') fail('bouton de formulaire interdit');
      if (tag === 'meta') {
        if (el.parentElement !== doc.head) fail('meta hors de head');
        if (el.hasAttribute('charset')) { if (el.getAttribute('charset').toLowerCase() !== 'utf-8') fail('charset incorrect'); }
        else {
          const name = el.getAttribute('name'); const property = el.getAttribute('property');
          if (!(name && META.has(name)) && !(property && OG.has(property))) fail('meta non autorisée');
          if (['og:image', 'twitter:image'].includes(name ?? property) && el.content !== `${siteOrigin}${siteSeoSource.SITE_IMAGE_PATH}`) fail('image sociale externe ou incorrecte');
          if (name === 'google-site-verification' && !/^[A-Za-z0-9_-]{20,200}$/.test(el.content)) fail('jeton de validation Google incorrect');
        }
      }
      if (tag === 'link') {
        if (el.parentElement !== doc.head) fail('link hors de head');
        const rel = el.getAttribute('rel'); const href = el.getAttribute('href') ?? '';
        if (rel === 'canonical') { if (href !== canonical) fail('lien canonique externe'); }
        else if (!['icon', 'stylesheet', 'modulepreload'].includes(rel) || !ASSET.test(href)) fail('ressource link externe ou inconnue');
      }
      if (tag === 'script') {
        const type = el.getAttribute('type'); const src = el.getAttribute('src');
        if ([...el.attributes].some(attr => !['type', 'src', 'crossorigin'].includes(attr.name))) fail('attribut script non autorisé');
        if (src) {
          if (type !== 'module' || !ASSET.test(src) || !/\.m?js$/.test(src) || el.textContent.trim()) fail('script externe invalide');
        } else if (type === 'application/ld+json' && expectedJson && el.parentElement === doc.head) {
          try {
            const data = JSON.parse(el.textContent);
            const hash = `sha256-${createHash('sha256').update(el.textContent).digest('base64')}`;
            if (data['@context'] !== 'https://schema.org' || el.textContent !== expectedJson || !csp.includes(`'${hash}'`)) fail('JSON-LD différent du contenu de cette page autorisé par la CSP');
          } catch { fail('JSON-LD invalide'); }
        } else fail('script en ligne exécutable interdit');
      }
    }
    if (doc.querySelectorAll('script[type="application/ld+json"]').length !== (expectedJson ? 1 : 0)) fail('nombre de blocs JSON-LD incorrect');
  } finally { dom.window.close(); }
  return errors;
}
