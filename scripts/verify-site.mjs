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
// 3. index.html est conforme à une LISTE BLANCHE. Il est produit par Vite à partir de site/index.html : sa structure est
//    connue et fermée, donc tout ce qui n'est pas attendu est refusé. Aucun commentaire (« <!-- », « <!--> »,
//    « <!---> », « --!> », « <![CDATA[ », « <? ») ; seulement les balises html, head, meta, title, link, script,
//    noscript, body, div, span, strong, em, br et a (dans <noscript>), avec leurs seuls attributs prévus ; aucune
//    valeur d'attribut contenant « & » (entité), « \ », « < », « > », un caractère de contrôle ou une espace Unicode
//    inattendue ; adresses de chargement (src, href) uniquement /assets/… (ou l'icône « data:image/svg+xml, »),
//    liens du <noscript> uniquement vers une page du site ; une adresse absolue n'est admise que dans
//    <link rel="canonical"> et <meta property="og:url">, et seulement si elle est EXACTEMENT « <SITE_ORIGIN>/ »
//    (SITE_ORIGIN, lue dans shared/site.ts). Ni script en ligne, gestionnaire d'évènement (on…), <style>, <base>,
//    formulaire, cadre, image, SVG en ligne, @import, url() ni redirection (<meta http-equiv>) ;
// 4. référencement : un lien canonique et une adresse og:url (uniques), robots.txt (plan du site déclaré, rien d'interdit)
//    et sitemap.xml (l'accueil « <SITE_ORIGIN>/ » seul : les pages légales portent le même lien canonique et n'ont
//    pas à être indexées) sont publiés ;
// 5. aucune sourcemap (.map) n'est publiée.
//
// Pourquoi une liste blanche : un navigateur n'analyse pas l'HTML comme une expression régulière (« <!--> » est un
// commentaire vide, « --!> » ferme un commentaire, « &colon; » et « &sol; » sont des caractères, un caractère de
// contrôle peut précéder une adresse, « <base> » réécrit toutes les adresses relatives…). Plutôt que d'énumérer des
// contournements, l'analyse ci-dessous ne lit que la grammaire stricte du gabarit et refuse tout le reste : un
// document accepté n'a qu'une seule lecture possible, la même pour ce contrôle et pour un navigateur.
//
// Usage : node scripts/verify-site.mjs [dossier]   (défaut : dist-site)

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from './mainModule.mjs';
import { checkPrerenderedPage } from './verify-prerender.mjs';
import { siteSeoSource } from './site-seo-source.mjs';

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

// ─── Lecture stricte d'index.html ───────────────────────────────────────────────────────────────────────────────────
//
// Lecteur HTML minimal, écrit pour REFUSER : il suit la découpe en balises d'un navigateur (séparateurs, guillemets,
// valeurs sans guillemets qui contiennent « / ») mais, au moindre doute (caractère inattendu, balise mal formée,
// déclaration, commentaire), il signale une erreur au lieu de deviner. Expressions régulières « collantes » (flag y) à
// position explicite : une seule passe, temps linéaire.

/** Séparateur de l'HTML dans une balise : espace, tabulation, saut de ligne, retour chariot (le saut de page n'est pas admis). */
const isSpace = char => char === ' ' || char === '\t' || char === '\n' || char === '\r';
/** Ce qui peut suivre un nom de balise ou un attribut sans valeur : un séparateur, « / » ou « > ». */
const isTagBreak = char => char !== undefined && (isSpace(char) || char === '/' || char === '>');

const TAG_NAME = /<([A-Za-z][A-Za-z0-9]*)/y;
const ATTRIBUTE_NAME = /[A-Za-z_][A-Za-z0-9_:.-]*/y;
/** Valeur sans guillemets : jusqu'au prochain séparateur ou « > » (un « / » en fait partie, comme dans un navigateur). */
const UNQUOTED_VALUE = /[^\t\n\f\r >]+/y;
const END_TAG = /<\/([A-Za-z][A-Za-z0-9]*)[\t\n\r ]*>/y;
const DOCTYPE = /<!doctype[\t\n\r ]+html[\t\n\r ]*>/iy;
const EMPTY_SCRIPT_END = /<\/script[\t\n\r ]*>/iy;
const SCRIPT_CLOSE = /<\/script(?=[\t\n\f\r />])/gi;

/** Exécute une expression « collante » à cette position (null si elle ne correspond pas exactement là). */
function matchAt(pattern, text, position) {
  pattern.lastIndex = position;
  return pattern.exec(text);
}

