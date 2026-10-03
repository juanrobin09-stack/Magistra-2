// @vitest-environment jsdom
// Réglages de l'application Windows, section « Recherche » : ce que chaque réglage permet réellement de consulter
// (sites officiels vérifiés, publications, Wikipédia), sans promettre le web en général.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { cleanup, fakeRuntime, flush, MemoryStore, PROFILE_COLLEGE, render } from './helpers';
import { installFakeLocalAI, removeFakeLocalAI } from './localAIHelpers';

vi.mock('@clerk/react', () => ({ useClerk: () => ({ openUserProfile: vi.fn() }) }));

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  removeFakeLocalAI();
});

async function mountSettings() {
  const { RuntimeContext } = await import('@/lib/runtime/context');
  const { default: SettingsPage } = await import('@/pages/SettingsPage');
  const view = await render(
    <RuntimeContext.Provider value={fakeRuntime(new MemoryStore([], PROFILE_COLLEGE), { mode: 'local', profile: PROFILE_COLLEGE })}>
      <MemoryRouter><SettingsPage /></MemoryRouter>
    </RuntimeContext.Provider>,
  );
  await flush(8);
  return view;
}

const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ');

describe('Réglages (application Windows) — recherche', () => {
  it('OpenAlex avec HAL et Crossref ; Wikipédia et les sites officiels vérifiés que ses références citent', async () => {
    installFakeLocalAI({ engine: 'running', installed: ['standard'] });
    const { container } = await mountSettings();
    const section = text(container);
    expect(section).toContain('Recherche académique (HAL, Crossref, OpenAlex)');
    expect(section).toContain('les sites officiels vérifiés (UNESCO, Éduscol, ministères…) que leurs références citent');
  });

  it('moteur de recherche web (SearXNG) : facultatif, interroge directement les sites officiels vérifiés, aucun autre site', async () => {
    installFakeLocalAI({ engine: 'running', installed: ['standard'] });
    const { container } = await mountSettings();
    const label = [...container.querySelectorAll('label')].find(l => l.textContent === 'Moteur de recherche web (facultatif)');
    expect(label).toBeDefined();
    const paragraph = text(label!.nextElementSibling);
    expect(paragraph).toContain('SearXNG');
    expect(paragraph).toContain('interroger directement tous les sites officiels vérifiés (UNESCO, Éduscol, ministères…)');
    expect(paragraph).toContain('sans lui, Magistra consulte ceux que Wikipédia cite');
    expect(paragraph).toContain("Aucun autre site n'est interrogé");
    // Plus d'annonce d'une « recherche web » générale ni de « sources institutionnelles (Bulletin officiel) ».
    expect(text(container)).not.toMatch(/Recherche web \(facultatif\)|[Ss]ources institutionnelles/);
  });
});
