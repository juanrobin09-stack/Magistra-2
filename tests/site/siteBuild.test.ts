// Construction et test de bout en bout du site vitrine : scripts npm, configuration Vite dédiée, pages d'entrée, projet
// Playwright « site » (port 4174, aperçu de dist-site/). Le contrat avec la CI et vercel.json : « build:site » produit
// dist-site/index.html, « verify:site » le contrôle, le projet « site » le teste.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import playwrightConfig from '../../playwright.config';
import { E2E_OUTPUT_DIRS, requestedProjects } from '../../e2e/outputDirs';
import { APP_TITLE } from '@/hooks/useDocumentTitle';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
/** Code sans commentaires (les commentaires expliquent ce que le fichier n'importe pas). */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('Scripts npm du site vitrine', () => {
  it('build:site, preview:site et verify:site', () => {
    expect(pkg.scripts['build:site']).toBe('tsc -b && vite build --config vite.site.config.ts');
    expect(pkg.scripts['preview:site']).toBe('vite preview --config vite.site.config.ts --port 4174 --strictPort --host 127.0.0.1');
    expect(pkg.scripts['verify:site']).toBe('node scripts/verify-site.mjs');
  });

  it('le build de l’application (utilisé par Electron) est inchangé', () => {
    expect(pkg.scripts.build).toBe('tsc -b && vite build');
    expect(pkg.scripts.preview).toBe('vite preview');
    const app = read('vite.config.ts');
    expect(app).toContain("outDir: 'dist'");
    expect(app).toContain('magistraDevApi(env)');
    expect(app).not.toMatch(/vite\.site|dist-site|site\/index\.html/);
  });
});

