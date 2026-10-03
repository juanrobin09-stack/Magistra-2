// scripts/verify-site.mjs : inspection du build du site vitrine (dist-site/) lancée par la CI. Dossiers synthétiques ;
// aucun build, aucun navigateur.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildRobotsTxt, buildSitemapXml, SITE_ORIGIN } from '../../shared/site';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'scripts', 'verify-site.mjs');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'magistra-verify-site-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

type Mod = {
  FORBIDDEN_TEXTS: [string, string][];
  readSiteOrigin(file?: string): string;
  verifySite(dir: string, options?: { siteOrigin?: string }): string[];
  checkIndexHtml(html: string, options?: { siteOrigin?: string }): string[];
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

describe('verify-site : index.html', () => {
  it('script en ligne : échec', () => {
    const errors = mod.checkIndexHtml(`${GOOD_INDEX}<script>window.x=1</script>`);
    expect(errors.join('\n')).toContain('script en ligne');
    const dir = site({ ...GOOD, 'index.html': GOOD_INDEX.replace('</body>', '<script>alert(1)</script></body>') });
    const { code, err } = run(dir);
    expect(code).toBe(1);
    expect(err).toContain('script en ligne');
  });

  it('script de type module sans « src » ou avec du contenu : échec ; avec « src » et vide : permis', () => {
    expect(mod.checkIndexHtml('<script type="module">import "/a.js"</script>')).not.toEqual([]);
    expect(mod.checkIndexHtml('<script type="application/ld+json">{"a":1}</script>')).not.toEqual([]);
    expect(mod.checkIndexHtml('<script type="module" src="/a.js">code()</script>')).not.toEqual([]);
    expect(mod.checkIndexHtml('<script type="module" src="/a.js"></script>')).toEqual([]);
    expect(mod.checkIndexHtml('<SCRIPT>x()</SCRIPT>')).not.toEqual([]);
  });

  it('balise <script> jamais refermée : échec', () => {
    expect(mod.checkIndexHtml('<script src="/a.js"></script><script>x()')).not.toEqual([]);
  });

  it('ressource chargée depuis un autre domaine : échec (script, feuille de style, image)', () => {
    expect(mod.checkIndexHtml('<script type="module" src="https://cdn.example/a.js"></script>')).not.toEqual([]);
    expect(mod.checkIndexHtml('<script type="module" src="//cdn.example/a.js"></script>')).not.toEqual([]);
    expect(mod.checkIndexHtml('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X">')).not.toEqual([]);
    expect(mod.checkIndexHtml('<img src="http://tracker.example/p.gif">')).not.toEqual([]);
  });

  it('adresse de données dans une icône (« data: » contenant http://www.w3.org) et liens du site : permis', () => {
    expect(mod.checkIndexHtml(GOOD_INDEX)).toEqual([]);
    expect(mod.checkIndexHtml('<a href="https://futurai.space">FutureAI</a><link rel="icon" href="/favicon.svg">')).toEqual([]);
  });
});

describe('verify-site : adresse officielle, lien canonique et og:url (liste blanche étroite)', () => {
  const OK = `${SITE_ORIGIN}/`;
  /** Fragment <head> : la seule exception admise, puis ce que le test essaie de faire passer. */
  const head = (extra: string) => `${CANONICAL}${OG_URL}${extra}`;

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
    expect(mod.checkIndexHtml(head(''))).toEqual([]);
    // Ordre des attributs, guillemets, casse des noms : même balise pour le navigateur.
    for (const link of [
      `<link href="${OK}" rel="canonical">`, `<link rel='canonical' href='${OK}'>`, `<link rel=canonical href=${OK}>`, `<LINK REL="Canonical" HREF="${OK}" />`,
      `<link  rel = "canonical"\n  href = "${OK}"\n/>`,
    ]) {
      expect(mod.checkIndexHtml(`${link}${OG_URL}`), link).toEqual([]);
      expect(mod.checkSearchTags(`${link}${OG_URL}`), link).toEqual([]);
    }
    for (const meta of [`<meta content="${OK}" property="og:url">`, `<META PROPERTY='OG:URL' CONTENT='${OK}' />`]) {
      expect(mod.checkIndexHtml(`${CANONICAL}${meta}`), meta).toEqual([]);
    }
  });

  it('la liste blanche suit shared/site.ts : une autre adresse officielle est refusée, même bien formée', () => {
    expect(mod.checkIndexHtml(CANONICAL, { siteOrigin: 'https://www.mag-istra.fr' })).toEqual([]);
    expect(mod.checkIndexHtml(CANONICAL, { siteOrigin: 'https://exemple.fr' }).join('\n')).toContain('le lien canonique doit être « https://exemple.fr/ »');
    expect(mod.checkIndexHtml(OG_URL, { siteOrigin: 'https://exemple.fr' }).join('\n')).toContain('og:url doit être « https://exemple.fr/ »');
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
    ['vide', ''],
  ])('lien canonique : %s refusé', (_name, href) => {
    const errors = mod.checkIndexHtml(`<link rel="canonical" href="${href}" />`);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`le lien canonique doit être « ${OK} »`);
  });

  it.each([
    ['apex', 'https://mag-istra.fr/'], ['http', 'http://www.mag-istra.fr/'], ['sans barre finale', SITE_ORIGIN], ['chemin', `${SITE_ORIGIN}/cgu`],
    ['suffixe collé', 'https://www.mag-istra.fr.evil.example/'], ['autre domaine', 'https://evil.example/'], ['vide', ''], ['relatif', '/'],
  ])('og:url : %s refusée', (_name, content) => {
    const errors = mod.checkIndexHtml(`<meta property="og:url" content="${content}" />`);
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
      const errors = mod.checkIndexHtml(head(html));
      expect(errors, html).toHaveLength(1);
      expect(errors[0], html).toContain('ressource chargée depuis un autre domaine');
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
    ];
    for (const html of tricks) expect(mod.checkIndexHtml(head(html)), html).not.toEqual([]);
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
      const errors = mod.checkIndexHtml(head(meta));
      expect(errors, meta).toHaveLength(1);
    }
    for (const meta of [
      '<meta name="description" content="Voir https://futurai.space pour le projet." />', '<meta property="og:type" content="website" />',
      '<meta property="og:site_name" content="Magistra" />', '<meta property="og:locale" content="fr_FR" />', '<meta name="viewport" content="width=device-width" />',
    ]) {
      expect(mod.checkIndexHtml(head(meta)), meta).toEqual([]);
    }
  });

  it('une balise en commentaire est sans effet : ni refusée, ni comptée', () => {
    expect(mod.checkIndexHtml(head('<!-- <script src="https://cdn.example/a.js"></script><link rel="stylesheet" href="https://cdn.example/a.css"> -->'))).toEqual([]);
    expect(mod.checkSearchTags(`<!-- ${CANONICAL}${OG_URL} -->`)).toHaveLength(2);
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
    expect(err).toContain('::error title=Site vitrine::index.html : le lien canonique doit être');
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

  it('robots.txt : plan du site à une autre adresse, absent ou « Disallow: / » : échec', () => {
    const robots = (text: string) => mod.verifySite(site({ ...GOOD, 'robots.txt': text })).join('\n');
    expect(robots('User-agent: *\nAllow: /\n')).toContain('« Sitemap: https://www.mag-istra.fr/sitemap.xml » attendu');
    expect(robots('User-agent: *\nAllow: /\nSitemap: https://evil.example/sitemap.xml\n')).toContain('attendu');
    expect(robots('User-agent: *\nAllow: /\nSitemap: https://magistra-2.vercel.app/sitemap.xml\n')).toContain('attendu');
    expect(robots(`User-agent: *\nAllow: /\nSitemap: ${SITE_ORIGIN}/sitemap.xml\nSitemap: https://evil.example/s.xml\n`)).toContain('attendu');
    expect(robots(`User-agent: *\nDisallow: /\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`)).toContain('« Disallow: / »');
    expect(robots(`User-agent: *\nDisallow:\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`)).toBe('');
    expect(robots(`User-agent: *\nDisallow: /api/\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`)).toBe('');
  });

  it('sitemap.xml : adresse d’un autre domaine, vide ou sans <loc> : échec', () => {
    const sitemap = (text: string) => mod.verifySite(site({ ...GOOD, 'sitemap.xml': text })).join('\n');
    expect(sitemap(buildSitemapXml().replace(`${SITE_ORIGIN}/cgu`, 'https://evil.example/cgu'))).toContain('n\'est pas une adresse de https://www.mag-istra.fr');
    expect(sitemap(buildSitemapXml().replace(`${SITE_ORIGIN}/`, 'http://www.mag-istra.fr/'))).toContain('n\'est pas une adresse');
    expect(sitemap(buildSitemapXml().replace(`${SITE_ORIGIN}/`, 'https://www.mag-istra.fr.evil.example/'))).toContain('n\'est pas une adresse');
    expect(sitemap(buildSitemapXml().replace(`${SITE_ORIGIN}/`, 'https://mag-istra.fr/'))).toContain('n\'est pas une adresse');
    expect(sitemap('<urlset></urlset>')).toContain('aucune adresse <loc>');
    expect(sitemap('')).toContain('aucune adresse <loc>');
  });

  it('robots.txt et sitemap.xml sont lus comme du texte : un mot interdit y est aussi signalé', () => {
    const errors = mod.verifySite(site({ ...GOOD, 'robots.txt': `${buildRobotsTxt()}# clerk\n` }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('robots.txt');
    expect(errors[0]).toContain('« clerk »');
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
