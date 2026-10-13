// Validation HTTP et rendu du tableau privé, exclusivement avec des données fictives.
// Usage : node scripts/usage-preview.mjs [dossier de sortie]
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..');
const output = path.resolve(process.argv[2] ?? path.join(root, 'test-results/usage-preview'));
const moduleDir = path.join(root, 'test-results/usage-preview');
await mkdir(output, { recursive: true });
await mkdir(moduleDir, { recursive: true });
const moduleFile = path.join(moduleDir, 'routes.mjs');
await build({ entryPoints: [path.join(root, 'server/usageRoutes.ts')], outfile: moduleFile, bundle: true,
  platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
const { createUsageRouteHandler } = await import(pathToFileURL(moduleFile).href);
const snapshot = { days: [{ period: '2026-10-13', active: 82, openings: 164 }, { period: '2026-10-12', active: 71, openings: 128 }],
  months: [{ period: '2026-10', active: 127 }, { period: '2026-09', active: 94 }],
  cohorts: [{ period: '2026-09-01', firstUses: 80, returned7: 56, returned30: 64 }] };
const password = 'synthetic-preview-password-not-production';
const authorization = 'Basic ' + Buffer.from('fixture:' + password).toString('base64');
const handler = createUsageRouteHandler('dashboard', {
  env: { MAGISTRA_STATS_OWNER_LOGIN: 'fixture', MAGISTRA_STATS_OWNER_PASSWORD_HASH: createHash('sha256').update(password).digest('hex') },
  now: () => new Date('2026-10-13T12:00:00Z'), store: { snapshot: async () => snapshot, record: async () => {} },
  downloads: async () => ({ total: 361, complete: true, releases: [{ version: 'v2.0.10', downloads: 216 }, { version: 'v2.0.9', downloads: 145 }] }),
});
const server = createServer((req, res) => { void handler(req, res); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  for (const endpoint of ['/tableau-prive', '/api/usage-dashboard?format=json']) {
    const response = await fetch(url + endpoint);
    assert.equal(response.status, 401);
    assert.ok(!(await response.text()).includes('127'));
  }
  const response = await fetch(url + '/api/usage-dashboard?format=json', { headers: { authorization } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const exported = await response.json();
  assert.deepEqual({ days: exported.days, months: exported.months, cohorts: exported.cohorts }, snapshot);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ httpCredentials: { username: 'fixture', password }, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const loaded = await page.goto(url + '/tableau-prive');
  assert.equal(loaded.status(), 200);
  assert.equal(await page.getByRole('heading', { name: 'La vie de Magistra' }).count(), 1);
  assert.equal(await page.getByRole('heading', { name: 'Retour dans les 30 jours' }).count(), 1);
  await page.screenshot({ path: path.join(output, 'usage-dashboard-preview.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth), false);
  await page.screenshot({ path: path.join(output, 'usage-dashboard-mobile.png'), fullPage: true });
  await writeFile(path.join(output, 'usage-preview-verification.json'), JSON.stringify({ synthetic: true, anonymousHTML: 401,
    anonymousJSON: 401, ownerHTML: 200, ownerJSON: 200, privateNoStore: true, mobileOverflow: false }, null, 2));
  console.log('Tableau privé : HTML/JSON refusés sans accès, autorisés après authentification ; captures ordinateur/mobile créées avec données fictives.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
