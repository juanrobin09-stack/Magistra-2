// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ALL_NIVEAUX } from '@shared/levels';
import LandingPage from '@/pages/LandingPage';
import { RuntimeContext } from '@/lib/runtime/context';
import type { RuntimeValue } from '@/lib/runtime/types';
import { cleanup, fakeRuntime, MemoryStore, PROFILE_COLLEGE, render } from './helpers';
import { COMMERCIAL_VENDOR } from '../vendor';

afterEach(cleanup);

async function mount(runtime: RuntimeValue | null) {
  return render(
    <RuntimeContext.Provider value={runtime}>
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    </RuntimeContext.Provider>,
  );
}

const ctaLinks = (root: ParentNode) =>
  Array.from(root.querySelectorAll<HTMLAnchorElement>('a.btn-primary')).map(a => ({ href: a.getAttribute('href'), text: a.textContent?.trim() }));

describe('Landing — boutons d’accès (démonstration)', () => {
  it('sans profil : les boutons mènent à la création du profil', async () => {
    const { container } = await mount(fakeRuntime(new MemoryStore()));
    const links = ctaLinks(container);
    expect(links.length).toBeGreaterThanOrEqual(3);
    for (const l of links) expect(l.href).toBe('/onboarding');
  });

  it('avec un profil : les boutons mènent directement à l’espace', async () => {
    const { container } = await mount(fakeRuntime(new MemoryStore([], PROFILE_COLLEGE), { profile: PROFILE_COLLEGE }));
    const links = ctaLinks(container);
    expect(links.length).toBeGreaterThanOrEqual(3);
    for (const l of links) {
      expect(l.href).toBe('/app');
      expect(l.text).toContain('Mon espace');
    }
  });

  it('affiche honnêtement le mode démonstration', async () => {
    const { container } = await mount(fakeRuntime(new MemoryStore()));
    expect(container.textContent).toContain('aucune IA n’est utilisée');
  });
});

describe('Landing — affirmations', () => {
  it('ne contient plus d’affirmations non tenues', async () => {
    const { container } = await mount(fakeRuntime(new MemoryStore()));
    const text = container.textContent ?? '';
    for (const forbidden of [
      /RGPD/i,
      /Aucune donnée élève/i,
      /programmes 2026/i,
      /alignés sur le BO/i,
      /180/,
      /30 niveaux/,
      /conforme au programme officiel/i,
      /à votre place/i,
      /\/ ?20 générations/,
      /quota quotidien/i,
      /abonnement premium/i,
    ]) {
      expect(text).not.toMatch(forbidden);
    }
  });

  it('annonce les vrais chiffres et les engagements du projet', async () => {
    const { container } = await mount(fakeRuntime(new MemoryStore()));
    const text = container.textContent ?? '';
    expect(text).toContain(`${ALL_NIVEAUX.length} niveaux`);
    expect(text).toMatch(/licence MIT/i);
    expect(text).toMatch(/IA locale gratuite sur Windows/);
    expect(text).toMatch(/vos documents restent sur votre ordinateur/);
    expect(text).toMatch(/serveur d’IA compatible OpenAI configuré par votre établissement/);
    expect(text).toMatch(/HAL, Crossref/);
    expect(text).toMatch(/relire et adapter/);
    expect(text).not.toMatch(COMMERCIAL_VENDOR);
    expect(text).not.toMatch(/clé API/i);
  });

  it('les liens externes s’ouvrent sans exposer la page (rel="noopener")', async () => {
    const { container } = await mount(fakeRuntime(new MemoryStore()));
    const external = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]'));
    expect(external.length).toBeGreaterThan(0);
    for (const a of external) expect(a.rel).toContain('noopener');
  });
});
