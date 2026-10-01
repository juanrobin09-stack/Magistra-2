// @vitest-environment jsdom
// Pages légales : routes publiques (sans connexion), contenu fidèle aux flux de données réels, informations de
// l'éditeur lues dans VITE_LEGAL_*, avis « à compléter » visible, prestataire d'IA pris dans providerInfo.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ProviderInfo } from '@shared/types';
import App from '@/App';
import LandingPage from '@/pages/LandingPage';
import LegalPage from '@/pages/LegalPage';
import { emailOf, readLegalInfo } from '@/lib/legal';
import { setRuntimeConfig } from '@/lib/runtime/mode';
import { RuntimeContext } from '@/lib/runtime/context';
import { cleanup, fakeRuntime, flush, MemoryStore, render } from './helpers';

const PROVIDER: ProviderInfo = {
  label: 'Fournisseur IA Exemple',
  thirdParty: true,
  country: 'France (Roubaix)',
  retention: 'aucune conservation annoncée',
  training: 'non, annoncé',
  privacyUrl: 'https://exemple.test/confidentialite-ia',
};

const LEGAL_VARS = {
  VITE_LEGAL_PUBLISHER: 'Association Exemple',
  VITE_LEGAL_DIRECTOR: 'Mme Dupont',
  VITE_LEGAL_ADDRESS: '1 rue de la Paix, 33000 Bordeaux',
  VITE_LEGAL_CONTACT: 'contact@exemple.test',
  VITE_LEGAL_HOST: 'Hébergeur Exemple, 2 avenue du Cloud',
  VITE_LEGAL_DATA_REGION: 'Union européenne (Paris)',
};

beforeEach(() => {
  setRuntimeConfig({ mode: 'web', clerkPublishableKey: 'pk_test_x', providerInfo: PROVIDER });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  setRuntimeConfig(null);
  window.history.pushState({}, '', '/');
});

function mountPage(page: 'mentions' | 'confidentialite' | 'cgu') {
  return render(
    <MemoryRouter>
      <LegalPage page={page} />
    </MemoryRouter>,
  );
}

describe('readLegalInfo', () => {
  it('lit les variables VITE_LEGAL_* et signale ce qui manque', () => {
    const info = readLegalInfo({ VITE_LEGAL_PUBLISHER: '  Asso  ', VITE_LEGAL_CONTACT: '' });
    expect(info.publisher).toBe('Asso');
    expect(info.contact).toBeUndefined();
    expect(info.missing).toEqual(['director', 'address', 'contact', 'host', 'dataRegion']);
    expect(readLegalInfo(LEGAL_VARS).missing).toEqual([]);
  });

  it('le contact de l\'administrateur du serveur sert de repli', () => {
    expect(readLegalInfo({}, 'admin@exemple.test').contact).toBe('admin@exemple.test');
    expect(readLegalInfo({ VITE_LEGAL_CONTACT: 'a@b.fr' }, 'admin@exemple.test').contact).toBe('a@b.fr');
  });

  it('neutralise les caractères de contrôle et borne la longueur', () => {
    expect(readLegalInfo({ VITE_LEGAL_ADDRESS: 'ligne 1\u0000\nligne 2' }).address).toBe('ligne 1 ligne 2');
    expect(readLegalInfo({ VITE_LEGAL_ADDRESS: 'x'.repeat(1000) }).address!.length).toBe(300);
  });

  it('emailOf extrait l\'adresse', () => {
    expect(emailOf('Service Magistra <aide@exemple.test>')).toBe('aide@exemple.test');
    expect(emailOf('par courrier')).toBeNull();
  });
});

describe('Routes publiques', () => {
  it.each([
    ['/mentions-legales', 'Mentions légales'],
    ['/confidentialite', 'Politique de confidentialité'],
    ['/cgu', "Conditions générales d'utilisation"],
  ])('%s est accessible sans connexion (démonstration, mode personnel et site web)', async (path, title) => {
    for (const config of [
      { mode: 'demo' as const },
      { mode: 'personal' as const },
      { mode: 'web' as const, clerkPublishableKey: 'pk_test_Y2xlcmsuZXhhbXBsZS5jb20k', providerInfo: PROVIDER },
    ]) {
      cleanup();
      setRuntimeConfig(config);
      window.history.pushState({}, '', path);
      const { container } = await render(<App config={config} />);
      await flush(8);
      expect(container.querySelector('h1')?.textContent).toBe(title);
      // Aucune redirection vers la connexion ou l'accueil.
      expect(window.location.pathname).toBe(path);
    }
  });
});