describe('vite.site.config.ts', () => {
  const config = read('vite.site.config.ts');

  it('mêmes plugins React et Tailwind et mêmes alias que l’application, sans l’API de développement', () => {
    expect(config).toContain('react()');
    expect(config).toContain('tailwindcss()');
    expect(config).toContain("'@': path.resolve(root, 'src')");
    expect(config).toContain("'@shared': path.resolve(root, 'shared')");
    expect(code(config)).not.toMatch(/magistraDevApi|viteDevApi|server\//);
    expect(read('vite.config.ts')).toContain("'@': path.resolve(root, 'src')");
    expect(read('vite.config.ts')).toContain("'@shared': path.resolve(root, 'shared')");
  });

  it('sortie dist-site/ (index.html à la racine), aucune sourcemap, point d’entrée site/index.html', () => {
    expect(config).toContain("outDir: 'dist-site'");
    expect(config).toContain('sourcemap: false');
    expect(config).toContain("const SITE_ENTRY = 'site/index.html'");
    expect(config).toContain("page.fileName = 'index.html'");
  });

  it('seules les variables d’identité publiques (VITE_LEGAL_*, VITE_AUTHOR_*) atteignent le site : jamais une clé de connexion', () => {
    expect(config).toContain("envPrefix: ['VITE_LEGAL_', 'VITE_AUTHOR_']");
    expect(code(config)).not.toMatch(/CLERK/i);
  });

  it('le dossier de sortie et les fichiers du site sont couverts par TypeScript', () => {
    const node = JSON.parse(read('tsconfig.node.json')) as { include: string[] };
    expect(node.include).toContain('vite.site.config.ts');
    const app = JSON.parse(read('tsconfig.app.json')) as { include: string[] };
    expect(app.include).toContain('src');
  });
});

describe('Pages d’entrée', () => {
  const site = read('site/index.html');

  it('site/index.html : titre et description de vitrine, auteur, noscript, même squelette de chargement', () => {
    expect(site).toContain(`<title>${APP_TITLE}</title>`);
    expect(site).toMatch(/<meta name="description" content="Magistra, l'application Windows gratuite[^"]*Juan Robin[^"]*FutureAI\." \/>/);
    expect(site).toContain('<meta name="author" content="Juan Robin" />');
    expect(site).toMatch(/<noscript>[^<]*JavaScript[^<]*<a href="\/telecharger">/);
    const app = read('index.html');
    const skeleton = (html: string) => /<div id="root">[\s\S]*?<\/div><\/div>/.exec(html)?.[0];
    expect(skeleton(site)).toBeDefined();
    expect(skeleton(site)).toBe(skeleton(app));
  });

  it('site/index.html : un seul script, externe, qui démarre le site vitrine (aucun script en ligne)', () => {
    expect([...site.matchAll(/<script\b[^>]*>/g)].map(m => m[0])).toEqual(['<script type="module" src="../src/site/main.tsx">']);
    expect(site).not.toMatch(/<script>[\s\S]*?\S[\s\S]*?<\/script>/);
    expect(site).not.toMatch(/src\/main\.tsx/);
  });

  it('index.html de l’application : l’auteur est déclaré, rien d’autre n’a changé', () => {
    const app = read('index.html');
    expect(app).toContain('<meta name="author" content="Juan Robin" />');
    expect(app).toContain('<script type="module" src="/src/main.tsx"></script>');
  });

  it('src/site/main.tsx : démarrage direct, ni découverte du mode, ni pont, ni code d’accès', () => {
    const main = read('src/site/main.tsx');
    expect(main).toContain('SiteApp');
    expect(main).not.toMatch(/discoverRuntimeConfig|getBridge|captureAccessFromUrl|RuntimeProvider|Clerk|setRuntimeConfig|fetch\(/);
  });
});

describe('Projet Playwright « site »', () => {
  const projects = playwrightConfig.projects ?? [];
  const project = projects.find(p => p.name === 'site');

  it('projet « site » : fichiers e2e/site-*.spec.ts, port 4174, dossier de sortie à lui', () => {
    expect(project).toBeDefined();
    expect(project!.testMatch).toEqual(/site-.*\.spec\.ts/);
    expect(project!.use?.baseURL).toBe('http://127.0.0.1:4174');
    expect(project!.outputDir).toBe(E2E_OUTPUT_DIRS.site);
    expect(E2E_OUTPUT_DIRS.site).toBe('test-results/site');
    expect(new Set(projects.map(p => p.outputDir)).size).toBe(projects.length);
  });

  it('les projets existants gardent leurs fichiers : aucun fichier E2E n’appartient à deux projets', () => {
    for (const spec of ['web-demo.spec.ts', 'web-mobile.spec.ts', 'electron-local.spec.ts', 'connector-local.spec.ts', 'site-vitrine.spec.ts']) {
      const owners = projects.filter(p => p.testMatch instanceof RegExp && p.testMatch.test(path.join(root, 'e2e', spec))).map(p => p.name);
      expect(owners.length, spec).toBeGreaterThanOrEqual(1);
      if (!spec.startsWith('connector-')) expect(owners, spec).toHaveLength(1);
    }
    expect(projects.filter(p => p.testMatch instanceof RegExp && p.testMatch.test(path.join(root, 'e2e', 'site-vitrine.spec.ts'))).map(p => p.name)).toEqual(['site']);
  });

  it('serveurs d’aperçu : le site sert dist-site/ (vite preview, port 4174, strictPort) ; l’application garde le port 4173', () => {
    const servers = [playwrightConfig.webServer].flat().filter((s): s is NonNullable<typeof s> => Boolean(s));
    const commands = servers.map(s => s.command);
    // Lancement sans --project (ici : vitest) : tous les projets, donc les deux serveurs.
    expect(commands).toContain('npx vite preview --port 4173 --strictPort --host 127.0.0.1');
    expect(commands).toContain('npx vite preview --config vite.site.config.ts --port 4174 --strictPort --host 127.0.0.1');
    expect(servers.find(s => s.command.includes('4174'))?.url).toBe('http://127.0.0.1:4174');
  });
});

describe('requestedProjects : seuls les serveurs nécessaires démarrent', () => {
  it('--project=site, --project site, plusieurs projets', () => {
    expect(requestedProjects(['node', 'playwright', 'test', '--project=site'])).toEqual(['site']);
    expect(requestedProjects(['node', 'playwright', 'test', '--project', 'site'])).toEqual(['site']);
    expect(requestedProjects(['x', 'test', '--project', 'site', 'web', '--workers=1'])).toEqual(['site', 'web']);
    expect(requestedProjects(['x', 'test', '--project=web', '--project=electron'])).toEqual(['web', 'electron']);
  });

  it('aucun --project, nom inconnu ou motif : tous les projets sont supposés lancés', () => {
    expect(requestedProjects(['x', 'test'])).toBeNull();
    expect(requestedProjects(['x', 'test', '--project=inconnu'])).toBeNull();
    expect(requestedProjects(['x', 'test', '--project=conn*'])).toBeNull();
    expect(requestedProjects(['x', 'test', '--project=site', '--project=inconnu'])).toBeNull();
    expect(requestedProjects(['x', 'test', '--project'])).toBeNull();
  });
});
