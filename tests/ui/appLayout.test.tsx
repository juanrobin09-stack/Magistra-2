// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { TeacherProfile } from '@shared/types';
import { RuntimeContext } from '@/lib/runtime/context';
import { cleanup, click, fakeRuntime, keyDown, MemoryStore, PROFILE_COLLEGE, render } from './helpers';

vi.mock('@/components/ai/AIStatusBadge', () => ({ default: () => <p data-testid="ai-status">IA prête</p> }));
vi.mock('@clerk/react', () => ({ UserButton: () => <button type="button" aria-label="Compte">Compte</button> }));

const { default: AppLayout } = await import('@/components/layout/AppLayout');
const { useAppShell } = await import('@/components/layout/shell');

/** Page de test qui demande « Changer d'outil » à la mise en page (et lui donne le niveau d'un formulaire). */
function ToolsOpener() {
  const shell = useAppShell();
  return (
    <>
      <button type="button" onClick={() => shell?.openTools()}>Changer d'outil</button>
      <button type="button" onClick={() => shell?.setToolNiveau('licence_2')}>Niveau Licence 2</button>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.removeItem('magistra_sidebar_tools_open');
});

async function mount(mode: 'demo' | 'web' | 'local' = 'demo', url = '/app/history', profile: TeacherProfile = PROFILE_COLLEGE) {
  const store = new MemoryStore([], profile);
  return render(
    <RuntimeContext.Provider value={fakeRuntime(store, { mode, profile })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/app" element={<AppLayout />}>
            <Route index element={<><p>Tableau</p><ToolsOpener /></>} />
            <Route path="history" element={<p>Page historique</p>} />
            <Route path="generate" element={<ToolsOpener />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </RuntimeContext.Provider>,
  );
}

const menuButton = (root: ParentNode) => root.querySelector<HTMLButtonElement>('button[aria-label="Ouvrir le menu"]')!;
const sidebar = (root: ParentNode) => root.querySelector<HTMLElement>('#app-sidebar')!;
const navOf = (root: ParentNode) => root.querySelector<HTMLElement>('nav[aria-label="Navigation principale"]')!;
const toolsToggle = (root: ParentNode) =>
  Array.from(navOf(root).querySelectorAll('button')).find(b => b.textContent?.includes('Outils pédagogiques'))!;
const opener = (root: ParentNode) =>
  Array.from(root.querySelectorAll<HTMLButtonElement>('main button')).find(b => b.textContent === "Changer d'outil")!;
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve(null)));

/**
 * Largeur d'écran simulée. `wide` : mise en page large (barre latérale fixe) seulement pour la requête exacte du
 * point de rupture « lg » de Tailwind (64rem), jamais pour un seuil en pixels qui s'en écarterait.
 */
