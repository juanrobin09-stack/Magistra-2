// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ProfileGuard } from '@/components/guards';
import { RuntimeContext } from '@/lib/runtime/context';
import type { RuntimeValue } from '@/lib/runtime/types';
import { MagistraError } from '@shared/errors';
import { button, cleanup, click, fakeRuntime, flush, MemoryStore, render } from './helpers';

afterEach(cleanup);

async function mount(overrides: Partial<RuntimeValue>) {
  const view = await render(
    <RuntimeContext.Provider value={fakeRuntime(new MemoryStore(), overrides)}>
      <MemoryRouter>
        <ProfileGuard>
          <p>Contenu protégé</p>
        </ProfileGuard>
      </MemoryRouter>
    </RuntimeContext.Provider>,
  );
  await flush();
  return view;
}

describe('ProfileGuard — profil illisible', () => {
  it('affiche la cause réelle (serveur indisponible), sans conseil trompeur, et permet de réessayer', async () => {
    const reloadProfile = vi.fn(async () => undefined);
    const { container } = await mount({
      profileStatus: 'error',
      profileError: new MagistraError('NETWORK_ERROR', 'Le serveur Magistra est momentanément indisponible. Réessayez dans quelques instants.'),
      reloadProfile,
    });
    const text = container.textContent ?? '';
    expect(text).toContain('Impossible de charger votre profil.');
    expect(text).toContain('Le serveur Magistra est momentanément indisponible.');
    expect(text).not.toContain('Contenu protégé');
    await click(button(container, 'Réessayer'));
    expect(reloadProfile).toHaveBeenCalledOnce();
  });

  it('erreur inattendue : message neutre, jamais de détail technique ; pas de déconnexion hors site web', async () => {
    const { container } = await mount({
      mode: 'local',
      profileStatus: 'error',
      profileError: new MagistraError('INTERNAL', 'TypeError: x is undefined at store.ts:12'),
    });
    const text = container.textContent ?? '';
    expect(text).toContain('Réessayez dans quelques instants.');
    expect(text).not.toMatch(/TypeError|store\.ts/);
    expect(button(container, /Se (re|dé)connecter/)).toBeNull();
  });
});
