// Outils communs aux tests de bout en bout du site en mode démonstration.
// (Fichier non exécuté comme test : seuls les fichiers « web-*.spec.ts » le sont.)

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import JSZip from 'jszip';

export const PROFILE_KEY = 'magistra_demo_profile_v2';
export const HISTORY_KEY = 'magistra_demo_history_v2';

export interface DemoProfile {
  displayName: string;
  etablissement: string;
  cycle: string;
  niveaux: string[];
  matierePrincipale: string;
  matiereSecondaire?: string;
  discipline?: string;
}

export const PROFILE_SUPERIEUR: DemoProfile = {
  displayName: 'Mme Dupont',
  etablissement: 'Université de Bordeaux',
  cycle: 'superieur',
  niveaux: ['master_1', 'master_2'],
  matierePrincipale: 'informatique',
  discipline: "Systèmes d'information",
};

export const PROFILE_COLLEGE: DemoProfile = {
  displayName: 'M. Martin',
  etablissement: 'Collège Victor Hugo',
  cycle: 'college',
  niveaux: ['4eme'],
  matierePrincipale: 'mathematiques',
};

/**
 * Réponse de GET /api/windows-release simulée (même forme que le serveur Magistra) : le site public en démonstration
 * garde son API et propose le téléchargement direct de la dernière version stable. L'installateur n'est jamais
 * téléchargé par les tests (lien vers github.com : toute requête externe ferait échouer le test).
 */
export const E2E_RELEASE = {
  available: true,
  version: '2.0.0',
  fileName: 'Magistra-Setup-2.0.0.exe',
  downloadUrl: 'https://github.com/juanrobin09-stack/magistra-downloads/releases/download/v2.0.0/Magistra-Setup-2.0.0.exe',
  sizeBytes: 89_443_942,
  sha256: 'a3f5c0e1b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a6',
  publishedAt: '2026-09-29T12:00:00Z',
  releaseUrl: 'https://github.com/juanrobin09-stack/magistra-downloads/releases/tag/v2.0.0',
  requirements: 'Windows 10 ou 11 (64 bits)',
} as const;

// ─── Surveillance : erreurs console et requêtes hors de 127.0.0.1 ───────────

export interface Monitor {
  errors: string[];
  external: string[];
}

function isLocal(url: string): boolean {
  if (!/^(https?|wss?):/i.test(url)) return true; // data:, blob:, about:…
  const host = new URL(url).hostname;
  return host === '127.0.0.1' || host === 'localhost';
}

/**
 * Chaque test vérifie automatiquement, à la fin, qu'aucune erreur n'est apparue dans la console
 * et qu'aucune requête n'est partie vers un autre domaine que 127.0.0.1 (polices, CDN, API…).
 */
export const test = base.extend<{ monitor: Monitor }>({
  monitor: [
    async ({ page }, use) => {
      const monitor: Monitor = { errors: [], external: [] };
      // « vite preview » ne sert que les fichiers statiques (aucune API) : GET /api/mode, lu au démarrage de
      // l'interface, y répondrait par une erreur (message dans la console). On répond comme un serveur Magistra
      // sans authentification configurée : l'interface reste en démonstration, comme avant.
      await page.route('**/api/mode', route => route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ auth: 'none' }),
      }));
      // Même raison pour GET /api/windows-release (carte « Passez à la vraie IA », section « Magistra pour Windows »).
      await page.route('**/api/windows-release', route => route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(E2E_RELEASE),
      }));
      await page.route(url => !isLocal(url.toString()), route => {
        monitor.external.push(route.request().url());
        return route.abort();
      });
      page.on('console', msg => {
        if (msg.type() === 'error') monitor.errors.push(`console : ${msg.text()}`);
      });
      page.on('pageerror', err => monitor.errors.push(`page : ${err.message}`));
      page.on('request', req => {
        if (!isLocal(req.url()) && !monitor.external.includes(req.url())) monitor.external.push(req.url());
      });
      await use(monitor);
      expect(monitor.errors, 'erreurs dans la console').toEqual([]);
      expect(monitor.external, 'requêtes vers un domaine externe').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

// ─── Captures ───────────────────────────────────────────────────────────────

/** Capture d'écran dans $E2E_SCREENSHOT_DIR (si défini). */
export async function snap(page: Page, name: string, fullPage = false): Promise<void> {
  const dir = process.env.E2E_SCREENSHOT_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage });
}

// ─── Données ────────────────────────────────────────────────────────────────

/** Enregistre un profil de démonstration dans ce navigateur (sans passer par l'onboarding). */
export async function seedProfile(page: Page, profile: DemoProfile = PROFILE_SUPERIEUR): Promise<void> {
  await page.goto('/');
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [PROFILE_KEY, JSON.stringify(profile)] as const);
}

export async function readHistory(page: Page): Promise<{ id: string; sujet: string; isFavorite: boolean; type: string }[]> {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '[]'), HISTORY_KEY);
}

// ─── Page Générer ───────────────────────────────────────────────────────────

export function resultSection(page: Page): Locator {
  return page.locator('section[aria-labelledby="gen-result-title"]');
}

