// @vitest-environment jsdom
// « Magistra pour Windows » : dernière version STABLE publiée (GET /api/windows-release) revérifiée côté navigateur,
// version, taille et date en français, empreinte SHA-256 repliable et copiable, repli vers la page des versions, puis
// « J’ai installé Magistra » [Détecter maintenant].

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import WindowsDownloadSection from '@/components/localEngine/WindowsDownloadSection';
import {
  fetchWindowsRelease, formatDate, formatSize, parseWindowsRelease, resetWindowsReleaseCache, WINDOWS_REQUIREMENTS_TEXT,
} from '@/components/localEngine/windowsRelease';
import { LocalEngineContext } from '@/lib/localConnector/controller';
import { WINDOWS_DOWNLOAD_URL } from '@/lib/links';
import { RuntimeContext } from '@/lib/runtime/context';
import type { RuntimeMode } from '@/lib/runtime/types';
import LandingPage from '@/pages/LandingPage';
import { button, cleanup, click, fakeRuntime, flush, MemoryStore, render } from './helpers';
import { engineState, FakeEngine, jsonResponse, RELEASE, stubReleaseFetch } from './localEngineHelpers';

const RELEASES_PAGE = 'https://github.com/juanrobin09-stack/magistra-2/releases';

/** jsdom ne sait pas naviguer : les clics sur les liens sont interceptés (le gestionnaire de la page s'exécute). */
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

async function mountSection(mode: RuntimeMode, engine: FakeEngine | null, variant: 'landing' | 'settings' = 'settings') {
  const view = await render(
    <LocalEngineContext.Provider value={engine}>
      <MemoryRouter>
        <WindowsDownloadSection variant={variant} mode={mode} />
      </MemoryRouter>
    </LocalEngineContext.Provider>,
  );
  await flush(4);
  const section = () => view.container.querySelector<HTMLElement>('[data-testid="windows-download"]')!;
  const download = () => Array.from(section().querySelectorAll<HTMLAnchorElement>('a')).find(a => a.textContent?.includes('Télécharger Magistra pour Windows'))!;
  return { ...view, section, download };
}

