// @vitest-environment jsdom
// SiteApp : routes du site vitrine (accueil et trois pages légales) ; toute autre adresse — dont celles de l'application
// (/app, /app/…, /onboarding, /setup, /presentation) — revient à l'accueil. Aucun fournisseur d'exécution.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetWindowsReleaseCache } from '@/components/localEngine/windowsRelease';
import SiteApp from '@/site/SiteApp';
import { cleanup, flush, render } from '../ui/helpers';
import { RELEASE, stubReleaseFetch } from '../ui/localEngineHelpers';

beforeEach(() => {
  resetWindowsReleaseCache();
  stubReleaseFetch(RELEASE);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetWindowsReleaseCache();
  window.history.replaceState(null, '', '/');
});

async function visit(path: string) {
  window.history.replaceState(null, '', path);
  const view = await render(<SiteApp />);
  await flush(4);
  return view;
}

const h1 = (container: HTMLElement) => container.querySelector('h1')?.textContent ?? '';

describe('Site vitrine : routes', () => {
  it('« / » : l’accueil (un seul h1)', async () => {
    const { container } = await visit('/');
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(h1(container)).toContain('vos cours');
    expect(window.location.pathname).toBe('/');
  });

  it.each([
    ['/mentions-legales', 'Mentions légales'],
    ['/confidentialite', 'Politique de confidentialité'],
    ['/cgu', 'Conditions générales d\'utilisation'],
  ])('%s : la page légale du site vitrine', async (path, title) => {
    const { container } = await visit(path);
    expect(h1(container)).toBe(title);
    expect(window.location.pathname).toBe(path);
  });

  it.each([
    '/app',
    '/app/',
    '/app/generate',
    '/app/history',
    '/app/favorites',
    '/app/settings',
    '/onboarding',
    '/setup',
    '/presentation',
    '/inconnu',
    '/mentions-legales/autre',
  ])('%s : page introuvable, sans trace de l’application', async path => {
    const { container } = await visit(path);
    expect(window.location.pathname).toBe(path);
    expect(h1(container)).toContain('introuvable');
    expect(container.textContent).not.toMatch(/Commencer|Se connecter|Mon espace|Tableau de bord|Bienvenue sur Magistra/);
  });

  it('une adresse inconnue reste une 404 sans fabriquer de navigation', async () => {
    window.history.replaceState(null, '', '/app/generate');
    const before = window.history.length;
    await render(<SiteApp />);
    await flush(4);
    expect(window.history.length).toBe(before);
    expect(window.location.pathname).toBe('/app/generate');
  });
});

describe('Site vitrine : pages légales', () => {
  it('« Retour » et le logo ramènent à l’accueil du site', async () => {
    const { container } = await visit('/cgu');
    const hrefs = Array.from(container.querySelectorAll('header a')).map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(['/', '/']);
  });

  it('le titre de l’onglet suit la page', async () => {
    await visit('/confidentialite');
    expect(document.title).toBe('Politique de confidentialité — Magistra');
  });
});
