// @vitest-environment jsdom
// Pages légales ouvertes depuis l'application : « Retour » ramène à la page d'origine ; depuis l'assistant d'accueil
// (profil en cours de saisie, non conservé), les liens s'ouvrent dans un nouvel onglet.

import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import LegalLinks from '@/components/LegalLinks';
import LegalPage from '@/pages/LegalPage';
import OnboardingPage from '@/pages/OnboardingPage';
import { RuntimeContext } from '@/lib/runtime/context';
import { setRuntimeConfig } from '@/lib/runtime/mode';
import type { RuntimeMode } from '@/lib/runtime/types';
import { button, byText, cleanup, click, fakeRuntime, flush, MemoryStore, render, typeInto } from './helpers';

afterEach(() => {
  cleanup();
  setRuntimeConfig(null);
});

function routes() {
  return (
    <Routes>
      <Route path="/" element={<p>PAGE ACCUEIL</p>} />
      <Route path="/app/settings" element={<p>PAGE REGLAGES</p>} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/confidentialite" element={<LegalPage page="confidentialite" />} />
      <Route path="/cgu" element={<LegalPage page="cgu" />} />
    </Routes>
  );
}

async function mountAt(entries: string[], index = entries.length - 1, mode: RuntimeMode = 'demo') {
  setRuntimeConfig({ mode: 'demo' });
  return render(
    <RuntimeContext.Provider value={fakeRuntime(new MemoryStore(), { mode })}>
      <MemoryRouter initialEntries={entries} initialIndex={index}>
        {routes()}
      </MemoryRouter>
    </RuntimeContext.Provider>,
  );
}

const retour = (container: HTMLElement) => byText<HTMLAnchorElement>(container, 'a', 'Retour');

describe('« Retour » des pages légales', () => {
  it('ramène à la page d\'application d\'où l\'on vient (Réglages), pas à l\'accueil', async () => {
    const { container } = await mountAt(['/app/settings', '/confidentialite']);
    expect(container.querySelector('h1')?.textContent).toBe('Politique de confidentialité');
    await click(retour(container));
    expect(container.textContent).toContain('PAGE REGLAGES');
    expect(container.querySelector('h1')).toBeNull();
  });

  it('arrivé directement sur la page (nouvel onglet, lien partagé) : ramène à l\'accueil', async () => {
    const { container } = await mountAt(['/confidentialite']);
    expect(retour(container)!.getAttribute('href')).toBe('/');
    await click(retour(container));
    expect(container.textContent).toContain('PAGE ACCUEIL');
  });

  it('un clic avec une touche modificatrice garde le comportement du lien (nouvel onglet vers l\'accueil)', async () => {
    const { container } = await mountAt(['/app/settings', '/confidentialite']);
    const link = retour(container)!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    link.dispatchEvent(event);
    await flush();
    expect(container.querySelector('h1')?.textContent).toBe('Politique de confidentialité');
  });
});

describe('Liens légaux de l\'assistant d\'accueil', () => {
  const wizardLinks = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLAnchorElement>('a')).filter(a => /^\/(mentions-legales|confidentialite|cgu)$/.test(a.getAttribute('href') ?? ''));

  it('s\'ouvrent dans un nouvel onglet : l\'assistant et le profil saisi restent en place', async () => {
    const { container } = await mountAt(['/onboarding']);
    await click(button(container, /Continuer/)); // Bienvenue → Établissement
    await typeInto(container.querySelector<HTMLInputElement>('input[type="text"]'), 'Collège Test');
    const links = wizardLinks(container);
    expect(links.map(a => a.getAttribute('href'))).toEqual(['/mentions-legales', '/confidentialite', '/cgu']);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
      expect(a.textContent).toContain('nouvel onglet');
    }
    await click(links[1]);
    // L'assistant n'est pas démonté : le champ saisi est toujours là.
    expect(container.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe('Collège Test');
    expect(container.querySelector('h1')?.textContent).not.toBe('Politique de confidentialité');
  });

  it('application Windows (pas d\'onglet possible) : les pages s\'ouvrent dans l\'application', async () => {
    const { container } = await mountAt(['/onboarding'], 0, 'local');
    const links = wizardLinks(container);
    expect(links).toHaveLength(3);
    for (const a of links) {
      expect(a.getAttribute('target')).toBeNull();
      expect(a.textContent).not.toContain('nouvel onglet');
    }
  });

  it('ailleurs (Réglages, accueil), LegalLinks navigue dans l\'application', async () => {
    const { container } = await render(
      <MemoryRouter>
        <LegalLinks />
      </MemoryRouter>,
    );
    for (const a of container.querySelectorAll('a')) expect(a.getAttribute('target')).toBeNull();
  });
});
