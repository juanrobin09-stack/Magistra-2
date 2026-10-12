// scripts/verify-site.mjs : inspection du build du site vitrine (dist-site/) lancée par la CI. Dossiers synthétiques ;
// aucun build, aucun navigateur (le gabarit site/index.html et, s'il existe, dist-site/ sont aussi contrôlés). La
// comparaison avec un vrai analyseur HTML (jsdom) est dans tests/site/verifySiteFuzz.test.ts.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildRobotsTxt, buildSitemapXml, SITE_ORIGIN, SITE_PATHS } from '../../shared/site';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'scripts', 'verify-site.mjs');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'magistra-verify-site-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

type Mod = {
  FORBIDDEN_TEXTS: [string, string][];
  readSiteOrigin(file?: string): string;
  verifySite(dir: string, options?: { siteOrigin?: string }): string[];
  checkIndexHtml(html: string, options?: { siteOrigin?: string; source?: boolean }): string[];
  tokenizeHtml(html: string): { tokens: { type: string; index: number }[]; errors: { index: number; message: string }[] };
  checkSearchTags(html: string): string[];
  checkSearchFiles(files: { name: string; text: string }[], options?: { siteOrigin?: string }): string[];
  checkForbiddenContent(files: { name: string; text: string }[]): string[];
  checkNoSourceMaps(names: string[]): string[];
};
const mod = (await import(pathToFileURL(script).href)) as Mod;

/** Seules adresses https externes d'index.html : le lien canonique et og:url, à l'adresse officielle (shared/site.ts). */
const CANONICAL = `<link rel="canonical" href="${SITE_ORIGIN}/" />`;
const OG_URL = `<meta property="og:url" content="${SITE_ORIGIN}/" />`;
const GOOD_INDEX = `<!doctype html>
<html lang="fr"><head><meta charset="UTF-8" /><title>Magistra</title>
${CANONICAL}
${OG_URL}
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E" />
<script type="module" crossorigin src="/assets/index-abc.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-abc.css"></head>
<body><noscript>JavaScript requis. <a href="/telecharger">Télécharger</a></noscript><div id="root"></div></body></html>`;
const GOOD_JS = 'fetch("/api/windows-release");export{};';
const GOOD_CSS = '.btn{color:#fff}';

let counter = 0;
/** Dossier de site synthétique : fichiers { chemin relatif → contenu }. */
function site(files: Record<string, string | Buffer>): string {
  const dir = path.join(tmp, `site-${counter++}`);
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, ...name.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return dir;
}

const GOOD = {
  'index.html': GOOD_INDEX,
  'robots.txt': buildRobotsTxt(),
  'sitemap.xml': buildSitemapXml(),
  'assets/index-abc.js': GOOD_JS,
  'assets/index-abc.css': GOOD_CSS,
  'assets/font.woff2': Buffer.from([0, 1, 2, 3]),
};

