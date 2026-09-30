// @vitest-environment jsdom
// Application Windows : animation d'ouverture « Magistra » (mode local seulement, passable, mouvement réduit, une fois
// par lancement) ; tout le site dans l'application — premier lancement : page d'accueil (sans connexion ni
// téléchargement) → profil ; ensuite : tableau de bord ; aucun assistant imposé (plus de redirection vers /setup).

import { readFileSync } from 'node:fs';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeConfig } from '@/lib/runtime/mode';
import { cleanup, flush, keyDown, PROFILE_COLLEGE, render } from './helpers';
import { installFakeLocalAI, removeFakeLocalAI } from './localAIHelpers';

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  removeFakeLocalAI();
  window.history.replaceState({}, '', '/');
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
});

function text(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
}

/** Attend qu'une condition soit vraie (pages chargées à la demande). */
async function waitFor(check: () => boolean, tries = 40): Promise<void> {
  for (let i = 0; i < tries && !check(); i++) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 25));
    });
  }
}

async function mountApp(config: RuntimeConfig, path = '/') {
  window.history.replaceState({}, '', path);
  const { default: App } = await import('@/App');
  const view = await render(<App config={config} />);
  await flush(6);
  return view;
}

const intro = () => document.querySelector('[data-testid="app-intro"]');

describe('Animation d’ouverture — dans l’application seulement', () => {
  it('application Windows : affichée au lancement (logo, « Magistra. », sous-titre), accessible', async () => {
    installFakeLocalAI({ engine: 'running', installed: ['standard'] });
    await mountApp({ mode: 'local' });
    const el = intro();
    expect(el).not.toBeNull();
    expect(el!.getAttribute('role')).toBe('img');
    expect(el!.getAttribute('aria-label')).toBe('Magistra, votre assistant pédagogique');
    expect(text(el)).toContain('Magistra.');
    expect(text(el)).toContain('Votre assistant pédagogique');
    expect(el!.querySelector('.glow-line')).not.toBeNull();
  });

  it('site (démonstration) : jamais d’animation', async () => {
    await mountApp({ mode: 'demo' });
    expect(intro()).toBeNull();
  });
});

