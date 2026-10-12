// @vitest-environment jsdom
// Accueil du site vitrine (SiteLanding) : présentation de Magistra et téléchargement de l'application Windows, rien
// d'autre. Aucun accès à une application dans le navigateur (« Commencer », « Se connecter », « Mon espace »…), aucun
// fournisseur d'exécution, aucune requête hors GET /api/windows-release ; le nom de l'auteur est lisible dès le héros.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AUTHOR_CREDIT, AUTHOR_DEFAULT_PROFILE_URL } from '@shared/author';
import { resetWindowsReleaseCache } from '@/components/localEngine/windowsRelease';
import SiteLanding from '@/site/SiteLanding';
import { click, cleanup, flush, render } from '../ui/helpers';
import { jsonResponse, RELEASE, stubReleaseFetch } from '../ui/localEngineHelpers';

/** jsdom ne sait pas naviguer : les clics sur les liens sont interceptés. */
function blockNavigation(event: MouseEvent): void {
  if ((event.target as Element | null)?.closest?.('a')) event.preventDefault();
}

beforeEach(() => {
  resetWindowsReleaseCache();
  document.addEventListener('click', blockNavigation);
});

afterEach(() => {
  cleanup();
  document.removeEventListener('click', blockNavigation);
  vi.unstubAllGlobals();
  resetWindowsReleaseCache();
});

/** Le site est monté SANS fournisseur d'exécution : un composant qui en exigerait un lèverait une erreur. */
async function mountSite() {
  const view = await render(
    <MemoryRouter>
      <SiteLanding />
    </MemoryRouter>,
  );
  await flush(4);
  return view;
}

const FORBIDDEN_WORDING = /Commencer|Se connecter|Connexion|Accéder à Magistra|Mon espace|démonstration/;
const ASSUMES_BROWSER = /Sur le web|Sur le site|ce site|dans (?:votre|le) navigateur|IA annoncée clairement|Le site indique/;

