// @vitest-environment jsdom
// Attribution « Magistra, créé par Juan Robin » : trois variantes (badge du héros, section « Qui est derrière Magistra ? »,
// pied de page), lien de profil sûr, présence sur l'accueil de l'application (Windows, démonstration) et dans les
// Réglages (À propos). FutureAI reste présent.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AUTHOR_CREDIT, AUTHOR_DEFAULT_PROFILE_URL, AUTHOR_NAME, authorProfile } from '@shared/author';
import AuthorCredit from '@/components/AuthorCredit';
import { RuntimeContext } from '@/lib/runtime/context';
import LandingPage from '@/pages/LandingPage';
import SettingsPage from '@/pages/SettingsPage';
import { cleanup, fakeRuntime, flush, MemoryStore, render } from './helpers';

vi.mock('@clerk/react', () => ({
  useClerk: () => ({ openUserProfile: vi.fn() }),
  ClerkFailed: () => null,
  ClerkLoading: () => null,
  Show: () => null,
  SignInButton: () => null,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const LINKEDIN = authorProfile({ VITE_AUTHOR_PROFILE_URL: 'https://www.linkedin.com/in/juan-robin/' });

function profileLinks(root: ParentNode, url: string): HTMLAnchorElement[] {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>('a')).filter(a => a.getAttribute('href') === url);
}

describe('AuthorCredit : variantes', () => {
  it('badge (héros) : « Magistra, créé par Juan Robin » puis « · un projet FutureAI »', async () => {
    const { container } = await render(<AuthorCredit variant="badge" />);
    expect(container.textContent).toBe(`${AUTHOR_CREDIT}· un projet FutureAI`);
    expect(container.querySelector('strong')?.textContent).toBe('Magistra, créé par Juan Robin');
    expect(container.querySelector('a')).toBeNull();
  });

  it('section « Qui est derrière Magistra ? » : courte présentation sans rien d’inventé, lien de profil', async () => {
    const { container } = await render(<AuthorCredit variant="section" profile={LINKEDIN} />);
    expect(container.querySelector('h2')?.textContent).toBe('Qui est derrière Magistra ?');
    const text = container.textContent ?? '';
    expect(text).toContain(
      'Magistra est conçu et développé par Juan Robin, dans le cadre du projet FutureAI : un assistant gratuit qui allège la préparation des enseignants, avec une IA qui reste sur leur ordinateur.',
    );
    // Aucune biographie : ni diplôme, ni ville, ni entreprise, ni parcours.
    expect(text).not.toMatch(/ancien|diplôm|ingénieur|enseignant depuis|ans d['’]expérience|fondateur|CEO|université|école de|né à|vit à|habite/i);
    expect(text).not.toMatch(/\d{4}/);
    const link = container.querySelector<HTMLAnchorElement>(`a[href="${LINKEDIN.url}"]`)!;
    expect(link.textContent).toContain('Profil LinkedIn');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    // FutureAI est un lien externe sûr, lui aussi.
    const futureAI = container.querySelector<HTMLAnchorElement>('a[href="https://futurai.space"]')!;
    expect(futureAI.textContent).toBe('FutureAI');
    expect(futureAI.rel).toBe('noopener noreferrer');
  });

  it('pied de page : attribution, FutureAI, Bordeaux, gratuité', async () => {
    const { container } = await render(<AuthorCredit variant="footer" />);
    expect(container.textContent).toBe('Magistra, créé par Juan Robin · Un projet FutureAI · Bordeaux, France · Application gratuite');
    expect(container.querySelector('a[href="https://futurai.space"]')).not.toBeNull();
    // Sans « showProfile » : pas de lien de profil.
    expect(container.querySelectorAll('a')).toHaveLength(1);
  });

  it('pied de page avec « showProfile » (Réglages) : le lien de profil suit', async () => {
    const { container } = await render(<AuthorCredit variant="footer" showProfile />);
    expect(container.textContent).toContain('Application gratuite · Profil LinkedIn');
    const [link] = profileLinks(container, AUTHOR_DEFAULT_PROFILE_URL);
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
  });
});

describe('AuthorCredit : lien de profil sûr', () => {
  it.each([
    ['javascript:', 'javascript:alert(document.domain)'],
    ['http:', 'http://www.linkedin.com/in/juan-robin'],
    ['identifiants', 'https://juan:secret@exemple.fr/'],
    ['trop long', `https://exemple.fr/${'a'.repeat(400)}`],
  ])('VITE_AUTHOR_PROFILE_URL %s : le profil par défaut est affiché, jamais l’adresse refusée', async (_name, value) => {
    vi.stubEnv('VITE_AUTHOR_PROFILE_URL', value);
    const { container } = await render(<AuthorCredit variant="section" />);
    const hrefs = Array.from(container.querySelectorAll('a')).map(a => a.getAttribute('href'));
    expect(hrefs).toContain(AUTHOR_DEFAULT_PROFILE_URL);
    for (const href of hrefs) expect(href).toMatch(/^https:\/\/[^@]*$/);
  });

  it('VITE_AUTHOR_PROFILE_URL valide : lue au build', async () => {
    vi.stubEnv('VITE_AUTHOR_PROFILE_URL', 'https://www.linkedin.com/in/juan-robin/');
    const { container } = await render(<AuthorCredit variant="section" />);
    expect(container.querySelector('a[href="https://www.linkedin.com/in/juan-robin/"]')?.textContent).toContain('Profil LinkedIn');
  });
});

describe('Attribution dans l’application', () => {
  async function mountLanding(mode: 'demo' | 'local') {
    return render(
      <RuntimeContext.Provider value={fakeRuntime(new MemoryStore(), { mode })}>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </RuntimeContext.Provider>,
    );
  }

  it.each(['demo', 'local'] as const)('accueil (%s) : le nom est dans le héros, la section « Qui est derrière Magistra ? » et le pied de page', async mode => {
    const { container } = await mountLanding(mode);
    const hero = container.querySelector('main section')!;
    expect(hero.textContent).toContain(AUTHOR_CREDIT);
    expect(container.querySelector('#author-title')?.textContent).toBe('Qui est derrière Magistra ?');
    expect(container.querySelector('footer')?.textContent).toContain(`${AUTHOR_CREDIT} · Un projet FutureAI · Bordeaux, France · Application gratuite`);
    expect(container.textContent).toContain(AUTHOR_NAME);
    // FutureAI reste présent.
    expect(container.querySelectorAll('a[href="https://futurai.space"]').length).toBeGreaterThanOrEqual(2);
    const [link] = profileLinks(container, AUTHOR_DEFAULT_PROFILE_URL);
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
  });

  it('Réglages, « À propos » : attribution et lien de profil', async () => {
    const { container } = await render(
      <RuntimeContext.Provider value={fakeRuntime(new MemoryStore())}>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </RuntimeContext.Provider>,
    );
    await flush(5);
    const about = container.querySelector('section[aria-labelledby="settings-about"]')!;
    expect(about.textContent).toContain(`${AUTHOR_CREDIT} · Un projet FutureAI · Bordeaux, France`);
    const [link] = profileLinks(about, AUTHOR_DEFAULT_PROFILE_URL);
    expect(link.textContent).toContain('Profil LinkedIn');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
  });
});
