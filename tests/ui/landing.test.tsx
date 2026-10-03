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
    expect(text).toContain('Application gratuite, sans abonnement.');
    expect(text).not.toMatch(/open.?source|licence MIT|code public et auditable/i);
    expect(text).toMatch(/IA locale gratuite sur Windows/);
    expect(text).toMatch(/vos documents restent sur votre ordinateur/);
    // Engagement vrai pour le site comme pour l'application : gratuit, sans compte, hors connexion.
    expect(text).toContain('Gratuit, sans compte, hors connexion');
    expect(text).toMatch(/ni abonnement, ni compte à créer\. Une fois l’IA activée, elle fonctionne sur votre ordinateur, même sans Internet/);
    // Aucun nom de moteur à connaître sur l'accueil public.
    expect(text).not.toMatch(/ollama/i);
    // Sans moteur de recherche web, seuls les sites que Wikipédia cite pour le sujet sont consultés : l'accueil le dit, et ne nomme
    // aucun site comme garanti.
    expect(text).toMatch(/HAL, Crossref, OpenAlex et des sites officiels vérifiés \(ceux que Wikipédia cite pour votre sujet, ou les principaux avec un moteur de recherche web\)/);
    expect(text).not.toMatch(/UNESCO|Éduscol/);
    // Les sources sont celles du catalogue des sites vérifiés : jamais « le web » en général, et le niveau de fiabilité est annoncé.
    expect(text).not.toMatch(/Crossref et le web|Crossref ou web/);
    expect(text).toMatch(/avec leur niveau de fiabilité/);
    expect(text).toMatch(/relire et adapter/);
    expect(text).not.toMatch(COMMERCIAL_VENDOR);
    // Seule mention permise : la négation « Aucune clé API » de la section « Magistra pour Windows » (demandée
    // explicitement) ; aucune clé n'est jamais demandée ni évoquée ailleurs.
    const windows = container.querySelector('[data-testid="windows-download"]');
    expect(windows?.textContent).toContain('Aucune clé API');
    expect(text.replace(/Aucune clé API/g, '')).not.toMatch(/clé API/i);
  });

  it('les liens externes s’ouvrent sans exposer la page (rel="noopener")', async () => {
    const { container } = await mount(fakeRuntime(new MemoryStore()));
    const external = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]'));
    expect(external.length).toBeGreaterThan(0);
    for (const a of external) expect(a.rel).toContain('noopener');
  });
});

describe('Landing — application Windows et IA du site', () => {
  it('liens « Télécharger pour Windows » vers la section « Magistra pour Windows » de la page (même onglet)', async () => {
    const { container } = await mount(fakeRuntime(new MemoryStore()));
    // Téléchargement direct, trois étapes et avertissement SmartScreen y sont réunis, plutôt que la page des versions.
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('a[href="#magistra-windows"]'));
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const a of links) {
      expect(a.textContent).toContain('Télécharger pour Windows');
      expect(a.target).toBe('');
    }
    expect(container.querySelector('section#magistra-windows')).not.toBeNull();
    // Le bouton principal reste le seul « btn-primary » : l'accès à l'application n'est pas modifié.
    for (const a of Array.from(container.querySelectorAll('a.btn-primary'))) expect(a.getAttribute('href')).toBe('/onboarding');
  });

  it('plus de carte « Sur le web, une IA annoncée clairement » : aucune phrase qui suppose Magistra dans le navigateur', async () => {
    const { container } = await mount(fakeRuntime(new MemoryStore()));
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/Sur le web|IA annoncée clairement|Le site indique toujours|serveur d’IA compatible OpenAI/);
  });

  it('l’étape « Créez votre profil » dit que le profil est propre à l’ordinateur, pas à un compte', async () => {
    const { container } = await mount(fakeRuntime(new MemoryStore()));
    const text = container.textContent ?? '';
    expect(text).toContain('Votre profil reste propre à votre ordinateur.');
    expect(text).not.toMatch(/propre à votre compte/);
  });

  it('mode personnel : « Commencer » mène à l’application, sans connexion', async () => {
    const { container } = await mount(fakeRuntime(new MemoryStore(), { mode: 'personal' }));
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>('a.btn-primary'));
    expect(links.length).toBeGreaterThanOrEqual(3);
    for (const a of links) expect(a.getAttribute('href')).toBe('/app');
    expect(container.textContent).toContain('Mode personnel');
    expect(container.textContent).not.toContain('Vous êtes sur la démonstration');
  });
});
