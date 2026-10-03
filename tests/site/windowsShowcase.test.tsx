// @vitest-environment jsdom
// « Magistra pour Windows » en mode « showcase » : WindowsDownloadSection accepte ce mode (type PageMode) et, comme le panneau
// que le site vitrine importe seul, ne propose ni « Détecter maintenant » ni « J’ai installé Magistra », même si un
// connecteur local est disponible ; les modes existants gardent leur comportement. ErrorBoundary du site : sans « Refaire
// mon profil ».

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import ErrorBoundary from '@/components/ErrorBoundary';
import { resetWindowsReleaseCache } from '@/components/localEngine/windowsRelease';
import WindowsDownloadPanel from '@/components/localEngine/WindowsDownloadPanel';
import WindowsDownloadSection from '@/components/localEngine/WindowsDownloadSection';
import { LocalEngineContext } from '@/lib/localConnector/controller';
import type { PageMode } from '@/lib/runtime/types';
import { button, cleanup, click, flush, render } from '../ui/helpers';
import { engineState, FakeEngine, RELEASE, stubReleaseFetch } from '../ui/localEngineHelpers';

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

async function mountSection(mode: PageMode, engine: FakeEngine | null) {
  const view = await render(
    <LocalEngineContext.Provider value={engine}>
      <MemoryRouter>
        <WindowsDownloadSection variant="landing" mode={mode} />
      </MemoryRouter>
    </LocalEngineContext.Provider>,
  );
  await flush(4);
  const section = view.container.querySelector<HTMLElement>('[data-testid="windows-download"]')!;
  const download = Array.from(section.querySelectorAll<HTMLAnchorElement>('a')).find(a => a.textContent?.includes('Télécharger Magistra pour Windows'))!;
  return { ...view, section, download };
}

describe('WindowsDownloadSection : mode « showcase »', () => {
  it('même avec un connecteur disponible : ni « J’ai installé Magistra » ni « Détecter maintenant » après le clic', async () => {
    stubReleaseFetch(RELEASE);
    const engine = new FakeEngine(engineState('idle'));
    const view = await mountSection('showcase', engine);
    await click(view.download);
    await flush(2);
    expect(view.section.querySelector('[data-testid="windows-installed"]')).toBeNull();
    expect(button(view.section, /Détecter maintenant/)).toBeNull();
    expect(view.section.textContent).not.toContain('J’ai installé Magistra');
    expect(engine.detect).not.toHaveBeenCalled();
    expect(engine.autoCheck).not.toHaveBeenCalled();
  });

  it('version, taille, empreinte, trois étapes et « Ouvrir Magistra » (magistra://open) ; bouton principal', async () => {
    stubReleaseFetch(RELEASE);
    const view = await mountSection('showcase', null);
    expect(view.section.querySelector('[data-testid="windows-version"]')?.textContent).toBe('2.3.1');
    expect(view.section.querySelector('[data-testid="windows-sha256"]')?.textContent).toBe(RELEASE.sha256);
    expect(view.section.querySelectorAll('ol[aria-label="Installation en trois étapes"] li')).toHaveLength(3);
    expect(view.section.querySelector('[data-testid="open-installed-app"] a')?.getAttribute('href')).toBe('magistra://open');
    expect(view.download.className).toContain('btn-primary');
    expect(view.download.className).not.toContain('btn-secondary');
  });

  it('la phrase du site avec comptes (« Depuis ce site, vous pourrez aussi l’utiliser… ») n’y figure pas', async () => {
    stubReleaseFetch(RELEASE);
    const view = await mountSection('showcase', null);
    expect(view.section.textContent).not.toContain('Depuis ce site');
    expect(view.section.textContent).not.toContain('nécessite une connexion');
  });

  it('modes existants inchangés : démonstration (« btn-secondary », rien après le clic hors « J’ai installé Magistra »)', async () => {
    stubReleaseFetch(RELEASE);
    const view = await mountSection('demo', null);
    expect(view.download.className).toContain('btn-secondary');
    await click(view.download);
    expect(view.section.querySelector('[data-testid="windows-installed"]')).not.toBeNull();
  });
});

describe('WindowsDownloadPanel : le panneau du site', () => {
  it('rendu seul (sans contexte de connecteur), le clic ne fait apparaître que l’annonce aux lecteurs d’écran', async () => {
    stubReleaseFetch(RELEASE);
    const view = await render(
      <MemoryRouter>
        <WindowsDownloadPanel variant="landing" mode="showcase" />
      </MemoryRouter>,
    );
    await flush(4);
    const link = Array.from(view.container.querySelectorAll<HTMLAnchorElement>('a')).find(a => a.textContent?.includes('Télécharger Magistra pour Windows'))!;
    expect(view.container.querySelector('p[role="status"].sr-only')?.textContent).toBe('');
    await click(link);
    expect(view.container.querySelector('p[role="status"].sr-only')?.textContent).toContain('Téléchargement lancé.');
    expect(view.container.querySelector('[data-testid="windows-installed"]')).toBeNull();
  });
});

describe('ErrorBoundary du site vitrine', () => {
  function Boom(): never {
    throw new Error('panne simulée');
  }

  it('sans « Refaire mon profil » (le site n’a pas de profil) ; Recharger et Revenir à l’accueil restent', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container } = await render(
      <ErrorBoundary withProfileReset={false}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Refaire mon profil');
    expect(button(container, 'Recharger')).not.toBeNull();
    expect(button(container, 'Revenir à l’accueil')).not.toBeNull();
    vi.restoreAllMocks();
  });

  it('application : « Refaire mon profil » reste proposé', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container } = await render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(button(container, 'Refaire mon profil')).not.toBeNull();
    vi.restoreAllMocks();
  });
});
