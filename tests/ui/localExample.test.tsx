// @vitest-environment jsdom
// Application Windows, page Générer, IA de l'ordinateur pas encore prête : « Activer l'IA » et, à côté, « Voir un
// exemple pré-rédigé » (même moteur d'exemples que la démonstration du site) — résultat très clairement marqué,
// jamais enregistré ; « Générer » tente toujours la vraie génération (jamais d'exemple silencieux).

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { button, cleanup, click, fakeRuntime, flush, MemoryStore, PROFILE_COLLEGE, render } from './helpers';
import { installFakeLocalAI, removeFakeLocalAI, type FakeLocalAI } from './localAIHelpers';

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  removeFakeLocalAI();
});

function text(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
}

async function mountGenerate(fake: FakeLocalAI) {
  const { RuntimeContext } = await import('@/lib/runtime/context');
  const { LocalGenerationClient } = await import('@/lib/runtime/local');
  const { default: GeneratePage } = await import('@/pages/GeneratePage');
  const store = new MemoryStore([], PROFILE_COLLEGE);
  const runtime = fakeRuntime(store, { mode: 'local', client: new LocalGenerationClient(fake.bridge), profile: PROFILE_COLLEGE });
  const view = await render(
    <RuntimeContext.Provider value={runtime}>
      <MemoryRouter initialEntries={['/app/generate?type=cours&sujet=Les%20fractions']}><GeneratePage /></MemoryRouter>
    </RuntimeContext.Provider>,
  );
  await flush(8);
  return { ...view, store };
}

/** Laisse l'exemple s'afficher en entier (flux simulé, quelques millisecondes par morceau). */
async function waitExample(container: HTMLElement): Promise<void> {
  for (let i = 0; i < 60 && !text(container).includes('Exemple non enregistré'); i++) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
  }
}

describe('Page Générer (application Windows) : IA pas prête', () => {
  it('carte « Activer l’IA » avec « Voir un exemple pré-rédigé » à côté (au lieu d’un simple avertissement)', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: [] });
    const { container } = await mountGenerate(fake);
    const card = container.querySelector('[data-testid="activate-ai"]');
    expect(card).not.toBeNull();
    expect(button(card!, /Activer l’IA/)).not.toBeNull();
    expect(button(card!, /Voir un exemple pré-rédigé/)).not.toBeNull();
    expect(text(card)).toContain('ce n’est pas l’IA');
    expect(container.querySelector('#gen-ai-title')).toBeNull();
    // Le bouton principal reste la vraie génération.
    expect(button(container, /Générer : Cours/)).not.toBeNull();
  });

  it('exemple : bandeau et libellé « Exemple pré-rédigé — ce n’est pas l’IA », jamais enregistré, aucune génération lancée', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: [] });
    const { container, store } = await mountGenerate(fake);
    await click(button(container, /Voir un exemple pré-rédigé/));
    await waitExample(container);
    const result = container.querySelector('section[aria-labelledby="gen-result-title"]')!;
    expect(result).not.toBeNull();
    expect(text(result.querySelector('[role="note"][aria-label="Exemple pré-rédigé"]'))).toContain('Exemple pré-rédigé — ce n’est pas l’IA');
    expect(text(result)).toContain('Exemple pré-rédigé');
    expect(text(result)).toContain('il ne tient compte ni de votre sujet, ni de vos paramètres, ni de vos documents');
    // Même contenu que la démonstration du site ; le texte lui-même (copié, exporté) le dit, sans parler d'un
    // « mode démonstration » qui n'existe pas dans l'application.
    expect(text(result)).toContain('Exemple pré-rédigé : ce texte est identique quels que soient le sujet et les paramètres saisis');
    expect(text(result)).toContain('Il n\'a pas été généré par une IA');
    expect(text(result)).not.toContain('Mode démonstration');
    expect(text(result)).toContain('Exemple non enregistré');
    expect(text(result)).not.toContain('Enregistré dans l\'historique');
    expect(fake.spies.generationStart).not.toHaveBeenCalled();
    expect(store.calls.filter(c => c.method !== 'getStats' && c.method !== 'listGenerations')).toEqual([]);
  });

  it('exemple : son propre sujet et son niveau dans l’en-tête et le titre des exports — jamais ceux saisis par l’enseignant', async () => {
    const exported: { title: string; meta?: Record<string, unknown> }[] = [];
    vi.doMock('@/lib/export', async importOriginal => ({
      ...(await importOriginal<typeof import('@/lib/export')>()),
      exportMarkdown: vi.fn((doc: { title: string }) => {
        exported.push(doc);
      }),
    }));
    try {
      const fake = installFakeLocalAI({ engine: 'running', installed: [] });
      const { container } = await mountGenerate(fake);
      await click(button(container, /Voir un exemple pré-rédigé/));
      await waitExample(container);
      const { getDemoExample } = await import('@shared/demo');
      const example = getDemoExample({ type: 'cours', niveau: PROFILE_COLLEGE.niveaux[0] });
      const result = container.querySelector('section[aria-labelledby="gen-result-title"]')!;
      const header = result.querySelector('#gen-result-title')!.parentElement!.parentElement!;
      expect(text(header)).toContain(example.subject);
      expect(text(header)).toContain(example.level);
      expect(text(header)).toContain('Exemple pré-rédigé');
      // Le sujet saisi (« Les fractions ») n'est jamais associé au texte fixe de l'exemple.
      expect(text(header)).not.toContain('Les fractions');

      await click(button(result, /Markdown/));
      expect(exported).toHaveLength(1);
      expect(exported[0].title).toContain(example.subject);
      expect(exported[0].title).toMatch(/\(exemple pré-rédigé\)$/);
      expect(JSON.stringify(exported[0])).not.toContain('Les fractions');
    } finally {
      vi.doUnmock('@/lib/export');
    }
  });

  it('« Générer » : toujours la vraie génération (jamais d’exemple silencieux)', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: [] });
    const { container } = await mountGenerate(fake);
    await click(button(container, /Générer : Cours/));
    await flush(6);
    expect(fake.spies.generationStart).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="note"][aria-label="Exemple pré-rédigé"]')).toBeNull();
  });
});

describe('Page Générer (application Windows) : IA prête', () => {
  it('ni carte d’activation, ni exemple', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: ['standard'] });
    const { container } = await mountGenerate(fake);
    expect(container.querySelector('[data-testid="activate-ai"]')).toBeNull();
    expect(button(container, /Voir un exemple/)).toBeNull();
  });
});
