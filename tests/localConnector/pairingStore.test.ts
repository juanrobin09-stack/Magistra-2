// Appairage mémorisé dans le navigateur : IndexedDB « magistra-local-connector » (un seul enregistrement, clé HMAC
// non extractible conservée telle quelle), enregistrements illisibles ignorés, repli en mémoire.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createIndexedDbPairingStore, isStoredPairing, MemoryPairingStore, PAIRING_DB_NAME, type StoredPairing,
} from '@/lib/localConnector/pairingStore';

const CLIENT_ID = 'AAECAwQFBgcICQoLDA0ODw';

async function hmacKey(extractable = false): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), { name: 'HMAC', hash: 'SHA-256' }, extractable, ['sign', 'verify']);
}

async function pairing(overrides: Partial<StoredPairing> = {}): Promise<StoredPairing> {
  return { clientId: CLIENT_ID, key: await hmacKey(), port: 47831, pairedAt: '2026-09-29T08:00:00.000Z', ...overrides };
}

// ─── Faux IndexedDB (sous-ensemble utilisé par le magasin) ──────────────────

interface FakeRequest {
  result?: unknown;
  error: DOMException | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded?: (() => void) | null;
}

class FakeIndexedDb {
  readonly stores = new Map<string, Map<string, unknown>>();
  opened: { name: string; version: number }[] = [];
  failOpen = false;
  neverOpen = false;
  failWrites = false;
  failReads = false;
  closed = 0;

