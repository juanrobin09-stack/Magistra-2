// scripts/audit-electron.mjs : seule une vulnérabilité grave d'Electron (livré aux utilisateurs) bloque la CI ;
// les outils de construction sont signalés, les autres outils de développement ignorés. Rapports simulés.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = mkdtempSync(path.join(os.tmpdir(), 'magistra-audit-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Lance le script avec un rapport simulé (jamais npm ni le réseau) ; `script` : chemin saisi pour `node`. */
function audit(report: unknown, script = path.join(root, 'scripts', 'audit-electron.mjs')) {
  const file = path.join(dir, `rapport-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(report));
  const res = spawnSync(process.execPath, [script, '--report', file], { encoding: 'utf8' });
  return { code: res.status, out: res.stdout, err: res.stderr };
}

const advisory = (severity: string, title = 'Faille dans Chromium') => ({
  source: 1234, name: 'electron', dependency: 'electron', title, url: 'https://github.com/advisories/GHSA-xxxx', severity, range: '<44.4.6',
});

describe('audit d’Electron (CI)', () => {
  it('aucune vulnérabilité : succès', () => {
    expect(audit({ auditReportVersion: 2, vulnerabilities: {} })).toMatchObject({ code: 0 });
  });

  it('avis « high » ou « critical » sur electron lui-même : échec', () => {
    for (const severity of ['high', 'critical']) {
      const r = audit({ vulnerabilities: { electron: { name: 'electron', severity, isDirect: true, via: [advisory(severity)], effects: [] } } });
      expect(r.code, severity).toBe(1);
      expect(r.err).toContain('::error title=Audit Electron::electron');
    }
  });

  it('avis « moderate » sur electron : non bloquant', () => {
    expect(audit({ vulnerabilities: { electron: { name: 'electron', severity: 'moderate', via: [advisory('moderate')] } } }).code).toBe(0);
  });

  it('dépendance d’installation d’electron ou chaîne electron-builder : avertissement seulement', () => {
    const r = audit({
      vulnerabilities: {
        electron: { name: 'electron', severity: 'high', isDirect: true, via: ['@electron/get'] },
        '@electron/get': { name: '@electron/get', severity: 'high', via: [{ ...advisory('high', 'Faille de got'), name: 'got' }] },
        'electron-builder': { name: 'electron-builder', severity: 'critical', isDirect: true, via: ['app-builder-lib'] },
      },
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain('::warning title=Audit outils de construction::electron (dépendance d’installation) [high] ← @electron/get');
    expect(r.out).toContain('::warning title=Audit outils de construction::electron-builder [critical] ← app-builder-lib');
  });

  it('outils de développement sans effet sur l’application installée (vite, eslint…) : ignorés', () => {
    const r = audit({ vulnerabilities: { vite: { name: 'vite', severity: 'critical', isDirect: true, via: [{ ...advisory('critical'), name: 'vite' }] } } });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain('::warning');
  });

  it('audit impossible (registre injoignable, rapport illisible) : échec explicite', () => {
    const r = audit({ error: { code: 'ENOAUDIT', summary: 'Your configured registry does not support audit requests.' } });
    expect(r.code).toBe(1);
    expect(r.err).toContain('Audit impossible : npm audit : Your configured registry');
  });

  it('lancé par un lien symbolique (ou une jonction) vers le dépôt : l’audit a bien lieu, jamais de code 0 silencieux', () => {
    const link = path.join(dir, 'depot-lie');
    symlinkSync(root, link, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      const script = path.join(link, 'scripts', 'audit-electron.mjs');
      const serious = audit({ vulnerabilities: { electron: { name: 'electron', severity: 'high', isDirect: true, via: [advisory('high')], effects: [] } } }, script);
      expect(serious.code).toBe(1);
      expect(serious.err).toContain('::error title=Audit Electron::electron');
      const clean = audit({ auditReportVersion: 2, vulnerabilities: {} }, script);
      expect(clean.code).toBe(0);
      expect(clean.out).toContain('[audit-electron] Electron : aucune vulnérabilité');
    } finally {
      unlinkSync(link);
    }
  });
});
