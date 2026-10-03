// Le site vitrine n'embarque rien de l'application : graphe d'imports (valeurs seulement, les types sont effacés) du
// point d'entrée du site, de LandingContent (accueil partagé) et du panneau de téléchargement. Aucun service de
// connexion, aucun connecteur local, aucun fournisseur d'exécution, aucun export ni lecteur de PDF. Le contrôle du
// résultat construit est celui de scripts/verify-site.mjs ; celui-ci échoue dès l'import fautif, sans construire.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OPEN_APP_URL } from '@shared/localConnector';
import { OPEN_APP_HREF } from '@/components/localEngine/windowsTexts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** Spécificateurs des imports qui laissent une trace à l'exécution (pas `import type`, pas `{ type A }` seul). */
function valueImports(code: string): string[] {
  const text = stripComments(code);
  const specs: string[] = [];
  for (const match of text.matchAll(/\b(?:import|export)\s+(type\s+)?([\w*{}\s,$]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
    const [, isType, clause, spec] = match;
    if (isType) continue;
    const named = /^\s*\{([\s\S]*)\}\s*$/.exec(clause)?.[1];
    if (named !== undefined && named.split(',').map(s => s.trim()).filter(Boolean).every(s => s.startsWith('type '))) continue;
    specs.push(spec);
  }
  for (const match of text.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) specs.push(match[1]);
  for (const match of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(match[1]);
  return specs;
}

function resolveFile(base: string): string | null {
  const bare = base.replace(/\.js$/, '');
  for (const candidate of [base, `${bare}.ts`, `${bare}.tsx`, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(candidate) && /\.(?:ts|tsx|css|mjs)$/.test(candidate)) return candidate;
  }
  return null;
}

interface Graph {
  /** Fichiers du dépôt atteints (chemins relatifs avec « / »). */
  files: Set<string>;
  /** Paquets npm atteints (« react », « @clerk/react »…). */
  packages: Set<string>;
}

function crawl(entry: string): Graph {
  const graph: Graph = { files: new Set(), packages: new Set() };
  const visit = (file: string) => {
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (graph.files.has(rel)) return;
    graph.files.add(rel);
    if (file.endsWith('.css')) return;
    for (const spec of valueImports(readFileSync(file, 'utf8'))) {
      let base: string | null = null;
      if (spec.startsWith('@/')) base = path.join(root, 'src', spec.slice(2));
      else if (spec.startsWith('@shared/')) base = path.join(root, 'shared', spec.slice(8));
      else if (spec.startsWith('.')) base = path.resolve(path.dirname(file), spec);
      if (base === null) {
        graph.packages.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
        continue;
      }
      const resolved = resolveFile(base);
      if (!resolved) throw new Error(`${rel} : import introuvable « ${spec} »`);
      visit(resolved);
    }
  };
  visit(path.join(root, entry));
  return graph;
}

/** Paquets qui n'ont rien à faire dans le site : connexion, base de données, PDF, Markdown, formules, archives. */
const FORBIDDEN_PACKAGES = /^(?:@clerk\/|@supabase\/|jspdf|pdfjs-dist|jszip|katex|react-markdown|remark-|unified)/;

/**
 * Modules de l'application : fournisseurs d'exécution (tout src/lib/runtime sauf les types et le pont Electron, dont le
 * site ne lit que la présence), connecteur local et son protocole, état de l'IA, détection du connecteur, routes de l'API.
 */
const FORBIDDEN_FILES = [
  /^src\/lib\/runtime\/(?!types\.ts$|local\.ts$)/,
  /^src\/lib\/localConnector\//,
  /^src\/hooks\/useAIStatus\.ts$/,
  /^src\/hooks\/useGeneration\.ts$/,
  /^src\/components\/localEngine\/(?:LocalEngineStatus|localActions|PermissionNotes|texts|WindowsDownloadSection|EngineSettings|LocalEngineCard)\.tsx?$/,
  /^src\/components\/(?:guards|PersonalAccess|ProfileCacheCleaner|AppIntro|WebSignOutButton|UpdateCheck)\.tsx$/,
  /^src\/pages\/(?:LandingPage|LegalPage|OnboardingPage|SetupPage|SettingsPage|DashboardPage|GeneratePage)\.tsx$/,
  /^shared\/(?:apiContract|localConnector)\.ts$/,
];

function expectClean(entry: string): Graph {
  const graph = crawl(entry);
  expect([...graph.packages].filter(pkg => FORBIDDEN_PACKAGES.test(pkg)), `paquets atteints depuis ${entry}`).toEqual([]);
  expect([...graph.files].filter(file => FORBIDDEN_FILES.some(re => re.test(file))), `modules de l'application atteints depuis ${entry}`).toEqual([]);
  return graph;
}

describe('Site vitrine : graphe d’imports', () => {
  it('src/site/main.tsx : les pages du site, rien de l’application', () => {
    const graph = expectClean('src/site/main.tsx');
    for (const file of [
      'src/site/SiteApp.tsx', 'src/site/SiteLanding.tsx', 'src/pages/landing/LandingContent.tsx',
      'src/components/localEngine/WindowsDownloadPanel.tsx', 'src/pages/legal/ShowcaseLegal.tsx', 'src/components/AuthorCredit.tsx',
    ]) {
      expect(graph.files.has(file), file).toBe(true);
    }
    // React et son routeur : le strict nécessaire.
    expect([...graph.packages].sort()).toEqual(
      expect.arrayContaining(['react', 'react-dom', 'react-router-dom', 'lucide-react']),
    );
    expect([...graph.packages].filter(pkg => !/^(?:react|react-dom|react-router-dom|lucide-react|@fontsource\/.+)$/.test(pkg))).toEqual([]);
  });

  it('LandingContent (accueil partagé) : sans Clerk, connecteur local, useAIStatus ni runtime — tout arrive par props', () => {
    const graph = expectClean('src/pages/landing/LandingContent.tsx');
    expect([...graph.files].filter(file => file.startsWith('src/lib/runtime/') || file.includes('useAIStatus'))).toEqual([]);
    expect([...graph.packages]).not.toContain('@clerk/react');
  });

  it('WindowsDownloadPanel (panneau de téléchargement, mode « showcase ») : sans connecteur local', () => {
    const graph = expectClean('src/components/localEngine/WindowsDownloadPanel.tsx');
    expect([...graph.files].filter(file => /localConnector|LocalEngine|localActions|PermissionNotes|localEngine\/texts/.test(file))).toEqual([]);
  });

  it('ShowcaseLegal : les textes légaux du site vitrine seuls, sans ceux de l’application', () => {
    const graph = expectClean('src/pages/legal/ShowcaseLegal.tsx');
    expect(graph.files.has('src/pages/LegalPage.tsx')).toBe(false);
    expect(graph.files.has('src/lib/runtime/mode.ts')).toBe(false);
  });

  it('« Ouvrir Magistra » : la même adresse que le protocole du connecteur (recopiée pour ne pas l’importer)', () => {
    expect(OPEN_APP_HREF).toBe(OPEN_APP_URL);
  });

  it('contre-épreuve : l’application, elle, atteint bien ces modules (le graphe voit les imports)', () => {
    const graph = crawl('src/pages/LandingPage.tsx');
    expect([...graph.packages]).toContain('@clerk/react');
    expect(graph.files.has('src/hooks/useAIStatus.ts')).toBe(true);
    expect(graph.files.has('src/components/localEngine/WindowsDownloadSection.tsx')).toBe(true);
    expect([...graph.files].some(file => file.startsWith('src/lib/localConnector/'))).toBe(true);
  });
});