describe('Réponse de /api/windows-release revérifiée', () => {
  it('version valide : conservée telle quelle (empreinte en minuscules)', () => {
    const parsed = parseWindowsRelease({ ...RELEASE, sha256: RELEASE.sha256.toUpperCase() });
    expect(parsed).toEqual({ ...RELEASE, sha256: RELEASE.sha256 });
  });

  it('refuse un lien hors de github.com, en http, avec identifiants, ou un fichier qui ne correspond pas à la version', () => {
    for (const downloadUrl of [
      'https://evil.example/releases/download/v2.3.1/Magistra-Setup-2.3.1.exe',
      'http://github.com/juanrobin09-stack/magistra-2/releases/download/v2.3.1/Magistra-Setup-2.3.1.exe',
      'https://user:pass@github.com/juanrobin09-stack/magistra-2/releases/download/v2.3.1/Magistra-Setup-2.3.1.exe',
      'https://github.com/juanrobin09-stack/magistra-2/releases/download/v2.3.1/Autre.exe',
      'javascript:alert(1)',
    ]) {
      expect(parseWindowsRelease({ ...RELEASE, downloadUrl }), downloadUrl).toBeNull();
    }
    expect(parseWindowsRelease({ ...RELEASE, fileName: 'Magistra-Setup-9.9.9.exe' })).toBeNull();
    expect(parseWindowsRelease({ ...RELEASE, version: 'v2.3.1' })).toBeNull();
    expect(parseWindowsRelease({ ...RELEASE, sizeBytes: -1 })).toBeNull();
    expect(parseWindowsRelease({ ...RELEASE, publishedAt: 'hier' })).toBeNull();
    expect(parseWindowsRelease('<!doctype html>')).toBeNull();
  });

  it('empreinte illisible : ignorée ; configuration illisible : texte par défaut', () => {
    const parsed = parseWindowsRelease({ ...RELEASE, sha256: 'pas-une-empreinte', requirements: 42 });
    expect(parsed && parsed.available && parsed.sha256).toBeFalsy();
    expect(parsed && parsed.available && parsed.requirements).toBe(WINDOWS_REQUIREMENTS_TEXT);
  });

  it('aucune version : lien de repli limité à github.com', () => {
    expect(parseWindowsRelease({ available: false, reason: 'none', releasesUrl: RELEASES_PAGE }))
      .toEqual({ available: false, reason: 'none', releasesUrl: RELEASES_PAGE });
    expect(parseWindowsRelease({ available: false, reason: 'none', releasesUrl: 'https://evil.example/releases' }))
      .toEqual({ available: false, reason: 'none', releasesUrl: WINDOWS_DOWNLOAD_URL });
    expect(parseWindowsRelease({ available: false, reason: 'autre', releasesUrl: RELEASES_PAGE })).toBeNull();
  });

  it('404, page HTML (hébergement sans API), réponse illisible, erreur réseau ou délai dépassé : repli sans erreur', async () => {
    const responses: (() => Promise<Response>)[] = [
      async () => jsonResponse({ error: { code: 'NOT_FOUND', message: 'x', retryable: false } }, 404),
      async () => new Response('<!doctype html><title>Magistra</title>', { status: 200, headers: { 'content-type': 'text/html' } }),
      async () => jsonResponse({ available: true, version: 'x' }),
      async () => {
        throw new TypeError('Failed to fetch');
      },
    ];
    for (const respond of responses) {
      const state = await fetchWindowsRelease(vi.fn(respond) as unknown as typeof fetch);
      expect(state).toEqual({ status: 'fallback', reason: 'unavailable', releasesUrl: WINDOWS_DOWNLOAD_URL });
    }
    const hanging = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('abandon', 'AbortError')));
    }));
    expect(await fetchWindowsRelease(hanging as unknown as typeof fetch, 5)).toMatchObject({ status: 'fallback', reason: 'unavailable' });
    const request = hanging.mock.calls[0][1]!;
    expect(request.credentials).toBe('omit');
    expect(hanging.mock.calls[0][0]).toBe('/api/windows-release');
  });

  it('mise en forme française : taille en Mo, date en toutes lettres', () => {
    expect(formatSize(RELEASE.sizeBytes)).toBe('85,3 Mo');
    expect(formatSize(150 * 1024 * 1024)).toBe('150 Mo');
    expect(formatDate(RELEASE.publishedAt)).toBe('15 septembre 2026');
    expect(formatDate('pas une date')).toBeNull();
  });
});

