// Site vitrine (build dédié : npm run build:site → dist-site/, servi par vite preview sur le port 4174) dans un vrai
// Chromium : la présentation de Magistra, le téléchargement de l'application Windows et les pages légales — aucune
// application dans le navigateur, aucun « Commencer », aucune connexion. Chaque test vérifie aussi, à la fin, qu'aucune
// erreur n'est apparue dans la console et qu'aucune requête n'est partie ailleurs que vers des fichiers statiques du
// site et GET /api/windows-release (jamais /api/mode, /api/status, un service de connexion ou une base de données).

import { expect, test as base, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { SITE_TITLE, SITE_IMAGE_PATH } from '../shared/siteSeo';
import { buildRobotsTxt, buildSitemapXml, SITE_ORIGIN } from '../shared/site';

const SITE_HOST = '127.0.0.1:4174';

/** Réponse de GET /api/windows-release simulée (même forme que le serveur Magistra). */
const RELEASE = {
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

const DIRECT_DOWNLOAD = 'https://github.com/juanrobin09-stack/magistra-downloads/releases/latest/download/Magistra-Setup.exe';

/** Ce qu'aucun bouton, aucun lien ni aucun texte du site ne dit : l'application n'est pas dans le navigateur. */
const NO_APP_ACCESS = /Commencer|Se connecter|Accéder à Magistra|Mon espace/;
const NO_APP_WORDING = /Commencer|Se connecter|Connexion|Accéder à Magistra|Mon espace|démonstration/;

interface Monitor {
  errors: string[];
  requests: { method: string; url: URL }[];
  /** Messages de console attendus par un test qui simule une panne (ex. « status of 500 » d'une réponse refusée). */
  tolerate: RegExp[];
}

const test = base.extend<{ monitor: Monitor }>({
  monitor: [
    async ({ page }, use) => {
      const monitor: Monitor = { errors: [], requests: [], tolerate: [] };
      // Version publiée simulée ; un test qui veut une autre réponse l'enregistre à son tour (la dernière route l'emporte).
      await page.route('**/api/windows-release', route => route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify(RELEASE),
      }));
      // Toute requête hors du site est interrompue et signalée : le téléchargement de l'installateur n'a jamais lieu.
      await page.route(url => url.host !== SITE_HOST && /^https?:/.test(url.protocol), route => {
        monitor.requests.push({ method: route.request().method(), url: new URL(route.request().url()) });
        return route.abort();
      });
      page.on('console', msg => {
        if (msg.type() === 'error') monitor.errors.push(`console : ${msg.text()}`);
      });
      page.on('pageerror', err => monitor.errors.push(`page : ${err.message}`));
      page.on('request', req => {
        const url = new URL(req.url());
        if (!/^https?:/.test(url.protocol)) return;
        if (!monitor.requests.some(r => r.url.href === url.href && r.method === req.method())) monitor.requests.push({ method: req.method(), url });
      });
      await use(monitor);
      expect(monitor.errors.filter(error => !monitor.tolerate.some(re => re.test(error))), 'erreurs dans la console').toEqual([]);
      const foreign = monitor.requests.filter(r => r.url.host !== SITE_HOST).map(r => r.url.href);
      expect(foreign, 'requêtes vers un domaine externe').toEqual([]);
      const own = monitor.requests.filter(r => r.url.host === SITE_HOST).map(r => r.url.pathname);
      expect(
        own.filter(path => !(path === '/' || path === '/index.html' || path.startsWith('/assets/') || path === '/api/windows-release' || LEGAL_OR_APP_PATH.test(path))),
        'requêtes du site hors fichiers statiques et /api/windows-release',
      ).toEqual([]);
    },
    { auto: true },
  ],
});

/** Pages du site, et adresses de l'application qui y reviennent à l'accueil : chargées comme page HTML (aucune API). */
const LEGAL_OR_APP_PATH = /^\/(?:mentions-legales|confidentialite|cgu|app(?:\/.*)?|onboarding|setup|presentation|inconnu)$/;

const FORBIDDEN_API = /\/api\/(?:mode|status|generate|generation|history|profile|account|stats)|clerk|supabase|127\.0\.0\.1:478\d\d/i;

/** Texte visible de la page, espaces insécables compris. */
async function pageText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}

