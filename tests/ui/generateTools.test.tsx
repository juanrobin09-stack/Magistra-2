// @vitest-environment jsdom
// Outils dans la barre latérale : la page Générer suit l'outil choisi dans « Outils pédagogiques » (adresse
// /app/generate?type=…), le présente en grand, garde la saisie d'un outil à l'autre, et inscrit l'outil dans
// l'adresse quand elle n'en porte pas (« Générer », reprise depuis l'historique).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { cleanup, click, fakeRuntime, flush, MemoryStore, PROFILE_COLLEGE, render, typeInto } from './helpers';

vi.mock('@/components/ai/AIStatusBadge', () => ({ default: () => <p data-testid="ai-status">IA prête</p> }));
vi.mock('@clerk/react', () => ({ UserButton: () => <button type="button" aria-label="Compte">Compte</button> }));

beforeEach(() => {
  localStorage.removeItem('magistra_sidebar_tools_open');
  // Démonstration : la carte « Passez à la vraie IA » demande la dernière version Windows (sans réponse ici).
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.removeItem('magistra_sidebar_tools_open');
});

let currentUrl = '';
function UrlProbe() {
  const location = useLocation();
  currentUrl = `${location.pathname}${location.search}`;
  return null;
}

async function mount(url: string) {
  const { RuntimeContext } = await import('@/lib/runtime/context');
  const { default: AppLayout } = await import('@/components/layout/AppLayout');
  const { default: GeneratePage } = await import('@/pages/GeneratePage');
  const store = new MemoryStore([], PROFILE_COLLEGE);
  const view = await render(
    <RuntimeContext.Provider value={fakeRuntime(store, { mode: 'demo', profile: PROFILE_COLLEGE })}>
      <MemoryRouter initialEntries={[url]}>
        <UrlProbe />
        <Routes>
          <Route path="/app" element={<AppLayout />}>
            <Route path="generate" element={<GeneratePage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </RuntimeContext.Provider>,
  );
  await flush(6);
  return view;
}

const heading = (root: ParentNode) => root.querySelector('main h1')?.textContent?.trim();
const nav = (root: ParentNode) => root.querySelector<HTMLElement>('nav[aria-label="Navigation principale"]')!;
const submit = (root: ParentNode) => root.querySelector<HTMLButtonElement>('form button[type="submit"]')!;

describe('page Générer pilotée par « Outils pédagogiques »', () => {
  it('l’outil de l’adresse est présenté en grand, avec sa famille', async () => {
    const { container } = await mount('/app/generate?type=evaluation');
    expect(heading(container)).toBe('Évaluation');
    expect(container.querySelector('main header')?.textContent).toContain('Entraîner et évaluer');
    expect(submit(container).textContent).toContain('Générer : Évaluation');
  });

  it('choisir un autre outil dans la barre latérale change l’outil de la page, sans perdre la saisie', async () => {
    const { container } = await mount('/app/generate?type=cours');
    await typeInto(container.querySelector<HTMLInputElement>('#gen-sujet'), 'Les fractions');
    const toggle = Array.from(nav(container).querySelectorAll('button')).find(b => b.textContent?.includes('Outils pédagogiques'))!;
    await click(toggle);
    await click(nav(container).querySelector('a[data-tool="exercices"]'));
    await flush(4);
    expect(currentUrl).toBe('/app/generate?type=exercices');
    expect(heading(container)).toBe('Exercices');
    expect(submit(container).textContent).toContain('Générer : Exercices');
    expect(container.querySelector<HTMLInputElement>('#gen-sujet')?.value).toBe('Les fractions');
    // Le nouvel outil est signalé dans la liste.
    expect(nav(container).querySelector('a[aria-current="true"]')?.getAttribute('data-tool')).toBe('exercices');
  });

  it('adresse sans outil ou outil inconnu : l’outil affiché y est inscrit (« Cours » par défaut)', async () => {
    const { container } = await mount('/app/generate?sujet=La%20photosynth%C3%A8se');
    expect(heading(container)).toBe('Cours');
    expect(currentUrl).toBe('/app/generate?sujet=La+photosynth%C3%A8se&type=cours');
    expect(container.querySelector<HTMLInputElement>('#gen-sujet')?.value).toBe('La photosynthèse');
    cleanup();
    const unknown = await mount('/app/generate?type=inexistant');
    expect(heading(unknown.container)).toBe('Cours');
    expect(currentUrl).toBe('/app/generate?type=cours');
  });

  it('« Générer » dans le menu garde l’outil en cours', async () => {
    const { container } = await mount('/app/generate?type=corrige');
    const generer = Array.from(nav(container).querySelectorAll('a')).find(a => a.textContent?.trim() === 'Générer')!;
    await click(generer);
    await flush(4);
    expect(heading(container)).toBe('Corrigé annoté');
    expect(currentUrl).toBe('/app/generate?type=corrige');
  });

  it('« Changer d’outil » déroule la liste des outils dans la barre latérale', async () => {
    const { container } = await mount('/app/generate?type=sequence');
    const change = Array.from(container.querySelectorAll('main button')).find(b => b.textContent?.includes("Changer d'outil"))!;
    await click(change);
    await flush(2);
    expect(nav(container).querySelectorAll('a[data-tool]')).toHaveLength(11);
    expect(nav(container).querySelector('a[aria-current="true"]')?.getAttribute('data-tool')).toBe('sequence');
  });
});
