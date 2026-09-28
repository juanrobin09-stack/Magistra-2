// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { RuntimeContext } from '@/lib/runtime/context';
import { button, cleanup, click, fakeRuntime, flush, makeRecord, MemoryStore, render, typeInto } from './helpers';

const exportMocks = vi.hoisted(() => ({
  exportPdf: vi.fn(async () => undefined),
  exportMarkdown: vi.fn(async () => undefined),
  printDocument: vi.fn(async () => undefined),
  copyText: vi.fn(async () => true),
}));

vi.mock('@/lib/export', () => exportMocks);
vi.mock('@/components/MarkdownView', () => ({
  default: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}));

// Import après les simulations de modules.
const { default: HistoryPage } = await import('@/pages/HistoryPage');
const { default: FavoritesPage } = await import('@/pages/FavoritesPage');

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

async function mount(store: MemoryStore, url = '/app/history') {
  const view = await render(
    <RuntimeContext.Provider value={fakeRuntime(store)}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/app/history" element={<HistoryPage />} />
          <Route path="/app/favorites" element={<FavoritesPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </RuntimeContext.Provider>,
  );
  await flush();
  return view;
}

const listItems = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLAnchorElement>('section ul li a'));
const location = (root: ParentNode) => root.querySelector('[data-testid="location"]')?.textContent;
const detailRegion = (root: ParentNode) => root.querySelector<HTMLElement>('section[aria-label="Contenu sélectionné"]')!;

beforeEach(() => {
  Object.values(exportMocks).forEach(m => m.mockClear());
});
afterEach(cleanup);

describe('Historique — liste', () => {
  it('pagination « Charger plus » sans limite artificielle', async () => {
    const store = new MemoryStore(Array.from({ length: 65 }, (_, i) => makeRecord(i)));
    const { container } = await mount(store);
    expect(listItems(container)).toHaveLength(30);
    await click(button(container, 'Charger plus'));
    await flush();
    expect(listItems(container)).toHaveLength(60);
    await click(button(container, 'Charger plus'));
    await flush();
    expect(listItems(container)).toHaveLength(65);
    expect(button(container, 'Charger plus')).toBeNull();
  });

  it('recherche insensible aux accents (sujet, matière, outil)', async () => {
    const store = new MemoryStore([
      makeRecord(0, { sujet: 'La Révolution française', matiere: 'histoire_geo' }),
      makeRecord(1, { sujet: 'Les fractions', matiere: 'mathematiques' }),
      makeRecord(2, { sujet: 'Théorème de Pythagore', matiere: 'mathematiques', type: 'evaluation' }),
    ]);
    const { container } = await mount(store);
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await typeInto(search, 'revolution');
    expect(listItems(container).map(a => a.textContent)).toEqual([expect.stringContaining('Révolution')]);
    await typeInto(search, 'mathematiques evaluation');
    expect(listItems(container).map(a => a.textContent)).toEqual([expect.stringContaining('Pythagore')]);
    await typeInto(search, 'zzz');
    expect(container.textContent).toContain('Aucun résultat pour « zzz »');
  });

  it('recherche dans tout l’historique : les pages suivantes sont chargées automatiquement', async () => {
    const records = Array.from({ length: 65 }, (_, i) => makeRecord(i));
    records[64] = makeRecord(64, { sujet: 'La photosynthèse (très ancien contenu)' });
    const { container } = await mount(new MemoryStore(records));
    expect(listItems(container)).toHaveLength(30);
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await typeInto(search, 'photosynthese');
    await flush(8);
    expect(listItems(container).map(a => a.textContent)).toEqual([expect.stringContaining('photosynthèse')]);
    expect(container.textContent).toContain('1 résultat');
    expect(container.textContent).not.toContain('contenus les plus récents');
  });

  it('erreur de chargement visible, puis « Réessayer »', async () => {
    const store = new MemoryStore([makeRecord(0)]);
    store.failures.listGenerations = 1;
    const { container } = await mount(store);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Impossible de charger votre historique');
    expect(container.textContent).not.toContain('Aucune génération pour le moment');
    await click(button(container, /Réessayer/));
    await flush();
    expect(listItems(container)).toHaveLength(1);
  });

  it('historique vide : message et invitation à générer', async () => {
    const { container } = await mount(new MemoryStore());
    expect(container.textContent).toContain('Aucune génération pour le moment');
    expect(container.querySelector('a[href="/app/generate"]')).not.toBeNull();
  });
});

