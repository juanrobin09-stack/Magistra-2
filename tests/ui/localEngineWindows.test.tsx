// @vitest-environment jsdom
// « Magistra pour Windows » : dernière version STABLE publiée (GET /api/windows-release) revérifiée côté navigateur,
// version, taille et date en français, empreinte SHA-256 repliable et copiable, repli vers la page des versions ; les
// trois étapes (avertissement SmartScreen compris) et « Déjà installée ? Ouvrir Magistra » ; puis « J’ai installé
// Magistra » [Détecter maintenant]. Le site en démonstration la demande aussi (le site public sans comptes garde son
// API) ; l'application Windows, jamais.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import WindowsDownloadSection from '@/components/localEngine/WindowsDownloadSection';
import { readFileSync } from 'node:fs';
import {
  fetchWindowsRelease, formatDate, formatSize, installerUrl, parseWindowsRelease, resetWindowsReleaseCache, WINDOWS_RELEASE_TIMEOUT_MS,
  SITE_DOWNLOAD_PATH, WINDOWS_REQUIREMENTS_TEXT,
} from '@/components/localEngine/windowsRelease';
import { WINDOWS_RELEASE_LIMITS } from '../../server/windowsRelease';
import { LocalEngineContext } from '@/lib/localConnector/controller';
import { WINDOWS_DOWNLOAD_URL, WINDOWS_RELEASES_URL } from '@/lib/links';
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
  /** Bouton inactif (aucune version publiée, ou version en cours de recherche). */
  const unavailable = () => section().querySelector<HTMLElement>('[data-testid="windows-download-unavailable"]');
  return { ...view, section, download, unavailable };
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

  it('aucune version : page des versions limitée à github.com', () => {
    expect(parseWindowsRelease({ available: false, reason: 'none', releasesUrl: RELEASES_PAGE }))
      .toEqual({ available: false, reason: 'none', releasesUrl: RELEASES_PAGE });
    expect(parseWindowsRelease({ available: false, reason: 'none', releasesUrl: 'https://evil.example/releases' }))
      .toEqual({ available: false, reason: 'none', releasesUrl: WINDOWS_RELEASES_URL });
    expect(parseWindowsRelease({ available: false, reason: 'autre', releasesUrl: RELEASES_PAGE })).toBeNull();
  });

  it('lien direct de repli : un FICHIER (installateur de la dernière version stable, nom fixe), jamais une page', () => {
    expect(WINDOWS_DOWNLOAD_URL).toBe('https://github.com/juanrobin09-stack/magistra-2/releases/latest/download/Magistra-Setup.exe');
  });

  it('aucune version stable publiée (réponse sûre du serveur) : rien à télécharger', async () => {
    const state = await fetchWindowsRelease(vi.fn(async () => jsonResponse({ available: false, reason: 'none', releasesUrl: RELEASES_PAGE })) as unknown as typeof fetch);
    expect(state).toEqual({ status: 'none' });
  });

  it('GitHub momentanément injoignable depuis le serveur (« unavailable ») : lien du site (dernière version, nom fixe)', async () => {
    // Le serveur du site répond : son lien /telecharger renvoie lui-même au fichier sous son nom fixe.
    const state = await fetchWindowsRelease(vi.fn(async () => jsonResponse({ available: false, reason: 'unavailable', releasesUrl: RELEASES_PAGE })) as unknown as typeof fetch);
    expect(state).toEqual({ status: 'direct', downloadUrl: SITE_DOWNLOAD_PATH });
    expect(installerUrl(state)).toBe('/telecharger');
  });

  it('404, page HTML (hébergement sans API), réponse illisible, erreur réseau ou délai dépassé : téléchargement direct, sans erreur', async () => {
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
      expect(state).toEqual({ status: 'direct', downloadUrl: WINDOWS_DOWNLOAD_URL });
    }
    const hanging = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('abandon', 'AbortError')));
    }));
    expect(await fetchWindowsRelease(hanging as unknown as typeof fetch, 5)).toEqual({ status: 'direct', downloadUrl: WINDOWS_DOWNLOAD_URL });
    const request = hanging.mock.calls[0][1]!;
    expect(request.credentials).toBe('omit');
    expect(hanging.mock.calls[0][0]).toBe('/api/windows-release');
  });

  it('délai du navigateur : au-dessus du budget GitHub du serveur (marge incluse), sous la durée maximale de la fonction', () => {
    // Sinon le navigateur abandonne pile quand le serveur renvoie sa dernière réponse valide (GitHub lent).
    expect(WINDOWS_RELEASE_TIMEOUT_MS).toBeGreaterThanOrEqual(WINDOWS_RELEASE_LIMITS.timeoutMs + 3_000);
    const vercel = JSON.parse(readFileSync(`${process.cwd()}/vercel.json`, 'utf8')) as { functions: Record<string, { maxDuration: number }> };
    expect(WINDOWS_RELEASE_TIMEOUT_MS).toBeLessThan(vercel.functions['api/windows-release.ts'].maxDuration * 1_000);
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
    expect(view.download().getAttribute('href')).toBe(SITE_DOWNLOAD_PATH);
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
    const steps = Array.from(view.section().querySelectorAll('ol[aria-label="Installation en trois étapes"] li')).map(li => li.textContent?.trim());
    expect(steps).toEqual([
      '1Téléchargez Magistra.',
      '2Ouvrez le fichier téléchargé. Si Windows affiche « Windows a protégé votre ordinateur », cliquez sur « Informations complémentaires » puis « Exécuter quand même ».',
      '3Magistra s’installe en quelques secondes, sans droits d’administrateur, et s’ouvre toute seule.',
    ]);
    // L'IA n'est pas dans l'installateur : téléchargée dans l'application, après un clic qui en annonce la taille.
    expect(text).toContain('Ensuite, Magistra vous propose d’activer l’IA : un seul téléchargement de plusieurs Go, dont la taille est annoncée avant.');
    expect(text).not.toMatch(/localhost|127\.0\.0\.1|ollama|powershell/i);
  });

  it('installateur conforme aux étapes annoncées : un clic, sans droits d’administrateur, Magistra s’ouvre à la fin', () => {
    const builder = JSON.parse(readFileSync(`${process.cwd()}/electron-builder.json`, 'utf8')) as { nsis: Record<string, unknown> };
    expect(builder.nsis).toMatchObject({
      oneClick: true, perMachine: false, allowElevation: false, runAfterFinish: true, createDesktopShortcut: true, createStartMenuShortcut: true,
    });
  });

  it('« Déjà installée ? Ouvrir Magistra » : magistra://open, sans nouvel onglet', async () => {
    stubReleaseFetch(RELEASE);
    const view = await mountSection('web', null);
    const open = view.section().querySelector<HTMLElement>('[data-testid="open-installed-app"]')!;
    expect(open.textContent?.replace(/\s+/g, ' ').trim()).toBe('Déjà installée ? Ouvrir Magistra');
    const link = open.querySelector<HTMLAnchorElement>('a')!;
    expect(link.getAttribute('href')).toBe('magistra://open');
    expect(link.target).toBe('');
  });

  it('après le téléchargement : « J’ai installé Magistra » [Détecter maintenant] → recherche, avec l’explication avant la demande du navigateur', async () => {
    stubReleaseFetch(RELEASE);
    const engine = new FakeEngine(engineState('not-found', { permission: 'prompt' }));
    const view = await mountSection('web', engine);
    expect(view.section().textContent).not.toContain('J’ai installé Magistra');
    // Région d'annonce présente dès l'affichage (vide), remplie au clic : l'apparition du bloc est annoncée.
    const announcements = () => Array.from(view.section().querySelectorAll<HTMLElement>('[role="status"]')).map(e => e.textContent ?? '');
    expect(announcements().some(t => t.includes('J’ai installé Magistra'))).toBe(false);
    const regionsBefore = view.section().querySelectorAll('[role="status"]').length;
    await click(view.download());
    expect(announcements().some(t => t.includes('Téléchargement lancé') && t.includes('« J’ai installé Magistra »'))).toBe(true);
    expect(view.section().querySelectorAll('[role="status"]').length).toBeGreaterThanOrEqual(regionsBefore);
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

  it('« Détecter maintenant » : après « Annuler » ou « Continuer » de l’explication, le focus revient sur le bouton (jamais perdu)', async () => {
    stubReleaseFetch(RELEASE);
    const engine = new FakeEngine(engineState('not-found', { permission: 'prompt' }));
    const view = await mountSection('web', engine);
    await click(view.download());
    const installed = view.section().querySelector<HTMLElement>('[data-testid="windows-installed"]')!;
    const detectNow = () => button(installed, /Détecter maintenant/);
    await click(detectNow());
    expect(document.activeElement).toBe(button(installed, 'Continuer'));
    await click(button(installed, 'Annuler'));
    await flush();
    expect(engine.detect).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(detectNow());
    await click(detectNow());
    await click(button(installed, 'Continuer'));
    await flush();
    expect(engine.detect).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(detectNow());
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
    // Le tableau de bord ne cherche pas Magistra de lui-même : le bouton à utiliser est nommé (jamais « détectera »).
    expect(installed.textContent).toContain('Connectez-vous : sur votre tableau de bord, cliquez sur « J\'ai déjà Magistra : la rechercher » pour la connecter à ce navigateur.');
    expect(installed.textContent).not.toContain('détectera');
  });

  it('information indisponible : le bouton télécharge quand même la dernière version (fichier, même onglet), sans version inventée', async () => {
    stubReleaseFetch(new TypeError('Failed to fetch'));
    const view = await mountSection('web', null);
    expect(view.download().getAttribute('href')).toBe(WINDOWS_DOWNLOAD_URL);
    // Un fichier se télécharge sur place : jamais un nouvel onglet ouvert sur GitHub.
    expect(view.download().target).toBe('');
    expect(view.download().rel).toContain('noopener');
    expect(view.section().textContent).toContain('ne sont pas disponibles pour le moment');
    expect(view.section().textContent).toContain('le bouton télécharge quand même la dernière version publiée');
    expect(view.section().querySelector('[data-testid="windows-version"]')).toBeNull();
  });

  it('aucune version stable publiée : bouton inactif qui le dit, AUCUN lien vers GitHub', async () => {
    stubReleaseFetch({ available: false, reason: 'none', releasesUrl: RELEASES_PAGE });
    const view = await mountSection('web', null);
    expect(view.download()).toBeUndefined();
    const inactive = view.unavailable()!;
    expect(inactive.textContent).toContain('Télécharger Magistra pour Windows');
    expect(inactive.getAttribute('aria-disabled')).toBe('true');
    expect(view.section().querySelector('[data-testid="windows-not-published"]')?.textContent)
      .toContain('Pas encore disponible : la première version de Magistra pour Windows n’est pas encore publiée.');
    // Aucune page GitHub proposée pour télécharger (seul un lien d'information pourrait y mener : il n'y en a pas ici).
    expect(Array.from(view.section().querySelectorAll('a')).filter(a => a.href.startsWith('https://github.com'))).toEqual([]);
    // Rien ne se passe au clic : pas de « J’ai installé Magistra » sans téléchargement.
    await click(inactive);
    expect(view.section().querySelector('[data-testid="windows-installed"]')).toBeNull();
  });

  it('démonstration (site public sans comptes, API présente) : téléchargement direct ; après le clic, Magistra s’ouvre seule', async () => {
    const fetchSpy = stubReleaseFetch(RELEASE);
    const view = await mountSection('demo', null, 'landing');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(view.download().getAttribute('href')).toBe(SITE_DOWNLOAD_PATH);
    expect(view.section().querySelector('[data-testid="windows-version"]')?.textContent).toBe('2.3.1');
    expect(view.section().querySelector('h2')?.textContent).toBe('Magistra pour Windows');
    // Le connecteur local n'existe que pour le site avec comptes : rien n'est promis ici.
    expect(view.section().textContent).not.toContain('Depuis ce site');
    await click(view.download());
    expect(view.section().textContent).toContain('Magistra s’ouvre toute seule à la fin de l’installation. Ensuite, retrouvez-la dans le menu Démarrer ou sur le Bureau.');
    expect(view.section().querySelector('[data-testid="windows-installed"] button')).toBeNull();
  });

  it('démonstration sur un hébergement statique (aucune API : page HTML) : téléchargement direct de la dernière version, sans version inventée', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!doctype html><title>Magistra</title>', { status: 200, headers: { 'content-type': 'text/html' } })));
    const view = await mountSection('demo', null, 'landing');
    expect(view.download().getAttribute('href')).toBe(WINDOWS_DOWNLOAD_URL);
    expect(view.download().target).toBe('');
    expect(view.section().querySelector('[data-testid="windows-version"]')).toBeNull();
  });

  it('site avec comptes : l’accueil annonce l’usage de l’application depuis le site', async () => {
    stubReleaseFetch(RELEASE);
    const view = await mountSection('web', null, 'landing');
    expect(view.section().textContent).toContain('Depuis ce site, vous pourrez aussi l’utiliser pour vos générations.');
  });

  it('application Windows (déjà installée) : aucune requête', async () => {
    const fetchSpy = stubReleaseFetch(RELEASE);
    const view = await mountSection('local', null);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(view.download().getAttribute('href')).toBe(WINDOWS_DOWNLOAD_URL);
  });
});

