// scripts/verify-site.mjs face à un vrai analyseur HTML : test différentiel. jsdom (analyse conforme à la spécification
// WHATWG, comme un navigateur) sert de RÉFÉRENCE : des milliers de variantes piégées de index.html sont chargées dans
// jsdom, dans les deux modes d'analyse d'un navigateur (scripts désactivés : le contenu de <noscript> devient des
// éléments ; scripts activés : il reste du texte). Si le DOM obtenu contient une base, un formulaire, une feuille de
// style en ligne, un script en ligne, un gestionnaire d'évènement, une redirection ou une adresse (src, href, action,
// formaction, ping, srcset, style, meta…) qui sort du site, le contrôle DOIT refuser le fichier : aucun faux négatif.
// Les faux positifs (variantes inoffensives refusées) sont mesurés et rapportés ; seuls ceux qui toucheraient la page
// réelle de Vite (variantes de forme, même sens) sont interdits.
//
// Graine fixe : le test est déterministe.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SITE_ORIGIN } from '../../shared/site';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const verify = (await import(pathToFileURL(path.join(root, 'scripts', 'verify-site.mjs')).href)) as {
  checkIndexHtml(html: string, options?: { siteOrigin?: string; source?: boolean }): string[];
};
const check = (html: string) => verify.checkIndexHtml(html);

/**
 * jsdom, seul, dans sa propre fenêtre (console muette : les « scripts » de variantes piégées, fragments de texte, ne sont
 * pas du JavaScript et leurs erreurs ne regardent personne). Aucun chargement de ressource : sans option « resources »,
 * jsdom ne télécharge rien.
 */
type JsdomWindow = { document: Document; DOMParser: typeof DOMParser };
type JsdomModule = { JSDOM: new (html: string, options: { runScripts: 'dangerously'; virtualConsole: unknown }) => { window: JsdomWindow }; VirtualConsole: new () => unknown };
const { JSDOM, VirtualConsole } = (await import('jsdom' as string)) as JsdomModule;
const scripted = new JSDOM('<!doctype html>', { runScripts: 'dangerously', virtualConsole: new VirtualConsole() }).window;
const parser = new scripted.DOMParser();

/** Page de référence : le gabarit site/index.html tel que Vite le publie (script et feuille de style dans <head>, adresses /assets/). */
const TEMPLATE = readFileSync(path.join(root, 'site', 'index.html'), 'utf8');
const BUILT = TEMPLATE
  .replace(/\s*<script type="module" src="\.\.\/src\/site\/main\.tsx"><\/script>/, '')
  .replace('</head>', '    <script type="module" crossorigin src="/assets/index-TITvjoDr.js"></script>\n    <link rel="stylesheet" crossorigin href="/assets/index-Cgh7_m3z.css">\n  </head>');

// ─── Générateur pseudo-aléatoire (graine fixe) ──────────────────────────────────────────────────────────────────────

class Rand {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(max: number): number {
    return Math.floor(this.next() * max);
  }
  chance(probability: number): boolean {
    return this.next() < probability;
  }
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }
}

// ─── Référence : ce que jsdom voit dans le DOM ──────────────────────────────────────────────────────────────────────

const SITE = `${SITE_ORIGIN}/`;
/** Attributs dont la valeur est une adresse. */
const ADDRESS_ATTRIBUTES = new Set([
  'src', 'href', 'poster', 'data', 'action', 'formaction', 'archive', 'background', 'longdesc', 'cite', 'manifest', 'codebase', 'usemap', 'xlink:href', 'icon',
]);
const BASELINE_ICON = /<link rel="icon"[^>]* href="(data:[^"]*)"/.exec(BUILT)![1];

/** Vrai si un navigateur résout cette adresse (relative à la page) vers autre chose que l'origine du site (autre domaine, data:, javascript:, mailto:…). */
function leavesSite(value: string): boolean {
  try {
    return new URL(value, SITE).origin !== SITE_ORIGIN;
  } catch {
    return false;
  }
}

function unescapeCss(value: string): string {
  return value.replace(/\\([0-9a-f]{1,6})\s?/gi, (_m, hex: string) => String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff))).replace(/\\(.)/g, '$1');
}