test('SEO sans JavaScript : présentation, sources, FAQ et lien de téléchargement restent utilisables', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage();
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto(`http://${SITE_HOST}/`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText("L'IA qui prépare");
    await expect(page.getByRole('heading', { name: 'Sources officielles et académiques' })).toHaveCount(1);
    const question = page.locator('details').filter({ hasText: 'Sur quelles sources l’IA peut-elle s’appuyer ?' });
    await question.locator('summary').click();
    await expect(question).toHaveAttribute('open', '');
    await expect(question.locator('p')).toBeVisible();
    await expect(question.locator('p')).toContainText('HAL, Crossref et OpenAlex');
    await expect(page.getByRole('link', { name: 'Télécharger Magistra pour Windows', exact: true }).first()).toHaveAttribute('href', '/telecharger');
    expect(requests.some(url => url.includes('/api/'))).toBe(false);
  } finally {
    await context.close();
  }
});

test('SEO avec la CSP de production : hydratation, métadonnées de navigation et sources sur mobile', async ({ page }, testInfo) => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const securityHeaders = Object.fromEntries(config.headers[0].headers.map((header: { key: string; value: string }) => [header.key, header.value]));
  await page.route('**/*', async route => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), ...securityHeaders } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page).toHaveTitle(SITE_TITLE);
  const card = page.getByRole('heading', { name: 'Sources officielles et académiques' }).locator('..');
  await expect(card).toContainText('HAL, Crossref, OpenAlex');
  await card.screenshot({ path: testInfo.outputPath('sources-mobile.png') });
  await page.getByRole('link', { name: 'Politique de confidentialité', exact: true }).click();
  await expect(page).toHaveTitle('Politique de confidentialité — Magistra');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${SITE_ORIGIN}/confidentialite`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

// ─── 1. Accueil ─────────────────────────────────────────────────────────────

test('accueil : se charge, un seul h1, aucun accès à une application, « Télécharger pour Windows » présent', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('L\'IA qui prépare');
  await expect(page).toHaveTitle(SITE_TITLE);

  // Aucun bouton, aucun lien nommé « Commencer », « Se connecter », « Accéder à Magistra », « Mon espace ».
  await expect(page.getByRole('button', { name: NO_APP_ACCESS })).toHaveCount(0);
  await expect(page.getByRole('link', { name: NO_APP_ACCESS })).toHaveCount(0);
  const hrefs = await page.locator('a').evaluateAll(links => links.map(a => a.getAttribute('href') ?? ''));
  expect(hrefs.filter(href => /^\/(?:app|onboarding|setup|presentation)(?:[/?#]|$)/.test(href))).toEqual([]);
  expect(await pageText(page)).not.toMatch(NO_APP_WORDING);

  // Téléchargement : la barre de navigation et le héros mènent à la section « Magistra pour Windows », qui porte le
  // bouton de téléchargement lui-même : trois entrées, sans doublon (ni carte, ni appel final).
  await expect(page.getByRole('navigation', { name: 'Navigation du site' }).getByRole('link', { name: 'Télécharger' })).toHaveAttribute('href', '#magistra-windows');
  const download = page.getByRole('link', { name: 'Télécharger pour Windows' });
  await expect(download).toHaveCount(1);
  await expect(download).toBeVisible();
  await expect(download).toHaveAttribute('href', '#magistra-windows');
  await expect(page.getByRole('link', { name: /^Télécharger/ })).toHaveCount(3);
  await expect(page.locator('section#magistra-windows')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Découvrir FutureAI' }).first()).toHaveAttribute('href', 'https://futurai.space');
});

test('polices servies par le site lui-même, aucun service tiers', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('link[href*="googleapis"], link[href*="gstatic"], link[href*="fonts."]')).toHaveCount(0);
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 30));
    }
    await document.fonts.ready;
  });
  const fonts = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name).filter(n => /\.(woff2?|ttf|otf)(\?|$)/.test(n)));
  expect(fonts.length, 'polices chargées').toBeGreaterThan(0);
  for (const url of fonts) expect(new URL(url).host).toBe(SITE_HOST);
});

test('référencement : lien canonique et Open Graph à l’adresse officielle, robots.txt et plan du site servis par le site (jamais l’accueil)', async ({ page }) => {
  await page.goto('/');
  // Adresse officielle (shared/site.ts) : seulement des balises, jamais une ressource chargée (le moniteur le vérifie à la fin).
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${SITE_ORIGIN}/`);
  const og = await page.locator('meta[property^="og:"]').evaluateAll(metas => Object.fromEntries(metas.map(m => [m.getAttribute('property'), m.getAttribute('content')])));
  expect(og).toEqual({
    'og:type': 'website',
    'og:site_name': 'Magistra',
    'og:title': SITE_TITLE,
    'og:description': await page.locator('meta[name="description"]').getAttribute('content'),
    'og:url': `${SITE_ORIGIN}/`,
    'og:locale': 'fr_FR',
    'og:image': `${SITE_ORIGIN}${SITE_IMAGE_PATH}`,
    'og:image:width': '512',
    'og:image:height': '512',
    'og:image:type': 'image/png',
    'og:image:alt': 'Logo Magistra',
  });
  expect(Object.keys(og)).toContain('og:image');

  const robots = await page.request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(robots.headers()['content-type']).toContain('text/plain');
  expect(await robots.text()).toBe(buildRobotsTxt());
  expect(await robots.text()).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);

  const sitemap = await page.request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()['content-type']).toMatch(/xml/);
  const xml = await sitemap.text();
  expect(xml).toBe(buildSitemapXml());
  expect(xml).not.toContain('<html');
  // L'accueil seul : les pages légales sont servies avec le lien canonique de l'accueil, elles ne sont pas à indexer.
  expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(location => location[1])).toEqual([`${SITE_ORIGIN}/`]);
  await page.goto('/mentions-legales');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${SITE_ORIGIN}/mentions-legales`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
});

// ─── 2. Attribution ─────────────────────────────────────────────────────────

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`attribution lisible sans défiler (${viewport.width}x${viewport.height}) : « Juan Robin » et « Magistra, créé par Juan Robin »`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByText('Magistra, créé par Juan Robin').first()).toBeVisible();
    await expect(page.getByText('Magistra, créé par Juan Robin').first()).toBeInViewport({ ratio: 1 });
    await expect(page.getByText('Juan Robin').first()).toBeInViewport({ ratio: 1 });
    await expect(page.getByText('un projet FutureAI').first()).toBeInViewport();
    // Le bouton principal reste lui aussi sur le premier écran.
    await expect(page.getByRole('link', { name: 'Télécharger pour Windows' }).first()).toBeInViewport();
  });
}

test('« Qui est derrière Magistra ? » et pied de page : attribution, FutureAI, licence', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Qui est derrière Magistra ?' })).toBeVisible();
  await expect(page.locator('main')).toContainText('Magistra est conçu et développé par Juan Robin, dans le cadre du projet FutureAI');
  await expect(page.locator('footer')).toContainText('Magistra, créé par Juan Robin · Un projet FutureAI · Bordeaux, France · Application gratuite');
});

test('lien de profil : https, nouvel onglet, noopener noreferrer ; tous les liens externes sont sûrs', async ({ page }) => {
  await page.goto('/');
  const profile = page.getByRole('link', { name: /^Profil (?:LinkedIn|GitHub|professionnel)/ });
  await expect(profile).toHaveCount(1);
  const href = await profile.getAttribute('href');
  expect(href).toMatch(/^https:\/\/[^@\s]+$/);
  await expect(profile).toHaveAttribute('target', '_blank');
  const rel = (await profile.getAttribute('rel')) ?? '';
  expect(rel).toContain('noopener');
  expect(rel).toContain('noreferrer');
  const external = await page.locator('a[href^="http"]').evaluateAll(links =>
    links.map(a => ({ href: a.getAttribute('href') ?? '', target: a.getAttribute('target'), rel: a.getAttribute('rel') ?? '' })));
  expect(external.length).toBeGreaterThan(2);
  for (const link of external) {
    expect(link.href).toMatch(/^https:\/\//);
    expect(link.target, link.href).toBe('_blank');
    expect(link.rel, link.href).toMatch(/noopener/);
    expect(link.rel, link.href).toMatch(/noreferrer/);
  }
});

// ─── 3. Section « Magistra pour Windows » ───────────────────────────────────

test('« Magistra pour Windows » : version, taille, empreinte, trois étapes SmartScreen, « Ouvrir Magistra », aucun connecteur', async ({ page }) => {
  await page.goto('/');
  const section = page.locator('section#magistra-windows');
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole('heading', { name: 'Magistra pour Windows' })).toBeVisible();
  await expect(section.getByTestId('windows-version')).toHaveText('2.0.0');
  await expect(section.getByTestId('windows-size')).toHaveText(/^85,3\s+Mo$/);
  const download = section.getByRole('link', { name: 'Télécharger Magistra pour Windows' });
  await expect(download).toHaveAttribute('href', '/telecharger');
  await expect(section.getByText('Windows 10 ou 11 (64 bits)').first()).toBeVisible();

  await section.getByText('Empreinte SHA-256').click();
  await expect(section.getByTestId('windows-sha256')).toHaveText(RELEASE.sha256);

  const steps = section.getByRole('list', { name: 'Installation en trois étapes' }).getByRole('listitem');
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(1)).toContainText('Windows a protégé votre ordinateur');
  await expect(steps.nth(1)).toContainText('Exécuter quand même');

  await expect(section.getByText('Déjà installée ?')).toBeVisible();
  await expect(section.getByRole('link', { name: 'Ouvrir Magistra' })).toHaveAttribute('href', 'magistra://open');
  await expect(section.getByRole('link', { name: 'Notes de version' })).toHaveAttribute('href', RELEASE.releaseUrl);

  // Rien à connecter : ni détection, ni suite de l'installation dans la page.
  await expect(page.getByRole('button', { name: /Détecter maintenant|Rechercher Magistra|Connecter/ })).toHaveCount(0);
  await expect(page.getByText(/Détecter maintenant|J’ai installé Magistra/)).toHaveCount(0);
});

test('« Magistra pour Windows » : serveur en erreur (500) → téléchargement direct de la dernière version et message', async ({ page, monitor }) => {
  // Chromium journalise toute réponse 500 : c'est la panne simulée, pas une erreur de la page.
  monitor.tolerate.push(/Failed to load resource: the server responded with a status of 500/);
  await page.route('**/api/windows-release', route => route.fulfill({
    status: 500,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Erreur', retryable: true } }),
  }));
  await page.goto('/');
  const section = page.locator('section#magistra-windows');
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByRole('link', { name: 'Télécharger Magistra pour Windows' })).toHaveAttribute('href', DIRECT_DOWNLOAD);
  await expect(section.getByText('Les détails de la dernière version (taille, date, empreinte) ne sont pas disponibles pour le moment')).toBeVisible();
  await expect(section.getByTestId('windows-version')).toHaveCount(0);
  await expect(section.getByText('Windows 10 ou 11 (64 bits)').first()).toBeVisible();
});

test('« Magistra pour Windows » : aucune version publiée → bouton inactif et explication', async ({ page }) => {
  await page.route('**/api/windows-release', route => route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({ available: false, reason: 'none', releasesUrl: 'https://github.com/juanrobin09-stack/magistra-downloads/releases' }),
  }));
  await page.goto('/');
  const section = page.locator('section#magistra-windows');
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByTestId('windows-not-published')).toContainText('Pas encore disponible');
  await expect(section.getByTestId('windows-download-unavailable')).toHaveAttribute('aria-disabled', 'true');
  await expect(section.getByRole('link', { name: 'Télécharger Magistra pour Windows' })).toHaveCount(0);
});

// ─── 4. Pages légales ───────────────────────────────────────────────────────

const LEGAL_PAGES = [
  { path: '/mentions-legales', title: 'Mentions légales', tab: 'Mentions légales', link: 'Mentions légales', contains: ['Éditeur du site', 'Hébergement', 'Hébergeur du site : Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis (https://vercel.com).', 'Magistra est une application pédagogique gratuite, conçue et développée par Juan Robin'] },
  { path: '/confidentialite', title: 'Politique de confidentialité', tab: 'Politique de confidentialité', link: 'Politique de confidentialité', contains: ['Ce que ce site ne fait pas', 'Journaux techniques de l\'hébergeur', 'servi par GitHub'] },
  { path: '/cgu', title: 'Conditions générales d\'utilisation', tab: 'Conditions générales d\'utilisation', link: 'Conditions d\'utilisation', contains: ['Ce site présente Magistra', 'Usage du site'] },
] as const;

for (const legal of LEGAL_PAGES) {
  test(`page légale ${legal.path} : titre, texte du site vitrine, navigation, aucun prestataire de l'application`, async ({ page }) => {
    await page.goto(legal.path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(legal.title);
    await expect(page).toHaveTitle(`${legal.tab} — Magistra`);
    for (const text of legal.contains) await expect(page.locator('main')).toContainText(text);
    const main = (await page.locator('main').innerText()).toLowerCase();
    for (const word of ['clerk', 'supabase', 'région de la base']) expect(main).not.toContain(word);
    await expect(page.getByRole('navigation', { name: 'Pages légales' }).getByRole('link')).toHaveCount(3);
    // Aucun trou, avis de projet ni consigne d'éditeur : l'éditeur, le contact et l'hébergeur ont des valeurs par défaut.
    expect(main).not.toMatch(/à compléter|projet de texte|à faire valider|à vérifier|vite_/);
    await expect(page.getByRole('note')).toHaveCount(0);
    const contact = page.locator('main').getByRole('link', { name: 'juanrobin89@gmail.com' }).first();
    await expect(contact).toHaveAttribute('href', 'mailto:juanrobin89@gmail.com');
    await expect(page.getByRole('link', { name: /Magistra, retour à l'accueil/ })).toHaveAttribute('href', '/');
  });
}

test('pied de page : les trois pages légales s\'ouvrent, « Retour » ramène à l\'accueil', async ({ page }) => {
  await page.goto('/');
  for (const legal of LEGAL_PAGES) {
    await page.goto('/');
    await page.locator('footer').getByRole('link', { name: legal.link }).click();
    await expect(page).toHaveURL(new RegExp(`${legal.path}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(legal.title);
    await page.getByRole('link', { name: 'Retour', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('L\'IA qui prépare');
  }
});

// ─── 5. Les adresses de l'application reviennent à l'accueil ────────────────

for (const path of ['/app', '/app/generate', '/app/history', '/onboarding', '/setup', '/presentation', '/inconnu']) {
  test(`${path} : route absente dans l’aperçu, aucune application embarquée`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('introuvable');
    await expect(page.getByRole('link', { name: NO_APP_ACCESS })).toHaveCount(0);
    expect(await pageText(page)).not.toMatch(/Tableau de bord|Bienvenue sur Magistra|Générer/);
  });
}

// ─── 6. Réseau, stockage, console ───────────────────────────────────────────

test('réseau : seulement des fichiers statiques du site et GET /api/windows-release', async ({ page, monitor }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 30));
    }
  });
  await page.waitForLoadState('networkidle');
  // Pages légales : même règle.
  for (const legal of LEGAL_PAGES) await page.goto(legal.path);
  await page.goto('/app');
  await page.waitForLoadState('networkidle');

  const urls = monitor.requests.map(r => `${r.method} ${r.url.origin}${r.url.pathname}`);
  expect(urls.length).toBeGreaterThan(2);
  for (const request of monitor.requests) {
    expect(request.url.host, request.url.href).toBe(SITE_HOST);
    expect(request.url.href).not.toMatch(FORBIDDEN_API);
  }
  const api = monitor.requests.filter(r => r.url.pathname.startsWith('/api/'));
  expect(api.map(r => `${r.method} ${r.url.pathname}`)).toEqual(['GET /api/windows-release']);
  // Une page HTML (la première), puis des fichiers de /assets/ ; aucune route d'application.
  for (const request of monitor.requests) {
    if (request.url.pathname.startsWith('/api/')) continue;
    expect(request.url.pathname === '/' || request.url.pathname.startsWith('/assets/') || LEGAL_OR_APP_PATH.test(request.url.pathname), request.url.pathname).toBe(true);
  }
});

test('stockage : aucun cookie, rien dans localStorage ni sessionStorage', async ({ page, context }) => {
  await page.goto('/');
  for (const legal of LEGAL_PAGES) await page.goto(legal.path);
  await page.goto('/app');
  await page.waitForLoadState('networkidle');
  expect(await context.cookies()).toEqual([]);
  const stored = await page.evaluate(() => ({ cookie: document.cookie, local: localStorage.length, session: sessionStorage.length }));
  expect(stored).toEqual({ cookie: '', local: 0, session: 0 });
});

// ─── 7. Mobile, clavier, accessibilité ──────────────────────────────────────

test('390 px : aucun défilement horizontal (accueil et pages légales)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/', ...LEGAL_PAGES.map(l => l.path)]) {
    await page.goto(path);
    await page.locator('main').waitFor();
    const widths = await page.evaluate(() => ({
      inner: window.innerWidth,
      root: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(widths.root, `${path} : largeur du document`).toBeLessThanOrEqual(widths.inner);
    expect(widths.body, `${path} : largeur du corps`).toBeLessThanOrEqual(widths.inner);
  }
});

test('clavier : le premier Tab atteint un lien visible, avec un nom accessible', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toBeVisible();
  expect(await focused.evaluate(el => el.tagName)).toBe('A');
  await expect(focused).toBeInViewport();
  await expect(focused).toHaveAccessibleName(/\S/);
  // Le parcours au clavier atteint ensuite le bouton de téléchargement du héros.
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
});

test('boutons et liens : tous ont un nom accessible', async ({ page }) => {
  await page.goto('/');
  await page.locator('section#magistra-windows').scrollIntoViewIfNeeded();
  for (const selector of ['button', 'a[href]']) {
    const items = page.locator(selector);
    const count = await items.count();
    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      if (!(await item.isVisible())) continue;
      const html = await item.evaluate(el => el.outerHTML.slice(0, 160));
      await expect(item, `sans nom accessible : ${html}`).toHaveAccessibleName(/\S/);
    }
  }
});