/** Choisit une valeur dans une liste déroulante SelectField (bouton + listbox). */
export async function chooseOption(page: Page, buttonId: string, optionLabel: string | RegExp): Promise<void> {
  await page.locator(`#${buttonId}`).click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  await listbox.getByRole('option', { name: optionLabel, exact: typeof optionLabel === 'string' }).click();
  await expect(listbox).toHaveCount(0);
}

export interface StreamRecording {
  /** Textes successifs affichés dans le résultat (sans doublons consécutifs). */
  snapshots: string[];
  /** Le bouton « Arrêter » a été visible pendant la génération. */
  sawStop: boolean;
  done: boolean;
}

/**
 * Lance la génération et enregistre, image par image, le texte affiché jusqu'à la fin
 * (bouton « Recommencer »).
 */
export async function generateAndRecord(page: Page): Promise<StreamRecording> {
  const recording = page.evaluate(() => new Promise<{ snapshots: string[]; sawStop: boolean; done: boolean }>(resolve => {
    const snapshots: string[] = [];
    let sawStop = false;
    const start = performance.now();
    const tick = () => {
      const section = document.querySelector('section[aria-labelledby="gen-result-title"]');
      const text = section?.querySelector('.prose-content')?.textContent ?? '';
      if (snapshots[snapshots.length - 1] !== text) snapshots.push(text);
      const labels = Array.from(section?.querySelectorAll('button') ?? []).map(b => b.textContent?.trim());
      if (labels.includes('Arrêter')) sawStop = true;
      const done = sawStop && labels.includes('Recommencer');
      if (done || performance.now() - start > 30_000) resolve({ snapshots, sawStop, done });
      else requestAnimationFrame(tick);
    };
    tick();
  }));
  await page.getByRole('button', { name: /^Générer : / }).click();
  return recording;
}

/** Vérifications communes à toute génération de démonstration terminée. */
export async function expectDemoResult(page: Page, rec: StreamRecording): Promise<void> {
  expect(rec.done, 'la génération se termine').toBe(true);
  expect(rec.sawStop, '« Arrêter » visible pendant la génération').toBe(true);
  const final = rec.snapshots[rec.snapshots.length - 1];
  const intermediate = rec.snapshots.filter(s => s.trim() !== '' && s !== final);
  expect(intermediate.length, 'au moins deux états intermédiaires du texte').toBeGreaterThanOrEqual(2);
  // Le texte s'allonge progressivement.
  expect(intermediate[0].length).toBeLessThan(final.length);

  const result = resultSection(page);
  await expect(result.getByRole('button', { name: 'Recommencer' })).toBeVisible();
  await expect(result.getByRole('button', { name: 'Arrêter' })).toHaveCount(0);
  // Bandeau de démonstration honnête, dans le contenu lui-même.
  await expect(result.locator('.prose-content blockquote').first()).toContainText(
    "Mode démonstration : ceci est un exemple pré-rédigé, identique quels que soient le sujet et les paramètres saisis",
  );
  // Tableau Markdown rendu en vrai tableau HTML.
  await expect(result.locator('.prose-content table').first()).toBeVisible();
  expect(await result.locator('.prose-content').first().innerText()).not.toContain('|---');
  await expect(result.getByText("Enregistré dans l'historique de démonstration (ce navigateur)")).toBeVisible();
  await expect(result.getByRole('link', { name: "Voir dans l'historique" })).toBeVisible();
}

// ─── Fichiers de test ───────────────────────────────────────────────────────

export async function makeDocx(paragraphs: { text: string; heading?: boolean }[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '</Types>');
  zip.file('_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>');
  const body = paragraphs.map(p => {
    const style = p.heading ? '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' : '';
    const text = p.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<w:p>${style}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  }).join('');
  zip.file('word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** En-tête d'un exécutable Windows (MZ … PE) : ce n'est pas un PDF, quel que soit son nom. */
export function fakeExe(): Buffer {
  const buf = Buffer.alloc(2048, 0);
  buf.write('MZ', 0, 'latin1');
  buf.write('This program cannot be run in DOS mode.', 0x4e, 'latin1');
  buf.writeUInt32LE(0x80, 0x3c);
  buf.write('PE\0\0', 0x80, 'latin1');
  return buf;
}

// ─── Mise en page ───────────────────────────────────────────────────────────

/** Largeurs de défilement : document et zone principale de l'application. */
export async function horizontalOverflow(page: Page): Promise<{ doc: number; main: number | null }> {
  return page.evaluate(() => {
    const se = document.scrollingElement ?? document.documentElement;
    const main = document.getElementById('main-content');
    return {
      doc: se.scrollWidth - se.clientWidth,
      main: main ? main.scrollWidth - main.clientWidth : null,
    };
  });
}

export async function expectNoHorizontalScroll(page: Page, where: string): Promise<void> {
  const o = await horizontalOverflow(page);
  expect(o.doc, `défilement horizontal de la page (${where})`).toBeLessThanOrEqual(1);
  if (o.main !== null) expect(o.main, `défilement horizontal de la zone principale (${where})`).toBeLessThanOrEqual(1);
}
