// @vitest-environment jsdom
// Reprise après un fichier introuvable (nouvelle version déployée) : un seul rechargement par minute, et l'évènement
// n'est neutralisé que lorsqu'on recharge réellement (sinon Vite relance l'erreur d'origine, qui s'affiche).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { installPreloadRecovery, recoverFromPreloadError, type PreloadRecoveryEnv } from '@/lib/preloadRecovery';

afterEach(() => vi.restoreAllMocks());

class FakeStorage {
  items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

function makeEnv(overrides: Partial<PreloadRecoveryEnv> = {}) {
  const storage = new FakeStorage();
  const clock = { now: 1_000_000 };
  const reload = vi.fn();
  const env: PreloadRecoveryEnv = {
    now: () => clock.now,
    isOnline: () => true,
    storage: () => storage,
    reload,
    ...overrides,
  };
  return { env, storage, clock, reload };
}

const failure = () => new Event('vite:preloadError', { cancelable: true });

describe('recoverFromPreloadError', () => {
  it('premier échec : recharge la page et neutralise l\'évènement', () => {
    const { env, reload } = makeEnv();
    const event = failure();
    expect(recoverFromPreloadError(event, env)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('deuxième échec dans la minute : ni rechargement ni neutralisation (l\'erreur d\'origine remonte)', () => {
    const { env, clock, reload } = makeEnv();
    recoverFromPreloadError(failure(), env);
    clock.now += 59_000;
    const event = failure();
    expect(recoverFromPreloadError(event, env)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it('un échec qui tarde (plus de 10 s) ne relance pas de boucle : la minuterie ne vide rien', () => {
    const { env, clock, reload } = makeEnv();
    recoverFromPreloadError(failure(), env);
    for (let i = 0; i < 4; i++) {
      clock.now += 12_000;
      expect(recoverFromPreloadError(failure(), env)).toBe(false);
    }
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('après la minute, une nouvelle version déployée peut déclencher un nouveau rechargement', () => {
    const { env, clock, reload } = makeEnv();
    recoverFromPreloadError(failure(), env);
    clock.now += 61_000;
    const event = failure();
    expect(recoverFromPreloadError(event, env)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(event.defaultPrevented).toBe(true);
  });

  it('horodatage dans le futur (horloge reculée) : n\'empêche pas le rechargement, mais le suivant est bloqué', () => {
    const { env, storage, clock, reload } = makeEnv();
    storage.setItem('magistra_preload_reload', String(clock.now + 3_600_000));
    expect(recoverFromPreloadError(failure(), env)).toBe(true);
    expect(recoverFromPreloadError(failure(), env)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('hors ligne : aucun rechargement (la page ne se rechargerait pas et l\'état serait perdu), erreur d\'origine conservée', () => {
    const { env, storage, reload } = makeEnv({ isOnline: () => false });
    const event = failure();
    expect(recoverFromPreloadError(event, env)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(storage.items.size).toBe(0);
  });

  it.each([
    ['accès au stockage', () => { throw new Error('SecurityError'); }],
    ['lecture', () => ({ getItem: () => { throw new Error('SecurityError'); }, setItem: () => undefined })],
    ['écriture', () => ({ getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } })],
  ])('sessionStorage qui lève (%s) : pas de rechargement, évènement intact', (_name, storage) => {
    const { env, reload } = makeEnv({ storage });
    const event = failure();
    expect(recoverFromPreloadError(event, env)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('installPreloadRecovery', () => {
  it('écoute vite:preloadError sur la fenêtre', () => {
    const { env, reload } = makeEnv();
    installPreloadRecovery(window, env);
    const event = failure();
    window.dispatchEvent(event);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('navigateur hors ligne (navigator.onLine) : l\'évènement n\'est pas neutralisé', () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const target = new EventTarget();
    installPreloadRecovery(target);
    const event = failure();
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