function stubScreen(wide: boolean) {
  const listeners = new Set<() => void>();
  const state = { wide };
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return state.wide && query === '(min-width: 64rem)';
    },
    media: query,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }));
  return {
    listeners,
    /** Fenêtre élargie ou rétrécie (rotation d'une tablette…). */
    resize(nextWide: boolean) {
      state.wide = nextWide;
      listeners.forEach(fn => fn());
    },
  };
}

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

  it('« Outils pédagogiques » sous « Réglages » : repliés par défaut, déroulés au clic, état retenu sur l’appareil', async () => {
    localStorage.removeItem('magistra_sidebar_tools_open');
    const { container } = await mount();
    const nav = container.querySelector<HTMLElement>('nav[aria-label="Navigation principale"]')!;
    const toggle = Array.from(nav.querySelectorAll('button')).find(b => b.textContent?.includes('Outils pédagogiques'))!;
    // Juste après « Réglages » dans l'ordre du menu.
    const order = Array.from(nav.querySelectorAll('a, button')).map(el => el.textContent?.trim() ?? '');
    expect(order.indexOf('Réglages') + 1).toBe(order.findIndex(t => t.startsWith('Outils pédagogiques')));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(nav.querySelectorAll('a[data-tool]')).toHaveLength(0);
    await click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)?.hidden).toBe(false);
    const tools = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a[data-tool]'));
    expect(tools).toHaveLength(11);
    expect(tools.map(a => a.getAttribute('href'))).toContain('/app/generate?type=evaluation');
    expect(localStorage.getItem('magistra_sidebar_tools_open')).toBe('1');
    cleanup();
    // Nouvelle visite : toujours déroulés.
    const again = await mount();
    expect(again.container.querySelectorAll('nav[aria-label="Navigation principale"] a[data-tool]')).toHaveLength(11);
    localStorage.removeItem('magistra_sidebar_tools_open');
  });

  it('page Générer : l’outil en cours est signalé ; « Changer d’outil » déroule la liste et y place le focus', async () => {
    localStorage.removeItem('magistra_sidebar_tools_open');
    const { container } = await mount('demo', '/app/generate?type=exercices');
    const nav = container.querySelector<HTMLElement>('nav[aria-label="Navigation principale"]')!;
    const toggle = Array.from(nav.querySelectorAll('button')).find(b => b.textContent?.includes('Outils pédagogiques'))!;
    // Replié : le nom de l'outil en cours reste visible à côté de l'entrée.
    expect(toggle.textContent).toContain('Exercices');
    const opener = Array.from(container.querySelectorAll('button')).find(b => b.textContent === "Changer d'outil")!;
    await click(opener);
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
    const current = nav.querySelector<HTMLAnchorElement>('a[data-tool][aria-current="true"]');
    expect(current?.getAttribute('data-tool')).toBe('exercices');
    expect(nav.querySelectorAll('a[aria-current="true"]')).toHaveLength(1);
    expect(document.activeElement).toBe(current);
    localStorage.removeItem('magistra_sidebar_tools_open');
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

describe('« Changer d’outil » : liste déjà ouverte, tiroir et retour du focus', () => {
  it('liste déjà ouverte (état retenu) : le focus va quand même à l’outil en cours, et plus jamais ensuite sans demande', async () => {
    localStorage.setItem('magistra_sidebar_tools_open', '1');
    const { container } = await mount('demo', '/app/generate?type=exercices');
    const toggle = toolsToggle(container);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const button = opener(container);
    button.focus();
    await click(button);
    await nextFrame();
    const current = navOf(container).querySelector<HTMLAnchorElement>('a[data-tool="exercices"]');
    expect(current?.getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(current);

    // Replier puis déplier la liste au clavier : le focus reste sur l'entrée (aucune demande restée en attente).
    toggle.focus();
    await click(toggle);
    await nextFrame();
    await click(toggle);
    await nextFrame();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(toggle);

    // Deuxième demande, liste toujours ouverte : servie elle aussi.
    button.focus();
    await click(button);
    await nextFrame();
    expect(document.activeElement).toBe(navOf(container).querySelector('a[data-tool="exercices"]'));
  });

  it('tableau de bord, liste déjà ouverte : « Voir les outils » place le focus sur « Outils pédagogiques »', async () => {
    localStorage.setItem('magistra_sidebar_tools_open', '1');
    const { container } = await mount('demo', '/app');
    const button = opener(container);
    button.focus();
    await click(button);
    await nextFrame();
    expect(document.activeElement).toBe(toolsToggle(container));
  });

  it('mise en page étroite (seuil lg de Tailwind, 64rem) : le tiroir s’ouvre sur l’outil en cours ; Échap rend le focus au bouton de la page', async () => {
    stubScreen(false);
    const { container } = await mount('demo', '/app/generate?type=sequence');
    const button = opener(container);
    button.focus();
    await click(button);
    expect(menuButton(container).getAttribute('aria-expanded')).toBe('true');
    expect(sidebar(container).className).not.toMatch(/(^|\s)invisible(\s|$)/);
    await nextFrame();
    expect(document.activeElement).toBe(navOf(container).querySelector('a[data-tool="sequence"]'));
    await keyDown(document.activeElement, 'Escape');
    expect(menuButton(container).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('tiroir ouvert par la page puis fermé par « Fermer le menu » ou le fond : focus rendu au bouton de la page', async () => {
    stubScreen(false);
    const { container } = await mount('demo', '/app/generate?type=sequence');
    const button = opener(container);
    button.focus();
    await click(button);
    await nextFrame();
    await click(container.querySelector('button[aria-label="Fermer le menu"]'));
    expect(document.activeElement).toBe(button);

    button.focus();
    await click(button);
    await nextFrame();
    await click(container.querySelector('div.fixed.inset-0[aria-hidden="true"]'));
    expect(menuButton(container).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);

    // Ouvert par « Menu » : le focus revient à « Menu », comme avant.
    const menu = menuButton(container);
    menu.focus();
    await click(menu);
    await keyDown(document.activeElement, 'Escape');
    expect(document.activeElement).toBe(menu);
  });

  it('mise en page large (même seuil de 64rem) : pas de tiroir, la liste de la barre latérale reçoit le focus', async () => {
    stubScreen(true);
    const { container } = await mount('demo', '/app/generate?type=sequence');
    await click(opener(container));
    expect(menuButton(container).getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('div.fixed.inset-0[aria-hidden="true"]')).toBeNull();
    await nextFrame();
    expect(document.activeElement).toBe(navOf(container).querySelector('a[data-tool="sequence"]'));
  });

  it('tiroir ouvert puis fenêtre élargie : le tiroir se ferme (plus de focus piégé dans la barre latérale)', async () => {
    const screen = stubScreen(false);
    const { container } = await mount();
    await click(menuButton(container));
    expect(menuButton(container).getAttribute('aria-expanded')).toBe('true');
    await act(async () => screen.resize(true));
    expect(menuButton(container).getAttribute('aria-expanded')).toBe('false');
    expect(screen.listeners.size).toBe(0);
  });
});

describe('tiroir mobile : choisir un lien ne laisse jamais le focus dans le tiroir refermé', () => {
  it('outil choisi dans le tiroir (seule l’adresse ?type= change) : tiroir fermé, focus sur le contenu principal', async () => {
    stubScreen(false);
    const { container } = await mount('demo', '/app/generate?type=cours');
    await click(opener(container));
    await nextFrame();
    const evaluation = navOf(container).querySelector<HTMLAnchorElement>('a[data-tool="evaluation"]')!;
    evaluation.focus();
    await click(evaluation);
    expect(menuButton(container).getAttribute('aria-expanded')).toBe('false');
    expect(navOf(container).querySelector('a[aria-current="true"]')?.getAttribute('data-tool')).toBe('evaluation');
    expect(document.activeElement).toBe(container.querySelector('main#main-content'));
    expect(sidebar(container).contains(document.activeElement)).toBe(false);
  });

  it('« Générer » choisi dans le tiroir depuis la page Générer : même chose', async () => {
    stubScreen(false);
    const { container } = await mount('demo', '/app/generate?type=cours');
    await click(menuButton(container));
    const generer = Array.from(navOf(container).querySelectorAll('a')).find(a => a.textContent?.trim() === 'Générer')!;
    generer.focus();
    await click(generer);
    expect(menuButton(container).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(container.querySelector('main#main-content'));
  });

  it('mise en page large : un outil choisi garde son lien visible, le focus n’est pas déplacé par la mise en page', async () => {
    stubScreen(true);
    localStorage.setItem('magistra_sidebar_tools_open', '1');
    const { container } = await mount('demo', '/app/generate?type=cours');
    const evaluation = navOf(container).querySelector<HTMLAnchorElement>('a[data-tool="evaluation"]')!;
    evaluation.focus();
    await click(evaluation);
    expect(document.activeElement).toBe(evaluation);
  });
});

describe('libellés des outils de la barre latérale : niveau du formulaire sur la page Générer', () => {
  it('niveau du formulaire (Licence 2) sur la page Générer, niveau du profil ailleurs', async () => {
    const { container } = await mount('demo', '/app/generate?type=exercices');
    const toggle = toolsToggle(container);
    // Profil collège (4e) : libellés du secondaire.
    expect(toggle.textContent).toContain('Exercices');
    expect(toggle.textContent).not.toContain('TD / Exercices');
    await click(Array.from(container.querySelectorAll('main button')).find(b => b.textContent === 'Niveau Licence 2')!);
    // Replié : la petite ligne de l'outil en cours suit le niveau du formulaire, comme le titre de la page.
    expect(toggle.textContent).toContain('TD / Exercices');
    await click(toggle);
    expect(navOf(container).querySelector('a[data-tool="exercices"]')?.textContent).toBe('TD / Exercices');
    expect(navOf(container).querySelector('a[data-tool="evaluation"]')?.textContent).toBe('Examen');
    // Hors de la page Générer : le niveau du profil.
    await click(Array.from(navOf(container).querySelectorAll('a')).find(a => a.textContent?.trim() === 'Historique')!);
    expect(navOf(container).querySelector('a[data-tool="evaluation"]')?.textContent).toBe('Évaluation');
    expect(navOf(container).querySelector('a[data-tool="exercices"]')?.textContent).toBe('Exercices');
  });

  it('hors de la page Générer : premier niveau valide du profil (BTS → « Examen »)', async () => {
    localStorage.setItem('magistra_sidebar_tools_open', '1');
    const bts = { ...PROFILE_COLLEGE, cycle: 'superieur', niveaux: ['bts'] } as TeacherProfile;
    const { container } = await mount('demo', '/app/history', bts);
    expect(navOf(container).querySelector('a[data-tool="evaluation"]')?.textContent).toBe('Examen');
    cleanup();
    // Niveau inconnu en tête (profil d'une version plus récente…) : ignoré, jamais pris pour le supérieur.
    const odd = { ...PROFILE_COLLEGE, niveaux: ['inconnu', '4eme'] } as unknown as TeacherProfile;
    const again = await mount('demo', '/app/history', odd);
    expect(navOf(again.container).querySelector('a[data-tool="evaluation"]')?.textContent).toBe('Évaluation');
  });
});
