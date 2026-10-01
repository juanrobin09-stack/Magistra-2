// Chaîne d'approvisionnement du dépôt : Dependabot (Electron à part), CODEOWNERS, SECURITY.md, et inspection du paquet
// Windows dans la CI. Contrôles textuels (aucune dépendance YAML ajoutée), comme tests/ci/workflows.test.ts.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('Dependabot', () => {
  const dependabot = read('.github/dependabot.yml');

  it('npm et actions GitHub, chaque semaine', () => {
    expect(dependabot).toMatch(/^version: 2$/m);
    expect(dependabot).toMatch(/package-ecosystem: npm\n {4}directory: \/\n {4}schedule:\n {6}interval: weekly/);
    expect(dependabot).toMatch(/package-ecosystem: github-actions\n {4}directory: \/\n {4}schedule:\n {6}interval: weekly/);
  });

  it('Electron est exclu du groupe « minor/patch » : ses mises à jour arrivent dans une demande à part', () => {
    expect(dependabot).toMatch(/minor-and-patch:\n {8}patterns: \['\*'\]\n {8}exclude-patterns: \['electron'\]\n {8}update-types: \[minor, patch\]/);
    // Aucun groupe ne porte sur electron, et les versions majeures de l'interface ne sont pas proposées.
    expect(dependabot).not.toMatch(/\n\s+patterns: \['electron/);
    for (const name of ['react', 'vite', 'tailwindcss']) expect(dependabot).toContain(`dependency-name: ${name}`);
  });
});

describe('CODEOWNERS et SECURITY.md', () => {
  it('CODEOWNERS : workflows, Electron, serveur et installateur relèvent du propriétaire du dépôt', () => {
    const owners = read('.github/CODEOWNERS');
    for (const p of ['/.github/', '/electron/', '/server/', '/electron-builder.json']) {
      expect(owners, p).toMatch(new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\s+@juanrobin09-stack$`, 'm'));
    }
  });

  it('SECURITY.md : signalement privé, délais, périmètre, versions prises en charge (aucune adresse inventée)', () => {
    const security = read('SECURITY.md');
    expect(security).toContain('N\'ouvrez pas d\'issue publique');
    expect(security).toContain('https://github.com/juanrobin09-stack/Magistra-2/security/advisories/new');
    expect(security).toMatch(/accusé de réception\*\* sous 7 jours/);
    expect(security).toContain('## Périmètre');
    expect(security).toContain('## Versions prises en charge');
    expect(security).not.toMatch(/[\w.-]+@[\w-]+\.[a-z]{2,}/i);
  });

  it('README : section Sécurité renvoyant à SECURITY.md', () => {
    expect(read('README.md')).toMatch(/## Sécurité\n\n[^\n]*\[SECURITY\.md\]\(SECURITY\.md\)/);
  });
});

describe('ci.yml : inspection du paquet Windows', () => {
  const ci = read('.github/workflows/ci.yml');
  const win = ci.slice(ci.indexOf('\n  windows-package:'));

  it('s\'exécute après electron-builder (le dossier win-unpacked existe) et avant l\'envoi de l\'installateur', () => {
    const build = win.indexOf('npx electron-builder --win nsis zip --x64 --publish never');
    const verify = win.indexOf('run: node scripts/verify-package.mjs');
    const upload = win.indexOf('uses: actions/upload-artifact@v4');
    expect(build).toBeGreaterThan(0);
    expect(verify).toBeGreaterThan(build);
    expect(upload).toBeGreaterThan(verify);
  });

  it('aucun secret ni droit d\'écriture ajouté', () => {
    expect(win).not.toMatch(/secrets\./);
    expect(win).not.toMatch(/contents: write/);
  });
});