describe('Historique — détail et actions', () => {
  it('sélection via ?id= : le contenu complet est chargé avec getGeneration', async () => {
    const store = new MemoryStore([
      makeRecord(0),
      makeRecord(1, { sujet: 'Les sources du droit', type: 'exercices', niveau: 'licence_1', matiere: 'Droit', discipline: 'Droit public', internetUsed: true, truncated: true }),
    ]);
    const { container } = await mount(store, '/app/history?id=gen-1');
    expect(store.calls.some(c => c.method === 'getGeneration' && c.args[0] === 'gen-1')).toBe(true);
    const detail = detailRegion(container);
    expect(detail.querySelector('h2')?.textContent).toBe('Les sources du droit');
    expect(detail.textContent).toContain('TD / Exercices');
    expect(detail.textContent).toContain('Licence 1');
    expect(detail.textContent).toContain('Droit public');
    expect(detail.textContent).toContain('⚖️'); // emoji retrouvé à partir d'un ancien libellé
    expect(detail.textContent).toContain('Internet utilisé');
    expect(detail.textContent).toContain('Contenu tronqué');
    expect(detail.querySelector('[data-testid="markdown"]')?.textContent).toContain('Contenu numéro 1');
    // L'élément sélectionné est signalé dans la liste
    expect(container.querySelector('a[aria-current="true"]')?.textContent).toContain('Les sources du droit');
  });

  it('un clic dans la liste met à jour l’URL (?id=) et « Retour » revient à la liste', async () => {
    const store = new MemoryStore([makeRecord(0), makeRecord(1)]);
    const { container } = await mount(store);
    await click(listItems(container)[1]);
    await flush();
    expect(location(container)).toBe('/app/history?id=gen-1');
    expect(detailRegion(container).querySelector('h2')?.textContent).toBe('Sujet 1');
    await click(button(detailRegion(container), /Retour à la liste/));
    await flush();
    expect(location(container)).toBe('/app/history');
  });

  it('favori : bascule optimiste, bouton désactivé pendant l’appel, retour arrière en cas d’erreur', async () => {
    const store = new MemoryStore([makeRecord(0)]);
    const { container } = await mount(store, '/app/history?id=gen-0');
    const fav = () => detailRegion(container).querySelector<HTMLButtonElement>('button[aria-label="Favori"]')!;
    expect(fav().getAttribute('aria-pressed')).toBe('false');

    // Succès
    await click(fav());
    await flush();
    expect(fav().getAttribute('aria-pressed')).toBe('true');
    expect(store.records[0].isFavorite).toBe(true);
    expect(container.querySelector('section ul li a')?.textContent).toContain('Favori');

    // Échec : l'état revient en arrière et une erreur est annoncée
    store.failures.setFavorite = 1;
    let resolveGate: () => void = () => undefined;
    const gate = new Promise<void>(r => {
      resolveGate = r;
    });
    const original = store.setFavorite.bind(store);
    store.setFavorite = async (id, value) => {
      await gate;
      return original(id, value);
    };
    await click(fav());
    expect(fav().getAttribute('aria-pressed')).toBe('false'); // optimiste
    expect(fav().disabled).toBe(true); // pendant l'appel
    resolveGate();
    await flush();
    expect(fav().getAttribute('aria-pressed')).toBe('true'); // retour arrière
    expect(fav().disabled).toBe(false);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Favori non modifié');
    expect(store.records[0].isFavorite).toBe(true);
  });

  it('suppression avec confirmation (Annuler ne supprime rien)', async () => {
    const store = new MemoryStore([makeRecord(0), makeRecord(1)]);
    const { container } = await mount(store, '/app/history?id=gen-0');
    const del = () => detailRegion(container).querySelector<HTMLButtonElement>('button[aria-label="Supprimer ce contenu"]')!;

    await click(del());
    let dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain('Sujet 0');
    await click(button(dialog, 'Annuler'));
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(store.calls.some(c => c.method === 'deleteGeneration')).toBe(false);

    await click(del());
    dialog = document.querySelector('[role="alertdialog"]')!;
    await click(button(dialog, 'Supprimer'));
    await flush();
    expect(store.calls.filter(c => c.method === 'deleteGeneration')).toHaveLength(1);
    expect(listItems(container)).toHaveLength(1);
    expect(location(container)).toBe('/app/history');
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Contenu supprimé');
  });

  it('actions d’export : Markdown, PDF, impression et copie', async () => {
    const store = new MemoryStore([makeRecord(0, { sujet: 'Les fractions' })]);
    const { container } = await mount(store, '/app/history?id=gen-0');
    const detail = detailRegion(container);
    await click(detail.querySelector('button[aria-label="Exporter en Markdown"]'));
    await click(detail.querySelector('button[aria-label="Exporter en PDF"]'));
    await click(detail.querySelector('button[aria-label="Imprimer"]'));
    await flush();
    for (const fn of [exportMocks.exportMarkdown, exportMocks.exportPdf, exportMocks.printDocument]) {
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(expect.objectContaining({ title: 'Les fractions', content: expect.stringContaining('Contenu numéro 0') }));
    }
    await click(detail.querySelector('button[aria-label="Copier le contenu"]'));
    await flush();
    expect(exportMocks.copyText).toHaveBeenCalledTimes(1);
    expect(detail.querySelector('button[aria-label="Contenu copié"]')).not.toBeNull();
  });

  it('copie refusée : erreur visible', async () => {
    exportMocks.copyText.mockResolvedValueOnce(false);
    const store = new MemoryStore([makeRecord(0)]);
    const { container } = await mount(store, '/app/history?id=gen-0');
    await click(detailRegion(container).querySelector('button[aria-label="Copier le contenu"]'));
    await flush();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Copie impossible');
  });

  it('contenu introuvable : message clair au lieu d’un chargement infini', async () => {
    const { container } = await mount(new MemoryStore([makeRecord(0)]), '/app/history?id=inconnu');
    expect(detailRegion(container).textContent).toContain('Ce contenu est introuvable');
  });

  it('boutons à icône : tous ont un nom accessible', async () => {
    const { container } = await mount(new MemoryStore([makeRecord(0)]), '/app/history?id=gen-0');
    for (const b of Array.from(detailRegion(container).querySelectorAll('button'))) {
      const name = b.getAttribute('aria-label') ?? b.textContent?.trim();
      expect(name, b.outerHTML).toBeTruthy();
    }
  });
});