describe('Page d’accueil', () => {
  it('section publique « Magistra pour Windows » (téléchargement direct), sans toucher au bouton principal', async () => {
    const fetchSpy = stubReleaseFetch(RELEASE);
    const view = await render(
      <RuntimeContext.Provider value={fakeRuntime(new MemoryStore())}>
        <MemoryRouter><LandingPage /></MemoryRouter>
      </RuntimeContext.Provider>,
    );
    await flush(4);
    const section = view.container.querySelector<HTMLElement>('section#magistra-windows')!;
    expect(section.querySelector('h2')?.textContent).toBe('Magistra pour Windows');
    // Démonstration du site public : la même API, une seule requête pour toute la page.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const download = Array.from(section.querySelectorAll<HTMLAnchorElement>('a')).find(a => a.textContent?.includes('Télécharger Magistra pour Windows'))!;
    expect(download.getAttribute('href')).toBe(SITE_DOWNLOAD_PATH);
    expect(section.querySelector('[data-testid="open-installed-app"] a')?.getAttribute('href')).toBe('magistra://open');
    // Les autres liens « Télécharger pour Windows » de la page mènent à cette section (étapes et avertissement compris).
    const toSection = Array.from(view.container.querySelectorAll<HTMLAnchorElement>('a[href="#magistra-windows"]'));
    expect(toSection.length).toBeGreaterThanOrEqual(2);
    for (const a of Array.from(view.container.querySelectorAll('a.btn-primary'))) expect(a.getAttribute('href')).toBe('/onboarding');
  });
});
