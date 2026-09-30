// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RuntimeContext } from '@/lib/runtime/context';
import { cleanup, click, fakeRuntime, keyDown, MemoryStore, PROFILE_COLLEGE, render } from './helpers';

vi.mock('@/components/ai/AIStatusBadge', () => ({ default: () => <p data-testid="ai-status">IA prête</p> }));
vi.mock('@clerk/react', () => ({ UserButton: () => <button type="button" aria-label="Compte">Compte</button> }));

const { default: AppLayout } = await import('@/components/layout/AppLayout');

afterEach(cleanup);

async function mount(mode: 'demo' | 'web' | 'local' = 'demo', url = '/app/history') {
  const store = new MemoryStore([], PROFILE_COLLEGE);
  return render(
    <RuntimeContext.Provider value={fakeRuntime(store, { mode, profile: PROFILE_COLLEGE })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<p>Tableau</p>} />
            <Route path="history" element={<p>Page historique</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </RuntimeContext.Provider>,
  );
}

const menuButton = (root: ParentNode) => root.querySelector<HTMLButtonElement>('button[aria-label="Ouvrir le menu"]')!;
const sidebar = (root: ParentNode) => root.querySelector<HTMLElement>('#app-sidebar')!;

describe('AppLayout', () => {
  it('navigation complète, lien actif signalé (aria-current), état de l’IA et mention FutureAI', async () => {
    const { container } = await mount();
    const links = Array.from(container.querySelectorAll('nav[aria-label="Navigation principale"] a'));
    expect(links.map(a => a.textContent?.trim())).toEqual(['Tableau de bord', 'Générer', 'Historique', 'Favoris', 'Réglages']);
    expect(links.filter(a => a.getAttribute('aria-current') === 'page').map(a => a.textContent?.trim())).toEqual(['Historique']);
    expect(sidebar(container).querySelector('[data-testid="ai-status"]')).not.toBeNull();
    expect(sidebar(container).textContent).toContain('Un projet FutureAI');
    expect(container.textContent).toContain('Page historique');
  });

  it('le bouton de compte n’apparaît qu’en mode web', async () => {
    const demo = await mount('demo');
    expect(demo.container.querySelector('button[aria-label="Compte"]')).toBeNull();
    cleanup();
    const web = await mount('web');
    expect(web.container.querySelector('button[aria-label="Compte"]')).not.toBeNull();
  });

  it('tiroir mobile : aria-expanded, Échap ferme et rend le focus au bouton « Menu »', async () => {
    const { container } = await mount();
    const btn = menuButton(container);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBe('app-sidebar');
    expect(sidebar(container).className).toContain('invisible');
    btn.focus();
    await click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(sidebar(container).className).not.toMatch(/(^|\s)invisible(\s|$)/);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Fermer le menu');
    await keyDown(document.activeElement, 'Escape');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(btn);
  });

  it('tiroir mobile : un clic à l’extérieur le ferme', async () => {
    const { container } = await mount();
    await click(menuButton(container));
    const overlay = container.querySelector('div.fixed.inset-0[aria-hidden="true"]');
    await click(overlay);
    expect(menuButton(container).getAttribute('aria-expanded')).toBe('false');
  });

  it('lien d’évitement vers le contenu principal', async () => {
    const { container } = await mount();
    const skip = container.querySelector<HTMLAnchorElement>('a[href="#main-content"]');
    expect(skip?.textContent).toBe('Aller au contenu');
    expect(container.querySelector('main#main-content')).not.toBeNull();
  });
});