describe('Site vitrine : ancre ouverte directement', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it('« /#magistra-windows » fait défiler jusqu’à la section de téléchargement', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    window.history.replaceState(null, '', '/#magistra-windows');
    stubReleaseFetch(RELEASE);
    const { container } = await mountSite();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(container.querySelector('#magistra-windows'));
  });

  it('sans ancre, ou avec une ancre inconnue ou mal encodée : aucun défilement, aucune erreur', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    stubReleaseFetch(RELEASE);
    for (const hash of ['', '#inconnue', '#%E0%A4%A']) {
      window.history.replaceState(null, '', `/${hash}`);
      cleanup();
      await mountSite();
    }
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('Site vitrine : aucun accès à l’application', () => {
  it('aucune occurrence de « Commencer », « Se connecter », « Connexion », « Accéder à Magistra », « Mon espace », « démonstration »', async () => {
    stubReleaseFetch(RELEASE);
    const { container } = await mountSite();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(FORBIDDEN_WORDING);
    // Ni dans les noms accessibles des boutons et des liens.
    for (const el of Array.from(container.querySelectorAll('a, button'))) {
      expect(`${el.textContent} ${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`).not.toMatch(FORBIDDEN_WORDING);
    }
  });

  it('aucune phrase qui suppose Magistra dans le navigateur', async () => {
    stubReleaseFetch(RELEASE);
    const { container } = await mountSite();
    expect(container.textContent).not.toMatch(ASSUMES_BROWSER);
    expect(container.textContent).not.toContain('Depuis ce site');
  });

  it('aucun lien vers l’application (/app, /onboarding, /setup) ni bouton principal qui y mène', async () => {
    stubReleaseFetch(RELEASE);
    const { container } = await mountSite();
    for (const a of Array.from(container.querySelectorAll('a'))) expect(a.getAttribute('href')).not.toMatch(/^\/(?:app|onboarding|setup|presentation)(?:[/?#]|$)/);
    expect(container.querySelectorAll('button.btn-primary')).toHaveLength(0);
  });

  it('un seul h1 ; barre de navigation « Télécharger » et héros « Télécharger pour Windows » vers #magistra-windows', async () => {
    stubReleaseFetch(RELEASE);
    const { container } = await mountSite();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    const nav = container.querySelector('nav[aria-label="Navigation du site"]')!;
    expect(Array.from(nav.querySelectorAll('a')).map(a => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([['Guides', '/guides'], ['Télécharger', '#magistra-windows']]);
    const hero = container.querySelector('main section')!;
    const heroLinks = Array.from(hero.querySelectorAll('a')).map(a => a.textContent?.trim());
    expect(heroLinks).toEqual(expect.arrayContaining(['Télécharger pour Windows', 'Découvrir FutureAI']));
    const toWindows = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href="#magistra-windows"]'));
    expect(toWindows.map(a => a.textContent?.trim())).toEqual(['Télécharger', 'Télécharger pour Windows']);
    for (const a of toWindows) expect(a.target).toBe('');
    expect(container.querySelector('section#magistra-windows')).not.toBeNull();
  });

  it('pas de doublons : trois entrées de téléchargement (barre de navigation, héros, section), ni carte « Télécharger » ni appel final', async () => {
    stubReleaseFetch(RELEASE);
    const { container } = await mountSite();
    // Ni la carte « IA locale gratuite » ni l'appel « Prêt à gagner du temps ? » ne répètent le bouton.
    expect(container.querySelector('section[aria-labelledby="cta-title"]')).toBeNull();
    expect(container.textContent).not.toContain('Prêt à gagner du temps');
    const plus = container.querySelector('section[aria-labelledby="plus-title"]')!;
    expect(plus.querySelectorAll('a')).toHaveLength(0);
    // Tous les liens et boutons dont le texte commence par « Télécharger » : barre, héros, bouton de la section.
    const downloads = Array.from(container.querySelectorAll<HTMLElement>('a, button')).filter(el => /^Télécharger/.test(el.textContent?.trim() ?? ''));
    expect(downloads.map(el => el.textContent?.trim())).toEqual(['Télécharger', 'Télécharger pour Windows', 'Télécharger Magistra pour Windows']);
  });

  it('l’engagement « Gratuit, sans compte, hors connexion » remplace « Sur le web, une IA annoncée clairement »', async () => {
    stubReleaseFetch(RELEASE);
    const { container } = await mountSite();
    expect(container.textContent).toContain('Gratuit, sans compte, hors connexion');
    expect(container.textContent).toContain('Votre profil reste propre à votre ordinateur.');
  });
});

describe('Site vitrine : section « Magistra pour Windows »', () => {
  it('version, taille, empreinte SHA-256, trois étapes SmartScreen et « Déjà installée ? Ouvrir Magistra » (magistra://open)', async () => {
    stubReleaseFetch(RELEASE);
    const { container } = await mountSite();
    const section = container.querySelector<HTMLElement>('section#magistra-windows')!;
    expect(section.querySelector('[data-testid="windows-version"]')?.textContent).toBe('2.3.1');
    expect(section.querySelector('[data-testid="windows-size"]')?.textContent).toBe('85,3\u00a0Mo');
    expect(section.querySelector('[data-testid="windows-sha256"]')?.textContent).toBe(RELEASE.sha256);
    const download = Array.from(section.querySelectorAll<HTMLAnchorElement>('a')).find(a => a.textContent?.includes('Télécharger Magistra pour Windows'))!;
    expect(download.getAttribute('href')).toBe('/telecharger');
    // L'action principale du site : bouton principal.
    expect(download.className).toContain('btn-primary');
    const steps = Array.from(section.querySelectorAll('ol[aria-label="Installation en trois étapes"] li')).map(li => li.textContent?.trim());
    expect(steps).toHaveLength(3);
    expect(steps[1]).toContain('Windows a protégé votre ordinateur');
    const open = section.querySelector<HTMLElement>('[data-testid="open-installed-app"]')!;
    expect(open.textContent).toContain('Déjà installée ?');
    expect(open.querySelector('a')?.getAttribute('href')).toBe('magistra://open');
    expect(open.querySelector('a')?.textContent).toContain('Ouvrir Magistra');
  });

  it('ni « Détecter maintenant » ni « J’ai installé Magistra » : même après le clic sur « Télécharger »', async () => {
    stubReleaseFetch(RELEASE);
    const { container } = await mountSite();
    const section = container.querySelector<HTMLElement>('section#magistra-windows')!;
    const download = Array.from(section.querySelectorAll<HTMLAnchorElement>('a')).find(a => a.textContent?.includes('Télécharger Magistra pour Windows'))!;
    await click(download);
    expect(section.querySelector('[data-testid="windows-installed"]')).toBeNull();
    expect(container.textContent).not.toMatch(/Détecter maintenant|J’ai installé Magistra|Connecter Magistra|Rechercher Magistra/);
    // Annonce aux lecteurs d'écran, sans rien promettre du connecteur.
    expect(section.querySelector('p[role="status"].sr-only')?.textContent).toBe('Téléchargement lancé. Suivez les trois étapes d’installation indiquées sur cette page.');
  });

  it('serveur en erreur (500) : téléchargement direct de la dernière version et message, sans version inventée', async () => {
    stubReleaseFetch({ error: 'indisponible' }, 500);
    const { container } = await mountSite();
    const section = container.querySelector<HTMLElement>('section#magistra-windows')!;
    const download = Array.from(section.querySelectorAll<HTMLAnchorElement>('a')).find(a => a.textContent?.includes('Télécharger Magistra pour Windows'))!;
    expect(download.getAttribute('href')).toBe('https://github.com/juanrobin09-stack/magistra-downloads/releases/latest/download/Magistra-Setup.exe');
    expect(section.textContent).toContain('Les détails de la dernière version (taille, date, empreinte) ne sont pas disponibles pour le moment');
    expect(section.querySelector('[data-testid="windows-version"]')).toBeNull();
  });

  it('une seule requête, et seulement GET /api/windows-release', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([String(input), init]);
      return jsonResponse(RELEASE);
    }));
    await mountSite();
    expect(calls.map(([url]) => url)).toEqual(['/api/windows-release']);
    expect(calls[0][1]?.method).toBe('GET');
    expect(calls[0][1]?.credentials).toBe('omit');
  });

  it('aucun connecteur local : rien ne sonde l’ordinateur (aucun appel à 127.0.0.1)', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse(RELEASE);
    }));
    const { container } = await mountSite();
    const section = container.querySelector<HTMLElement>('section#magistra-windows')!;
    await click(Array.from(section.querySelectorAll<HTMLAnchorElement>('a')).find(a => a.textContent?.includes('Télécharger Magistra pour Windows'))!);
    await flush(3);
    expect(calls.filter(url => !url.startsWith('/api/windows-release'))).toEqual([]);
  });
});