/** Tous les éléments du document (parcours direct : querySelectorAll('*') de jsdom coûte vingt fois plus). */
function elementsOf(doc: Document): Element[] {
  const all: Element[] = [];
  const pending: Element[] = doc.documentElement ? [doc.documentElement] : [];
  for (let element = pending.pop(); element; element = pending.pop()) {
    all.push(element);
    for (let child = element.firstElementChild; child; child = child.nextElementSibling) pending.push(child);
  }
  return all;
}

/** Constructions dangereuses ou adresses externes du DOM (liste vide : la page est, pour un navigateur, celle du site). */
function flaws(doc: Document): string[] {
  const found: string[] = [];
  for (const element of elementsOf(doc)) {
    const tag = element.localName.toLowerCase();
    if (tag === 'base' || tag === 'form' || tag === 'style') found.push(`<${tag}>`);
    if (tag === 'script' && ((element.textContent ?? '').trim() !== '' || (element.getAttribute('type') ?? '').toLowerCase() === 'importmap')) found.push('script en ligne');
    if (tag === 'meta') {
      if (element.hasAttribute('http-equiv')) found.push('meta http-equiv');
      const content = (element.getAttribute('content') ?? '').replace(/[\t\n\r]/g, '');
      if (/^\s*(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(content) && leavesSite(content.trim())) found.push('adresse externe dans une balise <meta>');
    }
    for (const attributeName of element.getAttributeNames()) {
      const name = attributeName.toLowerCase();
      const value = element.getAttribute(attributeName) ?? '';
      if (name.startsWith('on')) found.push(`gestionnaire d'évènement ${name}`);
      else if (name === 'srcset' || name === 'imagesrcset') {
        if (value.split(',').some(candidate => { const url = candidate.trim().split(/\s+/)[0]; return url !== '' && leavesSite(url); })) found.push(`adresse externe (${name})`);
      } else if (name === 'ping') {
        if (value.split(/\s+/).some(url => url !== '' && leavesSite(url))) found.push('adresse externe (ping)');
      } else if (ADDRESS_ATTRIBUTES.has(name)) {
        const isBaselineIcon = tag === 'link' && value === BASELINE_ICON;
        if (value.trim() !== '' && !isBaselineIcon && leavesSite(value)) found.push(`adresse externe (${tag} ${name})`);
      } else if (name === 'style' && /url\s*\(|@import|image-set\s*\(|src\s*\(/i.test(unescapeCss(value))) {
        found.push('style avec adresse');
      }
    }
  }
  return found;
}

/**
 * Les deux analyses ne diffèrent que par le contenu des <noscript> (éléments scripts désactivés, texte scripts activés).
 * Une page qui ne mentionne <noscript> qu'à son emplacement d'origine, avec le même contenu que la page de référence, se
 * lit donc de la même façon dans les deux modes : une seule analyse suffit (l'autre coûte, et ne dirait rien de plus).
 */
const noscriptRegion = (text: string) => {
  const open = text.search(/<noscript/i);
  if (open === -1) return '';
  const close = text.slice(open).search(/<\/noscript/i);
  return close === -1 ? text.slice(open) : text.slice(open, open + close);
};
const BUILT_NOSCRIPT = noscriptRegion(BUILT);
const noscriptMentions = (text: string) => (text.match(/noscript/gi) ?? []).length;

/** Les deux analyses d'un navigateur : scripts désactivés (DOMParser), puis activés (document.write d'une fenêtre jsdom avec scripts). */
function browserFlaws(html: string): string[] {
  const off = flaws(parser.parseFromString(html, 'text/html'));
  if (noscriptMentions(html) === 2 && noscriptRegion(html) === BUILT_NOSCRIPT) return off;
  scripted.document.open();
  scripted.document.write(html);
  scripted.document.close();
  const on = flaws(scripted.document);
  return [...new Set([...off, ...on])];
}

// ─── Variantes piégées ──────────────────────────────────────────────────────────────────────────────────────────────

const LEADS = ['', ' ', '\t', '\n', '\r', '\f', '\u0001', '\u000b', '\u001f', '\u0000', '\u007f', '\u{a0}', '\u{2003}', ' \n\t', '\u0001\u0002'];
const INSERTIONS = ['\t', '\n', '\r', '&Tab;', '&NewLine;', '&#9;', '&#x0a;', '&#13;', '&#x9'];
const COLONS = ['&colon;', '&#58;', '&#x3a;', '&#58', '&COLON;', '&#X3A;'];
const SLASHES = ['&sol;', '&#47;', '&#x2f;', '&#47', '&SOL;', '&#X2F;'];
const LETTERS = ['&#104;', '&#x68;', '&#104', '&#X68;', '&#72;'];

/** Adresse externe sous toutes ses formes : schémas, séparateurs, majuscules, caractères que l'analyse d'adresse retire, références de caractères. */
function evilAddress(r: Rand): string {
  const host = r.pick(['evil.example', 'cdn.evil.test', 'x.example.org', '203.0.113.7:8080', 'evil.example:8443', 'EVIL.EXAMPLE', 'xn--evil-9ua.example']);
  const rest = r.pick(['/x.js', '/a/b.css', '/p.png', '/', '', '/x?q=1', '/x#h', '/%2e%2e/x']);
  const scheme = r.pick([
    'https://', 'https://', 'https://', 'http://', 'HTTPS://', 'hTTps://', '//', '//', '\\\\', '/\\', '\\/', 'https:\\\\', 'https:/\\', 'https:///', 'ws://', 'ftp://',
    'https:\\/', 'javascript:', 'data:text/html,', 'https:', 'file://',
  ]);
  let value = `${scheme}${host}${rest}`;
  for (let step = r.int(3); step > 0; step -= 1) {
    switch (r.int(5)) {
      case 0: {
        const at = r.int(Math.min(value.length, 12));
        value = value.slice(0, at) + r.pick(INSERTIONS) + value.slice(at);
        break;
      }
      case 1:
        value = value.replace(':', r.pick(COLONS));
        break;
      case 2:
        value = value.replace('/', r.pick(SLASHES));
        break;
      case 3:
        value = value.replace(/^[hH]/, r.pick(LETTERS));
        break;
      default:
        value = value.replace(/\//g, () => (r.chance(0.5) ? r.pick(SLASHES) : '/'));
    }
  }
  if (r.chance(0.3)) value = r.pick(LEADS) + value;
  if (r.chance(0.15)) value += r.pick(['', ' ', '\t', '\n']);
  return value;
}

/** Valeur d'attribut écrite entre guillemets doubles, simples ou sans guillemets. */
function quoted(value: string, r: Rand): string {
  const style = r.pick(['"', '"', "'", '', '"']);
  if (style === '"' && !value.includes('"')) return `"${value}"`;
  if (style === "'" && !value.includes("'")) return `'${value}'`;
  return value.includes('"') ? `'${value}'` : style === '' ? value : `"${value}"`;
}

type Attribute = readonly [name: string, value: string | null];

const mixCase = (text: string, r: Rand) => (r.chance(0.3) ? [...text].map(char => (r.chance(0.5) ? char.toUpperCase() : char.toLowerCase())).join('') : text);

/** Balise ouvrante écrite au hasard : casse, séparateurs, espaces autour de « = », guillemets, attribut leurre contenant « > », fin « /> ». */
function tag(r: Rand, name: string, attributes: Attribute[], closing = ''): string {
  let html = `<${mixCase(name, r)}`;
  const list = [...attributes];
  if (r.chance(0.15)) list.unshift(r.pick<Attribute>([['title', '>'], ['data-x', '>'], ['alt', '<b>'], ['class', 'a b'], ['data-y', "'"]]));
  if (r.chance(0.1)) list.reverse();
  for (const [attributeName, value] of list) {
    html += r.pick([' ', ' ', ' ', '  ', '\t', '\n', '\r\n', '\f', ' \n ', '/']);
    html += mixCase(attributeName, r);
    if (value !== null) html += r.pick(['=', '=', '=', ' = ', '\n=\n', ' =', '= ']) + quoted(value, r);
  }
  html += r.pick(['>', '>', ' >', '\n>', '/>', ' />', '\t/>']);
  return html + closing;
}

const endTag = (name: string, r: Rand) => r.pick([`</${name}>`, `</${name.toUpperCase()}>`, `</${name} >`, '', `</${name}\n>`, `</${name}/>`]);

type Payload = (r: Rand) => string;

/** Charges : chacune tente de charger ou d'exécuter quelque chose qui ne vient pas du site. */
const PAYLOADS: Payload[] = [
  r => tag(r, 'script', [['type', 'module'], ['src', evilAddress(r)]], endTag('script', r)),
  r => tag(r, 'script', [['src', evilAddress(r)]], endTag('script', r)),
  r => tag(r, 'script', [['src', '/assets/index-x.js'], ['src', evilAddress(r)], ['type', 'module']], endTag('script', r)),
  r => tag(r, 'script', [['src', evilAddress(r)], ['src', '/assets/index-x.js'], ['type', 'module']], endTag('script', r)),
  r => tag(r, 'script', [], `0${endTag('script', r)}`),
  r => tag(r, 'script', [['type', 'module']], `0${endTag('script', r)}`),
  r => tag(r, 'script', [['src', '/assets/index-x.js'], ['type', 'module']], `0${endTag('script', r)}`),
  r => tag(r, 'script', [['type', 'importmap']], `{}${endTag('script', r)}`),
  r => tag(r, 'link', [['rel', r.pick(['stylesheet', 'preload', 'modulepreload', 'prefetch', 'icon', 'canonical', 'alternate', 'manifest', 'dns-prefetch', 'preconnect', 'apple-touch-icon', 'shortcut icon', 'canonical stylesheet'])], ['href', evilAddress(r)]]),
  r => tag(r, 'link', [['rel', 'preload'], ['as', 'image'], ['imagesrcset', `${evilAddress(r)} 1x`], ['href', '/assets/a.png']]),
  r => tag(r, 'link', [['rel', 'stylesheet'], ['href', '/assets/index-x.css'], ['onload', '0']]),
  r => tag(r, 'img', [['src', evilAddress(r)]]),
  r => tag(r, 'img', [['src', '/assets/a.png'], ['srcset', `/assets/a.png 1x, ${evilAddress(r)} 2x`]]),
  r => tag(r, 'img', [['src', 'x'], ['onerror', '0']]),
  r => `${tag(r, 'picture', [], '')}${tag(r, 'source', [['srcset', evilAddress(r)]])}${tag(r, 'img', [['src', '/assets/a.png']])}</picture>`,
  r => tag(r, 'iframe', [['src', evilAddress(r)]], endTag('iframe', r)),
  r => tag(r, 'iframe', [['srcdoc', `<script src=${evilAddress(r)}></script>`]], endTag('iframe', r)),
  r => tag(r, 'embed', [['src', evilAddress(r)]]),
  r => tag(r, 'object', [['data', evilAddress(r)]], endTag('object', r)),
  r => tag(r, 'applet', [['code', 'x'], ['archive', evilAddress(r)]], endTag('applet', r)),
  r => tag(r, 'video', [['poster', evilAddress(r)]], endTag('video', r)),
  r => `${tag(r, 'video', [])}${tag(r, 'track', [['src', evilAddress(r)]])}</video>`,
  r => tag(r, 'audio', [['src', evilAddress(r)]], endTag('audio', r)),
  r => `<frameset>${tag(r, 'frame', [['src', evilAddress(r)]])}</frameset>`,
  r => `${tag(r, 'form', [['action', evilAddress(r)]])}${tag(r, 'input', [['name', 'a']])}</form>`,
  r => `${tag(r, 'form', [])}${tag(r, 'button', [['formaction', evilAddress(r)]], 'x</button>')}</form>`,
  r => `${tag(r, 'form', [])}${tag(r, 'input', [['type', 'submit'], ['formaction', evilAddress(r)]])}</form>`,
  r => tag(r, 'input', [['type', 'image'], ['src', evilAddress(r)]]),
  r => tag(r, 'base', [['href', evilAddress(r)]]),
  r => tag(r, 'base', [['href', '/assets/']]),
  r => tag(r, 'base', [['target', '_blank']]),
  r => `<svg>${tag(r, 'use', [['href', evilAddress(r)]], '</use>')}</svg>`,
  r => `<svg xmlns:xlink="http://www.w3.org/1999/xlink">${tag(r, 'use', [['xlink:href', evilAddress(r)]], '</use>')}</svg>`,
  r => `<svg>${tag(r, 'image', [['href', evilAddress(r)]])}</svg>`,
  r => `<svg>${tag(r, 'script', [['href', evilAddress(r)]], '</script>')}</svg>`,
  r => `<svg>${tag(r, 'style', [], `@import url(${evilAddress(r)});</style>`)}</svg>`,
  r => tag(r, 'svg', [['onload', '0']], '</svg>'),
  r => tag(r, 'style', [], `@import url(${evilAddress(r)});</style>`),
  r => tag(r, 'style', [], `@import "${evilAddress(r)}";</style>`),
  r => tag(r, 'style', [], `a{background:url(${evilAddress(r)})}</style>`),
  r => tag(r, 'div', [['style', `background:url(${evilAddress(r)})`]], '</div>'),
  r => tag(r, 'div', [['style', `@import url(${evilAddress(r)})`]], '</div>'),
  r => tag(r, 'div', [['style', `background:image-set(${evilAddress(r)} 1x)`]], '</div>'),
  r => tag(r, 'div', [['style', `background:\\75rl(${evilAddress(r)})`]], '</div>'),
  r => tag(r, 'div', [['style', `background:UrL( ${evilAddress(r)} )`]], '</div>'),
  r => tag(r, 'a', [['href', evilAddress(r)]], `x${endTag('a', r)}`),
  r => tag(r, 'a', [['href', '/telecharger'], ['ping', evilAddress(r)]], `x${endTag('a', r)}`),
  r => tag(r, 'area', [['href', evilAddress(r)]]),
  r => tag(r, 'a', [['href', r.pick(['javascript:0', 'mailto:a@evil.example', 'JaVaScRiPt:0', ' javascript:0'])]], `x${endTag('a', r)}`),
  r => `<noscript>${tag(r, 'img', [['src', evilAddress(r)]])}</noscript>`,
  r => `<noscript>${tag(r, 'a', [['href', evilAddress(r)]], 'x</a>')}</noscript>`,
  r => tag(r, 'meta', [['http-equiv', 'refresh'], ['content', `0;url=${evilAddress(r)}`]]),
  r => tag(r, 'meta', [['http-equiv', 'content-security-policy'], ['content', 'default-src *']]),
  r => tag(r, 'meta', [['property', r.pick(['og:image', 'og:video', 'og:url', 'og:audio'])], ['content', evilAddress(r)]]),
  r => tag(r, 'meta', [['name', r.pick(['twitter:image', 'msapplication-TileImage', 'x-redirect'])], ['content', evilAddress(r)]]),
  r => tag(r, 'table', [['background', evilAddress(r)]], '</table>'),
  r => tag(r, 'div', [['onclick', '0']], '</div>'),
  r => tag(r, 'div', [['ONMOUSEOVER', '0']], '</div>'),
  r => tag(r, 'div', [['data', evilAddress(r)], ['srcset', `${evilAddress(r)} 1x`]], '</div>'),
];

/** Mises en forme qui jouent sur l'analyse : commentaires vides ou mal fermés, texte brut (style, textarea…), noscript, mXSS. */
function wrap(fragment: string, r: Rand): string {
  switch (r.int(40)) {
    case 0: return `<!-->${fragment}-->`;
    case 1: return `<!--->${fragment}-->`;
    case 2: return `<!-- x --!>${fragment}`;
    case 3: return `<style><!-- </style>${fragment} --></style>`;
    case 4: return `<noscript>${fragment}</noscript>`;
    case 5: return `<noscript><a title="</noscript>${fragment}">x</a></noscript>`;
    case 6: return `<textarea><!--</textarea>${fragment}`;
    case 7: return `<title>${fragment}</title>`;
    case 8: return `<template>${fragment}</template>`;
    case 9: return `<svg><style><!--</style>${fragment}</svg>`;
    case 10: return `<math><mtext><table><mglyph><style><!--</style>${fragment}`;
    case 11: return `<select><option>${fragment}`;
    case 12: return `<plaintext>${fragment}`;
    case 13: return `<iframe>${fragment}</iframe>`;
    case 14: return `<xmp>${fragment}</xmp>`;
    case 15: return `<noembed>${fragment}</noembed>`;
    case 16: return `<!-- ${fragment} -->`;
    case 17: return `<![CDATA[ ${fragment} ]]>`;
    case 18: return `<?x ${fragment} ?>`;
    case 19: return `<a title="${fragment.replace(/"/g, '&quot;')}">x</a>`;
    default: return fragment;
  }
}

/** Positions d'insertion entre deux balises de la page de référence. */
const BOUNDARIES = [0, ...[...BUILT.matchAll(/>/g)].map(match => match.index + 1), ...[...BUILT.matchAll(/</g)].map(match => match.index), BUILT.length];

function insertAt(html: string, fragment: string, r: Rand): string {
  const where = r.int(10);
  const at = where < 7 ? r.pick(BOUNDARIES) : where < 9 ? r.int(html.length + 1) : r.pick([0, html.length]);
  return html.slice(0, at) + fragment + html.slice(at);
}

/** Valeurs de la page de référence réécrites : adresse externe, gestionnaire, <base>… à la place du contenu prévu. */
const MUTATIONS: ((html: string, r: Rand) => string)[] = [
  (html, r) => html.replace('href="https://www.mag-istra.fr/"', `href=${quoted(evilAddress(r), r)}`),
  (html, r) => html.replace('content="https://www.mag-istra.fr/"', `content=${quoted(evilAddress(r), r)}`),
  (html, r) => html.replace('src="/assets/index-TITvjoDr.js"', `src=${quoted(evilAddress(r), r)}`),
  (html, r) => html.replace('href="/assets/index-Cgh7_m3z.css"', `href=${quoted(evilAddress(r), r)}`),
  (html, r) => html.replace('href="/telecharger"', `href=${quoted(evilAddress(r), r)}`),
  (html, r) => html.replace('role="status"', `role="status" style="background:url(${evilAddress(r)})"`),
  (html, r) => html.replace(/href="data:[^"]*"/, `href=${quoted(evilAddress(r), r)}`),
  html => html.replace('<body>', '<body onload=0>'),
  html => html.replace('<html lang="fr">', '<html lang="fr" onfocus=0>'),
  html => html.replace('<div id="root">', '<div id="root" onclick=0>'),
  html => html.replace('<meta charset="UTF-8" />', '<meta charset="UTF-8" http-equiv="refresh" />'),
  (html, r) => html.replace('<title>', `${tag(r, 'base', [['href', evilAddress(r)]])}<title>`),
  (html, r) => html.replace('<noscript>', `<noscript>${tag(r, 'form', [['action', evilAddress(r)]])}`),
  html => html.replace('rel="canonical"', 'rel="canonical" rel="stylesheet"'),
  html => html.replace('rel="canonical"', 'rel="canonical stylesheet"'),
  (html, r) => html.replace('</noscript>', `<img src=${quoted(evilAddress(r), r)}></noscript>`),
];

function maliciousCandidate(seed: number): string {
  const r = new Rand(seed);
  let html = BUILT;
  const kind = r.int(10);
  if (kind < 6) {
    html = insertAt(html, wrap(r.pick(PAYLOADS)(r), r), r);
  } else if (kind < 8) {
    html = r.pick(MUTATIONS)(html, r);
  } else if (kind < 9) {
    html = insertAt(insertAt(html, wrap(r.pick(PAYLOADS)(r), r), r), wrap(r.pick(PAYLOADS)(r), r), r);
  } else {
    html = insertAt(r.pick(MUTATIONS)(html, r), wrap(r.pick(PAYLOADS)(r), r), r);
  }
  return html;
}

// ─── Variantes inoffensives (faux positifs) ─────────────────────────────────────────────────────────────────────────

/** Variante de FORME de la page de référence (casse, guillemets, séparateurs, indentation) : même document pour un navigateur, acceptée par le contrôle. */
function formVariant(seed: number): string {
  const r = new Rand(seed);
  return BUILT
    .replace(/<(\/?)([a-z]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\s*\/?)>/g, (_whole, slash: string, name: string, body: string, end: string) => {
      const attributes: Attribute[] = [...body.matchAll(/([a-z-]+)(?:=(?:"([^"]*)"|'([^']*)'))?/g)].map(match => [match[1], match[2] ?? match[3] ?? null]);
      if (slash) return `</${mixCase(name, r)}${r.pick(['', ' ', '\n'])}>`;
      if (r.chance(0.2) && attributes.length > 1) attributes.reverse();
      let tagText = `<${mixCase(name, r)}`;
      for (const [attributeName, value] of attributes) {
        tagText += r.pick([' ', ' ', '  ', '\t', '\n', '\r\n']) + mixCase(attributeName, r);
        if (value !== null) {
          const bare = /^[^\s"'`=<>]+$/.test(value) && !value.endsWith('/') && r.chance(0.4);
          const around = r.pick(['=', ' = ', '\n=\n', ' =', '= ']);
          tagText += around + (bare ? value : r.pick(['"', "'"]) === '"' || value.includes("'") ? `"${value}"` : `'${value}'`);
        }
      }
      const last = attributes.at(-1);
      const unquotedLast = last !== undefined && last[1] !== null && /^[^\s"'`=<>]+$/.test(last[1]) && tagText.endsWith(last[1]);
      const closing = end.includes('/') && ['meta', 'link', 'br'].includes(name) ? r.pick([' />', '/>', '\n/>']) : r.pick(['>', ' >', '\n>']);
      return tagText + (unquotedLast && closing.startsWith('/') ? ` ${closing}` : closing);
    })
    .replace(/>\n\s*</g, () => `>${r.pick(['\n', '\r\n', '\n\n', '\n    ', '\t', ' ', '\n\t\t'])}<`);
}

/** Variantes inoffensives pour un navigateur mais refusées PAR CHOIX (aucun commentaire, aucune entité, aucune balise ou adresse imprévue). */
const BENIGN_BUT_REFUSED: ((html: string, r: Rand) => string)[] = [
  html => html.replace('<head>', '<head><!-- x -->'),
  html => html.replace('</body>', '<!-- fin --></body>'),
  html => html.replace('content="Magistra', 'content="Magistra &amp;'),
  html => html.replace('</noscript>', '<img src="/assets/logo.png" alt=""></noscript>'),
  html => html.replace('</head>', '<style>body{margin:0}</style></head>'),
  html => html.replace('</div></div>', '<img src="/assets/logo.png" alt=""></div></div>'),
  html => html.replace('src="/assets/index-TITvjoDr.js"', 'src="https://www.mag-istra.fr/assets/index-TITvjoDr.js"'),
  html => html.replace('</head>', '<link rel="preload" href="/assets/a.woff2" as="font" crossorigin></head>'),
  html => html.replace('</head>', '<meta name="twitter:card" content="summary"></head>'),
  html => html.replace('<body>', '<body class="x" data-theme="dark">'),
  html => html.replace('href="/telecharger"', 'href="/telecharger?source=noscript"'),
  html => html.replace('<html lang="fr">', '<html lang="fr" dir="ltr">'),
];

describe('verify-site face à jsdom : test différentiel', () => {
  it('la page de référence est conforme pour le contrôle ET sans défaut pour jsdom (le test n’est pas vide de sens)', () => {
    expect(check(BUILT)).toEqual([]);
    expect(browserFlaws(BUILT)).toEqual([]);
    // La référence voit bien les charges : base, formulaire, adresse, gestionnaire, style, redirection, script en ligne.
    for (const html of [
      BUILT.replace('<title>', '<base href="https://evil.example/"><title>'),
      BUILT.replace('<noscript>', '<noscript><form action="/x"></form>'),
      BUILT.replace('</head>', '<script src="//evil.example/x.js"></script></head>'),
      BUILT.replace('<body>', '<body onload=0>'),
      BUILT.replace('</head>', '<style>a{}</style></head>'),
      BUILT.replace('</head>', '<meta http-equiv="refresh" content="0"></head>'),
      BUILT.replace('</head>', '<script>0</script></head>'),
      BUILT.replace('<div id="root">', '<div id="root" style="background:url(//evil.example/x)">'),
      BUILT.replace('</head>', '<script src="https&colon;&sol;&sol;evil.example/x.js"></script></head>'),
      BUILT.replace('</head>', '<script src="\u0001https://evil.example/x.js"></script></head>'),
      BUILT.replace('</head>', '<!--><script src="https://evil.example/x.js"></script>--></head>'),
    ]) {
      expect(browserFlaws(html), html).not.toEqual([]);
    }
    // Scripts activés : le contenu d'un <noscript> n'est que du texte ; la référence ne voit pas ce qu'un navigateur ne ferait pas.
    expect(browserFlaws(BUILT.replace('</head>', '<!-- <script src="https://evil.example/x.js"></script> --></head>'))).toEqual([]);
  });

  it('au moins 5 000 variantes piégées (en tout genre) : le contrôle refuse TOUTES celles que jsdom voit dangereuses (aucun faux négatif)', { timeout: 180_000 }, () => {
    const categories = new Map<string, number>();
    const missed: { seed: number; html: string; flaws: string[] }[] = [];
    let malicious = 0;
    let inert = 0;
    let refusedInert = 0;
    const candidates = 8_000;
    const spent = { generation: 0, jsdom: 0, control: 0 };
    for (let seed = 1; seed <= candidates; seed += 1) {
      let started = performance.now();
      const html = maliciousCandidate(seed);
      spent.generation += performance.now() - started;
      started = performance.now();
      const flawed = browserFlaws(html);
      spent.jsdom += performance.now() - started;
      started = performance.now();
      const refused = check(html).length > 0;
      spent.control += performance.now() - started;
      if (flawed.length === 0) {
        inert += 1;
        if (refused) refusedInert += 1;
        continue;
      }
      malicious += 1;
      for (const flaw of new Set(flawed.map(text => text.replace(/\(\w+ /, '(')))) categories.set(flaw, (categories.get(flaw) ?? 0) + 1);
      if (!refused) missed.push({ seed, html, flaws: flawed });
    }
    console.info(`[fuzz verify-site] temps (ms) : génération ${spent.generation.toFixed(0)}, jsdom ${spent.jsdom.toFixed(0)}, contrôle ${spent.control.toFixed(0)}`);
    console.info(`[fuzz verify-site] candidats ${candidates} : ${malicious} dangereuses pour jsdom (toutes refusées : ${malicious - missed.length}), ${inert} inertes (${refusedInert} refusées quand même) ; catégories : ${[...categories].map(([name, count]) => `${name}=${count}`).join(', ')}`);
    expect(missed.slice(0, 3).map(({ seed, flaws: found, html }) => ({ seed, found, html: html.slice(0, 600) }))).toEqual([]);
    expect(malicious).toBeGreaterThanOrEqual(5_000);
    // Le corpus couvre les familles : base, formulaire, style, script en ligne, gestionnaire, redirection, adresses (script, lien, image, cadre, SVG…).
    expect(categories.size).toBeGreaterThanOrEqual(15);
    for (const family of ['<base>', '<form>', '<style>', 'script en ligne', 'meta http-equiv', 'style avec adresse', 'adresse externe (srcset)', 'adresse externe (ping)']) {
      expect(categories.get(family) ?? 0, family).toBeGreaterThan(20);
    }
  });

  it('variantes de forme de la page réelle (casse, guillemets, séparateurs, indentation, ordre des attributs) : même document, aucun faux positif', { timeout: 120_000 }, () => {
    const total = 1_500;
    const refused: { seed: number; html: string; errors: string[] }[] = [];
    for (let seed = 1; seed <= total; seed += 1) {
      const html = formVariant(seed);
      const errors = check(html);
      if (errors.length > 0) refused.push({ seed, html, errors });
      // Même document pour jsdom : la référence n'y voit aucun défaut.
      if (seed % 10 === 0) expect(browserFlaws(html), html).toEqual([]);
    }
    console.info(`[fuzz verify-site] variantes de forme : ${total}, refusées à tort : ${refused.length}`);
    expect(refused.slice(0, 2).map(({ seed, errors, html }) => ({ seed, errors, html: html.slice(0, 800) }))).toEqual([]);
  });

  it('variantes inoffensives mais hors liste blanche (commentaire, entité dans un attribut, image du site, <style>…) : refusées par choix, avec un message précis ; mesure du taux', () => {
    const r = new Rand(7);
    let refused = 0;
    for (const variant of BENIGN_BUT_REFUSED) {
      const html = variant(BUILT, r);
      const errors = check(html);
      // Inoffensive pour la référence (ou, pour une image du site, sans adresse externe) : le refus est un choix de la liste blanche.
      expect(browserFlaws(html).filter(found => !/^<style>$/.test(found)), html.slice(0, 120)).toEqual([]);
      if (errors.length > 0) {
        refused += 1;
        for (const error of errors) expect(error).toMatch(/^index\.html : /);
      }
    }
    console.info(`[fuzz verify-site] inoffensives hors liste blanche : ${BENIGN_BUT_REFUSED.length}, refusées : ${refused} (faux positifs voulus, jamais sur la page réelle de Vite)`);
    expect(refused).toBe(BENIGN_BUT_REFUSED.length);
  });

  it('références de caractères dans le TEXTE (&hellip;, &#39;, &nbsp;) : acceptées (inoffensives) ; refusées seulement dans les valeurs d’attributs', () => {
    for (const html of [BUILT.replace('Chargement…', 'Chargement&hellip;'), BUILT.replace('s\'afficher', 's&#39;afficher'), BUILT.replace('<noscript>', '<noscript>&nbsp;')]) {
      expect(check(html), html).toEqual([]);
      expect(browserFlaws(html), html).toEqual([]);
    }
  });
});