function run(dir?: string) {
  const result = spawnSync(process.execPath, dir === undefined ? [script] : [script, dir], { cwd: tmp, encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

describe('verify-site : site conforme', () => {
  it('un site vitrine propre passe (seule /api/windows-release est permise)', () => {
    expect(mod.verifySite(site(GOOD))).toEqual([]);
    const { code, out } = run(site(GOOD));
    expect(code).toBe(0);
    expect(out).toContain('aucun code de l\'application');
  });
});

describe('verify-site : dossier ou page d’entrée manquants', () => {
  it('dossier absent : échec, message clair', () => {
    const missing = path.join(tmp, 'absent');
    expect(mod.verifySite(missing).join('\n')).toContain('introuvable');
    const { code, err } = run(missing);
    expect(code).toBe(1);
    expect(err).toContain('::error title=Site vitrine::');
    expect(err).toContain('npm run build:site');
  });

  it('dossier sans index.html : échec', () => {
    const dir = site({ 'assets/index-abc.js': GOOD_JS });
    expect(mod.verifySite(dir).join('\n')).toContain('index.html introuvable');
    expect(run(dir).code).toBe(1);
  });

  it('sans argument : verdict sur le dist-site du dépôt, jamais un plantage', () => {
    const { code, err } = run();
    // dist-site existe ou non selon qu'un build a eu lieu : dans les deux cas le script répond par un code et, en échec, une annotation.
    expect([0, 1]).toContain(code);
    if (code === 1) expect(err).toContain('::error title=Site vitrine::');
  });
});

describe('verify-site : code de l’application dans le build', () => {
  const TEXTS: [string, string][] = [
    ['clerk', 'import("https://clerk.example/clerk.js")'],
    ['supabase', 'createClient("https://x.supabase.co")'],
    ['jspdf', 'new jsPDF()'],
    ['pdfjs', 'import("pdfjs-dist")'],
    ['/api/generate', 'fetch("/api/generate",{method:"POST"})'],
    ['/api/generation', 'fetch("/api/generation?id=1")'],
    ['/api/history', 'fetch("/api/history")'],
    ['/api/profile', 'fetch("/api/profile")'],
    ['/api/account', 'fetch("/api/account")'],
    ['/api/status', 'fetch("/api/status")'],
    ['/api/stats', 'fetch("/api/stats")'],
    ['/api/mode', 'fetch("/api/mode")'],
    ['47831', 'const p=47831'],
    ['localConnector', 'const localConnector={}'],
    ['/onboarding', 'location.href="/onboarding?edit=1"'],
    ['Refaire mon profil', 'label:"Refaire mon profil"'],
    ['Depuis ce site', 'text:"Depuis ce site, vous pourrez"'],
  ];

  it('chaque mot interdit de la liste est testé ici', () => {
    expect(TEXTS.map(([needle]) => needle).sort()).toEqual(mod.FORBIDDEN_TEXTS.map(([needle]) => needle).sort());
  });

  it.each(TEXTS)('« %s » dans un fichier .js : échec nommant le fichier', (needle, code) => {
    const dir = site({ ...GOOD, 'assets/index-abc.js': `${GOOD_JS}${code}` });
    const errors = mod.verifySite(dir);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('assets/index-abc.js');
    expect(errors[0]).toContain(`« ${needle} »`);
    const { code: exit, err } = run(dir);
    expect(exit).toBe(1);
    expect(err).toContain(`::error title=Site vitrine::assets/index-abc.js`);
  });

  it('casse ignorée : « CLERK », « Supabase », « JsPdf », « LOCALCONNECTOR »', () => {
    for (const text of ['CLERK', 'Supabase', 'JsPdf', 'LOCALCONNECTOR', '/API/MODE']) {
      expect(mod.verifySite(site({ ...GOOD, 'assets/index-abc.js': `x="${text}"` })), text).not.toEqual([]);
    }
  });

  it('dans un .css et dans un .html aussi', () => {
    expect(mod.verifySite(site({ ...GOOD, 'assets/index-abc.css': '/* clerk */' })).join('\n')).toContain('assets/index-abc.css');
    expect(mod.verifySite(site({ ...GOOD, 'index.html': `${GOOD_INDEX}<!-- supabase -->` })).join('\n')).toContain('index.html');
    expect(mod.verifySite(site({ ...GOOD, 'page.html': '<p>/api/status</p>' })).join('\n')).toContain('page.html');
  });

  it('dans un sous-dossier : le fichier est nommé avec son chemin', () => {
    const errors = mod.verifySite(site({ ...GOOD, 'assets/chunks/deep/a.mjs': 'x=47831' }));
    expect(errors.join('\n')).toContain('assets/chunks/deep/a.mjs');
  });

  it('un fichier binaire (police) n’est pas lu comme du texte', () => {
    expect(mod.verifySite(site({ ...GOOD, 'assets/font.woff2': Buffer.from('clerk supabase 47831') }))).toEqual([]);
  });

  it.each([
    ['clé secrète Clerk', 'k="sk_live_0123456789abcdef"'],
    ['clé secrète Clerk (test)', 'k="sk_test_0123456789abcdef"'],
    ['service_role', 'role="service_role"'],
    ['clé secrète Supabase', 'k="sb_secret_0123456789abcdef"'],
    ['secret de webhook', 'k="whsec_0123456789abcdef"'],
  ])('%s : échec', (_name, code) => {
    expect(mod.verifySite(site({ ...GOOD, 'assets/index-abc.js': code })), code).not.toEqual([]);
  });

  it('un mot qui ressemble sans l’être (« task_list », « risk ») ne déclenche rien', () => {
    expect(mod.verifySite(site({ ...GOOD, 'assets/index-abc.js': 'var task_list=1,risk_level=2;fetch("/api/windows-release")' }))).toEqual([]);
  });
});

/** Page complète : la page de référence avec ce fragment ajouté dans <head> ou dans <body> (le contrôle lit un document entier). */
const inHead = (fragment: string) => GOOD_INDEX.replace('</head>', `${fragment}</head>`);
const inBody = (fragment: string) => GOOD_INDEX.replace('</body>', `${fragment}</body>`);
const check = (html: string) => mod.checkIndexHtml(html);
const EVIL = 'https://evil.example';
const readSource = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('verify-site : index.html, lecture stricte (liste blanche)', () => {
  it('page de référence, gabarit site/index.html et page construite par Vite : conformes', () => {
    expect(check(GOOD_INDEX)).toEqual([]);
    const template = readSource('site/index.html');
    expect(mod.checkIndexHtml(template, { source: true })).toEqual([]);
    expect(mod.checkSearchTags(template)).toEqual([]);
    // Le gabarit charge son point d'entrée TypeScript : seule la page construite (adresse /assets/…) est conforme en production.
    expect(mod.checkIndexHtml(template).join('\n')).toContain('../src/site/main.tsx');
  });

  it.skipIf(!existsSync(path.join(root, 'dist-site', 'index.html')))('dist-site/ (npm run build:site) : conforme de bout en bout', () => {
    expect(mod.verifySite(path.join(root, 'dist-site'))).toEqual([]);
  });

  it('le gabarit n’a ni commentaire (Vite les recopie dans le build), ni CDATA, ni instruction ; son seul « <! » est le doctype', () => {
    const template = readSource('site/index.html');
    expect(template).not.toMatch(/<!--|--!?>|<!\[CDATA\[|<\?/i);
    expect(template.match(/<!/g)).toHaveLength(1);
    expect(template.trimStart().startsWith('<!doctype html>')).toBe(true);
  });

  it('balises et attributs prévus (liens du <noscript>, préchargement, feuille de style, formes de balises) : acceptés', () => {
    const page = GOOD_INDEX
      .replace('<noscript>JavaScript requis. <a href="/telecharger">Télécharger</a></noscript>',
        '<noscript>JavaScript requis.<br /><strong>Astuce</strong> <em>:</em> <a class="lien" href="/telecharger">Télécharger</a> ou <a href="#haut">le haut</a>.</noscript>')
      .replace('<div id="root"></div>', '<div id="root"><div role="status" aria-live="polite" aria-busy="true" style="min-height:100vh;display:flex;background:#0a0a0f;font:14px system-ui,sans-serif">Chargement…</div></div>')
      .replace('</head>', [
        '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        '<meta name="description" content="Magistra : l\'application, « gratuite » et open source — par Juan Robin." />',
        '<meta name="description" content="Espace insécable\u{a0}: et fine\u{202f}!" />',
        '<meta name="theme-color" content="#0a0a0f" />',
        '<meta property="og:title" content="Magistra" />',
        '<link rel="modulepreload" crossorigin href="/assets/chunk-a1B2.js">',
        '<link rel="icon" type="image/png" sizes="32x32" href="/assets/icone-32.png" />',
        '</head>',
      ].join(''));
    expect(check(page)).toEqual([]);
  });

  it('formes de balises équivalentes pour un navigateur : casse, guillemets, espaces autour de « = », séparateurs, balises auto-fermantes', () => {
    const variants = [
      GOOD_INDEX.replace('<meta charset="UTF-8" />', '<META CHARSET=\'UTF-8\'>'),
      GOOD_INDEX.replace('<meta charset="UTF-8" />', '<meta charset = "UTF-8"/>'),
      GOOD_INDEX.replace('<meta charset="UTF-8" />', '<meta\tcharset=UTF-8\n/>'),
      GOOD_INDEX.replace('<script type="module" crossorigin src="/assets/index-abc.js"></script>', '<SCRIPT SRC = \'/assets/index-abc.js\'\n\tTYPE=module CROSSORIGIN></SCRIPT >'),
      GOOD_INDEX.replace('<div id="root"></div>', '<DIV ID=root></DIV>'),
      GOOD_INDEX.replace('<html lang="fr">', '<HTML LANG=fr>').replace('</html>', '</HTML>'),
      GOOD_INDEX.replace('<!doctype html>', '<!DOCTYPE HTML>'),
    ];
    for (const html of variants) expect(check(html), html).toEqual([]);
  });
});

describe('verify-site : commentaires HTML refusés (V1 : <!-->, <!--->, --!>, <style><!--)', () => {
  const COMMENTS: [string, string][] = [
    ['« <!--> » est un commentaire vide', `<!--><script src="${EVIL}/x.js"></script>-->`],
    ['« <!---> » est un commentaire vide', `<!---><script src="${EVIL}/x.js"></script>-->`],
    ['« --!> » ferme un commentaire', `<!-- x --!><script src="${EVIL}/x.js"></script>`],
    ['« <!-- » dans un <style> est du texte', '<style><!-- </style><script src="//evil.example/x"></script> --></style>'],
    ['commentaire ordinaire', '<!-- affiché pendant le chargement -->'],
    ['commentaire vide', '<!---->'],
    ['commentaire non fermé', '<!-- x'],
    ['commentaire conditionnel', `<!--[if IE]><script src="${EVIL}/x.js"></script><![endif]-->`],
    ['commentaire autour d’une balise', `<!-- <script src="${EVIL}/a.js"></script><link rel="stylesheet" href="${EVIL}/a.css"> -->`],
    ['section CDATA', '<![CDATA[ x ]]>'],
    ['instruction de traitement', '<?xml version="1.0"?>'],
    ['déclaration', '<!ELEMENT x>'],
    ['second doctype', '<!doctype html>'],
  ];

  it.each(COMMENTS)('%s : refusé dans <head>, dans <body>, avant le doctype et après </html>', (_name, fragment) => {
    for (const html of [inHead(fragment), inBody(fragment), `${fragment}${GOOD_INDEX}`, `${GOOD_INDEX}${fragment}`]) {
      expect(check(html), html).not.toEqual([]);
    }
  });

  it('un commentaire inoffensif est refusé aussi : message précis, avec la ligne', () => {
    const errors = check(inHead('<!-- x -->'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^index\.html : ligne \d+ : commentaire HTML interdit/);
    expect(errors[0]).toContain('<!-- x -->');
    expect(check(inHead('<!-- x --!>')).join('\n')).toContain('--!>');
  });

  it('reproduction : le script de contrôle échoue (code 1) et signale le commentaire ET le script qui le suit', () => {
    const dir = site({ ...GOOD, 'index.html': GOOD_INDEX.replace('</head>', `<!--><script src="${EVIL}/x.js"></script>-->\n</head>`) });
    const { code, err } = run(dir);
    expect(code).toBe(1);
    expect(err).toContain('::error title=Site vitrine::index.html : ligne');
    expect(err).toContain('commentaire HTML interdit');
    expect(err).toContain('ressource chargée depuis un autre domaine');
    expect(mod.verifySite(dir).length).toBeGreaterThanOrEqual(2);
  });

  it('dans le texte d’un commentaire refusé, les mots interdits restent signalés (contrôle des textes inchangé)', () => {
    const errors = mod.verifySite(site({ ...GOOD, 'index.html': GOOD_INDEX.replace('</head>', '<!-- clerk --></head>') }));
    expect(errors.join('\n')).toContain('« clerk »');
    expect(errors.join('\n')).toContain('commentaire HTML interdit');
  });

  it('une balise canonique ou og:url « mise en commentaire » ne sauve pas la page : le commentaire est refusé', () => {
    for (const html of [GOOD_INDEX.replace(CANONICAL, `<!-- ${CANONICAL} -->`), GOOD_INDEX.replace(OG_URL, `<!-- ${OG_URL} -->`)]) {
      expect(check(html).join('\n')).toContain('commentaire HTML interdit');
    }
  });
});

describe('verify-site : adresses déguisées (V2 : références nommées, préfixes de contrôle, schéma coupé)', () => {
  const S = `<script type="module" src="`;
  const ADDRESSES: [string, string][] = [
    ['« &sol; » (script)', `${S}https:&sol;&sol;evil.example/x.js"></script>`],
    ['« &colon; » (image)', '<img src="https&colon;//evil.example/x.png">'],
    ['« &colon; » (feuille de style sans guillemets)', '<link rel=stylesheet href="https&colon;//evil.example/a.css">'],
    ['« &Tab; »', `${S}https:&Tab;//evil.example/x.js"></script>`],
    ['« &NewLine; »', `${S}https:&NewLine;//evil.example/x.js"></script>`],
    ['référence nommée sans point-virgule', `${S}https&colon//evil.example/x.js"></script>`],
    ['référence décimale', `${S}&#104;ttps://evil.example/x.js"></script>`],
    ['référence décimale sans point-virgule', `${S}&#104ttps://evil.example/x.js"></script>`],
    ['référence hexadécimale', `${S}&#x68;ttps://evil.example/x.js"></script>`],
    ['référence hexadécimale en majuscules', `${S}&#X68;ttps://evil.example/x.js"></script>`],
    ['préfixe de contrôle U+0001', `${S}\u0001https://evil.example/x.js"></script>`],
    ['préfixe de contrôle U+001F', `${S}\u001fhttps://evil.example/x.js"></script>`],
    ['préfixe NUL', `${S}\u0000https://evil.example/x.js"></script>`],
    ['saut de page de tête', `${S}\fhttps://evil.example/x.js"></script>`],
    ['espace de tête', `${S} https://evil.example/x.js"></script>`],
    ['espace insécable de tête', `${S}\u{a0}https://evil.example/x.js"></script>`],
    ['tabulation dans le schéma', `${S}ht\ttps://evil.example/x.js"></script>`],
    ['saut de ligne dans le schéma', `${S}ht\ntps://evil.example/x.js"></script>`],
    ['retour chariot dans le schéma', `${S}ht\rtps://evil.example/x.js"></script>`],
    ['antislashs doubles', `${S}\\\\evil.example/x.js"></script>`],
    ['« / » puis antislash', `${S}/\\evil.example/x.js"></script>`],
    ['protocole relatif', `${S}//evil.example/x.js"></script>`],
    ['majuscules', `${S}HTTPS://EVIL.EXAMPLE/X.JS"></script>`],
    ['http', `${S}http://evil.example/x.js"></script>`],
    ['ftp', `${S}ftp://evil.example/x.js"></script>`],
    ['javascript:', `${S}javascript:alert(1)"></script>`],
    ['data:', `${S}data:text/javascript,alert(1)"></script>`],
    ['adresse du site lui-même', `${S}https://www.mag-istra.fr/x.js"></script>`],
    ['sans guillemets', `<script type=module src=https://evil.example/x.js></script>`],
    ['guillemets simples', `<script type='module' src='//evil.example/x.js'></script>`],
  ];

  it.each(ADDRESSES)('%s : refusé dans <head> comme dans <body>', (_name, fragment) => {
    expect(check(inHead(fragment)), fragment).not.toEqual([]);
    expect(check(inBody(fragment)), fragment).not.toEqual([]);
  });

  it('reproductions du constat : « &sol; », « &colon; » (img et feuille de style) échouent aussi par la ligne de commande', () => {
    for (const fragment of [
      `${S}https:&sol;&sol;evil.example/x.js"></script>`,
      '<img src="https&colon;//evil.example/x.png">',
      '<link rel=stylesheet href="https&colon;//evil.example/a.css">',
      `${S}\u0001https://evil.example/x.js"></script>`,
    ]) {
      const { code, err } = run(site({ ...GOOD, 'index.html': inHead(fragment) }));
      expect(code, fragment).toBe(1);
      expect(err).toContain('::error title=Site vitrine::index.html : ligne');
    }
  });

  it('aucune référence de caractère « & » dans une valeur d’attribut, même inoffensive : refusée avec la raison', () => {
    for (const content of ['R&amp;D', 'a &lt; b', 'l&#39;école', '&nbsp;', 'a & b']) {
      const errors = check(inHead(`<meta name="description" content="${content}" />`));
      expect(errors, content).toHaveLength(1);
      expect(errors[0], content).toContain('référence de caractère « & »');
    }
    expect(check(inHead('<meta name="description" content="a \\ b" />')).join('\n')).toContain('antislash');
    expect(check(inHead('<meta name="description" content="a > b" />')).join('\n')).toContain('« < » ou « > »');
    expect(check(inHead('<meta name="description" content="a \u0007 b" />')).join('\n')).toContain('caractère de contrôle U+0007');
    expect(check(inHead('<meta name="description" content="a\tb" />')).join('\n')).toContain('caractère de contrôle U+0009');
  });

  it('espaces Unicode et caractères invisibles inattendus dans une valeur : refusés (insécable permis dans un texte, jamais dans une adresse)', () => {
    for (const char of ['\u{2003}', '\u{2028}', '\u{3000}', '\u{200b}', '\u{202e}', '\u{feff}', '\u{ad}']) {
      expect(check(inHead(`<meta name="description" content="a${char}b" />`)).join('\n'), `U+${char.codePointAt(0)!.toString(16)}`).toContain('Unicode inattendu');
    }
    expect(check(inHead('<meta name="description" content="a\u{a0}b\u{202f}c" />'))).toEqual([]);
    expect(check(inHead('<link rel="icon" href="/assets/a\u{a0}b.png" />')).join('\n')).toContain('Unicode inattendu');
  });
});

describe('verify-site : balises et attributs hors liste (V3 : <base>, <form>, formaction, images, SVG, @import, url(), on…)', () => {
  const STRUCTURES: [string, string, 'head' | 'body'][] = [
    ['<base> (réécrit toutes les adresses relatives)', `<base href="${EVIL}/">`, 'head'],
    ['<base> sur une adresse du site', '<base href="/assets/">', 'head'],
    ['<base target>', '<base target="_blank">', 'head'],
    ['<form action>', `<form action="${EVIL}/"><input name="a"></form>`, 'body'],
    ['<form> sans action', '<form></form>', 'body'],
    ['formaction d’un bouton', `<form><button formaction="${EVIL}/">x</button></form>`, 'body'],
    ['<input type="image">', `<input type="image" src="${EVIL}/x.png">`, 'body'],
    ['<track> d’une vidéo', `<video><track src="${EVIL}/t.vtt"></video>`, 'body'],
    ['<frame> d’un jeu de cadres', `<frameset><frame src="${EVIL}/"></frameset>`, 'body'],
    ['<iframe>', `<iframe src="${EVIL}/"></iframe>`, 'body'],
    ['<iframe srcdoc>', `<iframe srcdoc="<script src=${EVIL}/x.js></script>"></iframe>`, 'body'],
    ['<object data>', `<object data="${EVIL}/x"></object>`, 'body'],
    ['<embed>', `<embed src="${EVIL}/x.swf">`, 'body'],
    ['<applet archive>', `<applet code="x" archive="${EVIL}/x.jar"></applet>`, 'body'],
    ['<img>', `<img src="${EVIL}/x.png" alt="">`, 'body'],
    ['<img> du site', '<img src="/assets/x.png" alt="">', 'body'],
    ['<img srcset>', `<img src="/assets/a.png" srcset="${EVIL}/x.png 2x">`, 'body'],
    ['<picture><source srcset>', `<picture><source srcset="${EVIL}/x.png"><img src="/assets/a.png"></picture>`, 'body'],
    ['<video poster>', `<video poster="${EVIL}/p.png"></video>`, 'body'],
    ['<audio>', `<audio src="${EVIL}/p.mp3"></audio>`, 'body'],
    ['<svg><use>', `<svg><use href="${EVIL}/x.svg#a"></use></svg>`, 'body'],
    ['<svg><use xlink:href>', `<svg xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="${EVIL}/x.svg#a"/></svg>`, 'body'],
    ['<svg><image>', `<svg><image href="${EVIL}/x.png"/></svg>`, 'body'],
    ['<svg> seul', '<svg viewBox="0 0 1 1"></svg>', 'body'],
    ['<style> avec @import', `<style>@import url("${EVIL}/x.css");</style>`, 'head'],
    ['<style> avec @import sans url()', `<style>@import "${EVIL}/x.css";</style>`, 'head'],
    ['<style> avec url()', `<style>body{background:url(${EVIL}/x.png)}</style>`, 'head'],
    ['<style> vide', '<style></style>', 'head'],
    ['<style> dans <body>', `<style>@import url(//evil.example/x.css);</style>`, 'body'],
    ['attribut style avec url()', `<div style="background:url(${EVIL}/x.png)"></div>`, 'body'],
    ['attribut style avec url() sans guillemets, casse mêlée', `<div style=BACKGROUND:UrL(//evil.example/x.png)></div>`, 'body'],
    ['attribut style avec @import', '<div style="@import url(//evil.example/x.css)"></div>', 'body'],
    ['attribut style avec image-set()', `<div style="background:image-set(${EVIL}/x.png 1x)"></div>`, 'body'],
    ['attribut style avec échappement CSS', '<div style="background:\\75rl(//evil.example/x.png)"></div>', 'body'],
    ['attribut ping', `<a href="/telecharger" ping="${EVIL}/p">x</a>`, 'body'],
    ['attribut background', `<table background="${EVIL}/x.png"></table>`, 'body'],
    ['attribut background sur <body>', GOOD_INDEX.replace('<body>', `<body background="${EVIL}/x.png">`), 'body'],
    ['attribut archive', `<div archive="${EVIL}/x.jar"></div>`, 'body'],
    ['attribut srcset sur un <div>', `<div srcset="${EVIL}/x.png 1x"></div>`, 'body'],
    ['attribut formaction sur un <div>', `<div formaction="${EVIL}/"></div>`, 'body'],
    ['<link rel="preload">', `<link rel="preload" href="${EVIL}/a.woff2" as="font" crossorigin>`, 'head'],
    ['<link imagesrcset>', `<link rel="preload" as="image" imagesrcset="${EVIL}/a.png 1x" href="/assets/a.png">`, 'head'],
    ['<link rel="prefetch"> du site', '<link rel="prefetch" href="/assets/a.js">', 'head'],
    ['<link rel="manifest">', '<link rel="manifest" href="/assets/m.json">', 'head'],
    ['<link rel="alternate">', `<link rel="alternate" hreflang="en" href="${SITE_ORIGIN}/en">`, 'head'],
    ['<link rel="stylesheet"> externe', `<link rel="stylesheet" href="${EVIL}/a.css">`, 'head'],
    ['<link rel="stylesheet"> en .js', '<link rel="stylesheet" href="/assets/a.js">', 'head'],
    ['<link rel="icon"> externe', `<link rel="icon" href="${EVIL}/f.ico">`, 'head'],
    ['<link rel="icon"> data: HTML', '<link rel="icon" href="data:text/html,x">', 'head'],
    ['<link rel="icon"> data: SVG avec <image>', `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cimage href='${EVIL}/x.png'/%3E%3C/svg%3E">`, 'head'],
    ['<link rel="icon"> data: SVG avec <script>', '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cscript%3E0%3C/script%3E%3C/svg%3E">', 'head'],
    ['<link rel="icon"> data: SVG avec entité', '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'%3E%3Crect fill=\'%26%23117;rl(x)\'/%3E%3C/svg%3E">', 'head'],
    ['<link rel="icon"> data: SVG avec adresse', `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Crect fill='url(${EVIL})'/%3E%3C/svg%3E">`, 'head'],
    ['<meta http-equiv="refresh">', `<meta http-equiv="refresh" content="0;url=${EVIL}/">`, 'head'],
    ['<meta http-equiv="refresh"> relatif', '<meta http-equiv="refresh" content="0;url=/x">', 'head'],
    ['<meta http-equiv="Content-Security-Policy">', '<meta http-equiv="Content-Security-Policy" content="default-src *">', 'head'],
    ['<meta og:image>', `<meta property="og:image" content="${EVIL}/i.png" />`, 'head'],
    ['<meta twitter:image>', `<meta name="twitter:image" content="${EVIL}/i.png" />`, 'head'],
    ['<meta name inconnu avec adresse', `<meta name="x-redirect" content="${EVIL}/" />`, 'head'],
    ['<meta> sans nom', `<meta content="${EVIL}/" />`, 'head'],
    ['<a> externe dans <body>', `<a href="${EVIL}/">x</a>`, 'body'],
    ['<a> du site dans <body>', '<a href="/telecharger">x</a>', 'body'],
    ['<a> externe dans <noscript>', `<noscript><a href="${EVIL}/">x</a></noscript>`, 'body'],
    ['<a> mailto dans <noscript>', '<noscript><a href="mailto:a@evil.example">x</a></noscript>', 'body'],
    ['<a> javascript: dans <noscript>', '<noscript><a href="javascript:alert(1)">x</a></noscript>', 'body'],
    ['<a> protocole relatif dans <noscript>', '<noscript><a href="//evil.example/">x</a></noscript>', 'body'],
    ['<a> sans href dans <noscript>', '<noscript><a>x</a></noscript>', 'body'],
    ['<a> imbriqué', '<noscript><a href="/a"><a href="/b">x</a></a></noscript>', 'body'],
    ['<img> dans <noscript>', `<noscript><img src="${EVIL}/x.png"></noscript>`, 'body'],
    ['<script> dans <noscript>', `<noscript><script src="${EVIL}/x.js"></script></noscript>`, 'body'],
    ['<template>', `<template><img src="${EVIL}/x.png"></template>`, 'body'],
    ['<plaintext>', `<plaintext><img src="${EVIL}/x.png">`, 'body'],
    ['<xmp>', `<xmp><img src="${EVIL}/x.png"></xmp>`, 'body'],
    ['<textarea>', `<textarea><img src="${EVIL}/x.png"></textarea>`, 'body'],
    ['<math>', '<math href="javascript:alert(1)"></math>', 'body'],
    ['<script> en importmap', `<script type="importmap">{"imports":{"a":"${EVIL}/a.js"}}</script>`, 'head'],
    ['<script> classique du site (sans type="module")', '<script src="/assets/a.js"></script>', 'head'],
    ['<script> hors /assets/', '<script type="module" src="/x.js"></script>', 'head'],
    ['<script> avec « .. »', '<script type="module" src="/assets/../x.js"></script>', 'head'],
    ['<script> async', '<script type="module" async src="/assets/a.js"></script>', 'head'],
    ['<script> avec integrity', '<script type="module" src="/assets/a.js" integrity="sha256-x"></script>', 'head'],
    ['<script> en ligne', '<script>window.x=1</script>', 'head'],
    ['<script> module en ligne', '<script type="module">import("/assets/a.js")</script>', 'head'],
    ['<script> avec src ET contenu', '<script type="module" src="/assets/a.js">window.x=1</script>', 'head'],
    ['<script> jamais refermé', '<script src="/assets/a.js">', 'head'],
    ['<div id> autre que « root »', '<div id="autre"></div>', 'body'],
    ['<div id="root"> imbriqué', '<div><div id="root"></div></div>', 'body'],
    ['<div data-*>', '<div data-x="1"></div>', 'body'],
    ['<div href>', '<div href="/x"></div>', 'body'],
    ['<span> dans <body>', '<span>x</span>', 'body'],
    ['<p> dans <body>', '<p>x</p>', 'body'],
    ['<h1> dans <body>', '<h1>x</h1>', 'body'],
    ['<title> dans <body>', '<title>x</title>', 'body'],
    ['<noscript> dans <head>', '<noscript>x</noscript>', 'head'],
    ['balise inconnue', '<blink>x</blink>', 'body'],
    ['élément personnalisé', '<x-evil src="/assets/a.js"></x-evil>', 'body'],
    ['« constructor » (nom de propriété d’objet)', '<constructor></constructor>', 'body'],
    ['« __proto__ » en attribut', '<div __proto__="x"></div>', 'body'],
    ['« toString » en attribut', '<div tostring="x" valueof="y"></div>', 'body'],
    ['attribut xlink:href sur un <div>', `<div xlink:href="${EVIL}/x"></div>`, 'body'],
  ];

  it.each(STRUCTURES)('%s : refusé', (_name, fragment, where) => {
    const html = fragment.startsWith('<!doctype') ? fragment : where === 'head' ? inHead(fragment) : inBody(fragment);
    const errors = check(html);
    expect(errors, fragment).not.toEqual([]);
    for (const error of errors) expect(error).toMatch(/^index\.html : /);
  });

  it('gestionnaires d’évènements (on…) : refusés quelle que soit la balise, la casse ou les guillemets', () => {
    const handlers = [
      GOOD_INDEX.replace('<body>', '<body onload="x()">'),
      GOOD_INDEX.replace('<html lang="fr">', '<html lang="fr" onfocus=x()>'),
      inBody('<div onclick="x()"></div>'),
      inBody('<div ONCLICK=\'x()\'></div>'),
      inBody('<div oNmOuSeOvEr=x></div>'),
      inBody('<noscript onclick="x()">x</noscript>'),
      inHead('<script type="module" src="/assets/a.js" onerror="x()"></script>'),
      inHead('<link rel="stylesheet" href="/assets/a.css" onload="x()">'),
      inHead('<meta charset="UTF-8" onclick="x()" />'),
      inBody('<svg onload="x()"></svg>'),
      inBody('<img src="/assets/a.png" onerror="x()">'),
    ];
    for (const html of handlers) {
      const errors = check(html);
      expect(errors.join('\n'), html).toMatch(/gestionnaire d'évènement « on[a-z]+ »|non autorisée/);
      expect(errors, html).not.toEqual([]);
    }
    expect(check(inBody('<div onclick="x()"></div>')).join('\n')).toContain('gestionnaire d\'évènement « onclick » interdit');
  });

  it('messages précis : fichier, ligne, balise, raison', () => {
    const base = check(inHead(`<base href="${EVIL}/">`));
    expect(base).toHaveLength(1);
    expect(base[0]).toMatch(/^index\.html : ligne \d+ : balise <base> non autorisée \(réécrirait l'adresse de toutes les ressources relatives/);
    expect(base[0]).toContain(`<base href="${EVIL}/">`);
    expect(check(inBody('<form action="/x"></form>'))[0]).toContain('balise <form> non autorisée (enverrait des données');
    expect(check(inHead('<style>x{}</style>'))[0]).toContain('feuille de style en ligne');
    expect(check(inBody('<a href="/x">x</a>'))[0]).toContain('balise <a> non autorisée dans <body>');
    expect(check(inHead(`<link rel="stylesheet" href="${EVIL}/a.css">`))[0]).toContain('ressource chargée depuis un autre domaine (attribut href');
    expect(check(inHead('<link rel="stylesheet" href="/img/a.css">'))[0]).toContain('adresse « /img/a.css » non admise');
    expect(check(inBody('<div style="background:url(x)"></div>'))[0]).toContain('attribut « style » : style : parenthèse');
    expect(check(inBody('<div data-x="1"></div>'))[0]).toContain('attribut « data-x » non autorisé sur <div>');
    expect(check(inBody('<div href="/x"></div>'))[0]).toContain('attribut d\'adresse « href » interdit sur <div>');
    expect(check(inHead('<script>x</script>'))[0]).toContain('script en ligne');
    // La ligne est celle de la balise fautive.
    const lines = GOOD_INDEX.split('\n');
    const line = lines.findIndex(text => text.includes('<link rel="canonical"')) + 1;
    const wrong = GOOD_INDEX.replace(`${SITE_ORIGIN}/" />`, 'https://evil.example/" />');
    expect(check(wrong)[0]).toContain(`ligne ${line} : le lien canonique doit être`);
  });

  it('nombre d’écarts annoncés limité (fichier piégé) : le reste est compté', () => {
    const errors = check(inBody('<img src="/a.png">'.repeat(100)));
    expect(errors.length).toBeLessThanOrEqual(21);
    expect(errors.at(-1)).toMatch(/… et \d+ autre\(s\) écart\(s\)/);
  });

  it('syntaxe piégée : un seul écart de syntaxe n’empêche pas de contrôler les autres balises', () => {
    const errors = check(inHead(`<!-- x --><script src="${EVIL}/x.js"></script><base href="${EVIL}/">`));
    expect(errors.join('\n')).toContain('commentaire HTML interdit');
    expect(errors.join('\n')).toContain('balise <base> non autorisée');
    expect(errors.join('\n')).toContain('ressource chargée depuis un autre domaine');
  });
});

describe('verify-site : mêmes charges, écrites de toutes les façons (casse, guillemets, espaces, répétitions, « > »)', () => {
  const ADDR = `${EVIL}/x.js`;
  const SCRIPTS = [
    `<SCRIPT TYPE="MODULE" SRC="${ADDR}"></SCRIPT>`,
    `<ScRiPt tYpE=module sRc=${ADDR}></sCrIpT>`,
    `<script type='module' src='${ADDR}'></script>`,
    `<script type=module src=${ADDR}></script>`,
    `<script type = "module" src = "${ADDR}" ></script >`,
    `<script\ttype="module"\nsrc="${ADDR}"\r\n></script>`,
    `<script type="module"\fsrc="${ADDR}"></script>`,
    `<script/type="module"/src="${ADDR}"></script>`,
    `<script type="module" src="${ADDR}"/>`,
    `<script type="module" src="${ADDR}" />`,
    `<script src="/assets/ok.js" src="${ADDR}" type="module"></script>`,
    `<script src="${ADDR}" src="/assets/ok.js" type="module"></script>`,
    `<script type="module" type="text/plain" src="${ADDR}"></script>`,
    `<script data-x=">" type="module" src="${ADDR}"></script>`,
    `<script data-x='>' type="module" src="${ADDR}"></script>`,
    `<script type="module" src="${ADDR}" data-x=">"></script>`,
    `<script type="module" src="${ADDR}"data-x="1"></script>`,
    `<script type="module" src="${ADDR}"\u{a0}data-x="1"></script>`,
    `<script\u{a0}type="module" src="${ADDR}"></script>`,
    `<script type="module" src=" ${ADDR}"></script>`,
    `<script type="module" src="${ADDR} "></script>`,
    `<script type="module" src="${ADDR}`,
    `<script type="module" src="${ADDR}"></script`,
    `<script type="module" src="${ADDR}"></script foo>`,
    `<script type="module" src="${ADDR}"></script/>`,
    `<script type="module" src="${ADDR}"><`,
  ];

  it.each(SCRIPTS.map((fragment, index) => [index, fragment] as const))('script externe n°%i : refusé dans <head>, <body>, <noscript> et en fin de fichier', (_index, fragment) => {
    for (const html of [
      inHead(fragment), inBody(fragment), inBody(`<noscript>${fragment}</noscript>`), `${GOOD_INDEX}${fragment}`, GOOD_INDEX.replace('<div id="root">', `<div id="root">${fragment}`),
    ]) {
      expect(check(html), html).not.toEqual([]);
    }
  });

  it('valeurs contenant « > » : la balise ne se termine pas dans la valeur (lue comme un navigateur), jamais acceptée par erreur', () => {
    const tricks = [
      `<link rel="stylesheet" title=">" href="${EVIL}/a.css">`,
      `<link rel="stylesheet" title='>' href='${EVIL}/a.css'>`,
      `<meta name="description" content="a > b"><script src="${EVIL}/x.js"></script>`,
      `<meta name="description" content='a > b'><script src='${EVIL}/x.js'></script>`,
      `<meta name="description" content="<script src=${EVIL}/x.js></script>">`,
      `<title><script src="${EVIL}/x.js"></script></title>`,
      `<link rel="canonical" href="${SITE_ORIGIN}/" title=">"><script src="${EVIL}/x.js"></script>`,
    ];
    for (const fragment of tricks) expect(check(inHead(fragment)), fragment).not.toEqual([]);
    expect(check(inHead('<meta name="description" content="a > b" />')).join('\n')).toContain('« < » ou « > »');
  });

  it('attributs répétés : refusés même quand le premier est inoffensif (le navigateur ne lit que le premier)', () => {
    const errors = check(inHead('<link rel="icon" href="/assets/a.png" href="/assets/b.png" />'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('attribut « href » répété');
    expect(check(inHead('<meta name="description" content="a" content="b" />')).join('\n')).toContain('« content » répété');
    expect(check(GOOD_INDEX.replace('<div id="root">', '<div id="root" id="root">')).join('\n')).toContain('« id » répété');
  });

  it('balises auto-fermantes : permises sur les balises vides, refusées sur les autres (un navigateur ignore « / »)', () => {
    expect(check(GOOD_INDEX.replace('<meta charset="UTF-8" />', '<meta charset="UTF-8"/>'))).toEqual([]);
    for (const html of [
      inHead('<title/>'),
      GOOD_INDEX.replace('<div id="root"></div>', '<div id="root"/>'),
      inHead('<script type="module" src="/assets/a.js"/>'),
      GOOD_INDEX.replace('<noscript>', '<noscript/>'),
      inBody('<div/>'),
    ]) expect(check(html).join('\n'), html).toContain('auto-fermeture « /> »');
  });

  it('valeur sans guillemets contenant « / » : le « / » final fait partie de la valeur (comme dans un navigateur)', () => {
    // « href=/assets/a.css/> » : l'adresse lue est « /assets/a.css/ » (refusée), pas « /assets/a.css » suivie d'un « /> ».
    expect(check(inHead('<link rel=stylesheet href=/assets/a.css/>')).join('\n')).toContain('non admise');
    expect(check(inHead('<link rel=stylesheet href=/assets/a.css />'))).toEqual([]);
    expect(check(inHead('<link rel="stylesheet" href="/assets/a.css"/>'))).toEqual([]);
  });

  it('structure : doctype, <html>, <head>, <body> une fois chacun, dans l’ordre, document complet', () => {
    const cases: [string, string, string][] = [
      ['sans doctype', GOOD_INDEX.replace('<!doctype html>\n', ''), 'doctype'],
      ['doctype d’un autre type', GOOD_INDEX.replace('<!doctype html>', '<!doctype html system "x">'), 'déclaration'],
      ['<head> en double', GOOD_INDEX.replace('</head>', '</head><head></head>'), 'balise <head> inattendue'],
      ['<body> avant <head>', GOOD_INDEX.replace('<html lang="fr">', '<html lang="fr"><body></body>'), 'balise <body> inattendue'],
      ['<body> en double', GOOD_INDEX.replace('</body>', '</body><body></body>'), 'balise <body> inattendue'],
      ['<html> en double', GOOD_INDEX.replace('<head>', '<html><head>'), 'balise <html> inattendue'],
      ['balise après </body>', GOOD_INDEX.replace('</body>', '</body><script type="module" src="/assets/a.js"></script>'), 'hors de <head> et de <body>'],
      ['balise après </html>', `${GOOD_INDEX}<div></div>`, 'hors de <head> et de <body>'],
      ['texte après </html>', `${GOOD_INDEX}texte`, 'texte inattendu'],
      ['texte dans <head>', GOOD_INDEX.replace('<head>', '<head>texte'), 'texte inattendu'],
      ['texte dans <body> hors élément', GOOD_INDEX.replace('<body>', '<body>texte'), 'texte inattendu'],
      ['balise fermante sans ouvrante', inBody('</div>'), 'balise fermante </div> inattendue'],
      ['</br>', inBody('</br>'), 'balise fermante </br> inattendue'],
      ['</p>', inBody('</p>'), 'balise fermante </p> inattendue'],
      ['balises mal imbriquées', inBody('<div><span></div></span>'), 'balise fermante </div> inattendue'],
      ['document tronqué', GOOD_INDEX.replace('</html>', ''), 'document tronqué'],
      ['document tronqué (après <body>)', GOOD_INDEX.slice(0, GOOD_INDEX.indexOf('<body>') + 6), 'document tronqué'],
      ['fichier vide', '', 'document tronqué'],
      ['sans <div id="root">', GOOD_INDEX.replace('<div id="root"></div>', ''), '0 balise(s) <div id="root">'],
      ['deux <div id="root">', GOOD_INDEX.replace('<div id="root"></div>', '<div id="root"></div><div id="root"></div>'), '2 balise(s) <div id="root">'],
      ['sans script de démarrage', GOOD_INDEX.replace('<script type="module" crossorigin src="/assets/index-abc.js"></script>', ''), 'aucun <script type="module"'],
      ['« < » isolé', inBody('<div>a < b</div>'), 'caractère « < » isolé'],
      ['balise non terminée (fin du fichier)', `${GOOD_INDEX}<div class="a" `, 'balise non terminée'],
      ['guillemet non fermé', inBody('<div class="a>x</div>'), 'guillemet non fermé'],
      ['nom de balise collé à un caractère', inBody('<div_x></div_x>'), 'nom de balise suivi d\'un caractère inattendu'],
      ['valeur manquante', inBody('<div class=></div>'), 'valeur manquante'],
      ['attributs collés', inBody('<div class="a"role="b"></div>'), 'attributs collés'],
      ['barre isolée dans la balise', inBody('<div / class="a"></div>'), 'barre « / » inattendue'],
      ['balise fermante avec attribut', inBody('<div></div x>'), 'balise fermante mal formée'],
    ];
    for (const [name, html, reason] of cases) {
      const errors = check(html);
      expect(errors.length, name).toBeGreaterThan(0);
      expect(errors.join('\n'), name).toContain(reason);
    }
  });

  it('entrée hostile : jamais d’exception, temps linéaire', () => {
    const started = performance.now();
    const hostile = [
      inBody(`<${'a'.repeat(1_000_000)}`),
      inBody(`<div ${'a=1 '.repeat(200_000)}>`),
      inHead(`<meta content="${'x'.repeat(2_000_000)}`),
      inBody(`<!--${'--!>'.repeat(100_000)}`),
      inBody('<'.repeat(500_000)),
      inBody(`<script>${'<script>'.repeat(100_000)}`),
      inBody('<span>'.repeat(50_000)),
      inHead(`<link rel="icon" href="data:image/svg+xml,${'%3Crect/%3E'.repeat(50_000)}">`),
      inHead(`<link rel="icon" href="data:image/svg+xml,${'%3Crect fill=\'a\' '.repeat(20_000)}">`),
      inBody(`<div style="${'a:b;'.repeat(300_000)}">`),
      inHead(`<meta name="description" content="${'\u{200b}'.repeat(300_000)}">`),
    ];
    for (const html of hostile) {
      let errors: string[] = [];
      expect(() => { errors = check(html); }, html.slice(0, 40)).not.toThrow();
      expect(errors, html.slice(0, 40)).not.toEqual([]);
    }
    expect(performance.now() - started).toBeLessThan(10_000);
    const big = GOOD_INDEX.replace('</body>', `${'<div class="a"></div>\n'.repeat(100_000)}</body>`);
    const t = performance.now();
    expect(check(big)).toEqual([]);
    expect(performance.now() - t).toBeLessThan(3_000);
  });

  it('noms de balises et d’attributs hérités d’Object (« constructor », « __proto__ », « tostring ») : refusés proprement', () => {
    for (const html of [inBody('<constructor><constructor></constructor></constructor>'), inBody('<div constructor="x"></div>'), inBody('<hasownproperty></hasownproperty>')]) {
      expect(check(html), html).not.toEqual([]);
    }
  });
});

describe('verify-site : adresse officielle, lien canonique et og:url (liste blanche étroite)', () => {
  const OK = `${SITE_ORIGIN}/`;
  const withCanonical = (href: string) => GOOD_INDEX.replace(CANONICAL, `<link rel="canonical" href="${href}" />`);
  const withOgUrl = (content: string) => GOOD_INDEX.replace(OG_URL, `<meta property="og:url" content="${content}" />`);

  it('SITE_ORIGIN est lue dans shared/site.ts (source unique) ; fichier sans constante : erreur claire', () => {
    expect(mod.readSiteOrigin()).toBe(SITE_ORIGIN);
    expect(SITE_ORIGIN).toBe('https://www.mag-istra.fr');
    const dir = site({ 'site.ts': "export const SITE_ORIGIN = 'https://exemple.fr';\nexport const AUTRE = 'https://autre.fr';" });
    expect(mod.readSiteOrigin(path.join(dir, 'site.ts'))).toBe('https://exemple.fr');
    const empty = site({ 'vide.ts': 'export const AUTRE = 1;' });
    expect(() => mod.readSiteOrigin(path.join(empty, 'vide.ts'))).toThrow(/SITE_ORIGIN introuvable/);
  });

  it('seule adresse https externe permise : <link rel="canonical"> et <meta property="og:url"> valant EXACTEMENT « <SITE_ORIGIN>/ »', () => {
    expect(mod.checkIndexHtml(GOOD_INDEX)).toEqual([]);
    // Ordre des attributs, guillemets, casse des noms : même balise pour le navigateur.
    for (const link of [
      `<link href="${OK}" rel="canonical">`, `<link rel='canonical' href='${OK}'>`, `<link rel=canonical href=${OK}>`, `<LINK REL="Canonical" HREF="${OK}" />`,
      `<link  rel = "canonical"\n  href = "${OK}"\n/>`,
    ]) {
      const html = GOOD_INDEX.replace(CANONICAL, link);
      expect(mod.checkIndexHtml(html), link).toEqual([]);
      expect(mod.checkSearchTags(html), link).toEqual([]);
    }
    for (const meta of [`<meta content="${OK}" property="og:url">`, `<META PROPERTY='OG:URL' CONTENT='${OK}' />`]) {
      const html = GOOD_INDEX.replace(OG_URL, meta);
      expect(mod.checkIndexHtml(html), meta).toEqual([]);
      expect(mod.checkSearchTags(html), meta).toEqual([]);
    }
  });

  it('la liste blanche suit shared/site.ts : une autre adresse officielle est refusée, même bien formée', () => {
    expect(mod.checkIndexHtml(GOOD_INDEX, { siteOrigin: 'https://www.mag-istra.fr' })).toEqual([]);
    const other = mod.checkIndexHtml(GOOD_INDEX, { siteOrigin: 'https://exemple.fr' }).join('\n');
    expect(other).toContain('le lien canonique doit être « https://exemple.fr/ »');
    expect(other).toContain('og:url doit être « https://exemple.fr/ »');
  });

  it.each([
    ['apex', 'https://mag-istra.fr/'],
    ['http', 'http://www.mag-istra.fr/'],
    ['sans barre finale', SITE_ORIGIN],
    ['chemin', `${SITE_ORIGIN}/cgu`],
    ['port', `${SITE_ORIGIN}:443/`],
    ['port 8443', `${SITE_ORIGIN}:8443/`],
    ['identifiants', 'https://user@www.mag-istra.fr/'],
    ['sous-domaine', 'https://app.www.mag-istra.fr/'],
    ['suffixe collé', 'https://www.mag-istra.fr.evil.example/'],
    ['préfixe collé', 'https://evil-www.mag-istra.fr/'],
    ['majuscules', 'https://WWW.MAG-ISTRA.FR/'],
    ['point final', 'https://www.mag-istra.fr./'],
    ['requête', `${OK}?a=1`],
    ['fragment', `${OK}#a`],
    ['protocole relatif', '//www.mag-istra.fr/'],
    ['autre domaine', 'https://evil.example/'],
    ['ancienne adresse', 'https://magistra-2.vercel.app/'],
    ['homographe (punycode)', 'https://www.xn--mag-istr-8cf.fr/'],
    ['relatif (un canonique doit être absolu)', '/'],
    ['espace de tête', ` ${OK}`],
    ['vide', ''],
  ])('lien canonique : %s refusé', (_name, href) => {
    const errors = mod.checkIndexHtml(withCanonical(href));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`le lien canonique doit être « ${OK} »`);
  });

  it.each([
    ['apex', 'https://mag-istra.fr/'], ['http', 'http://www.mag-istra.fr/'], ['sans barre finale', SITE_ORIGIN], ['chemin', `${SITE_ORIGIN}/cgu`],
    ['suffixe collé', 'https://www.mag-istra.fr.evil.example/'], ['autre domaine', 'https://evil.example/'], ['vide', ''], ['relatif', '/'],
  ])('og:url : %s refusée', (_name, content) => {
    const errors = mod.checkIndexHtml(withOgUrl(content));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`og:url doit être « ${OK} »`);
  });

  it('ressources externes : échec, même vers le domaine du site (script, feuille de style, image, cadre, préchargement, icône, média…)', () => {
    const resources = [
      '<script type="module" src="https://cdn.example/a.js"></script>',
      `<script type="module" src="${OK}a.js"></script>`,
      '<script src="//cdn.example/a.js"></script>',
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X">',
      `<link rel="stylesheet" href="${OK}a.css">`,
      '<link rel="preload" href="https://cdn.example/a.woff2" as="font" crossorigin>',
      `<link rel="preload" href="${OK}a.woff2" as="font">`,
      '<link rel="modulepreload" href="https://cdn.example/a.js">',
      '<link rel="prefetch" href="https://cdn.example/a.js">',
      '<link rel="preconnect" href="https://cdn.example">',
      '<link rel="dns-prefetch" href="//cdn.example">',
      `<link rel="icon" href="${OK}favicon.ico">`,
      `<link rel="alternate" hreflang="en" href="${OK}en">`,
      `<link rel="manifest" href="${OK}site.webmanifest">`,
      '<img src="https://tracker.example/p.gif">',
      `<img src="${OK}logo.png" alt="">`,
      '<img srcset="https://cdn.example/a.png 1x, /b.png 2x" src="/a.png">',
      '<img src="/a.png" srcset="/a.png 1x, https://cdn.example/b.png 2x">',
      '<iframe src="https://evil.example/"></iframe>',
      `<iframe src="${OK}embed"></iframe>`,
      '<source src="https://cdn.example/a.mp4">',
      '<video poster="https://cdn.example/p.jpg"></video>',
      '<audio src="https://cdn.example/a.mp3"></audio>',
      '<embed src="https://cdn.example/a.swf">',
      '<object data="https://cdn.example/a.pdf"></object>',
    ];
    for (const html of resources) {
      const errors = mod.checkIndexHtml(inHead(html));
      expect(errors, html).toHaveLength(1);
    }
    // Script, feuille de style, préchargement de module et icône : l'adresse est celle jugée, le message le dit.
    for (const html of [resources[0], resources[1], resources[2], resources[3], resources[4], resources[7], resources[11]]) {
      expect(mod.checkIndexHtml(inHead(html))[0], html).toContain('ressource chargée depuis un autre domaine');
    }
  });

  it('balise canonique détournée : un autre « rel », une ressource ajoutée à la balise, ou une adresse cachée dans une valeur', () => {
    const tricks = [
      `<link rel="canonical stylesheet" href="${OK}">`,
      `<link rel="stylesheet canonical" href="${OK}">`,
      `<link rel="canonical" href="${OK}" src="https://cdn.example/a.js">`,
      `<link rel="canonical" href="${OK}" srcset="https://cdn.example/a.png 1x">`,
      '<link title=">" rel="stylesheet" href="https://evil.example/a.css">',
      `<link title='rel="canonical"' rel="stylesheet" href="${OK}a.css">`,
      `<link data-note="rel=canonical" rel="preload" href="${OK}a.js" as="script">`,
      '<link rel="stylesheet" href="\\\\evil.example/a.css">',
      '<link rel="stylesheet" href="/\\evil.example/a.css">',
      '<link rel="stylesheet" href="ht\ntps://evil.example/a.css">',
      '<link rel="stylesheet" href=" https://evil.example/a.css">',
      '<link rel="stylesheet" href="&#104;ttps://evil.example/a.css">',
      '<link rel="stylesheet" href="&#x68;ttps://evil.example/a.css">',
      '<link rel="stylesheet" href="HTTPS://EVIL.EXAMPLE/A.CSS">',
      '<link rel="stylesheet" href="ftp://evil.example/a.css">',
      `<link rel="canonical" rel="stylesheet" href="${OK}">`,
      '<link rel="can&#x6f;nical" href="https://evil.example/">',
    ];
    for (const html of tricks) expect(mod.checkIndexHtml(inHead(html)), html).not.toEqual([]);
  });

  it('autres balises <meta> : adresse d’image ou redirection automatique refusées ; texte ordinaire permis', () => {
    for (const meta of [
      '<meta property="og:image" content="https://cdn.example/a.png" />',
      `<meta property="og:image" content="${OK}a.png" />`,
      '<meta name="twitter:image" content="https://cdn.example/a.png" />',
      '<meta property="og:video" content="//cdn.example/a.mp4" />',
      '<meta name="msapplication-TileImage" content="https://cdn.example/t.png" />',
      '<meta http-equiv="refresh" content="0;url=https://evil.example/" />',
      '<meta http-equiv="Refresh" content="5" />',
    ]) {
      const errors = mod.checkIndexHtml(inHead(meta));
      expect(errors, meta).toHaveLength(1);
    }
    expect(mod.checkIndexHtml(inHead('<meta http-equiv="refresh" content="5" />'))[0]).toContain('redirection automatique');
    for (const content of ['https://cdn.example/a', '//cdn.example/a', ' https://cdn.example/a', 'javascript:alert(1)', 'mailto:a@evil.example', 'data:text/html,x']) {
      const errors = mod.checkIndexHtml(inHead(`<meta name="description" content="${content}" />`));
      expect(errors, content).toHaveLength(1);
      expect(errors[0], content).toContain('adresse d\'un autre domaine dans une balise <meta> autre que og:url');
    }
    for (const meta of [
      '<meta name="description" content="Voir https://futurai.space pour le projet." />', '<meta property="og:type" content="website" />',
      '<meta property="og:site_name" content="Magistra" />', '<meta property="og:locale" content="fr_FR" />', '<meta name="viewport" content="width=device-width" />',
    ]) {
      expect(mod.checkIndexHtml(inHead(meta)), meta).toEqual([]);
    }
  });

  it('exactement un lien canonique et une adresse og:url (verifySite) : absents ou en double, échec', () => {
    const noCanonical = GOOD_INDEX.replace(CANONICAL, '');
    expect(mod.checkSearchTags(noCanonical).join('\n')).toContain('0 lien(s) canonique(s)');
    expect(mod.verifySite(site({ ...GOOD, 'index.html': noCanonical })).join('\n')).toContain('un seul <link rel="canonical"> est attendu');
    expect(mod.verifySite(site({ ...GOOD, 'index.html': GOOD_INDEX.replace(CANONICAL, CANONICAL + CANONICAL) })).join('\n')).toContain('2 lien(s) canonique(s)');
    expect(mod.verifySite(site({ ...GOOD, 'index.html': GOOD_INDEX.replace(OG_URL, '') })).join('\n')).toContain('0 balise(s) <meta property="og:url">');
    expect(mod.verifySite(site({ ...GOOD, 'index.html': GOOD_INDEX.replace(OG_URL, OG_URL + OG_URL) })).join('\n')).toContain('2 balise(s) <meta property="og:url">');
  });

  it('verifySite et la ligne de commande : canonique d’un autre domaine, ressource externe ajoutée à côté d’un canonique correct', () => {
    const wrong = GOOD_INDEX.replace(`${SITE_ORIGIN}/" />`, 'https://evil.example/" />');
    expect(mod.verifySite(site({ ...GOOD, 'index.html': wrong })).join('\n')).toContain('le lien canonique doit être');
    const { code, err } = run(site({ ...GOOD, 'index.html': wrong }));
    expect(code).toBe(1);
    expect(err).toMatch(/::error title=Site vitrine::index\.html : ligne \d+ : le lien canonique doit être/);
    const withCdn = GOOD_INDEX.replace('</head>', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X"></head>');
    const errors = mod.verifySite(site({ ...GOOD, 'index.html': withCdn }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('ressource chargée depuis un autre domaine');
    expect(run(site({ ...GOOD, 'index.html': withCdn })).code).toBe(1);
  });

  it('adresse officielle passée à verifySite : un site d’un autre domaine passe avec SA adresse, échoue avec celle-ci', () => {
    const other = 'https://exemple.fr';
    const files = {
      ...GOOD,
      'index.html': GOOD_INDEX.replaceAll(SITE_ORIGIN, other),
      'robots.txt': buildRobotsTxt().replaceAll(SITE_ORIGIN, other),
      'sitemap.xml': buildSitemapXml().replaceAll(SITE_ORIGIN, other),
    };
    expect(mod.verifySite(site(files), { siteOrigin: other })).toEqual([]);
    expect(mod.verifySite(site(files)).length).toBeGreaterThanOrEqual(4);
  });
});

describe('verify-site : robots.txt et sitemap.xml', () => {
  const without = (name: string) => Object.fromEntries(Object.entries(GOOD).filter(([key]) => key !== name));

  it('publiés par le build : présents, conformes (les fichiers produits par shared/site.ts passent)', () => {
    expect(mod.verifySite(site(GOOD))).toEqual([]);
    expect(mod.checkSearchFiles([{ name: 'robots.txt', text: buildRobotsTxt() }, { name: 'sitemap.xml', text: buildSitemapXml() }])).toEqual([]);
  });

  it('absents : échec', () => {
    expect(mod.verifySite(site(without('robots.txt'))).join('\n')).toContain('robots.txt absent');
    expect(mod.verifySite(site(without('sitemap.xml'))).join('\n')).toContain('sitemap.xml absent');
    const { code, err } = run(site(without('sitemap.xml')));
    expect(code).toBe(1);
    expect(err).toContain('::error title=Site vitrine::sitemap.xml absent');
  });

  it('<meta name="robots"> (ou keywords, application-name) : refusé, le gabarit n\'en a pas (une désindexation contredirait le canonique et le plan du site)', () => {
    for (const name of ['robots', 'keywords', 'application-name']) {
      const page = GOOD_INDEX.replace('</head>', `<meta name="${name}" content="noindex, nofollow" /></head>`);
      expect(check(page).join('\n'), name).toContain(`name « ${name} » non autorisé`);
    }
  });

  it('robots.txt : plan du site à une autre adresse, absent ou « Disallow: / » : échec', () => {
    const robots = (text: string) => mod.verifySite(site({ ...GOOD, 'robots.txt': text })).join('\n');
    expect(robots('User-agent: *\nAllow: /\n')).toContain('« Sitemap: https://www.mag-istra.fr/sitemap.xml » attendu');
    expect(robots('User-agent: *\nAllow: /\nSitemap: https://evil.example/sitemap.xml\n')).toContain('attendu');
    expect(robots('User-agent: *\nAllow: /\nSitemap: https://magistra-2.vercel.app/sitemap.xml\n')).toContain('attendu');
    expect(robots(`User-agent: *\nAllow: /\nSitemap: ${SITE_ORIGIN}/sitemap.xml\nSitemap: https://evil.example/s.xml\n`)).toContain('attendu');
    expect(robots(`User-agent: *\nDisallow: /\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`)).toContain('« Disallow: / »');
    // « Disallow: » vide n'interdit rien, mais le fichier doit rester celui que produit le build.
    expect(robots(`User-agent: *\nDisallow:\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`)).toContain('différent du fichier produit par le build');
    expect(robots(`User-agent: *\nDisallow: /api/\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`)).toContain('« Disallow » non vide');
    expect(robots(`User-agent: *\nDisallow: /*\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`)).toContain('« Disallow » non vide');
    // Tout autre contenu que le fichier produit par le build est refusé.
    expect(robots(`${buildRobotsTxt()}# ajout\n`)).toContain('différent du fichier produit par le build');
  });

  it('sitemap.xml : adresse d’un autre domaine, vide ou sans <loc> : échec', () => {
    const sitemap = (text: string) => mod.verifySite(site({ ...GOOD, 'sitemap.xml': text })).join('\n');
    expect(sitemap(buildSitemapXml().replace(`${SITE_ORIGIN}/`, 'https://evil.example/'))).toContain('n\'est pas une page canonique indexable');
    expect(sitemap(buildSitemapXml().replace(`${SITE_ORIGIN}/`, 'http://www.mag-istra.fr/'))).toContain('n\'est pas une page canonique indexable');
    expect(sitemap(buildSitemapXml().replace(`${SITE_ORIGIN}/`, 'https://www.mag-istra.fr.evil.example/'))).toContain('n\'est pas une page canonique indexable');
    // <loc> écrit autrement, commentaire, CDATA, adresse ajoutée : jamais lu comme « l'accueil seul ».
    expect(sitemap(buildSitemapXml().replace('<loc>', '<loc xml:space="preserve">'))).not.toBe('');
    expect(sitemap(buildSitemapXml().replace('</urlset>', '<url><s:loc>https://www.mag-istra.fr/cgu</s:loc></url></urlset>'))).not.toBe('');
    expect(sitemap(buildSitemapXml().replace('</urlset>', '<!-- <loc>https://www.mag-istra.fr/cgu</loc> --></urlset>'))).not.toBe('');
    expect(sitemap(buildSitemapXml().replace('</urlset>', `<url><loc>${SITE_ORIGIN}/cgu</loc></url></urlset>`))).toContain('n\'est pas une page canonique indexable');
    // Lecture linéaire : un <loc> suivi de milliers d'espaces sans fermeture ne bloque pas le contrôle.
    const started = Date.now();
    expect(sitemap(`<loc>${' '.repeat(60_000)}`)).not.toBe('');
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(sitemap(buildSitemapXml().replace(`${SITE_ORIGIN}/`, 'https://mag-istra.fr/'))).toContain('n\'est pas une page canonique indexable');
    expect(sitemap(buildSitemapXml().replace(`${SITE_ORIGIN}/`, SITE_ORIGIN))).toContain('n\'est pas une page canonique indexable');
    expect(sitemap('<urlset></urlset>')).toContain('aucune adresse <loc>');
    expect(sitemap('')).toContain('aucune adresse <loc>');
  });

  it('sitemap.xml : accueil, hub et guides indexables ; pages légales, téléchargements et doublons refusés', () => {
    expect(buildSitemapXml().match(/<loc>/g)).toHaveLength(SITE_PATHS.length);
    const sitemap = (text: string) => mod.verifySite(site({ ...GOOD, 'sitemap.xml': text })).join('\n');
    const addLocation = (page: string) => buildSitemapXml().replace('</urlset>', `  <url>\n    <loc>${SITE_ORIGIN}${page}</loc>\n  </url>\n</urlset>`);
    for (const page of ['/mentions-legales', '/confidentialite', '/cgu', '/telecharger', '/index.html']) {
      expect(sitemap(addLocation(page)), page).toContain(`« ${SITE_ORIGIN}${page} » n'est pas une page canonique indexable`);
    }
    // Les trois pages légales de l'ancien plan du site.
    const legacy = buildSitemapXml().replace('</urlset>', ['/mentions-legales', '/confidentialite', '/cgu'].map(page => `  <url>\n    <loc>${SITE_ORIGIN}${page}</loc>\n  </url>\n`).join('') + '</urlset>');
    expect(mod.verifySite(site({ ...GOOD, 'sitemap.xml': legacy })).filter(error => error.startsWith('sitemap.xml'))).toHaveLength(3);
    // Une entrée en double n'est pas une page de plus : un seul « <loc> » est attendu.
    expect(sitemap(addLocation('/'))).toContain('listé 2 fois');
    for (const page of ['/guides', SITE_PATHS[2]]) {
      const missing = buildSitemapXml().replace(`  <url>\n    <loc>${SITE_ORIGIN}${page}</loc>\n  </url>\n`, '');
      expect(sitemap(missing)).toContain(`page indexable absente : ${SITE_ORIGIN}${page}`);
    }
  });

  it('robots.txt et sitemap.xml sont lus comme du texte : un mot interdit y est aussi signalé', () => {
    const errors = mod.verifySite(site({ ...GOOD, 'robots.txt': `${buildRobotsTxt()}# clerk\n` }));
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.every(error => error.includes('robots.txt'))).toBe(true);
    expect(errors.some(error => error.includes('« clerk »'))).toBe(true);
  });
});

describe('verify-site : sourcemaps', () => {
  it('un fichier .map publié : échec, où qu’il soit', () => {
    expect(mod.checkNoSourceMaps(['index.html', 'assets/a.js', 'assets/a.js.map'])).toEqual([expect.stringContaining('assets/a.js.map')]);
    const dir = site({ ...GOOD, 'assets/index-abc.js.map': '{"version":3}' });
    expect(mod.verifySite(dir).join('\n')).toContain('sourcemap');
    expect(run(dir).code).toBe(1);
  });

  it('plusieurs écarts : tous sont annoncés (une annotation ::error par écart)', () => {
    const dir = site({ ...GOOD, 'assets/index-abc.js': 'clerk;47831', 'assets/index-abc.js.map': '{}' });
    const { code, err } = run(dir);
    expect(code).toBe(1);
    expect(err.match(/::error title=Site vitrine::/g)).toHaveLength(3);
    expect(err).toContain('3 écart(s)');
  });
});
