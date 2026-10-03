// scripts/verify-site.mjs : inspection du build du site vitrine (dist-site/) lancée par la CI. Dossiers synthétiques ;
// aucun build, aucun navigateur.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'scripts', 'verify-site.mjs');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'magistra-verify-site-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

type Mod = {
  FORBIDDEN_TEXTS: [string, string][];
  verifySite(dir: string): string[];
  checkIndexHtml(html: string): string[];
  checkForbiddenContent(files: { name: string; text: string }[]): string[];
  checkNoSourceMaps(names: string[]): string[];
};
const mod = (await import(pathToFileURL(script).href)) as Mod;

const GOOD_INDEX = `<!doctype html>
<html lang="fr"><head><meta charset="UTF-8" /><title>Magistra</title>
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

const GOOD = { 'index.html': GOOD_INDEX, 'assets/index-abc.js': GOOD_JS, 'assets/index-abc.css': GOOD_CSS, 'assets/font.woff2': Buffer.from([0, 1, 2, 3]) };

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
