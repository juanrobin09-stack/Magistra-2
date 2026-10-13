// Chargement Node ESM réel, sans résolveur Vite ni bundling : les imports TS doivent survivre à la transpilation.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ENTRIES = ['api/usage.ts', 'api/usage-dashboard.ts', 'api/usage-maintenance.ts'];

/** Copie le graphe réellement émis ; ne réécrit aucun import et n'inclut aucune dépendance tierce. */
function transpileGraph(destination: string): void {
  const visited = new Set<string>();
  const visit = (relative: string) => {
    if (visited.has(relative)) return;
    visited.add(relative);
    const source = path.join(ROOT, relative);
    const emitted = ts.transpileModule(readFileSync(source, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, fileName: source,
    }).outputText;
    const output = path.join(destination, relative.replace(/\.ts$/, '.js'));
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, emitted);
    for (const dependency of ts.preProcessFile(emitted, true, true).importedFiles) {
      if (!dependency.fileName.startsWith('.')) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), dependency.fileName));
      if (resolved.startsWith('../') || path.posix.isAbsolute(resolved)) throw new Error('Import outside source graph');
      visit(resolved.endsWith('.js') ? resolved.slice(0, -3) + '.ts' : resolved + '.ts');
    }
  };
  for (const entry of ENTRIES) visit(entry);
}

it('les trois fonctions Vercel démarrent en Node ESM et refusent les requêtes anonymes avant tout accès à la base', () => {
  const temporaryRoot = path.resolve(tmpdir());
  const directory = mkdtempSync(path.join(temporaryRoot, 'magistra-usage-node-'));
  try {
    writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}');
    transpileGraph(directory);
    const script = `
      import { createServer } from 'node:http';
      const root = process.env.MAGISTRA_ESM_ROOT;
      const { SITE_ORIGIN } = await import(new URL('shared/site.js', root));
      const { SITE_GUIDES } = await import(new URL('shared/siteGuides.js', root));
      const results = [];
      for (const [file, query] of [['usage', ''], ['usage-dashboard', '?format=json'], ['usage-maintenance', '']]) {
        const { default: handler } = await import(new URL('api/' + file + '.js', root));
        const server = createServer((req, res) => { void handler(req, res); });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
          const response = await fetch('http://127.0.0.1:' + server.address().port + '/' + query);
          const body = await response.json();
          results.push({ file, status: response.status, body, cache: response.headers.get('cache-control'),
            robots: response.headers.get('x-robots-tag'), allow: response.headers.get('allow') });
        } finally {
          server.closeAllConnections();
          await new Promise(resolve => server.close(resolve));
        }
      }
      console.log(JSON.stringify({ origin: SITE_ORIGIN, guides: SITE_GUIDES.length, results }));
    `;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8', windowsHide: true, timeout: 15_000,
      env: { SystemRoot: process.env.SystemRoot ?? '', MAGISTRA_ESM_ROOT: pathToFileURL(directory + path.sep).href },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(output) as { origin: string; guides: number; results: Array<{ file: string; status: number; body: unknown; cache: string; robots: string; allow: string | null }> };
    expect(parsed.origin).toBe('https://www.mag-istra.fr');
    expect(parsed.guides).toBeGreaterThan(0);
    expect(parsed.results.map(result => [result.file, result.status])).toEqual([
      ['usage', 405], ['usage-dashboard', 401], ['usage-maintenance', 401],
    ]);
    expect(parsed.results[0].allow).toBe('POST');
    for (const result of parsed.results) {
      expect(result.cache).toContain('no-store');
      expect(result.robots).toContain('noindex');
      expect(result.body).toEqual({ error: result.status === 405 ? 'Méthode non autorisée.' : 'Authentification requise.' });
    }
  } finally {
    // La cible est exclusivement le dossier renvoyé par mkdtemp dans le répertoire temporaire système.
    if (path.dirname(path.resolve(directory)) !== temporaryRoot || !path.basename(directory).startsWith('magistra-usage-node-')) throw new Error('Unexpected temporary directory');
    rmSync(directory, { recursive: true, force: true });
  }
}, 30_000);