describe('Section « Magistra pour Windows »', () => {
  it('dernière version : bouton de téléchargement direct, version, taille, date, configuration, empreinte copiable', async () => {
    const fetchSpy = stubReleaseFetch(RELEASE);
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const view = await mountSection('web', null);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(view.download().getAttribute('href')).toBe(RELEASE.downloadUrl);
    expect(view.download().target).toBe('');
    expect(view.section().querySelector('[data-testid="windows-version"]')?.textContent).toBe('2.3.1');
    expect(view.section().querySelector('[data-testid="windows-size"]')?.textContent).toBe('85,3 Mo');
    expect(view.section().querySelector('[data-testid="windows-date"]')?.textContent).toBe('15 septembre 2026');
    expect(view.section().textContent).toContain('Windows 10 ou 11 (64 bits)');
    const details = view.section().querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toContain('Empreinte SHA-256');
    expect(details.querySelector('[data-testid="windows-sha256"]')?.textContent).toBe(RELEASE.sha256);
    await click(button(details, /Copier l’empreinte/));
    expect(writeText).toHaveBeenCalledWith(RELEASE.sha256);
    expect(details.textContent).toContain('Empreinte copiée.');
  });

  it('points clés et trois étapes courtes : IA locale, aucune clé API, hors connexion (le site, lui, nécessite Internet), confidentialité locale', async () => {
    stubReleaseFetch(RELEASE);
    const view = await mountSection('web', null);
    const text = view.section().textContent ?? '';
    for (const point of ['IA locale', 'Aucune clé API', 'Fonctionne hors connexion', 'Le site Magistra, lui, nécessite une connexion', 'Confidentialité locale']) {
      expect(text).toContain(point);
    }
    expect(view.section().querySelectorAll('ol[aria-label="Installation en trois étapes"] li')).toHaveLength(3);
    expect(text).not.toMatch(/localhost|127\.0\.0\.1|ollama|powershell/i);
  });

  it('après le téléchargement : « J’ai installé Magistra » [Détecter maintenant] → recherche, avec l’explication avant la demande du navigateur', async () => {
    stubReleaseFetch(RELEASE);
    const engine = new FakeEngine(engineState('not-found', { permission: 'prompt' }));
    const view = await mountSection('web', engine);
    expect(view.section().textContent).not.toContain('J’ai installé Magistra');
    await click(view.download());
    const installed = view.section().querySelector<HTMLElement>('[data-testid="windows-installed"]')!;
    expect(installed.textContent).toContain('J’ai installé Magistra');
    await click(button(installed, /Détecter maintenant/));
    expect(engine.detect).not.toHaveBeenCalled();
    expect(installed.textContent).toContain('Votre navigateur va vous demander l’autorisation');
    await click(button(installed, 'Continuer'));
    expect(engine.detect).toHaveBeenCalledTimes(1);
    // Le résultat de la recherche s'affiche sur place (ici : Magistra trouvée, à connecter).
    await engine.set(engineState('found', { permission: 'granted' }));
    expect(installed.textContent).toContain('✓ Magistra trouvée');
    await click(button(installed, /Connecter Magistra locale/));
    expect(engine.connect).toHaveBeenCalledTimes(1);
  });

  it('autorisation déjà accordée : « Détecter maintenant » recherche aussitôt', async () => {
    stubReleaseFetch(RELEASE);
    const engine = new FakeEngine(engineState('not-found', { permission: 'granted' }));
    const view = await mountSection('web', engine);
    await click(view.download());
    await click(button(view.section(), /Détecter maintenant/));
    expect(engine.detect).toHaveBeenCalledTimes(1);
  });

  it('site web sans session (aucun contrôleur) : invitation à se connecter', async () => {
    stubReleaseFetch(RELEASE);
    const view = await mountSection('web', null, 'landing');
    await click(view.download());
    const installed = view.section().querySelector('[data-testid="windows-installed"]')!;
    expect(installed.querySelector('a[href="/app"]')?.textContent).toBe('Se connecter');
    expect(button(installed, /Détecter maintenant/)).toBeNull();
  });

  it('information indisponible : lien vers la page officielle des versions (nouvel onglet), sans version inventée', async () => {
    stubReleaseFetch(new TypeError('Failed to fetch'));
    const view = await mountSection('web', null);
    expect(view.download().getAttribute('href')).toBe(WINDOWS_DOWNLOAD_URL);
    expect(view.download().target).toBe('_blank');
    expect(view.download().rel).toContain('noopener');
    expect(view.section().textContent).toContain('ne sont pas disponibles pour le moment');
    expect(view.section().querySelector('[data-testid="windows-version"]')).toBeNull();
  });

  it('aucune version stable publiée : dit clairement, lien vers la page des versions', async () => {
    stubReleaseFetch({ available: false, reason: 'none', releasesUrl: RELEASES_PAGE });
    const view = await mountSection('web', null);
    expect(view.download().getAttribute('href')).toBe(RELEASES_PAGE);
    expect(view.section().textContent).toContain('Aucune version stable n’est encore publiée');
  });

  it('démonstration (site sans API) : aucune requête, lien direct vers la page des versions', async () => {
    const fetchSpy = stubReleaseFetch(RELEASE);
    const view = await mountSection('demo', null, 'landing');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(view.download().getAttribute('href')).toBe(WINDOWS_DOWNLOAD_URL);
    expect(view.section().querySelector('h2')?.textContent).toBe('Magistra pour Windows');
    await click(view.download());
    expect(view.section().textContent).toContain('Lancez Magistra depuis le menu Démarrer de Windows.');
  });
});

describe('Page d’accueil', () => {
  it('section publique « Magistra pour Windows », sans toucher au bouton principal', async () => {
    const fetchSpy = stubReleaseFetch(RELEASE);
    const view = await render(
      <RuntimeContext.Provider value={fakeRuntime(new MemoryStore())}>
        <MemoryRouter><LandingPage /></MemoryRouter>
      </RuntimeContext.Provider>,
    );
    await flush();
    const section = view.container.querySelector('section#magistra-windows')!;
    expect(section.querySelector('h2')?.textContent).toBe('Magistra pour Windows');
    expect(fetchSpy).not.toHaveBeenCalled(); // démonstration : aucune API à interroger
    for (const a of Array.from(view.container.querySelectorAll('a.btn-primary'))) expect(a.getAttribute('href')).toBe('/onboarding');
  });
});