describe('Site vitrine : attribution', () => {
  it('« Magistra, créé par Juan Robin » dans le héros (premier écran), « Qui est derrière Magistra ? » et le pied de page', async () => {
    stubReleaseFetch(RELEASE);
    const { container } = await mountSite();
    const hero = container.querySelector('main section')!;
    expect(hero.textContent).toContain(AUTHOR_CREDIT);
    expect(hero.textContent).toContain('un projet FutureAI');
    expect(container.querySelector('#author-title')?.textContent).toBe('Qui est derrière Magistra ?');
    expect(container.querySelector('footer')?.textContent).toContain(`${AUTHOR_CREDIT} · Un projet FutureAI · Bordeaux, France · Application gratuite`);
  });

  it('lien de profil : https, nouvel onglet, noopener noreferrer ; tout lien externe est sûr', async () => {
    stubReleaseFetch(RELEASE);
    const { container } = await mountSite();
    const profile = container.querySelector<HTMLAnchorElement>(`a[href="${AUTHOR_DEFAULT_PROFILE_URL}"]`)!;
    expect(profile.textContent).toContain('Profil LinkedIn');
    expect(profile.target).toBe('_blank');
    expect(profile.rel).toBe('noopener noreferrer');
    for (const a of Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href^="http"]'))) {
      expect(a.getAttribute('href'), a.textContent ?? '').toMatch(/^https:\/\//);
      expect(a.target).toBe('_blank');
      expect(a.rel).toContain('noopener');
      expect(a.rel).toContain('noreferrer');
    }
  });
});
