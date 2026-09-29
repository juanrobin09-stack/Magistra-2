// Installateur Windows (electron-builder.json) : le parcours annoncé aux enseignants — « Magistra s'installe en quelques
// secondes, sans droits d'administrateur, et s'ouvre toute seule » — dépend de ces réglages ; ils ne doivent pas changer
// par inadvertance.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = JSON.parse(readFileSync(path.join(root, 'electron-builder.json'), 'utf8')) as {
  productName: string;
  win: { target: { target: string }[]; icon: string };
  nsis: Record<string, unknown>;
};

describe('Installateur Windows (NSIS)', () => {
  it('un clic, par utilisateur, sans droits d’administrateur, Magistra s’ouvre à la fin', () => {
    expect(config.win.target.map(t => t.target)).toContain('nsis');
    expect(config.nsis).toMatchObject({
      oneClick: true,
      perMachine: false,
      allowElevation: false,
      runAfterFinish: true,
    });
  });

  it('raccourcis Bureau et menu Démarrer, nom affiché « Magistra », icône de l’application', () => {
    expect(config.nsis).toMatchObject({
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'Magistra',
      uninstallDisplayName: 'Magistra',
    });
    expect(config.productName).toBe('Magistra');
    expect(config.win.icon).toBe('build/icon.png');
    // Les données de l'enseignant (historique, profil) ne sont jamais effacées par une désinstallation.
    expect(config.nsis.deleteAppDataOnUninstall).toBe(false);
  });
});
