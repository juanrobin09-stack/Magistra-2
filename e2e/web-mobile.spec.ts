// Mise en page mobile du site en mode démonstration (390×844 et 430×932) :
// aucune barre de défilement horizontale, champs utilisables, menu mobile, barre d'actions du résultat.

import type { Page } from '@playwright/test';
import {
  expect, expectDemoResult, expectNoHorizontalScroll, generateAndRecord, PROFILE_COLLEGE, PROFILE_SUPERIEUR, resultSection,
  seedProfile, snap, test,
} from './web-helpers';

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];

async function expectInViewport(page: Page, selector: string | ReturnType<Page['locator']>, what: string) {
  const locator = typeof selector === 'string' ? page.locator(selector) : selector;
  const box = await locator.boundingBox();
  const width = page.viewportSize()!.width;
  expect(box, `${what} affiché`).not.toBeNull();
  expect(box!.x, `${what} : bord gauche`).toBeGreaterThanOrEqual(-0.5);
  expect(box!.x + box!.width, `${what} : bord droit`).toBeLessThanOrEqual(width + 0.5);
}

for (const viewport of VIEWPORTS) {
  test.describe(`mobile ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const tag = `${viewport.width}`;

    test('accueil et onboarding sans défilement horizontal', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page, 'accueil');
      await snap(page, `m${tag}-01-accueil`, true);

      await page.getByRole('link', { name: 'Commencer' }).first().click();
      await expect(page).toHaveURL(/\/onboarding$/);
      await expectNoHorizontalScroll(page, 'onboarding : bienvenue');
      await page.getByRole('button', { name: /Continuer/ }).click();
      await page.locator('#onb-etablissement').fill('Université de Bordeaux — UFR de sciences économiques, sociales et de gestion');
      await expectNoHorizontalScroll(page, 'onboarding : établissement');
      await page.getByRole('button', { name: /Continuer/ }).click();
      await page.getByRole('group', { name: 'Cycle' }).getByRole('button', { name: /Supérieur/ }).click();
      for (const n of ['Licence 3', 'Master 1', 'Master 2', 'Doctorat']) await page.getByRole('button', { name: n, exact: true }).click();
      await expectNoHorizontalScroll(page, 'onboarding : niveaux');
      await snap(page, `m${tag}-02-onboarding-niveaux`, true);
      await page.getByRole('button', { name: /Continuer/ }).click();
      await page.getByRole('group', { name: 'Matière principale' }).getByRole('button', { name: /Informatique/ }).click();
      await page.locator('#onb-discipline').fill("Systèmes d'information et gouvernance des données");
      await expectNoHorizontalScroll(page, 'onboarding : matières');
      await page.getByRole('button', { name: /Continuer/ }).click();
      await expectNoHorizontalScroll(page, 'onboarding : récapitulatif');
      await page.getByRole('button', { name: /Commencer à générer/ }).click();
      await expect(page).toHaveURL(/\/app$/);
      await expect(page.locator('section[aria-labelledby="profile-title"]')).toBeVisible();
      await expectNoHorizontalScroll(page, 'tableau de bord');
      await snap(page, `m${tag}-03-tableau-de-bord`, true);
    });

    test('menu mobile : ouverture, fermeture par Échap, navigation', async ({ page }) => {
      await seedProfile(page, PROFILE_COLLEGE);
      await page.goto('/app');
      const sidebar = page.locator('#app-sidebar');
      const menu = page.getByRole('button', { name: 'Ouvrir le menu' });
      await expect(sidebar).toBeHidden();
      await expect(menu).toHaveAttribute('aria-expanded', 'false');

      await menu.click();
      await expect(sidebar).toBeVisible();
      await expect(menu).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('button', { name: 'Fermer le menu' })).toBeFocused();
      await expect.poll(async () => (await sidebar.boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
      await expectNoHorizontalScroll(page, 'menu ouvert');
      await snap(page, `m${tag}-04-menu`);

      await page.keyboard.press('Escape');
      await expect(sidebar).toBeHidden();
      await expect(menu).toBeFocused();
      await expect(menu).toHaveAttribute('aria-expanded', 'false');

      // Bouton « Fermer ».
      await menu.click();
      await page.getByRole('button', { name: 'Fermer le menu' }).click();
      await expect(sidebar).toBeHidden();

      // Un lien du menu navigue et referme le tiroir.
      await menu.click();
      await sidebar.getByRole('link', { name: 'Réglages' }).click();
      await expect(page).toHaveURL(/\/app\/settings$/);
      await expect(sidebar).toBeHidden();
    });

    test('générer : champ Sujet large, résultat et actions sans débordement', async ({ page }) => {
      await seedProfile(page, PROFILE_SUPERIEUR);
      await page.goto('/app/generate?type=cours');
      const sujet = page.locator('#gen-sujet');
      await expect(sujet).toBeVisible();
      expect((await sujet.boundingBox())!.width, 'largeur du champ Sujet').toBeGreaterThanOrEqual(250);
      await expectNoHorizontalScroll(page, 'générer (avant)');
      await snap(page, `m${tag}-05-generer-avant`, true);

      // Tous les outils : aucun formulaire ne déborde.
      for (const type of ['differenciation', 'appreciations', 'corrige', 'lettre_parents', 'evaluation']) {
        await page.goto(`/app/generate?type=${type}`);
        await expect(page.getByRole('button', { name: /^Générer : / })).toBeVisible();
        await expectNoHorizontalScroll(page, `générer (${type})`);
      }

      await page.goto('/app/generate?type=cours');
      await sujet.fill('Gouvernance des systèmes d’information et conformité réglementaire des données personnelles');
      await expectDemoResult(page, await generateAndRecord(page));
      await expectNoHorizontalScroll(page, 'générer (après)');

      const result = resultSection(page);
      const actions = result.getByRole('group', { name: 'Actions sur le contenu' });
      await actions.scrollIntoViewIfNeeded();
      await expect(actions).toBeVisible();
      await expectInViewport(page, actions, "barre d'actions");
      for (const button of await actions.getByRole('button').all()) {
        await expect(button).toBeVisible();
        await expectInViewport(page, button, `bouton « ${(await button.innerText()).trim()} »`);
      }
      // Les tableaux défilent dans leur cadre, la page ne s'élargit pas.
      const table = result.locator('.table-wrap').first();
      await expectInViewport(page, table, 'tableau');
      await expectInViewport(page, result.getByRole('button', { name: 'Recommencer' }), 'Recommencer');
      await snap(page, `m${tag}-06-generer-apres`, true);
      await actions.scrollIntoViewIfNeeded();
      await snap(page, `m${tag}-07-actions`);
    });

    test('historique, favoris et réglages sans défilement horizontal', async ({ page }) => {
      await seedProfile(page, PROFILE_SUPERIEUR);
      await page.goto('/app/generate?type=evaluation');
      await page.locator('#gen-sujet').fill('Examen de réseaux : adressage IPv4, routage statique et contrôle de congestion TCP');
      await expectDemoResult(page, await generateAndRecord(page));

      await page.goto('/app/history');
      await expect(page.getByRole('heading', { name: 'Historique', level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page, 'historique (liste)');
      await snap(page, `m${tag}-08-historique`);

      await page.getByRole('region', { name: 'Liste : Historique' }).getByRole('link').first().click();
      const detail = page.getByRole('region', { name: 'Contenu sélectionné' });
      await expect(detail.locator('h2[tabindex="-1"]')).toBeFocused();
      await expect(page.getByRole('region', { name: 'Liste : Historique' })).toBeHidden();
      await expectNoHorizontalScroll(page, 'historique (détail)');
      await expectInViewport(page, detail.getByRole('group', { name: 'Actions sur ce contenu' }), 'actions du détail');
      await snap(page, `m${tag}-09-historique-detail`);
      await detail.getByRole('button', { name: 'Favori' }).click();
      await expect(detail.getByRole('button', { name: 'Favori' })).toHaveAttribute('aria-pressed', 'true');
      await detail.getByRole('button', { name: 'Retour à la liste' }).click();
      await expect(page.getByRole('region', { name: 'Liste : Historique' })).toBeVisible();

      await page.goto('/app/favorites');
      await expect(page.getByText('1 favori', { exact: true })).toBeVisible();
      await expectNoHorizontalScroll(page, 'favoris');

      await page.goto('/app/settings');
      await expect(page.getByRole('heading', { name: 'Réglages', level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page, 'réglages');
      await snap(page, `m${tag}-10-reglages`, true);

      await page.goto('/app');
      await expectNoHorizontalScroll(page, 'tableau de bord (avec contenu)');
    });
  });
}
