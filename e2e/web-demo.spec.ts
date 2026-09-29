// Parcours complet du site en mode démonstration (build de production sans clé Clerk),
// avec le stockage du navigateur : accueil, onboarding, génération, sources, exports,
// historique, favoris, tableau de bord, réglages, robustesse et accessibilité de base.

import { readFile, writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import {
  chooseOption, E2E_RELEASE, expect, expectDemoResult, fakeExe, generateAndRecord, HISTORY_KEY, makeDocx, PROFILE_COLLEGE,
  PROFILE_KEY, PROFILE_SUPERIEUR, readHistory, resultSection, seedProfile, snap, test,
} from './web-helpers';
import { COMMERCIAL_VENDOR } from '../tests/vendor';

// Noms de fichiers accentués (« Cours — Écosystèmes.pdf ») : Chromium sous Linux les remplace par
// « download » si la locale du système n'est pas UTF-8. On impose donc une locale UTF-8 au navigateur.
test.use({ launchOptions: { env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } } });

async function expectButtonsNamed(page: Page, where: string): Promise<number> {
  const buttons = page.locator('button');
  const count = await buttons.count();
  let checked = 0;
  for (let i = 0; i < count; i++) {
    const button = buttons.nth(i);
    if (!(await button.isVisible())) continue;
    const html = await button.evaluate(el => el.outerHTML.slice(0, 160));
    await expect(button, `${where} : bouton sans nom accessible ${html}`).toHaveAccessibleName(/\S/);
    checked++;
  }
  return checked;
}

async function generateCours(page: Page, sujet: string) {
  await page.goto('/app/generate?type=cours');
  await page.locator('#gen-sujet').fill(sujet);
  const rec = await generateAndRecord(page);
  await expectDemoResult(page, rec);
  return rec;
}

// ─── 1. Accueil ─────────────────────────────────────────────────────────────

test('accueil : rendu sans erreur, polices servies localement, CTA « Commencer » → /onboarding', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('L\'IA qui prépare');
  await expect(page.getByRole('note').filter({ hasText: 'Vous êtes sur la démonstration' })).toBeVisible();
  await expect(page.locator('link[href*="googleapis"], link[href*="gstatic"], link[href*="fonts."]')).toHaveCount(0);

  // Parcours de toute la page (sections, images de fond, polices).
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 30));
    }
    await document.fonts.ready;
  });
  const fonts = await page.evaluate(() =>
    performance.getEntriesByType('resource').map(e => e.name).filter(n => /\.(woff2?|ttf|otf)(\?|$)/.test(n)));
  expect(fonts.length, 'polices chargées').toBeGreaterThan(0);
  for (const url of fonts) expect(new URL(url).host).toBe('127.0.0.1:4173');
  const families = await page.evaluate(() => Array.from(document.fonts).filter(f => f.status === 'loaded').map(f => f.family));
  expect(families.join(' ')).toMatch(/DM Sans/);
  await snap(page, '01-accueil', true);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('link', { name: 'Commencer' }).first().click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole('heading', { name: /Bienvenue sur Magistra/ })).toBeVisible();
});

