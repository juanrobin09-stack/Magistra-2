#!/usr/bin/env node
// Inspecte le build du SITE VITRINE (npm run build:site → dist-site/) : le site ne présente Magistra et ne propose le
// téléchargement de l'application Windows que par un code qui n'embarque rien de l'application. Ce script ne lance
// rien : il lit seulement les fichiers produits.
//
// Vérifie :
// 1. le dossier existe et contient index.html ;
// 2. aucun fichier .js / .mjs / .cjs / .css / .html ne contient (casse ignorée) un service de connexion (clerk), une
//    base de données (supabase), l'export ou la lecture de PDF (jspdf, pdfjs), une route de l'API de l'application
//    (/api/generate, /api/generation, /api/history, /api/profile, /api/account, /api/status, /api/stats, /api/mode ;
//    seule /api/windows-release est permise), le port du connecteur local (47831), le connecteur lui-même
//    (localConnector), ni une clé secrète (sk_live_…, sk_test_…, service_role, sb_secret_…, whsec_…) ;
// 3. index.html ne contient aucun script en ligne (la politique de sécurité du site peut ainsi les refuser) ni aucune
//    ressource chargée depuis un autre domaine. Seule exception, à liste blanche étroite : une adresse https absolue
//    n'est admise que dans le lien canonique (<link rel="canonical">) et dans <meta property="og:url">, et seulement si
//    elle est EXACTEMENT « <SITE_ORIGIN>/ » (SITE_ORIGIN, lue dans shared/site.ts) : ni lien ni image ni script ni
//    feuille de style ni préchargement d'un autre domaine, ni <meta http-equiv="refresh"> ;
// 4. référencement : un lien canonique et une adresse og:url (uniques), robots.txt (plan du site déclaré, rien d'interdit)
//    et sitemap.xml (toutes les adresses sous SITE_ORIGIN) sont publiés ;
// 5. aucune sourcemap (.map) n'est publiée.
//
// Usage : node scripts/verify-site.mjs [dossier]   (défaut : dist-site)

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './mainModule.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Textes qui n'ont rien à faire dans le site (comparaison sans tenir compte de la casse) : [texte, ce qu'il révèle]. */
export const FORBIDDEN_TEXTS = [
  ['clerk', 'service de connexion (Clerk)'],
  ['supabase', 'base de données de l\'application (Supabase)'],
  ['jspdf', 'export PDF (jsPDF)'],
  ['pdfjs', 'lecture de PDF (pdf.js)'],
  ['/api/generate', 'route de génération de l\'application'],
  ['/api/generation', 'route d\'une génération de l\'application'],
  ['/api/history', 'route de l\'historique de l\'application'],
  ['/api/profile', 'route du profil de l\'application'],
  ['/api/account', 'route du compte de l\'application'],
  ['/api/status', 'route d\'état de l\'IA de l\'application'],
  ['/api/stats', 'route des statistiques de l\'application'],
  ['/api/mode', 'route de découverte du mode de l\'application'],
  ['47831', 'port du connecteur local'],
  ['localConnector', 'connecteur local'],
  ['/onboarding', 'création du profil de l\'application'],
  ['Refaire mon profil', 'action du profil de l\'application'],
  ['Depuis ce site', 'phrase du site avec comptes (connecteur local)'],
];

/** Clés et secrets : jamais livrés (même motifs que scripts/verify-package.mjs pour l'application empaquetée). */
export const SECRET_PATTERNS = [
  [/\bsk_(?:live|test)_[A-Za-z0-9]{8,}|\bsk_[A-Za-z0-9]{24,}/, 'clé secrète (sk_…)'],
  [/service_role/i, 'clé « service_role »'],
  [/\bsb_secret_[A-Za-z0-9_-]{8,}/, 'clé secrète de base de données (sb_secret_…)'],
  [/\bwhsec_[A-Za-z0-9+/=]{8,}/, 'secret de webhook (whsec_…)'],
];

const TEXT_EXTENSIONS = /\.(?:js|mjs|cjs|css|html|txt|xml)$/i;

/** Fichiers du dossier, chemins relatifs avec « / », triés. */
export function listFiles(dir) {
  const out = [];
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(current, entry.name), rel);
      else out.push(rel);
    }
  };
  walk(dir, '');
  return out.sort();
}

