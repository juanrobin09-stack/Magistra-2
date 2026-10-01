// @vitest-environment jsdom
// Outils dans la barre latérale : la page Générer suit l'outil choisi dans « Outils pédagogiques » (adresse
// /app/generate?type=…), le présente en grand, garde la saisie d'un outil à l'autre, et inscrit l'outil dans
// l'adresse quand elle n'en porte pas (« Générer », reprise depuis l'historique).

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type InitialEntry, type NavigateFunction } from 'react-router-dom';
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
let navigate: NavigateFunction = () => undefined;
function UrlProbe() {
  const location = useLocation();
  currentUrl = `${location.pathname}${location.search}`;
  navigate = useNavigate();
  return null;
}

async function mount(url: string | InitialEntry[], initialIndex?: number) {
  const { RuntimeContext } = await import('@/lib/runtime/context');
  const { default: AppLayout } = await import('@/components/layout/AppLayout');
  const { default: GeneratePage } = await import('@/pages/GeneratePage');
  const store = new MemoryStore([], PROFILE_COLLEGE);
  const view = await render(
    <RuntimeContext.Provider value={fakeRuntime(store, { mode: 'demo', profile: PROFILE_COLLEGE })}>
      <MemoryRouter initialEntries={typeof url === 'string' ? [url] : url} initialIndex={initialIndex}>
        <UrlProbe />
        <Routes>
          <Route path="/app" element={<AppLayout />}>
            <Route path="generate" element={<GeneratePage />} />
            <Route path="history" element={<p>Page historique</p>} />
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
const toolsToggle = (root: ParentNode) =>
  Array.from(nav(root).querySelectorAll('button')).find(b => b.textContent?.includes('Outils pédagogiques'))!;
const reuseNote = (root: ParentNode) =>
  Array.from(root.querySelectorAll('main [role="note"]')).find(n => n.textContent?.includes('Demande reprise depuis l’historique'));
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve(null)));

/** Mise en page étroite (tiroir) : aucune requête « lg » (64rem) ne correspond. */
function stubNarrowScreen() {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
}

/** Enregistre les appels à scrollIntoView (absent de jsdom) et l'élément concerné. */
function spyScroll() {
  const calls: { el: Element; options: unknown }[] = [];
  const proto = Element.prototype as { scrollIntoView?: (options?: unknown) => void };
  const original = proto.scrollIntoView;
  proto.scrollIntoView = function (this: Element, options?: unknown) {
    calls.push({ el: this, options });
  };
  return { calls, restore: () => { proto.scrollIntoView = original; } };
}

/** Choisit une valeur dans une liste déroulante du formulaire (SelectField). */
async function pick(root: ParentNode, id: string, label: string) {
  await click(root.querySelector(`#${id}`));
  const option = Array.from(root.querySelectorAll('[role="option"]')).find(o => o.textContent?.trim() === label);
  await click(option ?? null);
  await flush(2);
}

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

describe('changement d’outil : la page revient en haut, le titre du nouvel outil reçoit le focus', () => {
  it('outil choisi dans la barre latérale : défilement vers le haut de la page et focus sur son titre (pas au premier affichage)', async () => {
    const scroll = spyScroll();
    try {
      const { container } = await mount('/app/generate?type=cours');
      const h1 = container.querySelector<HTMLHeadingElement>('main h1')!;
      expect(document.activeElement).not.toBe(h1);
      expect(scroll.calls).toHaveLength(0);
      await click(toolsToggle(container));
      await click(nav(container).querySelector('a[data-tool="exercices"]'));
      await flush(2);
      expect(heading(container)).toBe('Exercices');
      expect(document.activeElement).toBe(container.querySelector('main h1'));
      expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
      // La page entière (en-tête compris) est ramenée en haut de la zone qui défile.
      const page = scroll.calls.find(c => c.el.contains(container.querySelector('main h1')));
      expect(page?.options).toEqual({ block: 'start' });
      expect(page?.el.contains(container.querySelector('main form'))).toBe(true);
    } finally {
      scroll.restore();
    }
  });

  it('tiroir mobile : l’outil choisi ferme le tiroir, le focus va au titre du nouvel outil (jamais au lien masqué)', async () => {
    stubNarrowScreen();
    const { container } = await mount('/app/generate?type=cours');
    const outils = Array.from(container.querySelectorAll<HTMLButtonElement>('main button')).find(b => b.textContent?.includes("Changer d'outil"))!;
    outils.focus();
    await click(outils);
    await nextFrame();
    expect(document.activeElement?.getAttribute('data-tool')).toBe('cours');
    await click(nav(container).querySelector('a[data-tool="evaluation"]'));
    await flush(2);
    expect(container.querySelector('button[aria-label="Ouvrir le menu"]')?.getAttribute('aria-expanded')).toBe('false');
    expect(heading(container)).toBe('Évaluation');
    expect(document.activeElement).toBe(container.querySelector('main h1'));
  });

  it('même outil, ou outil inscrit dans l’adresse par la page : ni défilement ni focus', async () => {
    const scroll = spyScroll();
    try {
      const { container } = await mount('/app/generate?sujet=Les%20fractions');
      expect(currentUrl).toBe('/app/generate?sujet=Les+fractions&type=cours');
      await click(toolsToggle(container));
      await click(nav(container).querySelector('a[data-tool="cours"]'));
      await flush(2);
      expect(scroll.calls).toHaveLength(0);
      expect(document.activeElement).not.toBe(container.querySelector('main h1'));
    } finally {
      scroll.restore();
    }
  });
});