describe('Favoris', () => {
  it('liste uniquement les favoris, avec recherche ; retirer un favori le masque (annulable)', async () => {
    const store = new MemoryStore([
      makeRecord(0, { isFavorite: true, sujet: 'Les équations' }),
      makeRecord(1, { isFavorite: false, sujet: 'Hors favoris' }),
      makeRecord(2, { isFavorite: true, sujet: 'La photosynthèse', matiere: 'svt' }),
    ]);
    const { container } = await mount(store, '/app/favorites');
    expect(listItems(container).map(a => a.textContent)).toEqual([
      expect.stringContaining('Les équations'),
      expect.stringContaining('La photosynthèse'),
    ]);
    await typeInto(container.querySelector<HTMLInputElement>('input[type="search"]'), 'equations');
    expect(listItems(container)).toHaveLength(1);
    await typeInto(container.querySelector<HTMLInputElement>('input[type="search"]'), '');

    await click(listItems(container)[0]);
    await flush();
    const fav = () => detailRegion(container).querySelector<HTMLButtonElement>('button[aria-label="Favori"]')!;
    await click(fav());
    await flush();
    expect(store.records[0].isFavorite).toBe(false);
    expect(listItems(container).map(a => a.textContent)).toEqual([expect.stringContaining('La photosynthèse')]);
    // Annulation : le contenu réapparaît
    await click(fav());
    await flush();
    expect(listItems(container)).toHaveLength(2);
    // Export Markdown disponible aussi dans les Favoris
    expect(detailRegion(container).querySelector('button[aria-label="Exporter en Markdown"]')).not.toBeNull();
  });

  it('pagination des favoris au-delà de 100 éléments', async () => {
    const store = new MemoryStore(Array.from({ length: 130 }, (_, i) => makeRecord(i, { isFavorite: i % 2 === 0 })));
    const { container } = await mount(store, '/app/favorites');
    expect(listItems(container)).toHaveLength(30);
    for (let i = 0; i < 2; i++) {
      await click(button(container, 'Charger plus'));
      await flush();
    }
    expect(listItems(container)).toHaveLength(65);
    expect(button(container, 'Charger plus')).toBeNull();
  });

  it('suppressions puis « Charger plus » : aucun élément sauté (curseur corrigé)', async () => {
    const store = new MemoryStore(Array.from({ length: 40 }, (_, i) => makeRecord(i)));
    const { container } = await mount(store, '/app/history?id=gen-0');
    const del = () => detailRegion(container).querySelector<HTMLButtonElement>('button[aria-label="Supprimer ce contenu"]')!;
    await click(del());
    await click(button(document.querySelector('[role="alertdialog"]')!, 'Supprimer'));
    await flush();
    await click(button(container, 'Charger plus'));
    await flush();
    const ids = listItems(container).map(a => a.getAttribute('href'));
    expect(ids).toHaveLength(39);
    expect(new Set(ids).size).toBe(39);
    expect(ids).toContain('/app/history?id=gen-30');
  });
});