/** Texte interdit ou secret dans un fichier texte du build. `files` : [{ name, text }]. */
export function checkForbiddenContent(files) {
  const errors = [];
  for (const { name, text } of files) {
    const lower = text.toLowerCase();
    for (const [needle, what] of FORBIDDEN_TEXTS) {
      if (lower.includes(needle.toLowerCase())) errors.push(`${name} : contient « ${needle} » (${what}) : le site vitrine n'embarque rien de l'application`);
    }
    for (const [pattern, what] of SECRET_PATTERNS) {
      if (pattern.test(text)) errors.push(`${name} : contient une ${what}`);
    }
  }
  return errors;
}

/**
 * Adresse officielle du site, lue dans shared/site.ts (source unique, en TypeScript : ce script reste du JavaScript
 * lancé tel quel par Node, sans compilation).
 */
export function readSiteOrigin(file = path.join(root, 'shared', 'site.ts')) {
  const match = /^export const SITE_ORIGIN\s*=\s*'(https:\/\/[a-z0-9.-]+)'/m.exec(readFileSync(file, 'utf8'));
  if (!match) throw new Error(`SITE_ORIGIN introuvable dans ${file}`);
  return match[1];
}

/** Balises qui chargent une ressource : une adresse absolue ou « // » y est un chargement depuis un autre domaine. */
const RESOURCE_TAGS = ['script', 'link', 'img', 'iframe', 'source', 'video', 'audio', 'embed', 'object'];
/** Attributs qui désignent une ressource (une seule adresse), et ceux qui en listent plusieurs (« adresse 2x, adresse 1x »). */
const URL_ATTRIBUTES = ['src', 'href', 'data', 'poster'];
const URL_LIST_ATTRIBUTES = ['srcset', 'imagesrcset'];

/** Balise ouvrante « <nom … > », les guillemets des valeurs étant respectés (un « > » dans une valeur ne la termine pas). */
const openingTag = name => new RegExp(`<${name}(?=[\\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>`, 'gi');

/** Commentaires HTML : sans effet sur la page, donc ni contrôlés ni comptés. */
const withoutComments = html => html.replace(/<!--[\s\S]*?-->/g, '');