/** Point de code d'un caractère, écrit « U+00A0 ». */
const codePoint = char => `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;

/** Texte lisible dans un message : tronqué, les caractères invisibles écrits en clair. */
function printable(text, max = 80) {
  const shown = text.slice(0, max).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]|[^\S ]/gu, char => `\\u{${char.codePointAt(0).toString(16)}}`);
  return text.length > max ? `${shown}…` : shown;
}

/**
 * Balise ouvrante à cette position : { token, end } ou { error }. Valeurs entre guillemets simples ou doubles (un « > »
 * n'y termine pas la balise) ou sans guillemets ; tout autre caractère est une erreur.
 */
function scanStartTag(html, position) {
  const nameMatch = matchAt(TAG_NAME, html, position);
  const name = nameMatch[1].toLowerCase();
  let i = TAG_NAME.lastIndex;
  if (!isTagBreak(html[i])) return { error: `nom de balise suivi d'un caractère inattendu (« ${printable(html.slice(position, position + 20))} »)` };
  const attributes = [];
  let selfClosing = false;
  for (;;) {
    const char = html[i];
    if (char === undefined) return { error: 'balise non terminée (fin du fichier)' };
    if (char === '>') {
      i += 1;
      break;
    }
    if (char === '/') {
      if (html[i + 1] !== '>') return { error: 'barre « / » inattendue dans la balise' };
      selfClosing = true;
      i += 2;
      break;
    }
    if (isSpace(char)) {
      i += 1;
      continue;
    }
    const attributeName = matchAt(ATTRIBUTE_NAME, html, i);
    if (!attributeName) return { error: `caractère inattendu « ${printable(char)} » dans la balise <${name}>` };
    i = ATTRIBUTE_NAME.lastIndex;
    let j = i;
    while (isSpace(html[j])) j += 1;
    const attribute = { name: attributeName[0].toLowerCase(), value: '', quote: null };
    if (html[j] === '=') {
      j += 1;
      while (isSpace(html[j])) j += 1;
      const quote = html[j];
      if (quote === '"' || quote === '\'') {
        const close = html.indexOf(quote, j + 1);
        if (close === -1) return { error: `guillemet non fermé dans la balise <${name}>` };
        attribute.value = html.slice(j + 1, close);
        attribute.quote = quote;
        i = close + 1;
        if (!isTagBreak(html[i])) return { error: `attributs collés dans la balise <${name}> (séparateur attendu après la valeur de « ${attribute.name} »)` };
      } else {
        const bare = matchAt(UNQUOTED_VALUE, html, j);
        if (!bare) return { error: `valeur manquante pour l'attribut « ${attribute.name} » de <${name}>` };
        attribute.value = bare[0];
        attribute.quote = '';
        i = UNQUOTED_VALUE.lastIndex;
      }
    } else if (!isTagBreak(html[i])) {
      return { error: `caractère inattendu après l'attribut « ${attribute.name} » de <${name}>` };
    }
    attributes.push(attribute);
  }
  return { token: { type: 'start', index: position, name, attributes, selfClosing }, end: i };
}