test('vers la vraie IA : une seule voie (Magistra pour Windows), téléchargement direct, trois étapes, « Ouvrir Magistra »', async ({ page }) => {
  await seedProfile(page, PROFILE_SUPERIEUR);
  await page.goto('/app');
  // Le bandeau reste : exemples pré-rédigés, aucune IA.
  await expect(page.getByRole('note').filter({ hasText: 'Mode démonstration.' })).toContainText('aucune IA n’est utilisée');
  const card = page.getByTestId('connect-real-ai');
  await expect(card.getByText('Passez à la vraie IA : installez Magistra sur votre ordinateur Windows.')).toBeVisible();
  await expect(card.getByText('L’IA y fonctionne gratuitement, en privé, même sans Internet.')).toBeVisible();
  // Téléchargement direct de l'installateur de la dernière version stable (sans nouvel onglet).
  const download = card.getByRole('link', { name: 'Télécharger Magistra pour Windows' });
  await expect(download).toHaveAttribute('href', E2E_RELEASE.downloadUrl);
  await expect(download).not.toHaveAttribute('target', /./);
  // Un clic télécharge le fichier : sa taille (et la configuration requise) est annoncée à côté du bouton.
  await expect(card.getByTestId('windows-installer-facts')).toHaveText(/^Installateur : 85,3\sMo · version 2\.0\.0 · Windows 10 ou 11 \(64 bits\)$/);
  const steps = card.getByRole('list', { name: 'Installation en trois étapes' }).getByRole('listitem');
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText('Téléchargez Magistra.');
  await expect(steps.nth(1)).toContainText('Si Windows affiche « Windows a protégé votre ordinateur », cliquez sur « Informations complémentaires » puis « Exécuter quand même ».');
  await expect(steps.nth(2)).toContainText('sans droits d’administrateur, et s’ouvre toute seule.');
  await expect(card.getByText('Déjà installée ?')).toBeVisible();
  await expect(card.getByRole('link', { name: 'Ouvrir Magistra' })).toHaveAttribute('href', 'magistra://open');
  await expect(card.getByRole('link', { name: 'Mode d’emploi' })).toHaveAttribute('href', /#brancher-une-vraie-ia$/);
  // Rien de technique pour l'enseignant, et plus rien à déplier.
  expect(await card.innerText()).not.toMatch(/npm|ollama|clerk|supabase|AI_PRESET|OVHcloud|variable|localhost|trois solutions/i);
  await expect(card.locator('details, form, input')).toHaveCount(0);
  await card.scrollIntoViewIfNeeded();
  await snap(page, '03b-carte-vraie-ia');

  // Même carte sur la page Générer, sans masquer le formulaire de démonstration.
  await page.goto('/app/generate');
  await expect(page.getByTestId('connect-real-ai').getByRole('link', { name: 'Télécharger Magistra pour Windows' }))
    .toHaveAttribute('href', E2E_RELEASE.downloadUrl);
  await expect(page.getByRole('button', { name: 'Générer : Cours' })).toBeVisible();

  // Accueil : « Télécharger pour Windows » mène à la section (téléchargement direct, étapes, « Ouvrir Magistra »).
  await page.goto('/');
  await page.getByRole('link', { name: 'Télécharger pour Windows' }).first().click();
  await expect(page).toHaveURL(/\/#magistra-windows$/);
  const section = page.locator('section#magistra-windows');
  await expect(section.getByRole('heading', { name: 'Magistra pour Windows' })).toBeInViewport();
  await expect(section.getByRole('link', { name: 'Télécharger Magistra pour Windows' })).toHaveAttribute('href', E2E_RELEASE.downloadUrl);
  await expect(section.getByTestId('windows-version')).toHaveText(E2E_RELEASE.version);
  await expect(section.getByRole('list', { name: 'Installation en trois étapes' }).getByRole('listitem')).toHaveCount(3);
  await expect(section.getByRole('link', { name: 'Ouvrir Magistra' })).toHaveAttribute('href', 'magistra://open');
  await snap(page, '01b-accueil-windows');
});

// ─── 2. Onboarding ──────────────────────────────────────────────────────────

test('onboarding complet (Supérieur) → tableau de bord ; le profil résiste au rechargement', async ({ page }) => {
  await page.goto('/app');
  await expect(page).toHaveURL(/\/onboarding$/); // garde : pas de profil

  await page.getByRole('button', { name: /Continuer/ }).click();
  await expect(page.getByRole('heading', { name: 'Votre établissement' })).toBeFocused();
  await page.locator('#onb-etablissement').fill('Université de Bordeaux');
  await page.locator('#onb-nom').fill('Mme Dupont');
  await page.getByRole('button', { name: /Continuer/ }).click();

  await expect(page.getByRole('heading', { name: 'Vos niveaux' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Continuer/ })).toBeDisabled();
  await page.getByRole('group', { name: 'Cycle' }).getByRole('button', { name: /Supérieur/ }).click();
  await page.getByRole('button', { name: 'Master 1', exact: true }).click();
  await page.getByRole('button', { name: 'Master 2', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Master 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Continuer/ }).click();

  await expect(page.getByRole('heading', { name: 'Vos matières' })).toBeVisible();
  await page.getByRole('group', { name: 'Matière principale' }).getByRole('button', { name: /Informatique/ }).click();
  await page.locator('#onb-discipline').fill("Systèmes d'information");
  await snap(page, '02-onboarding-matieres');
  await page.getByRole('button', { name: /Continuer/ }).click();

  const recap = page.locator('dl');
  await expect(recap).toContainText('Université de Bordeaux');
  await expect(recap).toContainText('Supérieur');
  await expect(recap).toContainText('Master 1, Master 2');
  await expect(recap).toContainText('Informatique');
  await expect(recap).toContainText("Systèmes d'information");
  await expect(page.getByText('Mode démonstration : votre profil est enregistré dans ce navigateur uniquement.')).toBeVisible();
  await page.getByRole('button', { name: /Commencer à générer/ }).click();

  await expect(page).toHaveURL(/\/app$/);
  const checkDashboard = async () => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Mme Dupont');
    // Date en français : seule la première lettre est en capitale (« Lundi 28 septembre »).
    const dateLine = page.locator('main h1 + p');
    await expect(dateLine).toHaveText(/^\p{Ll}+ \d{1,2} \p{Ll}+$/u);
    expect(await dateLine.evaluate(el => getComputedStyle(el).textTransform)).toBe('none');
    const card = page.locator('section[aria-labelledby="profile-title"]');
    await expect(card.getByRole('heading', { name: 'Mme Dupont' })).toBeVisible();
    await expect(card).toContainText('Université de Bordeaux');
    await expect(card).toContainText('Master 1, Master 2');
    await expect(card).toContainText('Informatique');
    await expect(card).toContainText("Systèmes d'information");
    await expect(page.getByRole('note').filter({ hasText: 'Mode démonstration.' })).toBeVisible();
  };
  await checkDashboard();
  await snap(page, '03-tableau-de-bord');

  await page.reload();
  await expect(page).toHaveURL(/\/app$/);
  await checkDashboard();

  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), PROFILE_KEY);
  expect(stored).toMatchObject({ cycle: 'superieur', niveaux: ['master_1', 'master_2'], matierePrincipale: 'informatique' });

  // Accueil : le bouton mène désormais à l'espace.
  await page.goto('/');
  await page.getByRole('link', { name: 'Mon espace' }).first().click();
  await expect(page).toHaveURL(/\/app$/);
});