/** Attributs d'une balise (noms en minuscules ; doublon : le premier l'emporte, comme dans un navigateur). */
export function parseAttributes(tag) {
  const attributes = new Map();
  const body = tag.replace(/^<[^\s/>]+/, '');
  for (const [, name, double, single, bare] of body.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>=`]+)))?/g)) {
    const key = name.toLowerCase();
    if (!attributes.has(key)) attributes.set(key, double ?? single ?? bare ?? '');
  }
  return attributes;
}

/** Les balises ouvrantes de ce nom : [{ tag, attributes }]. */
function tagsNamed(html, name) {
  return [...html.matchAll(openingTag(name))].map(([tag]) => ({ tag, attributes: parseAttributes(tag) }));
}

/** Adresse telle que la lit un navigateur : entités numériques décodées, espaces, tabulations et retours retirés, « \ » lu « / ». */
function browserUrl(value) {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex) => String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)))
    .replace(/&#(\d+);?/g, (_m, dec) => String.fromCodePoint(Math.min(Number(dec), 0x10ffff)))
    .replace(/[\t\n\r]/g, '')
    .trim()
    .replace(/\\/g, '/');
}

/** Une adresse qui sort du site : avec un schéma (https:, http:, ftp:…) ou protocole relatif (« // »), suivi d'un hôte. */
const isAbsoluteUrl = value => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(browserUrl(value));

/** Attributs d'une balise dont la valeur désigne une autre origine. */
function externalAttributes(attributes) {
  const found = [];
  for (const name of URL_ATTRIBUTES) {
    if (attributes.has(name) && isAbsoluteUrl(attributes.get(name))) found.push(name);
  }
  for (const name of URL_LIST_ATTRIBUTES) {
    if (attributes.has(name) && attributes.get(name).split(',').some(candidate => isAbsoluteUrl(candidate))) found.push(name);
  }
  return found;
}

/** <link rel="canonical"> (le seul jeton de « rel » est « canonical »). */
const isCanonicalLink = attributes => (attributes.get('rel') ?? '').trim().toLowerCase() === 'canonical';

/** <meta property="og:url"> (casse du nom de propriété ignorée). */
const isOgUrlMeta = attributes => (attributes.get('property') ?? '').trim().toLowerCase() === 'og:url';

/**
 * index.html : aucun script en ligne, aucune ressource d'un autre domaine. Seules adresses absolues admises : le lien
 * canonique et og:url, qui valent EXACTEMENT « <siteOrigin>/ » (liste blanche étroite, jamais une adresse libre).
 */
export function checkIndexHtml(html, { siteOrigin = readSiteOrigin() } = {}) {
  const errors = [];
  const page = withoutComments(html);
  const expected = `${siteOrigin}/`;
  for (const match of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const [, attributes, body] = match;
    if (!/\bsrc\s*=/i.test(attributes) || body.trim()) errors.push('index.html : script en ligne (le site charge tout son code depuis des fichiers)');
  }
  const opened = (page.match(/<script\b/gi) ?? []).length;
  const closed = (page.match(/<\/script\s*>/gi) ?? []).length;
  if (opened !== closed) errors.push('index.html : balises <script> mal formées (ouvertes et fermées en nombre différent)');
  for (const name of RESOURCE_TAGS) {
    for (const { tag, attributes } of tagsNamed(page, name)) {
      const external = externalAttributes(attributes);
      if (name === 'link' && isCanonicalLink(attributes)) {
        const href = attributes.get('href') ?? '';
        if (href !== expected) errors.push(`index.html : le lien canonique doit être « ${expected} » (lu : « ${href.slice(0, 80)} »)`);
        // Le lien canonique est la seule balise de ressource admise vers une adresse absolue, et par « href » seulement.
        if (external.length === 0 || (external.length === 1 && external[0] === 'href')) continue;
      } else if (external.length === 0) {
        continue;
      }
      errors.push(`index.html : ressource chargée depuis un autre domaine (${tag.slice(0, 80)})`);
    }
  }
  for (const { tag, attributes } of tagsNamed(page, 'meta')) {
    const content = attributes.get('content') ?? '';
    if (isOgUrlMeta(attributes)) {
      if (content !== expected) errors.push(`index.html : og:url doit être « ${expected} » (lu : « ${content.slice(0, 80)} »)`);
    } else if ((attributes.get('http-equiv') ?? '').trim().toLowerCase() === 'refresh') {
      errors.push(`index.html : redirection automatique (${tag.slice(0, 80)})`);
    } else if (isAbsoluteUrl(content)) {
      errors.push(`index.html : adresse d'un autre domaine dans une balise <meta> autre que og:url (${tag.slice(0, 80)})`);
    }
  }
  return errors;
}

/** index.html : un seul lien canonique et une seule adresse og:url (leur valeur est contrôlée par checkIndexHtml). */
export function checkSearchTags(html) {
  const errors = [];
  const page = withoutComments(html);
  const canonicals = tagsNamed(page, 'link').filter(({ attributes }) => isCanonicalLink(attributes)).length;
  if (canonicals !== 1) errors.push(`index.html : ${canonicals} lien(s) canonique(s) (un seul <link rel="canonical"> est attendu)`);
  const ogUrls = tagsNamed(page, 'meta').filter(({ attributes }) => isOgUrlMeta(attributes)).length;
  if (ogUrls !== 1) errors.push(`index.html : ${ogUrls} balise(s) <meta property="og:url"> (une seule est attendue)`);
  return errors;
}

