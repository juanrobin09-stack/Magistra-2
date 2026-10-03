// scripts/build-electron.mjs et scripts/mainModule.mjs : le script ne s'exécute que lancé directement par `node`, y
// compris par un lien symbolique ou une jonction (jamais de code 0 silencieux sans construction), et jamais importé.
// La construction se fait dans une copie des scripts avec des sources minimales : le dist-electron du dépôt n'est pas touché.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'magistra-build-')));
/** Liens vers le node_modules du dépôt, retirés avant le nettoyage : seul le lien disparaît, jamais son contenu. */
const modulesLinks: string[] = [];
afterAll(() => {
  for (const link of modulesLinks) rmSync(link, { force: true });
  rmSync(tmp, { recursive: true, force: true });
});

const { isMainModule } = (await import(pathToFileURL(path.join(root, 'scripts', 'mainModule.mjs')).href)) as {
  isMainModule(moduleUrl: string, entry?: string): boolean;
};

const linkType = process.platform === 'win32' ? 'junction' : 'dir';

/** Mini-projet : les vrais scripts, deux sources esbuild minimales et le node_modules du dépôt (esbuild). */
function makeProject(name: string): string {
  const dir = path.join(tmp, name);
  cpSync(path.join(root, 'scripts'), path.join(dir, 'scripts'), { recursive: true });
  mkdirSync(path.join(dir, 'electron'), { recursive: true });
  writeFileSync(path.join(dir, 'electron', 'main.ts'), "export const principal: string = 'principal';\nconsole.log(principal);\n");
  writeFileSync(path.join(dir, 'electron', 'preload.ts'), "export const preload: string = 'preload';\nconsole.log(preload);\n");
  const modules = path.join(dir, 'node_modules');
  symlinkSync(path.join(root, 'node_modules'), modules, linkType);
  modulesLinks.push(modules);
  return dir;
}

const run = (script: string) => spawnSync(process.execPath, [script], { cwd: tmp, encoding: 'utf8', timeout: 120_000 });

describe('isMainModule : garde « exécution directe » des scripts', () => {
  const unit = path.join(tmp, 'unite');
  const file = path.join(unit, 'script.mjs');
  const url = pathToFileURL(file).href;
  mkdirSync(unit);
  writeFileSync(file, '');

  it('chemin saisi identique, ou chemin passant par un lien symbolique (ou une jonction) : vrai', () => {
    expect(isMainModule(url, file)).toBe(true);
    const link = path.join(tmp, 'unite-lie');
    symlinkSync(unit, link, linkType);
    try {
      expect(isMainModule(url, path.join(link, 'script.mjs'))).toBe(true);
    } finally {
      unlinkSync(link);
    }
  });

  it('autre fichier, ou aucun script lancé (node -e) : faux', () => {
    const other = path.join(unit, 'autre.mjs');
    writeFileSync(other, '');
    expect(isMainModule(url, other)).toBe(false);
    expect(isMainModule(url, '')).toBe(false);
  });

  it('fichier introuvable : repli sur la comparaison des chemins, sans exception', () => {
    const missing = path.join(tmp, 'absent.mjs');
    expect(isMainModule(pathToFileURL(missing).href, path.join(tmp, '.', 'absent.mjs'))).toBe(true);
    expect(isMainModule(pathToFileURL(missing).href, path.join(tmp, 'ailleurs.mjs'))).toBe(false);
  });
});

describe('scripts/build-electron.mjs lancé par node', () => {
  it('construit dist-electron/main.js et preload.cjs, directement comme par un lien symbolique (ou une jonction) vers le dépôt', () => {
    const project = makeProject('depot');
    const out = path.join(project, 'dist-electron');

    const direct = run(path.join(project, 'scripts', 'build-electron.mjs'));
    expect(direct.stderr).toBe('');
    expect(direct.status).toBe(0);
    expect(existsSync(path.join(out, 'main.js'))).toBe(true);
    expect(existsSync(path.join(out, 'preload.cjs'))).toBe(true);

    rmSync(out, { recursive: true, force: true });
    const link = path.join(tmp, 'depot-lie');
    symlinkSync(project, link, linkType);
    try {
      const viaLink = run(path.join(link, 'scripts', 'build-electron.mjs'));
      expect(viaLink.stderr).toBe('');
      expect(viaLink.status).toBe(0);
      expect(viaLink.stdout).toContain('dist-electron/main.js et dist-electron/preload.cjs construits');
      expect(existsSync(path.join(out, 'main.js'))).toBe(true);
      expect(existsSync(path.join(out, 'preload.cjs'))).toBe(true);
    } finally {
      unlinkSync(link);
    }
  });

  it('un échec de construction reste un échec (code 1) lancé par un lien symbolique', () => {
    const project = makeProject('depot-casse');
    writeFileSync(path.join(project, 'electron', 'main.ts'), "import './absent';\n");
    const link = path.join(tmp, 'depot-casse-lie');
    symlinkSync(project, link, linkType);
    try {
      const res = run(path.join(link, 'scripts', 'build-electron.mjs'));
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('[build-electron] Échec de la construction');
    } finally {
      unlinkSync(link);
    }
  });

  it('importé par un autre script (comme scripts/dev-electron.mjs) : rien n’est construit', () => {
    const project = makeProject('depot-importe');
    const importer = path.join(project, 'importeur.mjs');
    writeFileSync(importer, "import { outDir } from './scripts/build-electron.mjs';\nconsole.log(outDir);\n");
    const res = run(importer);
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe(path.join(project, 'dist-electron'));
    expect(existsSync(path.join(project, 'dist-electron'))).toBe(false);
  });
});
