// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { clearProfileCache, createSignOutWatcher } from '@/lib/runtime/web';
import ProfileCacheCleaner from '@/components/ProfileCacheCleaner';

const clerkMock = vi.hoisted(() => ({
  user: undefined as { id: string } | null | undefined,
  listeners: [] as Array<(resources: { user?: { id: string } | null }) => void>,
}));

vi.mock('@clerk/react', () => ({
  useClerk: () => ({
    user: clerkMock.user,
    addListener: (cb: (resources: { user?: { id: string } | null }) => void) => {
      clerkMock.listeners.push(cb);
      return () => {
        clerkMock.listeners = clerkMock.listeners.filter(l => l !== cb);
      };
    },
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function seed() {
  localStorage.setItem('magistra_profile_a', '{"displayName":"A"}');
  localStorage.setItem('magistra_profile_b', '{"displayName":"B"}');
  localStorage.setItem('magistra_engine_choice', 'server');
}

beforeEach(() => {
  localStorage.clear();
  clerkMock.user = undefined;
  clerkMock.listeners = [];
});
afterEach(() => localStorage.clear());

describe('clearProfileCache', () => {
  it('efface les copies de profil de tous les comptes, pas les autres clés', () => {
    seed();
    clearProfileCache();
    expect(localStorage.getItem('magistra_profile_a')).toBeNull();
    expect(localStorage.getItem('magistra_profile_b')).toBeNull();
    expect(localStorage.getItem('magistra_engine_choice')).toBe('server');
  });

  it('ne plante pas si le stockage local est indisponible', () => {
    const spy = vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => clearProfileCache()).not.toThrow();
    spy.mockRestore();
  });
});

describe('createSignOutWatcher', () => {
  it('n\'efface que sur « connecté → déconnecté »', () => {
    const onSignOut = vi.fn();
    const watch = createSignOutWatcher(onSignOut);
    watch({ user: undefined }); // chargement
    watch({ user: null }); // page ouverte sans session
    expect(onSignOut).not.toHaveBeenCalled();
    watch({ user: { id: 'u1' } });
    watch({ user: { id: 'u1' } }); // simple rafraîchissement du jeton
    expect(onSignOut).not.toHaveBeenCalled();
    watch({ user: null });
    expect(onSignOut).toHaveBeenCalledTimes(1);
    watch({ user: null });
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('<ProfileCacheCleaner />', () => {
  it('vide la copie du profil à la déconnexion Clerk, et seulement alors', async () => {
    seed();
    clerkMock.user = { id: 'a' };
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(<ProfileCacheCleaner />);
    });
    expect(clerkMock.listeners).toHaveLength(1);
    // Rafraîchissement de session : rien n'est effacé.
    act(() => clerkMock.listeners[0]({ user: { id: 'a' } }));
    expect(localStorage.getItem('magistra_profile_a')).not.toBeNull();
    // Déconnexion.
    act(() => clerkMock.listeners[0]({ user: null }));
    expect(localStorage.getItem('magistra_profile_a')).toBeNull();
    expect(localStorage.getItem('magistra_profile_b')).toBeNull();
    expect(localStorage.getItem('magistra_engine_choice')).toBe('server');
    await act(async () => root.unmount());
    expect(clerkMock.listeners).toHaveLength(0);
  });
});