describe('« Générer » dans le menu depuis la page Générer', () => {
  it('aucune entrée d’historique en double : « Précédent » quitte la page', async () => {
    const { container } = await mount(['/app/history', '/app/generate?type=corrige'], 1);
    const generer = Array.from(nav(container).querySelectorAll('a')).find(a => a.textContent?.trim() === 'Générer')!;
    await click(generer);
    await flush(4);
    expect(currentUrl).toBe('/app/generate?type=corrige');
    expect(heading(container)).toBe('Corrigé annoté');
    await act(async () => {
      await navigate(-1);
    });
    await flush(2);
    expect(currentUrl).toBe('/app/history');
    expect(container.textContent).toContain('Page historique');
  });
});

describe('libellés de la barre latérale au niveau du formulaire', () => {
  it('niveau changé dans le formulaire (4e → BTS) : la barre latérale nomme les outils comme la page', async () => {
    const { container } = await mount('/app/generate?type=evaluation');
    expect(heading(container)).toBe('Évaluation');
    expect(toolsToggle(container).textContent).toContain('Évaluation');
    await pick(container, 'gen-niveau', 'BTS');
    expect(heading(container)).toBe('Examen');
    expect(submit(container).textContent).toContain('Générer : Examen');
    // Replié : la petite ligne de l'outil en cours ; déroulé : l'outil signalé et les autres.
    expect(toolsToggle(container).textContent).toContain('Examen');
    await click(toolsToggle(container));
    expect(nav(container).querySelector('a[aria-current="true"]')?.textContent).toBe('Examen');
    expect(nav(container).querySelector('a[data-tool="exercices"]')?.textContent).toBe('TD / Exercices');
    // Retour au collège : libellés du secondaire partout.
    await pick(container, 'gen-niveau', '4ème');
    expect(heading(container)).toBe('Évaluation');
    expect(nav(container).querySelector('a[aria-current="true"]')?.textContent).toBe('Évaluation');
  });

  it('demande reprise depuis l’historique à un autre niveau que le profil : mêmes libellés que la page', async () => {
    const reuse = { type: 'evaluation', niveau: 'bts', matiere: 'mathematiques', sujet: 'Suites', params: {} };
    const { container } = await mount([{ pathname: '/app/generate', search: '?type=evaluation', state: { reuse } }]);
    expect(heading(container)).toBe('Examen');
    expect(toolsToggle(container).textContent).toContain('Examen');
  });
});

describe('demande reprise depuis l’historique puis autre outil', () => {
  it('le rappel de la reprise (et « collez-le à nouveau ») disparaît avec l’outil repris ; la saisie reste', async () => {
    const reuse = { type: 'corrige', niveau: '4eme', matiere: 'mathematiques', sujet: 'Fractions', params: { texteEleveLength: 120 } };
    const { container } = await mount([{ pathname: '/app/generate', search: '?type=corrige', state: { reuse } }]);
    expect(reuseNote(container)?.textContent).toContain('collez-le à nouveau');
    await click(toolsToggle(container));
    await click(nav(container).querySelector('a[data-tool="cours"]'));
    await flush(2);
    expect(heading(container)).toBe('Cours');
    expect(reuseNote(container)).toBeUndefined();
    expect(container.textContent).not.toContain('collez-le à nouveau');
    expect(container.querySelector<HTMLInputElement>('#gen-sujet')?.value).toBe('Fractions');
    // Retour à l'outil repris : le rappel revient (le formulaire garde les paramètres repris).
    await click(nav(container).querySelector('a[data-tool="corrige"]'));
    await flush(2);
    expect(reuseNote(container)?.textContent).toContain('collez-le à nouveau');
  });
});