describe('AppIntro', () => {
  async function mountIntro() {
    const mod = await import('@/components/AppIntro');
    const view = await render(<mod.default />);
    return { ...view, mod };
  }

  async function advance(ms: number): Promise<void> {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  }

  it('≈ 3,4 s (posée, jamais longue) puis fondu, puis plus rien ne recouvre l’application', async () => {
    vi.useFakeTimers();
    const { mod } = await mountIntro();
    expect(intro()).not.toBeNull();
    // Barre de défilement de la page en dessous retirée pendant l'animation, rendue dès le fondu.
    expect(document.documentElement.classList.contains('intro-active')).toBe(true);
    await advance(mod.INTRO_HOLD_MS - 10);
    expect(intro()!.className).not.toContain('intro-leaving');
    await advance(20);
    expect(intro()!.className).toContain('intro-leaving');
    expect(document.documentElement.classList.contains('intro-active')).toBe(false);
    await advance(mod.INTRO_FADE_MS + 10);
    expect(intro()).toBeNull();
    expect(mod.INTRO_HOLD_MS + mod.INTRO_FADE_MS).toBeGreaterThanOrEqual(3000);
    expect(mod.INTRO_HOLD_MS + mod.INTRO_FADE_MS).toBeLessThanOrEqual(3600);
  });

  it('chaque effet se termine avant le fondu (aucun n’est coupé) ; durées des fondus identiques côté CSS et côté minuteries', async () => {
    const mod = await import('@/components/AppIntro');
    const css = readFileSync(`${process.cwd()}/src/index.css`, 'utf8');
    /** Durée et délai (ms) de la propriété « animation » d'une règle .intro-… (valeurs en secondes dans le CSS). */
    const timing = (selector: string) => {
      const rule = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{[^}]*?animation:\\s*(intro\\w+)([^;]*);`).exec(css);
      expect(rule, selector).not.toBeNull();
      const seconds = Array.from(rule![2].matchAll(/(\d*\.?\d+)s\b/g), m => Math.round(Number(m[1]) * 1000));
      return { name: rule![1], duration: seconds[0], delay: seconds[1] ?? 0 };
    };
    const entrance = ['.intro-halo', '.intro-content', '.intro-logo', '.intro-dot', '.intro-shine', '.intro-line', '.intro-subtitle'];
    for (const selector of entrance) {
      const { duration, delay } = timing(selector);
      expect(delay + duration, selector).toBeLessThanOrEqual(mod.INTRO_HOLD_MS);
    }
    // Lettres : délai de la dernière (style en ligne) + durée CSS.
    const letter = timing('.intro-letter');
    const lastLetterEnd = mod.INTRO_LETTER_DELAY_MS + (mod.INTRO_WORD.length - 1) * mod.INTRO_LETTER_STAGGER_MS + letter.duration;
    expect(lastLetterEnd).toBeLessThanOrEqual(mod.INTRO_HOLD_MS);
    // Le point accent arrive après que la dernière lettre a commencé à se poser.
    expect(timing('.intro-dot').delay).toBeGreaterThan(mod.INTRO_LETTER_DELAY_MS + (mod.INTRO_WORD.length - 1) * mod.INTRO_LETTER_STAGGER_MS);
    // Fondus : même durée que les minuteries du composant.
    expect(timing('.intro-leaving').duration).toBe(mod.INTRO_FADE_MS);
    expect(timing('.intro-leaving .intro-content').duration).toBe(mod.INTRO_FADE_MS);
    expect(/\.intro-skipped, \.intro-skipped \.intro-content \{ animation-duration: (\d*\.?\d+)s; \}/.exec(css)?.[1]).toBe(String(mod.INTRO_SKIP_FADE_MS / 1000));
  });

  it('passable par un clic', async () => {
    vi.useFakeTimers();
    const { mod } = await mountIntro();
    await act(async () => {
      (intro() as HTMLElement).click();
    });
    expect(intro()!.className).toContain('intro-leaving');
    await advance(mod.INTRO_SKIP_FADE_MS + 10);
    expect(intro()).toBeNull();
  });

  it('passable par Échap ou toute autre touche', async () => {
    vi.useFakeTimers();
    const { mod } = await mountIntro();
    await keyDown(document.body, 'Escape');
    expect(intro()!.className).toContain('intro-leaving');
    await advance(mod.INTRO_SKIP_FADE_MS + 10);
    expect(intro()).toBeNull();

    cleanup();
    sessionStorage.clear();
    vi.resetModules();
    const again = await mountIntro();
    await keyDown(document.body, 'a');
    expect(intro()!.className).toContain('intro-leaving');
    await advance(again.mod.INTRO_SKIP_FADE_MS + 10);
    expect(intro()).toBeNull();
  });

  it('mouvement réduit : image fixe (aucune animation), ≈ 0,4 s', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
    try {
      const { mod } = await mountIntro();
      expect(intro()!.className).toContain('intro-reduced');
      expect(mod.INTRO_REDUCED_HOLD_MS + mod.INTRO_REDUCED_FADE_MS).toBeLessThanOrEqual(450);
      await advance(mod.INTRO_REDUCED_HOLD_MS + 5);
      expect(intro()!.className).toContain('intro-leaving');
      await advance(mod.INTRO_REDUCED_FADE_MS + 5);
      expect(intro()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('profil encore en chargement : l’animation reste affichée (jamais d’écran d’attente), 4 s au plus', async () => {
    vi.useFakeTimers();
    const { RuntimeContext } = await import('@/lib/runtime/context');
    const mod = await import('@/components/AppIntro');
    const { fakeRuntime, MemoryStore } = await import('./helpers');
    await render(
      <RuntimeContext.Provider value={fakeRuntime(new MemoryStore(), { mode: 'local', profileStatus: 'loading' })}>
        <mod.default />
      </RuntimeContext.Provider>,
    );
    await advance(mod.INTRO_HOLD_MS + 100);
    expect(intro()!.className).not.toContain('intro-leaving');
    await advance(mod.INTRO_MAX_HOLD_MS - mod.INTRO_HOLD_MS);
    expect(intro()!.className).toContain('intro-leaving');
  });

  it('une fois par lancement : un rechargement de la fenêtre ne la rejoue pas', async () => {
    vi.useFakeTimers();
    await mountIntro();
    expect(intro()).not.toBeNull();
    cleanup();
    vi.resetModules();
    await mountIntro();
    expect(intro()).toBeNull();
  });
});

describe('Tout le site dans l’application', () => {
  it('premier lancement (aucun profil) : page d’accueil adaptée — ni connexion, ni téléchargement ; « Commencer » → profil', async () => {
    installFakeLocalAI({ engine: 'not_installed' });
    const { container } = await mountApp({ mode: 'local' });
    await waitFor(() => text(container).includes('L\'IA qui prépare'));
    const page = text(container);
    expect(page).toContain('L\'IA qui prépare');
    expect(page).toContain('Magistra est installée sur cet ordinateur : l’IA s’active en un clic depuis votre tableau de bord');
    expect(page).not.toContain('Télécharger pour Windows');
    expect(container.querySelector('[data-testid="windows-download"]')).toBeNull();
    expect(container.querySelector('#magistra-windows')).toBeNull();
    const start = Array.from(container.querySelectorAll<HTMLAnchorElement>('a.btn-primary')).find(a => a.textContent?.includes('Commencer'));
    expect(start?.getAttribute('href')).toBe('/app');
    // /app sans profil → création du profil (et non l'assistant de l'IA).
    await act(async () => {
      start!.click();
    });
    await waitFor(() => window.location.pathname === '/onboarding');
    expect(window.location.pathname).toBe('/onboarding');
  });

  it('premier lancement : depuis la création du profil, « ← Présentation » ramène à l’accueil (l’application n’a pas de bouton « précédent »)', async () => {
    installFakeLocalAI({ engine: 'not_installed' });
    const { container } = await mountApp({ mode: 'local' }, '/onboarding');
    const backLink = () => Array.from(container.querySelectorAll<HTMLAnchorElement>('a')).find(a => a.textContent?.includes('Présentation'));
    await waitFor(() => Boolean(backLink()));
    expect(backLink()?.getAttribute('href')).toBe('/');
    await act(async () => {
      backLink()!.click();
    });
    await waitFor(() => text(container).includes('L\'IA qui prépare'));
    expect(window.location.pathname).toBe('/');
    expect(text(container)).toContain('L\'IA qui prépare');
  });

  it('activation demandée puis données effacées (aucun profil) : rien ne reprend sans tableau de bord visible ; avec un profil, elle reprend', async () => {
    const fake = installFakeLocalAI({ engine: 'running', installed: [] }, { aiSetupRequested: true });
    const { container } = await mountApp({ mode: 'local' });
    await waitFor(() => text(container).includes('L\'IA qui prépare'));
    await flush(8);
    // Page d'accueil, puis création du profil : ni progression ni « Annuler » à l'écran — donc aucun téléchargement.
    expect(fake.spies.pullModel).not.toHaveBeenCalled();
    expect(fake.spies.installEngine).not.toHaveBeenCalled();
    expect(fake.prefs.aiSetupRequested).toBe(true);

    cleanup();
    removeFakeLocalAI();
    vi.resetModules();
    const withProfile = installFakeLocalAI({ engine: 'running', installed: [] }, { aiSetupRequested: true }, PROFILE_COLLEGE);
    await mountApp({ mode: 'local' });
    await waitFor(() => withProfile.spies.pullModel.mock.calls.length > 0);
    expect(withProfile.spies.pullModel).toHaveBeenCalledOnce();
  });

  it('lancements suivants : tableau de bord, même si l’IA n’est pas prête et l’ancien assistant jamais terminé', async () => {
    installFakeLocalAI({ engine: 'not_installed' }, { setupCompleted: false }, PROFILE_COLLEGE);
    const { container } = await mountApp({ mode: 'local' });
    await waitFor(() => window.location.pathname === '/app' && Boolean(container.querySelector('[data-testid="activate-ai"]')));
    expect(window.location.pathname).toBe('/app');
    expect(text(container)).toContain('M. Martin');
    expect(container.querySelector('[data-testid="activate-ai"]')).not.toBeNull();
    // La présentation reste accessible depuis la barre latérale.
    expect(container.querySelector('a[href="/presentation"]')?.textContent).toBe('Présentation');
  });

  it('« Présentation » : la page d’accueil, avec « Mon espace »', async () => {
    installFakeLocalAI({ engine: 'running', installed: ['standard'] }, {}, PROFILE_COLLEGE);
    const { container } = await mountApp({ mode: 'local' }, '/presentation');
    await waitFor(() => text(container).includes('L\'IA qui prépare'));
    expect(window.location.pathname).toBe('/presentation');
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('a.btn-primary'));
    expect(links.some(a => a.textContent?.includes('Mon espace') && a.getAttribute('href') === '/app')).toBe(true);
    // IA déjà prête : plus d'invitation à l'activer.
    await waitFor(() => text(container).includes('son IA y fonctionne'));
    expect(text(container)).toContain('Magistra est installée sur cet ordinateur : son IA y fonctionne, gratuitement, même sans Internet.');
    expect(text(container)).not.toContain('s’active en un clic');
  });

  it('la page de l’IA reste accessible : une action principale « Activer l’IA », le reste replié', async () => {
    installFakeLocalAI({ engine: 'not_installed' }, {}, PROFILE_COLLEGE);
    const { container } = await mountApp({ mode: 'local' }, '/setup');
    await waitFor(() => Boolean(container.querySelector('[data-testid="activate-ai"]')));
    expect(window.location.pathname).toBe('/setup');
    expect(container.querySelector('h1')?.textContent).toBe('L’intelligence artificielle de Magistra');
    const main = Array.from(container.querySelectorAll('button.btn-primary')).map(b => text(b).trim());
    expect(main).toEqual(['Activer l’IA']);
    // Détails et options avancées repliés.
    const toggles = Array.from(container.querySelectorAll('button[aria-expanded]'));
    expect(toggles.map(t => t.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
    expect(text(container)).toContain('Options avancées');
  });
});
