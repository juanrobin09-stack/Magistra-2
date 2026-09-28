// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from '@/pages/DashboardPage';
import { RuntimeContext } from '@/lib/runtime/context';
import { DemoDataStore } from '@/lib/runtime/demo';
import { cleanup, fakeRuntime, flush, MemoryStore, render } from './helpers';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('profil de démonstration relu depuis le navigateur', () => {
  it('profil modifié ou corrompu : validé (champs invalides ignorés), sans exception', async () => {
    localStorage.setItem('magistra_demo_profile_v2', JSON.stringify({ displayName: 'Mme Test', niveaux: 'pas-un-tableau', matierePrincipale: '<b>' }));
    const profile = await new DemoDataStore().getProfile();
    expect(profile).toMatchObject({ displayName: 'Mme Test', niveaux: [], matierePrincipale: 'autre' });

    localStorage.setItem('magistra_demo_profile_v2', '{json cassé');
    expect(await new DemoDataStore().getProfile()).toBeNull();
  });

  it('le tableau de bord s’affiche avec un profil sans niveaux', async () => {
    const store = new MemoryStore();
    const profile = { displayName: 'Mme Test', etablissement: '', cycle: '', niveaux: undefined as unknown as [], matierePrincipale: 'autre' as const };
    const { container } = await render(
      <RuntimeContext.Provider value={fakeRuntime(store, { profile })}>
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </RuntimeContext.Provider>,
    );
    await flush();
    expect(container.textContent).toContain('Mme Test');
  });
});