/** Message d'une déclaration « <! » ou d'une instruction « <? » (toujours refusées). */
function markupMessage(html, position) {
  if (html.startsWith('<!--', position)) return 'commentaire HTML interdit (« <!-- », « <!--> », « <!---> » : un navigateur ne les analyse pas comme une expression régulière ; le gabarit n\'en contient aucun)';
  if (/^<!\[cdata\[/i.test(html.slice(position, position + 9))) return 'section « <![CDATA[ » interdite';
  if (html[position + 1] === '?') return 'instruction de traitement « <? » interdite';
  return 'déclaration « <! » interdite (seul « <!doctype html> », en tête de fichier, est admis)';
}

/**
 * Découpe index.html en jetons : { type: 'doctype' | 'start' | 'end' | 'text', index, … }, et liste les erreurs de
 * syntaxe { index, message }. Après une erreur, la lecture reprend au caractère suivant : les jetons qui suivent sont
 * utiles aux messages, jamais à une acceptation (un fichier avec une erreur de syntaxe est toujours refusé).
 */
export function tokenizeHtml(html) {
  const tokens = [];
  const errors = [];
  let position = 0;
  let markupSeen = false;
  const fail = (index, message) => {
    errors.push({ index, message });
  };
  while (position < html.length) {
    const lt = html.indexOf('<', position);
    const textEnd = lt === -1 ? html.length : lt;
    if (textEnd > position) tokens.push({ type: 'text', index: position, raw: html.slice(position, textEnd) });
    if (lt === -1) break;
    position = lt;
    const next = html[position + 1];
    const doctype = next === '!' && !markupSeen ? matchAt(DOCTYPE, html, position) : null;
    markupSeen = true;
    if (doctype) {
      tokens.push({ type: 'doctype', index: position, raw: doctype[0] });
      position += doctype[0].length;
    } else if (next === '!' || next === '?') {
      fail(position, markupMessage(html, position));
      position += 1;
    } else if (next === '/') {
      const end = matchAt(END_TAG, html, position);
      if (end) {
        tokens.push({ type: 'end', index: position, name: end[1].toLowerCase() });
        position += end[0].length;
      } else {
        fail(position, 'balise fermante mal formée');
        position += 1;
      }
    } else if (next !== undefined && /[A-Za-z]/.test(next)) {
      const scanned = scanStartTag(html, position);
      if (scanned.error) {
        fail(position, scanned.error);
        position += 1;
        continue;
      }
      const { token } = scanned;
      tokens.push(token);
      position = scanned.end;
      // Le contenu d'un <script> n'est pas de l'HTML : s'il n'est pas vide, c'est un script en ligne ; il est sauté d'un
      // bloc jusqu'à </script> (comme le fait un navigateur) pour ne pas être lu comme des balises.
      if (token.name === 'script' && !token.selfClosing && !matchAt(EMPTY_SCRIPT_END, html, position)) {
        token.inline = true;
        SCRIPT_CLOSE.lastIndex = position;
        const close = SCRIPT_CLOSE.exec(html);
        const gt = close ? html.indexOf('>', close.index) : -1;
        position = gt === -1 ? html.length : gt + 1;
        tokens.push({ type: 'end', index: position, name: 'script', synthetic: true });
      }
    } else {
      fail(position, 'caractère « < » isolé (une balise bien formée est attendue)');
      position += 1;
    }
  }
  return { tokens, errors };
}

// ─── Liste blanche : balises, attributs, valeurs ────────────────────────────────────────────────────────────────────

/** Table sans prototype : « constructor » ou « toString » (noms de balise ou d'attribut possibles) n'y sont jamais des entrées. */
const table = entries => Object.assign(Object.create(null), entries);

/** Balises admises (hors html, head et body, gérées par la structure) : enfants permis et présence de texte. */
const ELEMENTS = table({
  head: { children: ['meta', 'title', 'link', 'script'] },
  body: { children: ['noscript', 'div', 'script'] },
  title: { children: [], text: true },
  meta: { void: true },
  link: { void: true },
  script: { children: [] },
  noscript: { children: ['a', 'br', 'strong', 'em'], text: true },
  div: { children: ['div', 'span', 'strong', 'em', 'br'], text: true },
  span: { children: ['span', 'strong', 'em', 'br'], text: true },
  strong: { children: ['strong', 'em', 'br'], text: true },
  em: { children: ['strong', 'em', 'br'], text: true },
  a: { children: ['strong', 'em', 'br'], text: true },
  br: { void: true },
});
/** Balises sans contenu (ni balise fermante), y compris celles qui ne sont pas admises : leur fermeture n'est pas attendue. */
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** Attributs admis par balise (les valeurs de meta, link, script et a sont ensuite contrôlées une à une). */
const ATTRIBUTES = table({
  html: ['lang'],
  head: [],
  body: ['class'],
  title: [],
  meta: ['charset', 'name', 'property', 'content'],
  link: ['rel', 'href', 'type', 'sizes', 'crossorigin'],
  script: ['type', 'src', 'crossorigin'],
  noscript: [],
  div: ['id', 'class', 'role', 'aria-live', 'aria-busy', 'aria-label', 'style'],
  span: ['class', 'role', 'aria-label', 'style'],
  strong: ['class'],
  em: ['class'],
  a: ['href', 'class'],
  br: [],
});

/** Pourquoi une balise courante est refusée (message plus précis que « non autorisée »). */
const TAG_REASONS = table({
  base: 'réécrirait l\'adresse de toutes les ressources relatives, dont le code du site',
  form: 'enverrait des données à une autre adresse',
  input: 'champ de saisie (« type=image » charge une image, « formaction » détourne un formulaire)',
  button: 'bouton de formulaire (« formaction » détourne un formulaire)',
  iframe: 'cadre : charge une autre page',
  frame: 'cadre : charge une autre page',
  frameset: 'cadre : charge une autre page',
  object: 'objet embarqué : charge une ressource',
  embed: 'objet embarqué : charge une ressource',
  applet: 'objet embarqué : charge une ressource',
  img: 'image : le site n\'en charge aucune',
  picture: 'image : le site n\'en charge aucune',
  source: 'média ou image : le site n\'en charge aucun',
  video: 'média : le site n\'en charge aucun',
  audio: 'média : le site n\'en charge aucun',
  track: 'piste de média : charge un fichier',
  svg: 'dessin SVG en ligne (<use> et <image> chargent une adresse)',
  use: 'élément SVG qui charge une adresse',
  image: 'élément SVG qui charge une adresse',
  style: 'feuille de style en ligne (@import et url() chargent une adresse)',
  area: 'zone cliquable : adresse de lien',
  map: 'carte cliquable : adresses de liens',
  math: 'contenu MathML en ligne',
  template: 'contenu inerte non contrôlé',
  textarea: 'champ de saisie',
  select: 'champ de saisie',
});

/** Attributs qui désignent une adresse (le message l'indique). */
const ADDRESS_ATTRIBUTES = new Set([
  'src', 'href', 'poster', 'srcset', 'imagesrcset', 'data', 'action', 'formaction', 'ping', 'archive', 'background', 'xlink:href',
  'longdesc', 'usemap', 'cite', 'manifest', 'codebase', 'srcdoc', 'dynsrc', 'lowsrc',
]);

/** Adresses de ressources du site : /assets/… (fichiers produits par Vite), sans « .. », sans paramètres. */
const ASSET_PATH = /^\/assets\/[A-Za-z0-9_~-][A-Za-z0-9._~-]*(?:\/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)*$/;
/** Pages du site (liens du <noscript>) : un chemin absolu simple, ou une ancre. */
const SITE_PAGE = /^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/;
const ANCHOR = /^#[A-Za-z][A-Za-z0-9_-]*$/;
/** Début d'une adresse qui sort du site (schéma, « // » ou « \\ », après les caractères que le navigateur ignore) : sert à classer l'erreur. */
const LEAVES_SITE = /^[\p{Cc} ]*(?:[a-z][a-z0-9+.-]*:|[\\/]{2})/iu;
/** Point d'entrée du gabarit (site/index.html) : Vite le remplace par /assets/index-….js. */
const SOURCE_ENTRY = '../src/site/main.tsx';

const META_NAMES = ['description', 'author', 'viewport', 'theme-color', 'color-scheme'];
const META_PROPERTIES = ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:url', 'og:locale'];
const LINK_RELS = ['canonical', 'stylesheet', 'icon', 'modulepreload'];
/** Début d'un texte qui est lui-même une adresse ou un schéma dangereux (une description n'en est pas une). */
const URL_LIKE_TEXT = /^[\p{Cc} ]*(?:[a-z][a-z0-9+.-]*:\/\/|\/\/|(?:https?|ftp|wss?|file|data|javascript|vbscript|mailto|blob|about):)/iu;

/** Raison de refuser une valeur d'attribut quelle que soit la balise (null si elle est sûre). `typographic` : texte seulement, jamais une adresse. */
function unsafeValue(value, { typographic = false } = {}) {
  if (value.includes('&')) return 'référence de caractère « & » (entité) interdite : un navigateur la décode, pas ce contrôle';
  if (value.includes('\\')) return 'antislash « \\ » interdit (un navigateur le lit comme « / »)';
  if (/[<>]/.test(value)) return 'caractère « < » ou « > » interdit';
  const control = /\p{Cc}/u.exec(value);
  if (control) return `caractère de contrôle ${codePoint(control[0])} interdit`;
  for (const [char] of value.matchAll(/[\p{White_Space}\p{Cf}]/gu)) {
    if (char === ' ' || (typographic && (char === '\u{a0}' || char === '\u{202f}'))) continue;
    return `espace ou caractère invisible Unicode inattendu (${codePoint(char)})`;
  }
  return null;
}

/** Raison de refuser un texte entre des balises (null si sûr) : seuls les caractères de contrôle et d'orientation invisibles. */
function unsafeText(text) {
  const control = /(?![\t\n\r])\p{Cc}|\p{Cf}/u.exec(text);
  return control ? `caractère de contrôle ou invisible ${codePoint(control[0])} interdit dans le texte` : null;
}

/** Attribut « style » (squelette de chargement) : déclarations simples, aucune fonction CSS (donc ni url() ni image-set()), aucun « @import ». */
function styleReason(value) {
  if (/[()@\\]/.test(value)) return 'style : parenthèse, « @ » ou antislash interdits (url(), @import et les fonctions CSS chargeraient une adresse)';
  if (!/^[A-Za-z0-9 #%.,:;!_-]*$/.test(value)) return 'style : caractère non admis (seuls lettres, chiffres et # % . , : ; ! _ - sont permis)';
  return null;
}

/** Valeurs admises des attributs de mise en forme communs. */
const VALUE_RULES = table({
  lang: value => (/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value) ? null : 'code de langue attendu (« fr »)'),
  class: value => (/^[A-Za-z0-9 _-]*$/.test(value) ? null : 'noms de classes simples attendus (lettres, chiffres, « _ », « - »)'),
  role: value => (/^[a-z]+$/.test(value) ? null : 'rôle ARIA simple attendu'),
  'aria-live': value => (['off', 'polite', 'assertive'].includes(value) ? null : 'valeur attendue : off, polite ou assertive'),
  'aria-busy': value => (['true', 'false'].includes(value) ? null : 'valeur attendue : true ou false'),
  style: styleReason,
  crossorigin: value => (['', 'anonymous', 'use-credentials'].includes(value) ? null : 'valeur attendue : anonymous ou use-credentials'),
});

const SVG_ELEMENTS = ['svg', 'rect', 'path', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'g'];
const SVG_ATTRIBUTES = [
  'xmlns', 'viewbox', 'width', 'height', 'rx', 'ry', 'fill', 'd', 'cx', 'cy', 'r', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'transform',
  'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'fill-rule', 'clip-rule', 'stroke-linecap', 'stroke-linejoin',
];
const SVG_TAG = / *<(\/?)([A-Za-z]+)((?: +[A-Za-z-]+ *= *(?:'[^']*'|"[^"]*"))*) *(\/?)>/y;

/** Icône « data:image/svg+xml, » : un dessin simple, sans script, sans adresse (hors l'espace de noms SVG), sans entité. */
function iconReason(href) {
  if (href.length > 4096) return 'icône « data: » trop volumineuse (4 Ko au plus : un dessin simple)';
  const match = /^data:image\/svg\+xml,([A-Za-z0-9 %'=.,:;_+/-]*)$/.exec(href);
  if (!match) return 'icône « data:image/svg+xml, » attendue (caractères simples, « # » écrit « %23 »)';
  let svg;
  try {
    svg = decodeURIComponent(match[1]);
  } catch {
    return 'icône : encodage « % » invalide';
  }
  if (/[&\\\p{Cc}]/u.test(svg)) return 'icône : « & », antislash ou caractère de contrôle interdits';
  let position = 0;
  while (position < svg.length) {
    const tag = matchAt(SVG_TAG, svg, position);
    if (!tag) return 'icône : balise SVG mal formée, ou texte entre les balises';
    if (!SVG_ELEMENTS.includes(tag[2].toLowerCase())) return `icône : élément SVG <${tag[2]}> non autorisé (formes seulement)`;
    for (const [, name, single, double] of tag[3].matchAll(/ +([A-Za-z-]+) *= *(?:'([^']*)'|"([^"]*)")/g)) {
      const value = single ?? double ?? '';
      if (!SVG_ATTRIBUTES.includes(name.toLowerCase())) return `icône : attribut SVG « ${name} » non autorisé`;
      if (name.toLowerCase() === 'xmlns' ? value !== 'http://www.w3.org/2000/svg' : /:|url\s*\(/i.test(value)) return `icône : valeur d'attribut SVG « ${printable(value, 40)} » non autorisée (aucune adresse)`;
    }
    position = SVG_TAG.lastIndex;
  }
  return null;
}

/** Classe l'erreur d'une adresse non admise : sortie du site, ou simple adresse inattendue. */
function addressReason(attribute, value, { link = false, allowed }) {
  if (LEAVES_SITE.test(value)) {
    return link
      ? `lien vers un autre domaine ou un autre schéma (attribut ${attribute} : « ${printable(value)} »)`
      : `ressource chargée depuis un autre domaine (attribut ${attribute} : « ${printable(value)} »)`;
  }
  return `adresse « ${printable(value)} » non admise (attribut ${attribute} : ${allowed})`;
}

/** Valeurs d'une balise sous forme de table (doublon : le premier l'emporte, comme dans un navigateur). */
function attributeTable(token) {
  const table = new Map();
  for (const { name, value } of token.attributes) if (!table.has(name)) table.set(name, value);
  return table;
}

/** <meta> : charset, ou nom/propriété d'une liste fermée avec sa valeur ; og:url vaut exactement l'adresse officielle. */
function metaReason(attrs, expected) {
  const names = [...attrs.keys()];
  if (attrs.has('charset')) return names.length === 1 && /^utf-8$/i.test(attrs.get('charset')) ? null : 'charset « UTF-8 » seul attendu';
  const key = attrs.has('property') ? 'property' : 'name';
  if (names.length !== 2 || !attrs.has(key) || !attrs.has('content') || (key === 'property' && attrs.has('name'))) {
    return 'forme attendue : <meta charset="UTF-8"> ou <meta name|property="…" content="…">';
  }
  const label = attrs.get(key).toLowerCase();
  const content = attrs.get('content');
  if (!(key === 'name' ? META_NAMES : META_PROPERTIES).includes(label)) return `${key} « ${printable(label)} » non autorisé (une image, une vidéo ou une redirection serait une ressource)`;
  if (label === 'og:url') return content === expected ? null : `og:url doit être « ${expected} » (lu : « ${printable(content)} »)`;
  if (URL_LIKE_TEXT.test(content)) return `adresse d'un autre domaine dans une balise <meta> autre que og:url (« ${printable(content)} »)`;
  return null;
}

/** <link> : canonique (adresse officielle exacte), feuille de style, icône, préchargement de module (/assets/… seulement). */
function linkReason(attrs, expected) {
  if (!attrs.has('rel')) return 'attribut « rel » manquant';
  const rel = attrs.get('rel').toLowerCase();
  const href = attrs.get('href');
  if (!LINK_RELS.includes(rel)) return `rel « ${printable(attrs.get('rel'))} » non autorisé (admis : ${LINK_RELS.join(', ')} ; un seul jeton)`;
  if (rel === 'canonical') {
    if ([...attrs.keys()].some(name => name !== 'rel' && name !== 'href')) return 'le lien canonique ne porte que « rel » et « href »';
    return href === expected ? null : `le lien canonique doit être « ${expected} » (lu : « ${printable(href ?? '')} »)`;
  }
  if (href === undefined) return 'attribut « href » manquant';
  if (attrs.has('type') && !/^[a-z]+\/[a-z0-9.+-]+$/.test(attrs.get('type'))) return 'type MIME simple attendu';
  if (attrs.has('sizes') && !/^(?:any|\d+x\d+(?: \d+x\d+)*)$/.test(attrs.get('sizes'))) return 'valeur de « sizes » attendue (« 32x32 », « any »)';
  if (rel === 'icon' && href.startsWith('data:')) return iconReason(href);
  const extension = { stylesheet: /\.css$/, modulepreload: /\.m?js$/, icon: /\.(?:svg|png|ico|webp)$/ }[rel];
  if (!ASSET_PATH.test(href) || !extension.test(href)) return addressReason('href', href, { allowed: `seule une adresse /assets/… de type ${rel} est admise` });
  return null;
}

/** <script> : module chargé depuis /assets/… (ou, dans le gabarit, le point d'entrée), jamais en ligne. */
function scriptReason(token, attrs, { source }) {
  if (token.inline || !attrs.has('src')) return 'script en ligne (le site charge tout son code depuis des fichiers)';
  const src = attrs.get('src');
  if (!(source ? src === SOURCE_ENTRY : ASSET_PATH.test(src) && /\.m?js$/.test(src))) {
    return addressReason('src', src, { allowed: source ? `le gabarit charge ${SOURCE_ENTRY}` : 'seule une adresse /assets/… en .js est admise' });
  }
  return attrs.get('type')?.toLowerCase() === 'module' ? null : 'type="module" attendu';
}

/**
 * Contrôle d'une balise ouvrante admise : doublons, attributs, valeurs. Retourne la raison du refus, ou null.
 * `parent` : balise qui la contient.
 */
function startTagReason(token, parent, { expected, source }) {
  const seen = new Set();
  for (const { name } of token.attributes) {
    if (seen.has(name)) return `attribut « ${name} » répété (un navigateur ne lit que le premier)`;
    seen.add(name);
  }
  const allowed = ATTRIBUTES[token.name];
  for (const { name, value } of token.attributes) {
    if (!allowed.includes(name)) {
      if (/^on/.test(name)) return `gestionnaire d'évènement « ${name} » interdit`;
      if (name === 'http-equiv') return 'redirection automatique ou en-tête simulé (« http-equiv ») interdit';
      if (ADDRESS_ATTRIBUTES.has(name)) return `attribut d'adresse « ${name} » interdit sur <${token.name}>`;
      return `attribut « ${name} » non autorisé sur <${token.name}>`;
    }
    const unsafe = unsafeValue(value, { typographic: name === 'content' || name === 'aria-label' });
    if (unsafe) return `attribut « ${name} » : ${unsafe}`;
    if (VALUE_RULES[name]) {
      const reason = VALUE_RULES[name](value);
      if (reason) return `attribut « ${name} » : ${reason}`;
    }
    if (name === 'id' && (value !== 'root' || token.name !== 'div' || parent !== 'body')) return 'attribut « id » : seul « root », sur le <div> de la racine, est admis';
  }
  const attrs = attributeTable(token);
  if (token.name === 'meta') return metaReason(attrs, expected);
  if (token.name === 'link') return linkReason(attrs, expected);
  if (token.name === 'script') return scriptReason(token, attrs, { source });
  if (token.name === 'a') {
    const href = attrs.get('href');
    if (href === undefined) return 'attribut « href » manquant';
    if (!SITE_PAGE.test(href) && !ANCHOR.test(href)) return addressReason('href', href, { link: true, allowed: 'seuls /page-du-site et #ancre sont admis' });
  }
  return null;
}

/** Nombre maximal d'écarts retenus pour index.html (un fichier piégé ne doit pas inonder la sortie de la CI). */
const MAX_INDEX_ERRORS = 20;

/** Analyse d'index.html : liste d'écarts { index, message } (index : position dans le texte, ou null pour l'ensemble du fichier). */
function analyzeIndex(html, { siteOrigin, source }) {
  const expected = `${siteOrigin}/`;
  const { tokens, errors: syntaxErrors } = tokenizeHtml(html);
  const found = [];
  const report = (index, message) => {
    if (found.length < 200) found.push({ index, message: index === null ? message : `${message} : « ${printable(html.slice(index, index + 80).split(/[\r\n]/, 1)[0])} »` });
  };
  for (const { index, message } of syntaxErrors) report(index, message);
  for (let at = html.indexOf('--!>'); at !== -1; at = html.indexOf('--!>', at + 1)) report(at, 'fin de commentaire « --!> » interdite (aucun commentaire n\'est admis)');
  // Après une erreur de syntaxe, la structure n'est plus fiable : chaque balise est quand même contrôlée une à une.
  const structured = syntaxErrors.length === 0;
  const structure = (index, message) => {
    if (structured) report(index, message);
  };
  const stack = [];
  let phase = 'start';
  let roots = 0;
  let modules = 0;
  const closeElement = name => {
    if (name === 'head') phase = 'bodyNext';
    else if (name === 'body') phase = 'afterBody';
    else if (name === 'html') phase = 'done';
  };
  for (const token of tokens) {
    const parent = stack[stack.length - 1];
    if (token.type === 'text') {
      const unsafe = unsafeText(token.raw);
      if (unsafe) report(token.index, unsafe);
      else if (!ELEMENTS[parent]?.text && /[^\t\n\r ]/.test(token.raw)) structure(token.index, `texte inattendu hors d'un élément de texte (dans <${parent ?? 'document'}>)`);
    } else if (token.type === 'doctype') {
      if (phase !== 'start') structure(token.index, 'doctype inattendu');
      phase = 'html';
    } else if (token.type === 'end') {
      if (parent === token.name) {
        stack.pop();
        closeElement(token.name);
      } else {
        structure(token.index ?? html.length, `balise fermante </${token.name}> inattendue${parent ? ` (la balise ouverte est <${parent}>)` : ''}`);
        const open = stack.lastIndexOf(token.name);
        while (open !== -1 && stack.length > open) closeElement(stack.pop());
      }
    } else {
      const { name } = token;
      let accepted = false;
      if (name === 'html' || name === 'head' || name === 'body') {
        const expectedPhase = { html: 'html', head: 'headNext', body: 'bodyNext' }[name];
        if (phase === 'start') structure(token.index, 'doctype « <!doctype html> » attendu en tête de fichier');
        else if (phase !== expectedPhase) structure(token.index, `balise <${name}> inattendue à cet endroit (structure attendue : <!doctype html>, <html>, <head>, <body>, une seule fois chacune, dans cet ordre)`);
        phase = { html: 'headNext', head: 'head', body: 'body' }[name];
        const reason = startTagReason(token, parent, { expected, source });
        if (reason) report(token.index, reason);
        accepted = true;
      } else if (!ELEMENTS[name]) {
        report(token.index, `balise <${name}> non autorisée${TAG_REASONS[name] ? ` (${TAG_REASONS[name]})` : ''}`);
      } else if (parent === undefined || parent === 'html') {
        report(token.index, `balise <${name}> hors de <head> et de <body>`);
      } else if (ELEMENTS[parent] && !ELEMENTS[parent].children?.includes(name)) {
        report(token.index, `balise <${name}> non autorisée dans <${parent}>${TAG_REASONS[name] ? ` (${TAG_REASONS[name]})` : ''}`);
      } else {
        // Parent admis (ou déjà signalé comme non autorisé : la balise est quand même contrôlée).
        const reason = startTagReason(token, parent, { expected, source });
        if (reason) report(token.index, reason);
        else if (name === 'script') modules += 1;
        if (name === 'div' && parent === 'body' && token.attributes.some(attribute => attribute.name === 'id' && attribute.value === 'root')) roots += 1;
        accepted = true;
      }
      const isVoid = ELEMENTS[name]?.void || (!ELEMENTS[name] && VOID_TAGS.has(name));
      if (accepted && token.selfClosing && !isVoid) report(token.index, `auto-fermeture « /> » sur la balise non vide <${name}> (un navigateur l'ignore : la balise resterait ouverte)`);
      if (!isVoid) stack.push(name);
    }
  }
  if (structured && (phase !== 'done' || stack.length > 0)) structure(null, 'fin du fichier avant </html> : document tronqué ou incomplet');
  if (structured && roots !== 1) structure(null, `${roots} balise(s) <div id="root"> dans <body> (une seule est attendue)`);
  if (structured && modules < 1) structure(null, 'aucun <script type="module" src="…"> : la page ne démarrerait pas');
  return found;
}

/** Numéro de ligne (à partir de 1) de chaque écart, trié par position. */
function withLines(html, errors) {
  const sorted = [...errors].sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity));
  let line = 1;
  let from = 0;
  return sorted.map(error => {
    if (error.index === null) return { ...error, line: null };
    for (let at = html.indexOf('\n', from); at !== -1 && at < error.index; at = html.indexOf('\n', from)) {
      line += 1;
      from = at + 1;
    }
    return { ...error, line };
  });
}

/**
 * index.html : conforme à la liste blanche (voir l'en-tête). Retourne les écarts, un message en français par écart
 * (fichier, ligne, balise, raison). `source: true` : le gabarit site/index.html (le point d'entrée n'est pas encore
 * remplacé par Vite) ; sinon la page construite (dist-site/index.html).
 */
export function checkIndexHtml(html, { siteOrigin = readSiteOrigin(), source = false, pagePath = '/' } = {}) {
  if (!source && /<main(?:\s|>)/.test(html)) return checkPrerenderedPage(html, { siteOrigin, pagePath });
  const found = withLines(html, analyzeIndex(html, { siteOrigin, source }));
  const lines = found.slice(0, MAX_INDEX_ERRORS).map(({ line, message }) => (line === null ? `index.html : ${message}` : `index.html : ligne ${line} : ${message}`));
  if (found.length > MAX_INDEX_ERRORS) lines.push(`index.html : … et ${found.length - MAX_INDEX_ERRORS} autre(s) écart(s) non détaillé(s)`);
  return lines;
}

/** Une balise est celle-ci : le jeton, son nom et la valeur de l'attribut « clé » (comparée sans casse ni espaces). */
const isTagWith = (token, tag, key, value) => token.type === 'start' && token.name === tag && (attributeTable(token).get(key) ?? '').trim().toLowerCase() === value;

/** index.html : un seul lien canonique et une seule adresse og:url (leur valeur est contrôlée par checkIndexHtml). */
export function checkSearchTags(html) {
  const errors = [];
  const { tokens } = tokenizeHtml(html);
  const canonicals = tokens.filter(token => isTagWith(token, 'link', 'rel', 'canonical')).length;
  if (canonicals !== 1) errors.push(`index.html : ${canonicals} lien(s) canonique(s) (un seul <link rel="canonical"> est attendu)`);
  const ogUrls = tokens.filter(token => isTagWith(token, 'meta', 'property', 'og:url')).length;
  if (ogUrls !== 1) errors.push(`index.html : ${ogUrls} balise(s) <meta property="og:url"> (une seule est attendue)`);
  return errors;
}

/** robots.txt tel que le produit shared/site.ts (buildRobotsTxt). */
const expectedRobotsTxt = siteOrigin => `User-agent: *\nAllow: /\n\nSitemap: ${siteOrigin}/sitemap.xml\n`;
/** Sitemap issu des mêmes routes indexables que le pré-rendu ; aucune duplication des chemins. */
const expectedSitemapXml = siteOrigin => siteSeoSource.buildSitemapXml().replaceAll(siteSeoSource.SITE_ORIGIN, siteOrigin);

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
    if (/^[ \t]*disallow[ \t]*:[ \t]*\/[ \t]*$/im.test(robots.text)) errors.push('robots.txt : « Disallow: / » interdirait tout le site aux moteurs de recherche');
    else if (/^[ \t]*disallow[ \t]*:[ \t]*\S/im.test(robots.text)) errors.push('robots.txt : une directive « Disallow » non vide interdirait une partie du site aux moteurs de recherche');
    if (errors.length === 0 && robots.text.replace(/\r\n/g, '\n') !== expectedRobotsTxt(siteOrigin)) errors.push('robots.txt : différent du fichier produit par le build (buildRobotsTxt, shared/site.ts)');
  }
  const sitemap = files.find(f => f.name === 'sitemap.xml');
  if (!sitemap) {
    errors.push('sitemap.xml absent (plan du site déclaré par robots.txt)');
  } else {
    const expectedLocations = siteSeoSource.SITE_PATHS.map(route => `${siteOrigin}${route}`);
    const locations = [...sitemap.text.matchAll(/<loc>([^<]*)<\/loc>/gi)].map(m => m[1].trim());
    if (locations.length === 0) errors.push('sitemap.xml : aucune adresse <loc>');
    for (const location of locations) {
      if (!expectedLocations.includes(location)) errors.push(`sitemap.xml : « ${location.slice(0, 80)} » n'est pas une page canonique indexable de ${siteOrigin}/`);
    }
    for (const location of new Set(locations)) {
      const count = locations.filter(url => url === location).length;
      if (count > 1) errors.push(`sitemap.xml : ${location} est listé ${count} fois (une seule entrée est attendue)`);
    }
    for (const location of expectedLocations) if (!locations.includes(location)) errors.push(`sitemap.xml : page indexable absente : ${location}`);
    // Fichier exactement tel que le produit le build : une balise <loc> écrite autrement (espace de noms, commentaire, CDATA)
    // ou un contenu ajouté ne passe pas pour « l'accueil seul ».
    if (errors.length === 0 && sitemap.text.replace(/\r\n/g, '\n') !== expectedSitemapXml(siteOrigin)) errors.push('sitemap.xml : différent du fichier produit par le build (buildSitemapXml, shared/site.ts)');
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
  for (const file of files.filter(f => /\.html$/.test(f.name) && f.name !== 'index.html')) {
    const pagePath = `/${file.name.replace(/\.html$/, '')}`;
    if (!Object.hasOwn(siteSeoSource.SITE_SEO, pagePath)) errors.push(`${file.name} : page inattendue`);
    else errors.push(...checkPrerenderedPage(file.text, { siteOrigin, pagePath }));
  }
  errors.push(...checkSearchFiles(files, { siteOrigin }));
  // Les fixtures du gabarit minimal restent prises en charge ; un vrai build pré-rendu doit livrer toutes les routes.
  if (index && /<main(?:\s|>)/.test(index.text)) {
    for (const route of Object.keys(siteSeoSource.SITE_SEO).filter(route => route !== '/')) {
      const file = `${route.slice(1)}.html`;
      if (!names.includes(file)) errors.push(`${file} : page pré-rendue absente`);
    }
    const key = files.find(file => file.name === siteSeoSource.INDEXNOW_PATH.slice(1));
    if (key?.text !== siteSeoSource.INDEXNOW_KEY) errors.push('IndexNow : fichier de validation publique absent ou incorrect');
    for (const [asset, width, height] of [[siteSeoSource.SITE_IMAGE_PATH, 1200, 630], [siteSeoSource.SITE_ICON_PATH, 512, 512]]) {
      try {
        const data = readFileSync(path.join(dir, asset.slice(1)));
        if (data.length < 24 || data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
          || data.readUInt32BE(16) !== width || data.readUInt32BE(20) !== height) errors.push(`${asset} : PNG ${width} × ${height} requis`);
      } catch { errors.push(`${asset} : image publiée absente ou illisible`); }
    }
  }
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
  console.log(`[verify-site] ${dir} : aucun code de l'application, aucune sourcemap ni script inline exécutable ; pages pré-rendues et ressources contrôlées, JSON-LD autorisé par empreinte CSP ; robots.txt et sitemap.xml conformes à ${readSiteOrigin()}.`);
}
