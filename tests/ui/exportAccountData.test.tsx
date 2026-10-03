// @vitest-environment jsdom
// Export des données du compte (JSON) : pagination complète, fiche illisible, profil nul, aucun jeton dans le fichier,
// annulation, bouton des Réglages.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { MagistraError } from '@shared/errors';
import type { GenerationRecord } from '@shared/types';
import { accountExportFileName, collectAccountData, ExportCancelled, EXPORT_ERROR_MESSAGE } from '@/lib/exportAccountData';
import { RuntimeContext } from '@/lib/runtime/context';
import SettingsPage from '@/pages/SettingsPage';
import { button, cleanup, click, fakeRuntime, flush, makeRecord, MemoryStore, PROFILE_COLLEGE, render } from './helpers';

vi.mock('@clerk/react', () => ({ useClerk: () => ({ openUserProfile: vi.fn() }) }));

afterEach(cleanup);

function manyRecords(n: number): GenerationRecord[] {
  return Array.from({ length: n }, (_, i) => makeRecord(i + 1, { isFavorite: i % 5 === 0 }));
}

describe('collectAccountData', () => {
  it('parcourt toutes les pages (historique complet, favoris compris) et lit chaque fiche', async () => {
    const store = new MemoryStore(manyRecords(75), PROFILE_COLLEGE);
    const progress: number[] = [];
    const data = await collectAccountData(store, { onProgress: p => progress.push(p.done), now: () => new Date('2026-10-01T10:00:00Z') });
    expect(data.generations).toHaveLength(75);
    expect(new Set(data.generations.map(g => g.id)).size).toBe(75);
    expect(data.generations.filter(g => g.isFavorite)).toHaveLength(15);
    expect(data.profile).toEqual(PROFILE_COLLEGE);
    expect(data.unreadable).toEqual([]);
    expect(data.exportedAt).toBe('2026-10-01T10:00:00.000Z');
    // 75 fiches par pages de 30 : 3 pages demandées, sans filtre « favoris ».
    const lists = store.calls.filter(c => c.method === 'listGenerations');
    expect(lists).toHaveLength(3);
    expect(lists.every(c => !(c.args[0] as { favoritesOnly?: boolean }).favoritesOnly)).toBe(true);
    expect(progress.at(-1)).toBe(75);
  });

  it('lit les fiches avec au plus 3 requêtes simultanées', async () => {
    const store = new MemoryStore(manyRecords(20), null);
    let active = 0;
    let peak = 0;
    const original = store.getGeneration.bind(store);
    store.getGeneration = async (id: string) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      try {
        return await original(id);
      } finally {
        active--;
      }
    };
    await collectAccountData(store);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('une fiche illisible est signalée sans faire échouer l\'export', async () => {
    const store = new MemoryStore(manyRecords(5), PROFILE_COLLEGE);
    store.failures.getGeneration = 1;
    const data = await collectAccountData(store);
    expect(data.generations).toHaveLength(4);
    expect(data.unreadable).toHaveLength(1);
    expect(data.unreadable[0]).toMatchObject({ id: expect.any(String), sujet: expect.any(String) });
  });

  it('une panne réseau arrête l\'export (jamais un fichier silencieusement incomplet)', async () => {
    const store = new MemoryStore(manyRecords(50), PROFILE_COLLEGE);
    store.getGeneration = async () => {
      throw new MagistraError('NETWORK_ERROR');
    };
    await expect(collectAccountData(store)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('une erreur sur la liste interrompt l\'export', async () => {
    const store = new MemoryStore(manyRecords(5), null);
    store.failures.listGenerations = 1;
    await expect(collectAccountData(store)).rejects.toBeInstanceOf(Error);
  });

  it('profil nul et historique vide : fichier valide', async () => {
    const data = await collectAccountData(new MemoryStore([], null));
    expect(data.profile).toBeNull();
    expect(data.generations).toEqual([]);
    expect(JSON.parse(JSON.stringify(data)).profile).toBeNull();
  });

  it('ne contient ni jeton, ni clé, ni champ inconnu renvoyé par le stockage', async () => {
    const store = new MemoryStore([makeRecord(1)], PROFILE_COLLEGE);
    const original = store.getGeneration.bind(store);
    store.getGeneration = async id => ({ ...(await original(id)), token: 'jwt-secret', apiKey: 'sk-secret', userId: 'user_123' } as GenerationRecord);
    const json = JSON.stringify(await collectAccountData(store));
    expect(json).not.toMatch(/jwt-secret|sk-secret|user_123|token|apiKey/i);
  });

  it('annulation : ExportCancelled, aucune lecture après l\'annulation', async () => {
    const store = new MemoryStore(manyRecords(40), null);
    const abort = new AbortController();
    abort.abort();
    await expect(collectAccountData(store, { signal: abort.signal })).rejects.toBeInstanceOf(ExportCancelled);
    expect(store.calls).toHaveLength(0);
  });

  it('nom de fichier : magistra-mes-donnees-AAAA-MM-JJ.json', () => {
    expect(accountExportFileName(new Date('2026-10-01T10:00:00Z'))).toBe('magistra-mes-donnees-2026-10-01.json');
  });
});

describe('Réglages — bouton d\'export', () => {
  let downloads: Blob[];

  beforeEach(() => {
    downloads = [];
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn((blob: Blob) => {
        downloads.push(blob);
        return 'blob:test/1';
      }),
      revokeObjectURL: vi.fn(),
    }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mount(store: MemoryStore) {
    return render(
      <RuntimeContext.Provider value={fakeRuntime(store, { profile: PROFILE_COLLEGE })}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </RuntimeContext.Provider>,
    );
  }

  it('télécharge un JSON complet, sans confirmation, au-dessus du bouton d\'effacement', async () => {
    const store = new MemoryStore(manyRecords(35), PROFILE_COLLEGE);
    const { container } = await mount(store);
    const exportBtn = button(container, /Télécharger toutes mes données \(JSON\)/)!;
    const deleteBtn = button(container, /Effacer les données de démonstration/)!;
    expect(exportBtn).toBeTruthy();
    expect(exportBtn.compareDocumentPosition(deleteBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await click(exportBtn);
    await flush(10);
    expect(document.body.querySelector('[role="dialog"], [role="alertdialog"]')).toBeNull();
    expect(downloads).toHaveLength(1);
    const data = JSON.parse(await downloads[0].text()) as { generations: unknown[]; profile: { displayName: string } };
    expect(data.generations).toHaveLength(35);
    expect(data.profile.displayName).toBe('M. Martin');
    expect(container.textContent).toContain('Fichier téléchargé : 35 fiches');
  });

  it('affiche un message générique (sans détail technique) quand l\'export échoue', async () => {
    const store = new MemoryStore(manyRecords(3), PROFILE_COLLEGE);
    store.failures.listGenerations = 1;
    const { container } = await mount(store);
    await click(button(container, /Télécharger toutes mes données/));
    await flush(10);
    expect(downloads).toHaveLength(0);
    expect(container.textContent).toContain(EXPORT_ERROR_MESSAGE);
    expect(container.textContent).not.toContain('SimulatedError');
    expect(container.textContent).not.toContain('Échec simulé');
  });
});
