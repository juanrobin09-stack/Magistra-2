// scripts/verify-package.mjs : inspection du paquet Windows (fusibles, intégrité et contenu de l'asar) lancée par la CI
// après electron-builder. Paquets simulés : exécutable factice (marqueur de fusibles + ressource d'intégrité) et vrai
// app.asar construit avec @electron/asar ; aucun Electron ni Windows nécessaire.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FuseV1Options } from '@electron/fuses';
import asar from '@electron/asar';
import { afterAll, describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const script = path.join(root, 'scripts', 'verify-package.mjs');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'magistra-verify-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

type Mod = {
  FUSE_INDEX: Record<string, number>;
  REQUIRED_FUSES: Record<string, boolean>;
  checkFuses(wire: Record<number, number>, config: Record<string, boolean>): string[];
  checkAsarEntries(entries: string[]): string[];
  checkNoSecrets(files: { name: string; text: string }[]): string[];
  checkAsarIntegrity(exe: Buffer, header: string): string[];
};
const mod = (await import(pathToFileURL(script).href)) as Mod;

const builderFuses = (JSON.parse(readFileSync(path.join(root, 'electron-builder.json'), 'utf8')) as { electronFuses: Record<string, boolean> }).electronFuses;

/** Fusibles tels que les écrit electron-builder avec la configuration du dépôt (autres : désactivés). */
function wireFor(config: Record<string, boolean>): Record<number, number> {
  const wire: Record<number, number> = {};
  for (const [name, index] of Object.entries(mod.FUSE_INDEX)) wire[index] = config[name] ? 49 : 48;
  return wire;
}

const GOOD_ENTRIES = ['/package.json', '/dist-electron', '/dist-electron/main.js', '/dist-electron/preload.cjs', '/dist', '/dist/index.html'];

describe('verify-package : fusibles', () => {
  it('les positions codées dans le script suivent @electron/fuses', () => {
    for (const [name, index] of Object.entries(mod.FUSE_INDEX)) {
      expect(FuseV1Options[index], name).toBe(name.charAt(0).toUpperCase() + name.slice(1));
    }
  });

  it('la configuration d’electron-builder du dépôt respecte le socle de sécurité', () => {
    for (const [name, value] of Object.entries(mod.REQUIRED_FUSES)) expect(builderFuses[name], name).toBe(value);
    expect(mod.checkFuses(wireFor(builderFuses), builderFuses)).toEqual([]);
  });

  it('runAsNode actif dans l’exécutable : échec', () => {
    const wire = { ...wireFor(builderFuses), [mod.FUSE_INDEX.runAsNode]: 49 };
    expect(mod.checkFuses(wire, builderFuses).join('\n')).toContain('fusible runAsNode : désactivé attendu, activé');
  });

  it('intégrité de l’asar ou chargement hors asar non appliqués : échec', () => {
    const wire = { ...wireFor(builderFuses), [mod.FUSE_INDEX.enableEmbeddedAsarIntegrityValidation]: 48, [mod.FUSE_INDEX.onlyLoadAppFromAsar]: 48 };
    const errors = mod.checkFuses(wire, builderFuses);
    expect(errors).toHaveLength(2);
    expect(errors.join('\n')).toContain('enableEmbeddedAsarIntegrityValidation');
    expect(errors.join('\n')).toContain('onlyLoadAppFromAsar');
  });

  it('fusible retiré (état 114) ou illisible : échec', () => {
    const wire = { ...wireFor(builderFuses), [mod.FUSE_INDEX.runAsNode]: 114 };
    expect(mod.checkFuses(wire, builderFuses).join('\n')).toContain('absent ou inconnu');
    expect(mod.checkFuses({}, builderFuses).length).toBeGreaterThan(0);
  });

  it('une clé retirée d’electron-builder.json ne désactive pas un fusible en silence (socle codé dans le script)', () => {
    const weakened = { ...builderFuses } as Record<string, boolean>;
    delete weakened.runAsNode;
    // Exécutable qui laisserait runAsNode actif (défaut d’Electron) : détecté malgré l’absence de la clé.
    const wire = { ...wireFor(weakened), [mod.FUSE_INDEX.runAsNode]: 49 };
    expect(mod.checkFuses(wire, weakened).join('\n')).toContain('runAsNode');
  });

  it('configuration affaiblie dans electron-builder.json : signalée', () => {
    const errors = mod.checkFuses(wireFor({ ...builderFuses, runAsNode: true }), { ...builderFuses, runAsNode: true });
    expect(errors.join('\n')).toContain('le fusible runAsNode doit rester désactivé');
  });
});

describe('verify-package : contenu de l’asar', () => {
  it('paquet conforme : aucun écart', () => {
    expect(mod.checkAsarEntries(GOOD_ENTRIES)).toEqual([]);
    // Séparateurs Windows acceptés.
    expect(mod.checkAsarEntries(GOOD_ENTRIES.map(e => e.replace(/\//g, '\\')))).toEqual([]);
  });

  it('preload, page d’accueil ou processus principal manquants : échec', () => {
    const errors = mod.checkAsarEntries(['/package.json', '/dist-electron/main.js']);
    expect(errors.join('\n')).toContain('dist-electron/preload.cjs');
    expect(errors.join('\n')).toContain('dist/index.html');
  });

  it('node_modules, sourcemap et fichier .env livrés : échec', () => {
    const errors = mod.checkAsarEntries([...GOOD_ENTRIES, '/node_modules/x/index.js', '/dist-electron/main.js.map', '/.env.local']);
    expect(errors).toHaveLength(3);
  });

  it('secrets serveur dans un fichier livré : échec (et rien à signaler sinon)', () => {
    expect(mod.checkNoSecrets([{ name: 'dist-electron/main.js', text: 'const AI_API_KEY = process.env.AI_API_KEY' }])).toEqual([]);
    const errors = mod.checkNoSecrets([
      { name: 'dist/assets/a.js', text: 'x={role:"service_role"}' },
      { name: 'dist-electron/main.js', text: 'SUPABASE_SERVICE_ROLE_KEY' },
      { name: 'dist/b.js', text: 'k="sk_live_' + 'a'.repeat(24) + '"' },
    ]);
    // « service_role » apparaît aussi dans SUPABASE_SERVICE_ROLE_KEY (insensible à la casse) : 4 signalements.
    expect(errors).toHaveLength(4);
  });
});

describe('verify-package : intégrité de l’asar', () => {
  const header = '{"files":{}}';
  const hash = createHash('sha256').update(header).digest('hex');
  const resource = (value: string) => Buffer.from(`MZ\0\0[{"file":"resources\\\\app.asar","alg":"SHA256","value":"${value}"}]\0`);

  it('empreinte inscrite égale à celle de l’en-tête : conforme', () => {
    expect(mod.checkAsarIntegrity(resource(hash), header)).toEqual([]);
  });

  it('asar modifié après la construction : échec', () => {
    expect(mod.checkAsarIntegrity(resource(hash), '{"files":{"x":{}}}').join('\n')).toContain('ne correspond pas');
  });

  it('aucune ressource d’intégrité : échec', () => {
    expect(mod.checkAsarIntegrity(Buffer.from('MZ\0\0 rien'), header).join('\n')).toContain('ELECTRONASAR');
  });
});

describe('verify-package : paquet complet (ligne de commande)', () => {
  const SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX';

  /** Construit un dossier « win-unpacked » factice ; `tweak` permet d'y introduire un défaut. */
  async function makePackage(name: string, tweak: { fuses?: Record<string, boolean>; files?: Record<string, string>; noIcon?: boolean; tamperAsar?: boolean } = {}) {
    const dir = path.join(tmp, name);
    const app = path.join(dir, 'app-src');
    const files: Record<string, string> = {
      'package.json': '{"main":"dist-electron/main.js"}',
      'dist-electron/main.js': 'console.log("main")',
      'dist-electron/preload.cjs': 'require("electron")',
      'dist/index.html': '<!doctype html>',
      ...tweak.files,
    };
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(app, file)), { recursive: true });
      writeFileSync(path.join(app, file), text);
    }
    mkdirSync(path.join(dir, 'resources'), { recursive: true });
    const asarFile = path.join(dir, 'resources', 'app.asar');
    await asar.createPackage(app, asarFile);
    const header = asar.getRawHeader(asarFile).headerString;
    const integrity = createHash('sha256').update(tweak.tamperAsar ? header + ' ' : header).digest('hex');
    const wire = wireFor({ ...builderFuses, ...tweak.fuses });
    const exe = Buffer.concat([
      Buffer.from('MZ-faux-exe'),
      Buffer.from(SENTINEL),
      Buffer.from([1, 8, ...Object.keys(wire).map(i => wire[Number(i)])]),
      Buffer.from(`[{"file":"resources\\\\app.asar","alg":"SHA256","value":"${integrity}"}]`),
    ]);
    writeFileSync(path.join(dir, 'Magistra.exe'), exe);
    if (!tweak.noIcon) writeFileSync(path.join(dir, 'resources', 'icon.png'), 'png');
    return dir;
  }

  const run = (dir: string) => spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });

  it('paquet conforme : code 0', async () => {
    const res = run(await makePackage('ok'));
    expect(res.stderr).toBe('');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('conformes');
  });

  it('fusible runAsNode actif : code 1 avec annotation ::error', async () => {
    const res = run(await makePackage('runasnode', { fuses: { runAsNode: true } }));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('::error title=Paquet Windows::fusible runAsNode');
  });

  it('preload absent de l’asar (files modifié) : code 1', async () => {
    const dir = await makePackage('nopreload');
    // Rebâtit un asar sans preload, en gardant l'exécutable : manque ET empreinte périmée.
    const app = path.join(dir, 'app-src');
    rmSync(path.join(app, 'dist-electron', 'preload.cjs'));
    await asar.createPackage(app, path.join(dir, 'resources', 'app.asar'));
    const res = run(dir);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('dist-electron/preload.cjs');
  });

  it('secret serveur livré dans le bundle : code 1', async () => {
    const res = run(await makePackage('secret', { files: { 'dist-electron/main.js': 'const k = "SUPABASE_SERVICE_ROLE_KEY"' } }));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('SUPABASE_SERVICE_*');
  });

  it('empreinte d’intégrité périmée, icône absente : code 1', async () => {
    const res = run(await makePackage('tamper', { tamperAsar: true, noIcon: true }));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('ne correspond pas');
    expect(res.stderr).toContain('icon.png');
  });

  it('dossier absent : code 1, message clair', () => {
    const res = run(path.join(tmp, 'inexistant'));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('introuvable');
  });
});