test('onboarding Collège : profil enregistré avec la matière choisie', async ({ page }) => {
  await page.goto('/onboarding');
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.getByRole('button', { name: /Passer cette étape/ }).click();
  await page.getByRole('group', { name: 'Cycle' }).getByRole('button', { name: /Collège/ }).click();
  await page.getByRole('button', { name: '4ème', exact: true }).click();
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.getByRole('group', { name: 'Matière principale' }).getByRole('button', { name: /Mathématiques/ }).click();
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.getByRole('button', { name: /Commencer à générer/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  const card = page.locator('section[aria-labelledby="profile-title"]');
  await expect(card).toContainText('4ème');
  await expect(card).toContainText('Mathématiques');
});

test('onboarding maternelle : la matière par défaut n\'est pas « Français »', async ({ page }) => {
  await page.goto('/onboarding');
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.getByRole('button', { name: /Passer cette étape/ }).click();
  await page.getByRole('group', { name: 'Cycle' }).getByRole('button', { name: /Maternelle/ }).click();
  await page.getByRole('button', { name: 'Petite Section (PS)', exact: true }).click();
  await page.getByRole('button', { name: /Continuer/ }).click();

  const matieres = page.getByRole('group', { name: 'Matière principale' });
  await expect(matieres.getByRole('button', { name: /Français/ })).toHaveCount(0);
  const pressed = matieres.locator('button[aria-pressed="true"]');
  await expect(pressed).toHaveCount(1);
  await expect(pressed).not.toContainText('Français');
  const defaultLabel = (await pressed.innerText()).trim();

  await page.getByRole('button', { name: /Continuer/ }).click();
  const row = page.locator('dl > div').filter({ hasText: 'Matière principale' });
  await expect(row).not.toContainText('Français');
  await page.getByRole('button', { name: /Commencer à générer/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  const card = page.locator('section[aria-labelledby="profile-title"]');
  await expect(card).not.toContainText('Français');
  await expect(card).toContainText(defaultLabel.replace(/^\S+\s+/, ''));
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? 'null'), PROFILE_KEY);
  expect(stored.matierePrincipale).not.toBe('francais');
  expect(stored.niveaux).toEqual(['maternelle_ps']);
});

// ─── 3. Générer ─────────────────────────────────────────────────────────────

test('générer « Cours » au niveau Master 1 : flux progressif, démonstration honnête, tableau, enregistrement', async ({ page }) => {
  await seedProfile(page, PROFILE_COLLEGE);
  await page.goto('/app/generate');
  await expect(page.getByRole('button', { name: 'Générer : Cours' })).toBeVisible();

  // Sujet obligatoire : message clair et focus sur le champ.
  await page.getByRole('button', { name: 'Générer : Cours' }).click();
  await expect(page.locator('#gen-submit-status')).toHaveText('Indiquez un sujet.');
  await expect(page.locator('#gen-sujet')).toBeFocused();
  await expect(resultSection(page)).toHaveCount(0);

  await chooseOption(page, 'gen-niveau', 'Master 1');
  await expect(page.locator('#gen-niveau')).toContainText('Master 1');
  await expect(page.locator('#gen-discipline')).toBeVisible(); // champ propre au supérieur
  await page.locator('#gen-sujet').fill("La gouvernance des systèmes d'information");
  await page.locator('#gen-discipline').fill('UE Gouvernance des SI');

  const rec = await generateAndRecord(page);
  await expectDemoResult(page, rec);
  const result = resultSection(page);
  await expect(result.locator('#gen-result-title')).toHaveText('Cours');
  await expect(result).toContainText("Master 1 · Mathématiques (UE Gouvernance des SI) · La gouvernance des systèmes d'information");
  await snap(page, '04-generer-cours-master1', true);

  const history = await readHistory(page);
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({ type: 'cours', sujet: "La gouvernance des systèmes d'information", isFavorite: false });
});

test('générer « Appréciations » : 7 appréciations annoncées', async ({ page }) => {
  await seedProfile(page, PROFILE_COLLEGE);
  await page.goto('/app/generate?type=appreciations');
  await expect(page.getByRole('button', { name: 'Générer : Appréciations' })).toBeVisible();
  const nombre = page.locator('#gen-nombre');
  await expect(page.locator('#gen-nombre-summary')).toHaveText(/Magistra rédigera 10 appréciations/);
  await nombre.fill('7');
  await nombre.blur();
  await expect(nombre).toHaveValue('7');
  await expect(page.locator('#gen-nombre-summary')).toHaveText(/Magistra rédigera 7 appréciations$/);

  // Valeur invalide : message, pas de génération.
  await nombre.fill('');
  await page.getByRole('button', { name: 'Générer : Appréciations' }).click();
  await expect(page.locator('#gen-submit-status')).toContainText("Indiquez un nombre d'appréciations");
  await nombre.fill('7');
  await expect(page.locator('#gen-nombre-summary')).toHaveText(/Magistra rédigera 7 appréciations$/);

  const rec = await generateAndRecord(page);
  await expectDemoResult(page, rec);
  await expect(resultSection(page).locator('#gen-result-title')).toHaveText('Appréciations');
  const history = await readHistory(page);
  expect(history[0].type).toBe('appreciations');
});

test('générer « Différenciation » : zone multiligne « contenu à adapter »', async ({ page }) => {
  await seedProfile(page, PROFILE_COLLEGE);
  await page.goto('/app/generate?type=differenciation');
  await page.getByRole('button', { name: 'Générer : Différenciation' }).click();
  await expect(page.locator('#gen-submit-status')).toHaveText('Indiquez un sujet ou collez le contenu à adapter.');

  const contenu = page.getByLabel(/Exercice ou contenu à adapter/);
  expect(await contenu.evaluate(el => el.tagName)).toBe('TEXTAREA');
  await contenu.fill('Exercice 1 — Calcule : 3/4 + 1/2\nExercice 2 — Range : 2/3 ; 1/2 ; 5/6');
  await contenu.press('End');
  await contenu.press('Enter'); // Entrée = nouvelle ligne, jamais une génération
  await contenu.pressSequentially('Exercice 3 — Simplifie 12/16');
  await expect(contenu).toHaveValue('Exercice 1 — Calcule : 3/4 + 1/2\nExercice 2 — Range : 2/3 ; 1/2 ; 5/6\nExercice 3 — Simplifie 12/16');
  await expect(resultSection(page)).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(3);

  const rec = await generateAndRecord(page);
  await expectDemoResult(page, rec);
  await expect(resultSection(page).locator('#gen-result-title')).toHaveText('Différenciation');
});

test('générer « Corrigé annoté » : travail à corriger obligatoire', async ({ page }) => {
  await seedProfile(page, PROFILE_COLLEGE);
  await page.goto('/app/generate?type=corrige');
  await page.getByRole('button', { name: 'Générer : Corrigé annoté' }).click();
  await expect(page.locator('#gen-submit-status')).toHaveText('Collez le travail à corriger.');
  await expect(page.locator('#gen-copie')).toBeFocused();

  await page.locator('#gen-sujet').fill('Résoudre 2x + 3 = 11');
  await page.locator('#gen-copie').fill('2x + 3 = 11\n2x = 14\nx = 7');
  const rec = await generateAndRecord(page);
  await expectDemoResult(page, rec);
  await expect(resultSection(page).locator('#gen-result-title')).toHaveText('Corrigé annoté');
});

test('arrêter une génération : « Génération interrompue. », texte partiel conservé, puis « Recommencer »', async ({ page }) => {
  await seedProfile(page, PROFILE_SUPERIEUR);
  await page.goto('/app/generate?type=cours');
  await page.locator('#gen-sujet').fill('Architecture des réseaux');
  await page.getByRole('button', { name: /^Générer : / }).click();

  const result = resultSection(page);
  const stop = result.getByRole('button', { name: 'Arrêter' });
  await expect(stop).toBeVisible();
  await expect(page.getByRole('button', { name: /Génération en cours/ })).toBeDisabled();
  await expect(result.locator('.prose-content')).toContainText('Mode démonstration');
  await stop.click();

  await expect(result.getByText('Génération interrompue. Le texte déjà produit est conservé ci-dessous.')).toBeVisible();
  await expect(stop).toHaveCount(0);
  const partial = await result.locator('.prose-content').innerText();
  expect(partial.length).toBeGreaterThan(0);
  await expect(result.getByText(/Enregistré dans l'historique/)).toHaveCount(0);
  await page.waitForTimeout(500); // aucun texte n'arrive après l'arrêt
  expect(await result.locator('.prose-content').innerText()).toBe(partial);
  expect(await readHistory(page)).toHaveLength(0);
  await snap(page, '05-generation-interrompue');

  // Les actions restent disponibles sur le texte partiel.
  await expect(result.getByRole('group', { name: 'Actions sur le contenu' })).toBeVisible();

  const recording = page.evaluate(() => new Promise<{ snapshots: string[]; done: boolean }>(resolve => {
    const snapshots: string[] = [];
    let running = false;
    const start = performance.now();
    const tick = () => {
      const section = document.querySelector('section[aria-labelledby="gen-result-title"]');
      const labels = Array.from(section?.querySelectorAll('button') ?? []).map(b => b.textContent?.trim());
      if (labels.includes('Arrêter')) running = true;
      const text = section?.querySelector('.prose-content')?.textContent ?? '';
      if (running && snapshots[snapshots.length - 1] !== text) snapshots.push(text);
      const done = running && labels.includes('Recommencer');
      if (done || performance.now() - start > 30_000) resolve({ snapshots, done });
      else requestAnimationFrame(tick);
    };
    tick();
  }));
  await result.getByRole('button', { name: 'Recommencer' }).click();
  const rec = await recording;
  await expectDemoResult(page, { ...rec, sawStop: true });
  const full = await result.locator('.prose-content').innerText();
  expect(full.length).toBeGreaterThan(partial.length);
  expect(await readHistory(page)).toHaveLength(1);
});

// ─── 4. Sources ─────────────────────────────────────────────────────────────

test('sources : TXT et DOCX analysés dans le navigateur ; faux PDF refusé clairement', async ({ page }) => {
  await seedProfile(page, PROFILE_SUPERIEUR);
  await page.goto('/app/generate?type=cours');
  const input = page.locator('input[type="file"]');
  const docx = await makeDocx([
    { text: 'Introduction à la gouvernance', heading: true },
    { text: 'La gouvernance du SI aligne les décisions informatiques sur la stratégie.' },
    { text: 'Référentiels', heading: true },
    { text: 'ISO/IEC 38500 et COBIT structurent les responsabilités.' },
  ]);
  await input.setInputFiles([
    { name: 'notes-de-cours.txt', mimeType: 'text/plain', buffer: Buffer.from('Première ligne : définitions.\nDeuxième ligne : exemples.\nTroisième ligne : exercices.\n', 'utf8') },
    { name: 'plan-du-module.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx },
  ]);

  const list = page.getByRole('list', { name: 'Documents ajoutés' });
  const txt = list.getByRole('listitem').filter({ hasText: 'notes-de-cours.txt' });
  const word = list.getByRole('listitem').filter({ hasText: 'plan-du-module.docx' });
  await expect(txt).toContainText('Analysé');
  await expect(word).toContainText('Analysé');
  await expect(txt).toContainText(/·\s*\d+ (lignes?|paragraphes?|sections?|caractères)/);
  await expect(word).toContainText('· 2 sections');

  await input.setInputFiles({ name: 'programme.pdf', mimeType: 'application/pdf', buffer: fakeExe() });
  const bad = list.getByRole('listitem').filter({ hasText: 'programme.pdf' });
  await expect(bad).toContainText('« programme.pdf » est endommagé ou ne correspond pas à son extension.');
  await expect(bad).not.toContainText('Analysé');

  await input.setInputFiles({ name: 'installeur.exe', mimeType: 'application/octet-stream', buffer: fakeExe() });
  await expect(list.getByRole('listitem').filter({ hasText: 'installeur.exe' }))
    .toContainText('Format non pris en charge. Formats acceptés : PDF, DOCX, PPTX, TXT, MD.');
  await snap(page, '06-sources', true);

  // Retirer un document.
  await page.getByRole('button', { name: 'Retirer installeur.exe' }).click();
  await expect(list.getByRole('listitem').filter({ hasText: 'installeur.exe' })).toHaveCount(0);

  // La démonstration dit honnêtement qu'elle n'utilise pas les documents.
  await expect(page.getByText("Mode démonstration : vos documents sont analysés dans ce navigateur, mais l'exemple affiché ne les utilise pas.")).toBeVisible();
  await page.locator('#gen-sujet').fill('Gouvernance');
  const rec = await generateAndRecord(page);
  await expectDemoResult(page, rec);
});

// ─── 5. Exports ─────────────────────────────────────────────────────────────

test('exports : copier, Markdown, PDF et impression', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:4173' });
  await seedProfile(page, PROFILE_SUPERIEUR);
  await generateCours(page, 'Écosystèmes forestiers');
  const actions = resultSection(page).getByRole('group', { name: 'Actions sur le contenu' });

  // Copier
  await actions.getByRole('button', { name: 'Copier' }).click();
  await expect(actions.getByRole('button', { name: 'Copié' })).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('> Mode démonstration');
  expect(clip).toMatch(/\n\|.*\|\n\|\s*-+/); // tableau Markdown brut
  await expect(actions.getByRole('button', { name: 'Copier' })).toBeVisible({ timeout: 5_000 });

  // Markdown
  const [md] = await Promise.all([page.waitForEvent('download'), actions.getByRole('button', { name: 'Markdown' }).click()]);
  expect(md.suggestedFilename()).toBe('Cours — Écosystèmes forestiers.md');
  const mdText = await readFile(await md.path(), 'utf8');
  expect(mdText.startsWith('# Cours — Écosystèmes forestiers\n\n> Mode démonstration')).toBe(true);
  expect(mdText).toMatch(/^\|.*\|$/m);
  expect(mdText).toMatch(/^## /m);
  expect(mdText).not.toContain('<table');

  // PDF
  const pdfButton = actions.getByRole('button', { name: 'PDF' });
  const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), pdfButton.click()]);
  expect(pdf.suggestedFilename()).toBe('Cours — Écosystèmes forestiers.pdf');
  const pdfBytes = await readFile(await pdf.path());
  expect(pdfBytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(pdfBytes.length).toBeGreaterThan(10 * 1024);
  await expect(pdfButton).toBeEnabled();

  // Impression : window.print intercepté.
  await page.evaluate(() => {
    const w = window as unknown as { __prints: { printing: boolean; chars: number }[] };
    w.__prints = [];
    window.print = () => {
      w.__prints.push({
        printing: document.documentElement.classList.contains('mg-printing'),
        chars: document.querySelector('.print-root')?.textContent?.length ?? 0,
      });
      window.dispatchEvent(new Event('afterprint'));
    };
  });
  await actions.getByRole('button', { name: 'Imprimer' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __prints: unknown[] }).__prints.length)).toBe(1);
  const prints = await page.evaluate(() => (window as unknown as { __prints: { printing: boolean; chars: number }[] }).__prints);
  expect(prints[0].printing).toBe(true);
  expect(prints[0].chars).toBeGreaterThan(500);
  await expect(page.locator('.print-root')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.classList.contains('mg-printing'))).toBe(false);
  await expect(page.getByRole('alert')).toHaveCount(0);

  // Favori depuis le résultat, puis ouverture dans l'historique.
  const favorite = actions.getByRole('button', { name: 'Favori' });
  await expect(favorite).toHaveAttribute('aria-pressed', 'false');
  await favorite.click();
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await readHistory(page))[0]?.isFavorite).toBe(true);
  await resultSection(page).getByRole('link', { name: "Voir dans l'historique" }).click();
  await expect(page).toHaveURL(/\/app\/history\?id=/);
  const detail = page.getByRole('region', { name: 'Contenu sélectionné' });
  await expect(detail.getByRole('heading', { name: 'Écosystèmes forestiers' })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Favori' })).toHaveAttribute('aria-pressed', 'true');

  // Exports depuis le détail de l'historique.
  await detail.getByRole('button', { name: 'Copier le contenu' }).click();
  await expect(detail.getByRole('button', { name: 'Contenu copié' })).toBeVisible();
  const [md2] = await Promise.all([page.waitForEvent('download'), detail.getByRole('button', { name: 'Exporter en Markdown' }).click()]);
  expect(md2.suggestedFilename()).toBe('Écosystèmes forestiers.md');
  expect(await readFile(await md2.path(), 'utf8')).toContain('> Mode démonstration');
  const [pdf2] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    detail.getByRole('button', { name: 'Exporter en PDF' }).click(),
  ]);
  expect(pdf2.suggestedFilename()).toBe('Écosystèmes forestiers.pdf');
  const pdf2Bytes = await readFile(await pdf2.path());
  expect(pdf2Bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(pdf2Bytes.length).toBeGreaterThan(10 * 1024);
  await detail.getByRole('button', { name: 'Imprimer' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __prints: unknown[] }).__prints?.length ?? 0)).toBe(2);
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0);
});

