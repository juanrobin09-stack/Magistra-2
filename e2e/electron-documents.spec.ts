// Import réel sous app://, CSP et réseau de production : CMaps, pages scannées et citations.
// Prérequis : npm run build et node scripts/build-electron.mjs.
import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { jsPDF } from 'jspdf';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MagistraBridge, StoredDocument } from '../shared/ipc';
import { makeCjkPdf } from '../tests/documents/cjkFixture';
import { E2E_SCREENSHOT_DIRS, fromRoot } from './outputDirs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function prepareProfile(page: Page) {
  await expect(page.getByTestId('app-intro')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('app-intro').click();
  await page.getByRole('link', { name: /Commencer/ }).first().click();
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.locator('#onb-nom').fill('Professeur OCR');
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.getByRole('button', { name: /Supérieur/ }).click();
  await page.getByRole('button', { name: /^Master 1$/ }).click();
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.getByRole('button', { name: /Commencer à générer/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  // La préférence est sauvegardée via le vrai pont, avant de monter le formulaire.
  await page.evaluate(async () => {
    await (window as unknown as { magistra: MagistraBridge }).magistra.prefs.set({ keepDocuments: true });
  });
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Générer', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Cours' })).toBeVisible();
}

async function rasterPage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1100;
    canvas.height = 780;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000';
    context.font = '38px Arial, sans-serif';
    const lines = ['La photosynthèse', 'Les plantes utilisent la lumière du soleil.', 'Elles produisent de l’oxygène.', 'Plants use sunlight to produce oxygen.'];
    lines.forEach((line, n) => context.fillText(line, 70, 120 + n * 125));
    return canvas.toDataURL('image/png');
  });
}

function imagePdf(image: string): Buffer {
  const pdf = new jsPDF();
  pdf.addImage(image, 'PNG', 15, 15, 180, 127);
  return Buffer.from(pdf.output('arraybuffer'));
}

function mixedPdf(image: string): Buffer {
  const pdf = new jsPDF();
  pdf.setFontSize(18);
  pdf.text('Native page one: the plants absorb sunlight and produce oxygen.', 15, 35, { maxWidth: 175 });
  pdf.addPage();
  pdf.text('Native page two: a complete lesson about plants and energy.', 15, 35, { maxWidth: 175 });
  pdf.addPage();
  pdf.addImage(image, 'PNG', 15, 15, 180, 127);
  return Buffer.from(pdf.output('arraybuffer'));
}

function watermarkedScanPdf(image: string): Buffer {
  const pdf = new jsPDF();
  pdf.addImage(image, 'PNG', 15, 15, 180, 127);
  // Ce texte est natif et sélectionnable, mais le contenu du cours est une image.
  pdf.setFontSize(12);
  pdf.text('CONFIDENTIEL', 15, 170);
  return Buffer.from(pdf.output('arraybuffer'));
}

async function importAndKeep(page: Page, name: string, buffer: Buffer): Promise<StoredDocument> {
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: 'application/pdf', buffer });
  const row = page.getByRole('list', { name: 'Documents ajoutés' }).getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) });
  await expect(row).toContainText('Analysé', { timeout: 120_000 });
  await expect(row).not.toContainText(/impossible à lire|ne contient pas de texte sélectionnable/);
  await row.getByRole('button', { name: 'Conserver sur cet ordinateur', exact: true }).click();
  await expect(row).toContainText('Conservé sur cet ordinateur');
  return await page.evaluate(async filename => {
    const bridge = (window as unknown as { magistra: MagistraBridge }).magistra;
    const summary = (await bridge.documents.list()).find(doc => doc.name === filename);
    if (!summary) throw new Error('Document conservé absent');
    const doc = await bridge.documents.load(summary.id);
    if (!doc) throw new Error('Document conservé illisible');
    return doc;
  }, name);
}

