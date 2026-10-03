// @vitest-environment jsdom
// Réglages de l'application Windows, section « Recherche » : ce que chaque réglage permet réellement de consulter
// (sites officiels vérifiés, publications, Wikipédia), sans promettre le web en général.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { NOT_SEARCHED_SITES, SEARCHED_DOMAIN_COUNT, trustedSearchGroups } from '@shared/research/trusted';
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
    expect(section).toContain('les sites officiels vérifiés que leurs références citent pour votre sujet');
    expect(section).not.toMatch(/\btous les sites\b|tout le catalogue/);
  });

  it('moteur de recherche web (SearXNG) : facultatif, interroge directement les principaux sites officiels vérifiés (nombre exact), dit ce qui ne l\'est pas, aucun autre site', async () => {
    installFakeLocalAI({ engine: 'running', installed: ['standard'] });
    const { container } = await mountSettings();
    const label = [...container.querySelectorAll('label')].find(l => l.textContent === 'Moteur de recherche web (facultatif)');
    expect(label).toBeDefined();
    const paragraph = text(label!.nextElementSibling);
    expect(paragraph).toContain('SearXNG');
    expect(paragraph).toContain('interroger directement les principaux sites officiels vérifiés (UNESCO, Éduscol, ministères, ONU…)');
    expect(paragraph).not.toMatch(/\btous\b|tout le catalogue/);
    // Le nombre annoncé est celui des domaines réellement interrogés, et ce qui ne l'est pas est nommé.
    expect(paragraph).toContain(`soit ${SEARCHED_DOMAIN_COUNT} domaines`);
    expect(trustedSearchGroups().flat()).toHaveLength(SEARCHED_DOMAIN_COUNT);
    expect(paragraph).toContain(`Ne sont pas interrogés directement : ${NOT_SEARCHED_SITES}.`);
    expect(paragraph).toContain('Sans lui, Magistra consulte seulement les sites officiels vérifiés que Wikipédia cite pour le sujet');
    expect(paragraph).toContain("Aucun autre site n'est interrogé");
    // Plus d'annonce d'une « recherche web » générale ni de « sources institutionnelles (Bulletin officiel) ».
    expect(text(container)).not.toMatch(/Recherche web \(facultatif\)|[Ss]ources institutionnelles/);
  });
});