// ─── 6. Historique, favoris, tableau de bord ────────────────────────────────

test('historique : recherche sans accents, détail, favori, suppression confirmée ; favoris et statistiques exactes', async ({ page }) => {
  await seedProfile(page, PROFILE_COLLEGE);
  await generateCours(page, 'Écosystèmes forestiers et équilibre écologique');
  await page.goto('/app/generate?type=appreciations');
  await generateAndRecord(page).then(rec => expectDemoResult(page, rec));

  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Historique' }).click();
  await expect(page).toHaveURL(/\/app\/history$/);
  await expect(page.getByText('2 contenus', { exact: true })).toBeVisible();
  const listSection = page.getByRole('region', { name: 'Liste : Historique' });
  const search = page.getByRole('searchbox', { name: /Rechercher dans l’historique/ });

  await search.fill('ecosystemes EQUILIBRE');
  await expect(listSection.getByRole('status').filter({ hasText: '1 résultat' })).toBeVisible();
  const item = listSection.getByRole('link', { name: /Écosystèmes forestiers et équilibre écologique/ });
  await expect(item).toBeVisible();
  await search.fill('zzz introuvable');
  await expect(page.getByText('Aucun résultat pour « zzz introuvable »')).toBeVisible();
  await search.fill('');
  await expect(listSection.getByRole('link')).toHaveCount(2);

  // Détail par clic.
  await item.click();
  await expect(page).toHaveURL(/\/app\/history\?id=/);
  const id = new URL(page.url()).searchParams.get('id')!;
  const detail = page.getByRole('region', { name: 'Contenu sélectionné' });
  await expect(detail.getByRole('heading', { name: 'Écosystèmes forestiers et équilibre écologique' })).toBeVisible();
  await expect(detail.locator('.prose-content table').first()).toBeVisible();
  await expect(item).toHaveAttribute('aria-current', 'true');
  // Honnêteté : un exemple de démonstration n'est jamais présenté comme produit par une IA.
  await expect(detail.getByText('Exemple pré-rédigé de la démonstration : aucune IA n’a été utilisée.')).toBeVisible();
  await expect(detail.getByText(/Contenu produit par IA/)).toHaveCount(0);
  await snap(page, '07-historique-detail');

  // Détail par URL directe.
  await page.goto(`/app/history?id=${encodeURIComponent(id)}`);
  await expect(detail.getByRole('heading', { name: 'Écosystèmes forestiers et équilibre écologique' })).toBeVisible();
  await page.goto('/app/history?id=inexistant');
  await expect(detail.getByText('Ce contenu est introuvable.')).toBeVisible();
  await page.goto(`/app/history?id=${encodeURIComponent(id)}`);

  // Favori : bascule.
  const fav = detail.getByRole('button', { name: 'Favori' });
  await expect(fav).toHaveAttribute('aria-pressed', 'false');
  await fav.click();
  await expect(fav).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Ajouté aux favoris.')).toBeVisible();
  await fav.click();
  await expect(fav).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('Retiré des favoris.')).toBeVisible();
  await fav.click();
  await expect(fav).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await readHistory(page)).find(r => r.id === id)?.isFavorite).toBe(true);
  await expect(listSection.getByRole('link', { name: /Écosystèmes/ })).toContainText('Favori');

  // Favoris
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Favoris' }).click();
  await expect(page.getByText('1 favori', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Liste : Favoris' }).getByRole('link', { name: /Écosystèmes forestiers/ })).toBeVisible();

  // Tableau de bord : statistiques exactes, aucune mention de quota.
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Tableau de bord' }).click();
  const stats = page.locator('section[aria-labelledby="stats-title"]');
  await expect(stats).toContainText('2 contenus au total');
  await expect(stats).toContainText('2 générations · 1 favori');
  const card = page.locator('section[aria-labelledby="profile-title"]');
  await expect(card.locator('div').filter({ hasText: /^Total généré/ })).toContainText('2');
  await expect(card.locator('div').filter({ hasText: /^Favoris/ })).toContainText('1');
  const recent = page.locator('section[aria-labelledby="recent-title"]');
  await expect(recent.getByRole('link')).toHaveCount(3); // 2 contenus + « Tout voir »
  const mainText = await page.locator('main').innerText();
  expect(mainText).not.toMatch(/restant/i);
  expect(mainText).not.toMatch(/quota/i);
  expect(mainText).not.toMatch(/\/\s*20\b|\b20\s*\/|\b20 (générations|par jour)/i);
  expect(await stats.innerText()).not.toMatch(/\b20\b/);
  await snap(page, '08-tableau-de-bord-stats');

  // Suppression avec confirmation : Annuler, puis Supprimer.
  await page.goto(`/app/history?id=${encodeURIComponent(id)}`);
  await detail.getByRole('button', { name: 'Supprimer ce contenu' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Supprimer ce contenu ?' });
  await expect(dialog).toContainText('et de vos favoris');
  await expect(dialog.getByRole('button', { name: 'Annuler' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await readHistory(page)).toHaveLength(2);
  await expect(detail.getByRole('heading', { name: /Écosystèmes forestiers/ })).toBeVisible();

  await detail.getByRole('button', { name: 'Supprimer ce contenu' }).click();
  await dialog.getByRole('button', { name: 'Supprimer' }).click();
  await expect(page.getByText('Contenu supprimé.')).toBeVisible();
  await expect(page).toHaveURL(/\/app\/history$/);
  await expect(page.getByText('1 contenu', { exact: true })).toBeVisible();
  expect(await readHistory(page)).toHaveLength(1);

  await page.goto('/app');
  await expect(stats).toContainText('1 contenu au total');
  await expect(card.locator('div').filter({ hasText: /^Favoris/ })).toContainText('0');
  await page.goto('/app/favorites');
  await expect(page.getByText('Aucun favori pour le moment')).toBeVisible();
});

// ─── 7. Réglages ────────────────────────────────────────────────────────────

test('réglages : aucune mention trompeuse ; effacement des données avec confirmation', async ({ page }) => {
  await seedProfile(page, PROFILE_SUPERIEUR);
  await generateCours(page, 'Réseaux');
  await page.goto('/app/settings');
  await expect(page.getByRole('heading', { name: 'Réglages', level: 1 })).toBeVisible();
  await expect(page.getByText('Mode démonstration', { exact: true })).toBeVisible();
  const text = await page.locator('main').innerText();
  for (const forbidden of [COMMERCIAL_VENDOR, /supabase/i, /clé API/i, /20\s*\/\s*jour/i, /RGPD[\s-]*compliant/i, /restantes/i]) {
    expect(text, `mention interdite ${forbidden}`).not.toMatch(forbidden);
  }
  await expect(page.locator('section[aria-labelledby="settings-profile"]')).toContainText('Master 1, Master 2');
  await snap(page, '09-reglages', true);

  const clear = page.getByRole('button', { name: 'Effacer les données de démonstration' });
  await clear.click();
  const dialog = page.getByRole('alertdialog', { name: 'Effacer les données de démonstration ?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(clear).toBeFocused();
  expect(await readHistory(page)).toHaveLength(1);

  await clear.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await readHistory(page)).toHaveLength(1);

  await clear.click();
  await dialog.getByRole('button', { name: 'Effacer' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole('heading', { name: /Bienvenue sur Magistra/ })).toBeVisible();
  const keys = await page.evaluate(([a, b]) => [localStorage.getItem(a), localStorage.getItem(b)], [PROFILE_KEY, HISTORY_KEY] as const);
  expect(keys).toEqual([null, null]);
  await page.goto('/app/history');
  await expect(page).toHaveURL(/\/onboarding$/);
});

// ─── 8. Robustesse ──────────────────────────────────────────────────────────

test('robustesse : outil inconnu → « Cours », route inconnue → accueil, rechargement direct', async ({ page }) => {
  await seedProfile(page, PROFILE_SUPERIEUR);
  await page.goto('/app/generate?type=inexistant');
  await expect(page.getByRole('button', { name: 'Générer : Cours' })).toBeVisible();
  const tools = page.getByRole('navigation', { name: 'Outils de génération' }).filter({ visible: true });
  await expect(tools.getByRole('button', { name: /Cours/ })).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/app/generate?type=corrige');
  await expect(page.getByRole('button', { name: 'Générer : Correction de copie' })).toBeVisible();

  await page.goto('/cette/page/nexiste/pas');
  await expect(page).toHaveURL('http://127.0.0.1:4173/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('L\'IA qui prépare');

  await page.goto('/app/page-inconnue');
  await expect(page).toHaveURL('http://127.0.0.1:4173/');

  await page.goto('/app/history');
  await expect(page.getByRole('heading', { name: 'Historique', level: 1 })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/app\/history$/);
  await expect(page.getByRole('heading', { name: 'Historique', level: 1 })).toBeVisible();
  await expect(page.getByText('Aucune génération pour le moment')).toBeVisible();

  await page.goto('/app/settings');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Réglages', level: 1 })).toBeVisible();

  // Données illisibles dans le stockage : l'application ne plante pas.
  await page.evaluate(key => localStorage.setItem(key, '{pas du json'), HISTORY_KEY);
  await page.goto('/app');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Mme Dupont');
  await page.goto('/app/history');
  await expect(page.getByText('Aucune génération pour le moment')).toBeVisible();
});

// ─── Accessibilité de base ──────────────────────────────────────────────────

test('accessibilité : chaque bouton visible a un nom accessible (Générer, Historique, Réglages)', async ({ page }) => {
  await seedProfile(page, PROFILE_SUPERIEUR);
  await page.goto('/app/generate?type=differenciation');
  await expect(page.getByRole('button', { name: /^Générer : / })).toBeVisible();
  expect(await expectButtonsNamed(page, 'Générer (différenciation)')).toBeGreaterThan(10);
  await page.goto('/app/generate?type=cours');
  await page.locator('#gen-sujet').fill('Réseaux');
  await page.locator('input[type="file"]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Notes\n', 'utf8') });
  await expect(page.getByText('Analysé', { exact: true })).toBeVisible();
  await expectDemoResult(page, await generateAndRecord(page));
  expect(await expectButtonsNamed(page, 'Générer (résultat)')).toBeGreaterThan(10);

  await page.goto('/app/history');
  await page.getByRole('region', { name: 'Liste : Historique' }).getByRole('link').first().click();
  await expect(page.getByRole('button', { name: 'Supprimer ce contenu' })).toBeVisible();
  expect(await expectButtonsNamed(page, 'Historique')).toBeGreaterThan(4);

  await page.goto('/app/settings');
  await expect(page.getByRole('heading', { name: 'Réglages', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Effacer les données de démonstration' })).toBeVisible();
  expect(await expectButtonsNamed(page, 'Réglages')).toBeGreaterThan(1);
});

// ─── Parcours complémentaires ───────────────────────────────────────────────

test('générer : double-clic = une seule génération ; quitter la page pendant la génération', async ({ page }) => {
  await seedProfile(page, PROFILE_COLLEGE);
  await page.goto('/app/generate?sujet=Les%20fractions');
  await expect(page.locator('#gen-sujet')).toHaveValue('Les fractions');
  await page.getByRole('button', { name: 'Générer : Cours' }).dblclick();
  await expect(resultSection(page).getByRole('button', { name: 'Recommencer' })).toBeVisible({ timeout: 30_000 });
  expect(await readHistory(page)).toHaveLength(1);

  // Entrée dans le champ Sujet : génère (formulaire), sans doublon.
  await page.locator('#gen-sujet').press('Enter');
  await expect(resultSection(page).getByRole('button', { name: 'Arrêter' })).toBeVisible();
  // Quitter la page interrompt la génération : rien n'est enregistré, aucune erreur.
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Historique' }).click();
  await expect(page.getByRole('heading', { name: 'Historique', level: 1 })).toBeVisible();
  await page.waitForTimeout(2_500);
  expect(await readHistory(page)).toHaveLength(1);
  await expect(page.getByText('1 contenu', { exact: true })).toBeVisible();
});

test('tableau de bord : outils rapides et idées de sujets pré-remplissent Générer', async ({ page }) => {
  await seedProfile(page, PROFILE_COLLEGE);
  await page.goto('/app');
  const tools = page.locator('section[aria-labelledby="tools-title"]');
  await tools.getByRole('link', { name: /Différenciation/ }).click();
  await expect(page).toHaveURL(/\/app\/generate\?type=differenciation$/);
  await expect(page.getByRole('button', { name: 'Générer : Différenciation' })).toBeVisible();

  await page.goto('/app');
  const ideas = page.locator('section[aria-labelledby="ideas-title"]');
  const first = ideas.getByRole('link').first();
  const idea = (await first.locator('p').first().innerText()).trim();
  await first.click();
  await expect(page.locator('#gen-sujet')).toHaveValue(idea);
  await expect(page.locator('#gen-niveau')).toContainText('4ème');
  await expect(page.locator('#gen-matiere')).toContainText('Mathématiques');
});

test('profil : modification depuis les réglages (annuler, puis enregistrer)', async ({ page }) => {
  await seedProfile(page, PROFILE_COLLEGE);
  await page.goto('/app/settings');
  await page.getByRole('button', { name: 'Modifier mon profil' }).click();
  await expect(page).toHaveURL(/\/onboarding\?edit=1$/);
  await expect(page.getByText('Modification de votre profil')).toBeVisible();
  await expect(page.locator('#onb-etablissement')).toHaveValue('Collège Victor Hugo');
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(page).toHaveURL(/\/app\/settings$/);

  await page.getByRole('button', { name: 'Modifier mon profil' }).click();
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.getByRole('button', { name: '3ème', exact: true }).click();
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.getByRole('button', { name: /Continuer/ }).click();
  await expect(page.locator('dl')).toContainText('4ème, 3ème');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator('section[aria-labelledby="profile-title"]')).toContainText('4ème, 3ème');
  await page.reload();
  await expect(page.locator('section[aria-labelledby="profile-title"]')).toContainText('4ème, 3ème');
});

test('historique : pagination « Charger plus », recherche dans tout l’historique ; favoris retirés', async ({ page }) => {
  await seedProfile(page, PROFILE_COLLEGE);
  await page.evaluate(key => {
    const now = Date.now();
    const records = Array.from({ length: 35 }, (_, i) => ({
      id: `rec-${i}`,
      createdAt: new Date(now - i * 3_600_000).toISOString(),
      type: 'cours',
      niveau: '4eme',
      matiere: 'mathematiques',
      sujet: i === 33 ? 'Théorème de Pythagore' : `Chapitre ${i + 1}`,
      contenu: `# Chapitre ${i + 1}\n\n| A | B |\n|---|---|\n| 1 | 2 |\n`,
      isFavorite: i < 2,
      sources: [],
      params: { demo: true },
      model: 'démonstration',
    }));
    localStorage.setItem(key, JSON.stringify(records));
  }, HISTORY_KEY);

  await page.goto('/app/history');
  const list = page.getByRole('region', { name: 'Liste : Historique' });
  await expect(page.getByText('30+ contenus', { exact: true })).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveCount(30);
  // La recherche porte sur tout l'historique : la page suivante est chargée automatiquement.
  await page.getByRole('searchbox').fill('theoreme pythagore');
  await expect(list.getByRole('link', { name: /Théorème de Pythagore/ })).toBeVisible();
  await expect(page.getByText('1 résultat', { exact: true })).toBeVisible();
  await page.getByRole('searchbox').fill('');
  await expect(list.getByRole('listitem')).toHaveCount(35);
  await expect(page.getByText('35 contenus', { exact: true })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Charger plus' })).toHaveCount(0);

  // Tableau de bord : les statistiques ne sont pas plafonnées.
  await page.goto('/app');
  await expect(page.locator('section[aria-labelledby="stats-title"]')).toContainText('35 contenus au total');

  // Favoris : retirer un favori le fait disparaître de la liste.
  await page.goto('/app/favorites');
  const favs = page.getByRole('region', { name: 'Liste : Favoris' });
  await expect(page.getByText('2 favoris', { exact: true })).toBeVisible();
  await favs.getByRole('link').first().click();
  await page.getByRole('region', { name: 'Contenu sélectionné' }).getByRole('button', { name: 'Favori' }).click();
  await expect(page.getByText('Retiré des favoris.')).toBeVisible();
  await expect(page.getByText('1 favori', { exact: true })).toBeVisible();
  await expect(favs.getByRole('listitem')).toHaveCount(1);
});

test('sources : doublon signalé, 12 documents au maximum', async ({ page }, testInfo) => {
  await seedProfile(page, PROFILE_COLLEGE);
  await page.goto('/app/generate');
  const input = page.locator('input[type="file"]');
  // Un vrai fichier sur le disque : même nom, même taille, même date de modification à chaque sélection.
  const file = testInfo.outputPath('cours.md');
  await writeFile(file, '# Titre\n\nTexte.\n', 'utf8');
  await input.setInputFiles(file);
  await expect(page.getByText('Analysé', { exact: true })).toBeVisible();
  await input.setInputFiles(file);
  await expect(page.getByText('« cours.md » est déjà ajouté.')).toBeVisible();
  const list = page.getByRole('list', { name: 'Documents ajoutés' });
  await expect(list.getByRole('listitem')).toHaveCount(1);

  await input.setInputFiles(Array.from({ length: 12 }, (_, i) => ({
    name: `doc-${i + 1}.txt`, mimeType: 'text/plain', buffer: Buffer.from(`Document ${i + 1}\n`, 'utf8'),
  })));
  await expect(list.getByRole('listitem')).toHaveCount(12);
  await expect(page.getByText('12 documents maximum : 1 fichier a été ignoré.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ajouter des documents' })).toBeDisabled();
  await page.getByRole('button', { name: 'Masquer ce message' }).click();
  await expect(page.getByText('12 documents maximum')).toHaveCount(0);
});
