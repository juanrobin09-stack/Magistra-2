// Autorisation « accès au réseau local » du navigateur : lue sans jamais être demandée, jamais d'exception.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { queryLoopbackPermission } from '@/lib/localConnector/permission';

type Query = (descriptor: { name: string }) => Promise<{ state: string }>;

function permissions(query: Query) {
  const names: string[] = [];
  const api = {
    query: vi.fn((descriptor: { name: string }) => {
      names.push(descriptor.name);
      return query(descriptor);
    }),
  };
  return { api: api as unknown as Pick<Permissions, 'query'>, names };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('queryLoopbackPermission', () => {
  it('« loopback-network » connu : son état, sans essayer l’autre nom', async () => {
    for (const state of ['granted', 'prompt', 'denied'] as const) {
      const { api, names } = permissions(async () => ({ state }));
      expect(await queryLoopbackPermission(api)).toBe(state);
      expect(names).toEqual(['loopback-network']);
    }
  });

  it('nom inconnu du navigateur (TypeError) : « local-network-access » essayé ensuite', async () => {
    const { api, names } = permissions(async ({ name }) => {
      if (name === 'loopback-network') throw new TypeError('Unknown permission');
      return { state: 'prompt' };
    });
    expect(await queryLoopbackPermission(api)).toBe('prompt');
    expect(names).toEqual(['loopback-network', 'local-network-access']);
  });

  it('aucun nom connu, exception immédiate, état inattendu ou API absente : « unsupported »', async () => {
    expect(await queryLoopbackPermission(permissions(async () => {
      throw new TypeError('Unknown permission');
    }).api)).toBe('unsupported');
    expect(await queryLoopbackPermission(permissions(() => {
      throw new Error('synchrone');
    }).api)).toBe('unsupported');
    expect(await queryLoopbackPermission(permissions(async () => ({ state: 'bizarre' })).api)).toBe('unsupported');
    expect(await queryLoopbackPermission(null)).toBe('unsupported');
    // Environnement sans navigator.permissions (Node) : valeur par défaut.
    expect(await queryLoopbackPermission()).toBe('unsupported');
  });

  it('réponse qui n’arrive jamais : « unsupported » après le délai, sans rester bloqué', async () => {
    vi.useFakeTimers();
    const { api } = permissions(() => new Promise(() => undefined));
    const pending = queryLoopbackPermission(api);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(await pending).toBe('unsupported');
  });
});