/** robots.txt et sitemap.xml (fichiers texte du build, `files` : [{ name, text }]) : présents et conformes à l'adresse officielle. */
export function checkSearchFiles(files, { siteOrigin = readSiteOrigin() } = {}) {
  const errors = [];
  const robots = files.find(f => f.name === 'robots.txt');
  if (!robots) {
    errors.push('robots.txt absent (le site doit déclarer son plan du site)');
  } else {
    const sitemaps = [...robots.text.matchAll(/^\s*sitemap\s*:\s*(\S*)\s*$/gim)].map(m => m[1]);
    if (sitemaps.length === 0 || sitemaps.some(url => url !== `${siteOrigin}/sitemap.xml`)) {
      errors.push(`robots.txt : « Sitemap: ${siteOrigin}/sitemap.xml » attendu, et rien d'autre (lu : ${sitemaps.length ? sitemaps.join(', ') : 'aucun'})`);
    }
    if (/^\s*disallow\s*:\s*\/\s*$/im.test(robots.text)) errors.push('robots.txt : « Disallow: / » interdirait tout le site aux moteurs de recherche');
  }
  const sitemap = files.find(f => f.name === 'sitemap.xml');
  if (!sitemap) {
    errors.push('sitemap.xml absent (plan du site déclaré par robots.txt)');
  } else {
    const locations = [...sitemap.text.matchAll(/<loc>\s*([^<]*?)\s*<\/loc>/gi)].map(m => m[1]);
    if (locations.length === 0) errors.push('sitemap.xml : aucune adresse <loc>');
    for (const location of locations) {
      if (!location.startsWith(`${siteOrigin}/`)) errors.push(`sitemap.xml : « ${location.slice(0, 80)} » n'est pas une adresse de ${siteOrigin}`);
    }
  }
  return errors;
}

/** Aucune sourcemap publiée. */
export function checkNoSourceMaps(names) {
  return names.filter(name => /\.map$/i.test(name)).map(name => `${name} : sourcemap publiée (le code source du site n'est pas à livrer)`);
}

/** Inspecte un dossier de build du site : retourne la liste des erreurs (vide si tout est conforme). */
export function verifySite(dir, { siteOrigin = readSiteOrigin() } = {}) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [`${dir} introuvable (npm run build:site l'a-t-il construit ?)`];
  const names = listFiles(dir);
  if (!names.includes('index.html')) return [`${path.join(dir, 'index.html')} introuvable : le site n'a pas de page d'entrée`];
  const errors = [...checkNoSourceMaps(names)];
  const files = [];
  for (const name of names.filter(n => TEXT_EXTENSIONS.test(n))) {
    try {
      files.push({ name, text: readFileSync(path.join(dir, name), 'utf8') });
    } catch {
      errors.push(`${name} : illisible`);
    }
  }
  errors.push(...checkForbiddenContent(files));
  const index = files.find(f => f.name === 'index.html');
  if (index) errors.push(...checkIndexHtml(index.text, { siteOrigin }), ...checkSearchTags(index.text));
  errors.push(...checkSearchFiles(files, { siteOrigin }));
  return errors;
}

if (isMainModule(import.meta.url)) {
  const dir = path.resolve(process.argv[2] ?? path.join(root, 'dist-site'));
  let errors;
  try {
    errors = verifySite(dir);
  } catch (err) {
    errors = [`inspection impossible : ${err?.message ?? err}`];
  }
  if (errors.length) {
    for (const e of errors) console.error(`::error title=Site vitrine::${e}`);
    console.error(`[verify-site] ${errors.length} écart(s) dans ${dir}.`);
    process.exit(1);
  }
  console.log(`[verify-site] ${dir} : aucun code de l'application, aucun script en ligne, aucune sourcemap ; lien canonique, robots.txt et sitemap.xml conformes à ${readSiteOrigin()}.`);
}