describe('Contenu', () => {
  it('annonce un projet à valider et liste ce qui reste « à compléter » quand VITE_LEGAL_* manque', async () => {
    const { container } = await mountPage('mentions');
    const notice = container.querySelector('[role="note"]')!;
    expect(notice.textContent).toContain('à faire valider');
    expect(notice.textContent).toContain('VITE_LEGAL_PUBLISHER');
    expect(notice.textContent).toContain('VITE_LEGAL_HOST');
    expect(container.querySelectorAll('[data-legal-todo]').length).toBeGreaterThanOrEqual(4);
    expect(container.textContent).toContain('[à compléter');
  });

  it('affiche les informations de l\'éditeur et plus aucun avis « à compléter » quand tout est renseigné', async () => {
    for (const [key, value] of Object.entries(LEGAL_VARS)) vi.stubEnv(key, value);
    const { container } = await mountPage('mentions');
    expect(container.textContent).toContain('Association Exemple');
    expect(container.textContent).toContain('1 rue de la Paix, 33000 Bordeaux');
    expect(container.textContent).toContain('Hébergeur Exemple');
    expect(container.querySelector('a[href="mailto:contact@exemple.test"]')).not.toBeNull();
    expect(container.querySelector('[data-legal-missing]')).toBeNull();
    expect(container.querySelector('[data-legal-todo]')).toBeNull();
    // L'avis « projet à valider » reste affiché.
    expect(container.querySelector('[role="note"]')!.textContent).toContain('à faire valider');
  });

  it('confidentialité : sous-traitants réels, droits, CNIL, cookies, et prestataire d\'IA tiré de providerInfo', async () => {
    const { container } = await mountPage('confidentialite');
    const text = container.textContent ?? '';
    for (const word of ['Clerk', 'Supabase', 'Vercel', 'Turnstile', 'CNIL', 'aucun cookie publicitaire', 'Télécharger toutes mes données (JSON)', 'Supprimer toutes mes données Magistra', 'art. 6.1.b']) {
      expect(text).toContain(word);
    }
    const provider = container.querySelector('[data-legal-provider]')!;
    expect(provider.textContent).toContain('Fournisseur IA Exemple');
    expect(provider.textContent).toContain('France (Roubaix)');
    expect(provider.textContent).toContain('aucune conservation annoncée');
    expect(provider.querySelector('a[href="https://exemple.test/confidentialite-ia"]')).not.toBeNull();
  });

  it('confidentialité : le prestataire suit la configuration du serveur (AI_PRESET)', async () => {
    setRuntimeConfig({ mode: 'web', clerkPublishableKey: 'pk_test_x', providerInfo: { ...PROVIDER, label: 'Autre Prestataire', country: 'Allemagne' } });
    const { container } = await mountPage('confidentialite');
    expect(container.querySelector('[data-legal-provider]')!.textContent).toContain('Autre Prestataire');
    expect(container.textContent).not.toContain('Fournisseur IA Exemple');
  });

  it('confidentialité : un lien de politique non https du prestataire n\'est pas affiché', async () => {
    setRuntimeConfig({ mode: 'web', clerkPublishableKey: 'pk_test_x', providerInfo: { ...PROVIDER, privacyUrl: 'javascript:alert(1)' } });
    const { container } = await mountPage('confidentialite');
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it('confidentialité : sans prestataire annoncé, renvoie vers l\'application', async () => {
    setRuntimeConfig({ mode: 'web', clerkPublishableKey: 'pk_test_x' });
    const { container } = await mountPage('confidentialite');
    expect(container.querySelector('[data-legal-provider]')).toBeNull();
    expect(container.textContent).toContain('Le prestataire qui reçoit vos demandes est nommé dans');
  });

  it('application Windows : texte local, sans Clerk ni Supabase', async () => {
    setRuntimeConfig({ mode: 'local' });
    const { container } = await mountPage('confidentialite');
    const text = container.textContent ?? '';
    expect(text).toContain('sans compte');
    expect(text).not.toContain('Clerk');
    expect(text).not.toContain('Supabase');
  });

  it('CGU : relecture des contenus d\'IA et pas de données d\'élèves', async () => {
    const { container } = await mountPage('cgu');
    expect(container.textContent).toContain('relit, vérifie');
    expect(container.textContent).toContain('données personnelles d\'élèves');
  });
});

describe('Liens', () => {
  it('le pied de page de l\'accueil renvoie vers les trois pages', async () => {
    const { container } = await render(
      <RuntimeContext.Provider value={fakeRuntime(new MemoryStore())}>
        <MemoryRouter>
          <LandingPage />
        </MemoryRouter>
      </RuntimeContext.Provider>,
    );
    const footer = container.querySelector('footer')!;
    expect(Array.from(footer.querySelectorAll('a')).map(a => a.getAttribute('href'))).toEqual(
      expect.arrayContaining(['/mentions-legales', '/confidentialite', '/cgu']),
    );
  });
});
