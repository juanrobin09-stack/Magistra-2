import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { SITE_GUIDES } from '../shared/siteGuides';
import { SITE_SEO } from '../shared/siteSeo';
import { SITE_ORIGIN } from '../shared/site';

test('les 12 guides sont lisibles et reliés sans JavaScript, avec leurs métadonnées et données structurées', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: 'http://127.0.0.1:4174' });
  try {
    const page = await context.newPage();
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto('/guides');
    const linkedGuides = await page.locator('main a[href^="/guides/"]').evaluateAll(links => links.map(link => link.getAttribute('href')));
    expect(new Set(linkedGuides)).toEqual(new Set(SITE_GUIDES.map(guide => guide.path)));
    for (const guide of SITE_GUIDES) {
      const response = await page.goto(guide.path);
      expect(response?.status(), guide.path).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(guide.heading);
      await expect(page).toHaveTitle(guide.title);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', guide.description);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${SITE_ORIGIN}${guide.path}`);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow, max-image-preview:large');
      const json = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() ?? '{}');
      expect(json['@graph'].some((item: { '@type': string }) => item['@type'] === 'Article')).toBe(true);
      expect(json['@graph'].some((item: { '@type': string }) => item['@type'] === 'BreadcrumbList')).toBe(true);
      for (const related of guide.related) await expect(page.locator(`main a[href="${related}"]`)).toHaveCount(1);
      const brokenAnchors = await page.locator('main a[href^="#"]').evaluateAll(links => links.filter(link => !document.getElementById(link.getAttribute('href')!.slice(1))).map(link => link.getAttribute('href')));
      expect(brokenAnchors, guide.path).toEqual([]);
      const faq = page.locator('main details').first();
      await faq.locator('summary').click();
      await expect(faq).toHaveAttribute('open', '');
    }
    expect(requests.filter(url => url.includes('/api/'))).toEqual([]);
  } finally { await context.close(); }
});

test('parcours accueil → guides → article → téléchargement sous la CSP de production, sur mobile', async ({ page }, testInfo) => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const headers = Object.fromEntries(config.headers[0].headers.map((header: { key: string; value: string }) => [header.key, header.value]));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/api/windows-release', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ available: false }) }));
  await page.route('**/*', async route => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    return route.fulfill({ response, headers: { ...response.headers(), ...headers } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Navigation du site' }).getByRole('link', { name: 'Guides', exact: true }).click();
  await expect(page).toHaveURL(/\/guides$/);
  await expect(page).toHaveTitle(SITE_SEO['/guides'].title);
  await page.screenshot({ path: testInfo.outputPath('guides-mobile.png') });
  const guide = SITE_GUIDES.find(item => item.path.endsWith('/pdf-scannes-documents'))!;
  await page.locator(`main a[href="${guide.path}"]`).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(guide.heading);
  await expect(page).toHaveTitle(guide.title);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${SITE_ORIGIN}${guide.path}`);
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article');
  const json = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() ?? '{}');
  expect(JSON.stringify(json)).toContain(`${SITE_ORIGIN}${guide.path}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('guide-pdf-mobile.png') });
  await page.getByRole('navigation', { name: 'Navigation du site' }).getByRole('link', { name: 'Télécharger', exact: true }).click();
  await expect(page).toHaveURL(/\/#magistra-windows$/);
  await expect(page.locator('#magistra-windows')).toBeInViewport();
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'website');
  expect(errors).toEqual([]);
});

test('une section de guide partagée par son ancre reste visible après hydratation', async ({ page }) => {
  await page.goto('/guides/pdf-scannes-documents#controle-lecture');
  await expect(page.locator('#controle-lecture')).toBeInViewport();
  await page.getByRole('navigation', { name: 'Navigation du site' }).getByRole('link', { name: 'Guides enseignants', exact: true }).click();
  await expect(page).toHaveURL(/\/guides$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
});