  open(name: string, version: number): FakeRequest {
    this.opened.push({ name, version });
    const request: FakeRequest = { error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
    if (this.neverOpen) return request;
    setTimeout(() => {
      if (this.failOpen) {
        request.error = new DOMException('Stockage bloqué', 'InvalidStateError');
        request.onerror?.();
        return;
      }
      request.result = this.database();
      if (!this.stores.size) request.onupgradeneeded?.();
      request.onsuccess?.();
    }, 0);
    return request;
  }

  private database() {
    return {
      objectStoreNames: { contains: (n: string) => this.stores.has(n) },
      createObjectStore: (n: string) => {
        this.stores.set(n, new Map());
      },
      close: () => {
        this.closed++;
      },
      onversionchange: null as (() => void) | null,
      transaction: (storeName: string, mode: 'readonly' | 'readwrite') => this.transaction(storeName, mode),
    };
  }

  private transaction(storeName: string, mode: 'readonly' | 'readwrite') {
    const data = this.stores.get(storeName);
    if (!data) throw new DOMException('Magasin introuvable', 'NotFoundError');
    const tx = {
      error: null as DOMException | null,
      oncomplete: null as (() => void) | null,
      onerror: null as (() => void) | null,
      onabort: null as (() => void) | null,
      objectStore: () => ({
        get: (key: string) => this.op(tx, mode, () => data.get(key)),
        put: (value: unknown, key: string) => this.op(tx, mode, () => {
          data.set(key, value);
          return key;
        }),
        delete: (key: string) => this.op(tx, mode, () => {
          data.delete(key);
          return undefined;
        }),
      }),
    };
    return tx;
  }

  private op(tx: { error: DOMException | null; oncomplete: (() => void) | null; onerror: (() => void) | null; onabort: (() => void) | null }, mode: string, run: () => unknown): FakeRequest {
    const request: FakeRequest = { error: null, onsuccess: null, onerror: null };
    setTimeout(() => {
      if ((mode === 'readwrite' && this.failWrites) || (mode === 'readonly' && this.failReads)) {
        tx.error = new DOMException('Quota dépassé', 'QuotaExceededError');
        request.error = tx.error;
        request.onerror?.();
        tx.onerror?.();
        tx.onabort?.();
        return;
      }
      request.result = run();
      request.onsuccess?.();
      tx.oncomplete?.();
    }, 0);
    return request;
  }

  asFactory(): IDBFactory {
    return this as unknown as IDBFactory;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('isStoredPairing', () => {
  it('exige un enregistrement complet avec une clé HMAC non extractible', async () => {
    expect(isStoredPairing(await pairing())).toBe(true);
    expect(isStoredPairing(await pairing({ key: await hmacKey(true) }))).toBe(false);
    expect(isStoredPairing(await pairing({ clientId: 'court' }))).toBe(false);
    expect(isStoredPairing(await pairing({ port: 0 }))).toBe(false);
    expect(isStoredPairing(await pairing({ port: 70_000 }))).toBe(false);
    expect(isStoredPairing(await pairing({ port: 47831.5 }))).toBe(false);
    expect(isStoredPairing(await pairing({ pairedAt: 'hier' }))).toBe(false);
    expect(isStoredPairing({ ...(await pairing()), key: { type: 'secret', extractable: false } })).toBe(false);
    expect(isStoredPairing(null)).toBe(false);
  });
});

describe('MemoryPairingStore', () => {
  it('enregistre, relit (copie) et oublie ; refuse un enregistrement invalide', async () => {
    const store = new MemoryPairingStore();
    expect(await store.load()).toBeNull();
    const p = await pairing();
    await store.save(p);
    const loaded = await store.load();
    expect(loaded).toEqual(p);
    expect(loaded).not.toBe(p);
    expect(loaded!.key).toBe(p.key);
    await expect(store.save({ ...p, clientId: 'x' })).rejects.toThrow();
    await store.clear();
    expect(await store.load()).toBeNull();
  });
});

describe('magasin IndexedDB', () => {
  it('base « magistra-local-connector », un seul enregistrement, CryptoKey conservé tel quel', async () => {
    const idb = new FakeIndexedDb();
    const store = createIndexedDbPairingStore(idb.asFactory());
    expect(await store.load()).toBeNull();
    const first = await pairing();
    await store.save(first);
    const second = await pairing({ port: 47832 });
    await store.save(second);
    expect(idb.opened).toEqual([{ name: PAIRING_DB_NAME, version: 1 }]);
    const data = idb.stores.get('pairing')!;
    expect([...data.keys()]).toEqual(['current']);
    const loaded = await store.load();
    expect(loaded).toEqual(second);
    expect(loaded!.key).toBe(second.key);
    expect(loaded!.key.extractable).toBe(false);

    // Un autre onglet (autre instance) lit le même enregistrement.
    expect(await createIndexedDbPairingStore(idb.asFactory()).load()).toEqual(second);

    await store.clear();
    expect(await store.load()).toBeNull();
    expect(data.size).toBe(0);
  });

  it('enregistrement illisible (ancienne version, altération) : ignoré puis effacé', async () => {
    const idb = new FakeIndexedDb();
    const store = createIndexedDbPairingStore(idb.asFactory());
    await store.save(await pairing());
    idb.stores.get('pairing')!.set('current', { clientId: CLIENT_ID, key: 'secret-en-clair', port: 47831, pairedAt: '2026-09-29T08:00:00.000Z' });
    expect(await store.load()).toBeNull();
    expect(idb.stores.get('pairing')!.size).toBe(0);
  });

  it('IndexedDB absent : repli en mémoire (l’appairage dure jusqu’au rechargement)', async () => {
    const store = createIndexedDbPairingStore(null);
    const p = await pairing();
    await store.save(p);
    expect(await store.load()).toEqual(p);
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('ouverture refusée (navigation privée stricte) : repli en mémoire, sans erreur', async () => {
    const idb = new FakeIndexedDb();
    idb.failOpen = true;
    const store = createIndexedDbPairingStore(idb.asFactory());
    expect(await store.load()).toBeNull();
    const p = await pairing();
    await store.save(p);
    expect(await store.load()).toEqual(p);
  });

  it('ouverture sans réponse : repli en mémoire après 3 s', async () => {
    vi.useFakeTimers();
    const idb = new FakeIndexedDb();
    idb.neverOpen = true;
    const store = createIndexedDbPairingStore(idb.asFactory());
    const loading = store.load();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await loading).toBeNull();
    const p = await pairing();
    await store.save(p);
    expect(await store.load()).toEqual(p);
  });

  it('écriture impossible (quota) : l’appairage reste utilisable pendant la visite', async () => {
    const idb = new FakeIndexedDb();
    const store = createIndexedDbPairingStore(idb.asFactory());
    expect(await store.load()).toBeNull();
    idb.failWrites = true;
    const p = await pairing();
    await expect(store.save(p)).resolves.toBeUndefined();
    expect(await store.load()).toEqual(p);
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('lecture impossible après un enregistrement réussi : la copie en mémoire prend le relais', async () => {
    const idb = new FakeIndexedDb();
    const store = createIndexedDbPairingStore(idb.asFactory());
    const p = await pairing();
    await store.save(p);
    idb.failReads = true;
    expect(await store.load()).toEqual(p);
  });
});