test('PDF japonais, scans et pages mixtes : lecture locale complète sous app:// avec pages conservées', async () => {
  test.setTimeout(300_000);
  const userData = mkdtempSync(path.join(os.tmpdir(), 'magistra-ocr-e2e-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (typeof value === 'string') env[key] = value;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VITE_DEV_SERVER_URL;
  delete env.MAGISTRA_SMOKE_TEST;
  env.MAGISTRA_USER_DATA_DIR = userData;
  env.MAGISTRA_OLLAMA_URL = 'http://127.0.0.1:9';
  const args = [root];
  if (process.platform === 'linux') {
    args.push('--disable-gpu');
    if (process.getuid?.() === 0 || process.env.CI) args.push('--no-sandbox');
    env.LANG = 'C.UTF-8';
    env.LC_ALL = 'C.UTF-8';
  }
  const app = await electron.launch({ args, cwd: root, env, timeout: 60_000 });
  try {
    const page = await app.firstWindow();
    // Cette fenêtre de vérification reste masquée : l'utilisateur continue à travailler.
    // Le rendu reste actif pour conserver les vrais événements et le vrai moteur OCR.
    await app.evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.hide();
        win.webContents.setBackgroundThrottling(false);
        win.show = () => {};
        win.focus = () => {};
      }
    });
    const errors: string[] = [];
    const external: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      const url = request.url();
      if (/^https?:/.test(url)) external.push(url);
    });
    // Même si la politique change accidentellement, aucune requête du document ne quitte le poste.
    await page.route(/^https?:\/\//, route => route.abort());
    await prepareProfile(page);
    const frenchImage = await rasterPage(page);
    // Image fixée : aucune police japonaise installée n’est nécessaire pour la CI Linux.
    const japaneseImage = `data:image/png;base64,${readFileSync(path.join(root, 'e2e', 'fixtures', 'ocr-japanese.png')).toString('base64')}`;

    const cjk = await importAndKeep(page, 'japonais-cid-sans-tounicode.pdf', Buffer.from(makeCjkPdf()));
    expect(cjk.units[0].text).toContain('こんにちは');
    expect(cjk.units[0].locator).toMatchObject({ type: 'pages', start: 1 });
    expect(cjk.warnings ?? []).not.toContainEqual(expect.stringContaining('reconnaissance de caractères locale'));

    const french = await importAndKeep(page, 'scan-francais-anglais.pdf', imagePdf(frenchImage));
    expect(french.units.map(unit => unit.text).join('\n')).toMatch(/photosynth[èe]se/i);
    expect(french.units.map(unit => unit.text).join('\n')).toMatch(/sunlight/i);
    expect(french.units[0].locator).toMatchObject({ type: 'pages', start: 1 });
    expect(french.warnings).toContainEqual(expect.stringContaining('reconnaissance de caractères locale'));

    const japanese = await importAndKeep(page, 'scan-vocabulaire-japonais.pdf', imagePdf(japaneseImage));
    expect(japanese.units.map(unit => unit.text).join('\n')).toMatch(/日本|学校|先生/);
    expect(japanese.units[0].locator).toMatchObject({ type: 'pages', start: 1 });
    expect(japanese.warnings).toContainEqual(expect.stringContaining('reconnaissance de caractères locale'));

    const mixed = await importAndKeep(page, 'natif-et-scan.pdf', mixedPdf(frenchImage));
    expect(mixed.units.map(unit => unit.locator.start)).toEqual([1, 2, 3]);
    expect(mixed.units[0].text).toContain('Native page one');
    expect(mixed.units[1].text).toContain('Native page two');
    expect(mixed.units[2].text).toMatch(/photosynth[èe]se/i);
    expect(mixed.warnings).toContainEqual(expect.stringMatching(/^1 page\(s\) lues par reconnaissance/));

    const watermarked = await importAndKeep(page, 'scan-avec-filigrane-natif.pdf', watermarkedScanPdf(frenchImage));
    expect(watermarked.units.map(unit => unit.text).join('\n')).toMatch(/photosynth[èe]se/i);
    expect(watermarked.units.map(unit => unit.text).join('\n')).toMatch(/sunlight/i);
    expect(watermarked.units[0].locator).toMatchObject({ type: 'pages', start: 1 });
    expect(watermarked.warnings).toContainEqual(expect.stringContaining('reconnaissance de caractères locale'));

    // Le protocole app:// n'apparaît pas dans page.request/ResourceTiming. La présence
    // de la CMap dans dist et le résultat japonais natif ci-dessus vérifient son usage réel.
    const dist = process.env.MAGISTRA_DIST_DIR ?? path.join(root, 'dist');
    expect(existsSync(path.join(dist, 'pdfjs', 'cmaps', 'UniJIS-UCS2-H.bcmap'))).toBe(true);
    expect(existsSync(path.join(dist, 'ocr', 'worker.min.js'))).toBe(true);
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
    const shots = path.resolve(process.env.MAGISTRA_E2E_SCREENSHOTS ?? fromRoot(E2E_SCREENSHOT_DIRS.electron));
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, 'documents-ocr-offline.png') });
  } finally {
    await app.close();
    // Le dossier est celui créé pour ce test, sous le répertoire temporaire du système.
    const resolved = path.resolve(userData);
    if (resolved.startsWith(path.join(path.resolve(os.tmpdir()), 'magistra-ocr-e2e-'))) rmSync(resolved, { recursive: true, force: true });
  }
});
