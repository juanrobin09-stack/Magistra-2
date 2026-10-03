// @vitest-environment jsdom
// Pages légales sans trou ni consigne d'éditeur : contact (juanrobin89@gmail.com) et hébergeur (Vercel) par défaut,
// éditeur et directeur de la publication « Juan Robin », adresse affichée seulement si le build la donne, jamais de
// « à compléter », de « projet de texte » ni de nom de variable dans le texte affiché ; les variables VITE_LEGAL_*
// restent des surcharges. Site vitrine et application, dans tous les modes.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import LegalPage from '@/pages/LegalPage';
import ShowcaseLegalPage from '@/pages/legal/ShowcaseLegal';
import { LEGAL_DEFAULT_HOST, LEGAL_NON_PROFESSIONAL_NOTICE, readLegalInfo, type LegalPageKind } from '@/lib/legal';
import { setRuntimeConfig, type RuntimeConfig } from '@/lib/runtime/mode';
import { cleanup, render } from './helpers';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  setRuntimeConfig(null);
});

const PAGES: LegalPageKind[] = ['mentions', 'confidentialite', 'cgu'];
const DEFAULT_MAILTO = 'a[href="mailto:juanrobin89@gmail.com"]';

/** Chaque mode d'affichage : les modes d'exécution de l'application, et le site vitrine. */
const MODES: Record<string, RuntimeConfig | 'showcase'> = {
  showcase: 'showcase',
  web: { mode: 'web', clerkPublishableKey: 'pk_test_x' },
  personal: { mode: 'personal' },
  demo: { mode: 'demo' },
  local: { mode: 'local' },
};

const OVERRIDES = {
  VITE_LEGAL_PUBLISHER: 'Association Exemple',
  VITE_LEGAL_DIRECTOR: 'Mme Dupont',
  VITE_LEGAL_ADDRESS: '1 rue de la Paix, 33000 Bordeaux',
  VITE_LEGAL_CONTACT: 'Service Exemple, contact@exemple.test',
  VITE_LEGAL_HOST: 'Hébergeur Exemple, 2 avenue du Cloud',
  VITE_LEGAL_DATA_REGION: 'Union européenne (Paris)',
};

function stub(vars: Record<string, string>) {
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
}

async function mount(page: LegalPageKind, mode: string) {
  const config = MODES[mode];
  if (config === 'showcase') {
    return render(
      <MemoryRouter>
        <ShowcaseLegalPage page={page} />
      </MemoryRouter>,
    );
  }
  setRuntimeConfig(config);
  return render(
    <MemoryRouter>
      <LegalPage page={page} />
    </MemoryRouter>,
  );
}

const textOf = (container: HTMLElement) => (container.textContent ?? '').replace(/\s+/g, ' ');

/** Ce qu'un visiteur ne doit jamais lire : marques « à compléter », avis de projet, consignes d'éditeur, noms de variables. */
const FORBIDDEN_WORDING = /à compléter|projet de texte|à faire valider|à vérifier|VITE_|variable de build|\[à/i;

describe('Valeurs par défaut', () => {
  it('readLegalInfo sans variable : Juan Robin, juanrobin89@gmail.com, Vercel ; ni adresse ni région de base de données', () => {
    expect(readLegalInfo({})).toEqual({
      publisher: 'Juan Robin',
      director: 'Juan Robin',
      contact: 'juanrobin89@gmail.com',
      host: 'Vercel Inc., États-Unis (https://vercel.com)',
    });
    expect(LEGAL_DEFAULT_HOST).toBe('Vercel Inc., États-Unis (https://vercel.com)');
    // Variables présentes mais vides (variables de dépôt GitHub non définies : chaîne vide) ou blanches : les mêmes défauts.
    const empty = Object.fromEntries(Object.keys(OVERRIDES).map(name => [name, '']));
    expect(readLegalInfo(empty)).toEqual(readLegalInfo({}));
    expect(readLegalInfo(Object.fromEntries(Object.keys(OVERRIDES).map(name => [name, ' \t\n ']))).address).toBeUndefined();
  });

  it.each(PAGES)('%s : le contact par défaut est un lien « mailto: » exact, dans chaque mode', async page => {
    for (const mode of Object.keys(MODES)) {
      cleanup();
      const { container } = await mount(page, mode);
      const links = container.querySelectorAll(DEFAULT_MAILTO);
      expect(links.length, `${page} en ${mode}`).toBeGreaterThan(0);
      for (const link of links) expect(link.textContent).toBe('juanrobin89@gmail.com');
      // Aucune autre adresse « mailto: » que celle-là.
      const all = [...container.querySelectorAll('a[href^="mailto:"]')].map(a => a.getAttribute('href'));
      expect([...new Set(all)], `${page} en ${mode}`).toEqual(['mailto:juanrobin89@gmail.com']);
    }
  });

  it('mentions légales : l\'hébergeur par défaut est Vercel (nom, pays, site) sur le site vitrine et le site web ; pas dans les autres modes', async () => {
    for (const mode of ['showcase', 'web']) {
      cleanup();
      const { container } = await mount('mentions', mode);
      expect(textOf(container), mode).toContain('Hébergeur du site : Vercel Inc., États-Unis (https://vercel.com).');
      expect(container.querySelector('a[href="https://vercel.com/"]'), mode).not.toBeNull();
    }
    for (const mode of ['personal', 'demo', 'local']) {
      cleanup();
      const { container } = await mount('mentions', mode);
      expect(textOf(container), mode).not.toMatch(/Vercel|Hébergeur|Hébergement/);
    }
  });

  it('politique de confidentialité : l\'hébergeur par défaut (Vercel) est nommé sur le site vitrine et le site web', async () => {
    for (const mode of ['showcase', 'web']) {
      cleanup();
      const { container } = await mount('confidentialite', mode);
      expect(textOf(container), mode).toContain('Vercel Inc., États-Unis (https://vercel.com)');
    }
  });

  it('éditeur et directeur de la publication : Juan Robin, dans chaque mode', async () => {
    for (const mode of Object.keys(MODES)) {
      cleanup();
      const { container } = await mount('mentions', mode);
      const text = textOf(container);
      expect(text, mode).toContain('Juan Robin');
      expect(text, mode).toContain('Directeur ou directrice de la publication : Juan Robin.');
    }
  });

  it('éditeur sans adresse : la phrase de l\'article 6, III, 2° de la LCEN, là où le site a un hébergeur ; jamais d\'adresse inventée', async () => {
    for (const mode of ['showcase', 'web']) {
      cleanup();
      const { container } = await mount('mentions', mode);
      const text = textOf(container);
      expect(text, mode).toContain(
        "L'éditeur, personne physique éditant le site à titre non professionnel, a communiqué ses éléments d'identification à l'hébergeur et ne publie pas son adresse personnelle (article 6, III, 2° de la loi n° 2004-575 du 21 juin 2004).",
      );
      expect(text, mode).toContain(LEGAL_NON_PROFESSIONAL_NOTICE);
      expect(text, mode).not.toContain('Adresse :');
    }
    for (const mode of ['personal', 'demo', 'local']) {
      cleanup();
      const { container } = await mount('mentions', mode);
      expect(textOf(container), mode).not.toContain('article 6, III');
      expect(textOf(container), mode).not.toContain('Adresse :');
    }
  });

  it('l\'application Windows et les autres modes : « Éditeur de l\'application » ; le site : « Éditeur du site »', async () => {
    for (const [mode, heading] of [['showcase', 'Éditeur du site'], ['web', 'Éditeur du site'], ['local', "Éditeur de l'application"], ['personal', "Éditeur de l'application"], ['demo', "Éditeur de l'application"]]) {
      cleanup();
      const { container } = await mount('mentions', mode);
      expect([...container.querySelectorAll('h2')].map(h => h.textContent), mode).toContain(heading);
    }
  });

  it('la région de la base de données n\'est jamais affichée sans variable, ni sur le site vitrine', async () => {
    const web = await mount('mentions', 'web');
    expect(textOf(web.container)).toContain('base de données Supabase.');
    expect(textOf(web.container)).not.toMatch(/région/i);
    cleanup();
    const privacy = await mount('confidentialite', 'web');
    expect(textOf(privacy.container)).not.toMatch(/Région/);
    cleanup();
    stub(OVERRIDES);
    const showcase = await mount('mentions', 'showcase');
    expect(textOf(showcase.container)).not.toMatch(/Supabase|région/i);
  });
});

describe('Aucune formulation d\'éditeur, de projet ni de variable dans les pages', () => {
  it.each(PAGES)('%s : ni avis, ni marque, ni « à compléter » / « projet de texte » / « VITE_ », dans chaque mode, variables absentes', async page => {
    for (const mode of Object.keys(MODES)) {
      cleanup();
      const { container } = await mount(page, mode);
      expect(textOf(container), `${page} en ${mode}`).not.toMatch(FORBIDDEN_WORDING);
      expect(container.querySelector('[role="note"]'), `${page} en ${mode}`).toBeNull();
      expect(container.querySelector('[data-legal-todo], [data-legal-missing]'), `${page} en ${mode}`).toBeNull();
      expect(container.querySelector('mark'), `${page} en ${mode}`).toBeNull();
    }
  });

  it.each(PAGES)('%s : même résultat avec toutes les variables renseignées ou toutes vides', async page => {
    for (const vars of [OVERRIDES, Object.fromEntries(Object.keys(OVERRIDES).map(name => [name, '']))]) {
      vi.unstubAllEnvs();
      stub(vars);
      for (const mode of Object.keys(MODES)) {
        cleanup();
        const { container } = await mount(page, mode);
        expect(textOf(container), `${page} en ${mode}`).not.toMatch(FORBIDDEN_WORDING);
        expect(container.querySelector('[role="note"]'), `${page} en ${mode}`).toBeNull();
      }
    }
  });

  it('le texte public ne cite aucune consigne destinée à l\'éditeur (garanties « à vérifier », « avant publication »)', async () => {
    for (const mode of ['showcase', 'web']) {
      cleanup();
      const { container } = await mount('confidentialite', mode);
      const text = textOf(container);
      expect(text, mode).not.toMatch(/avant publication|avant mise en ligne|par l'éditeur/);
      expect(text, mode).toContain('clauses contractuelles types');
    }
  });
});

describe('Conditions d\'utilisation selon le mode', () => {
  const headings = (container: HTMLElement) => [...container.querySelectorAll('h2')].map(h => h.textContent);

  it.each(['local', 'personal', 'demo'])('%s : sans compte, sans limite de débit ni suspension d\'accès, numérotation continue', async mode => {
    const { container } = await mount('cgu', mode);
    const text = textOf(container);
    expect(text).not.toMatch(/Le compte est personnel|identifiants|votre compte|Suspension|suspendre|limites de débit|nombre de demandes par minute/);
    expect(text).toContain('Il fonctionne sans compte : vous pouvez effacer vos données à tout moment (Réglages).');
    expect(text).toContain('Le logiciel est fourni « en l\'état ».');
    expect(headings(container)).toEqual([
      '1. Objet', '2. Accès', '3. Usage de Magistra', '4. Contenus générés par intelligence artificielle',
      '5. Vos contenus et la propriété intellectuelle', '6. Disponibilité', '7. Responsabilité', '8. Données personnelles',
      '9. Évolution des conditions et droit applicable',
    ]);
    // Conservé : relecture des contenus d'IA, pas de données d'élèves, licence MIT, droit français, contact.
    expect(text).toContain('L\'enseignant relit, vérifie et adapte chaque contenu');
    expect(text).toContain('données personnelles d\'élèves');
    expect(text).toContain('licence MIT');
    expect(text).toContain('soumises au droit français');
    expect(container.querySelector(DEFAULT_MAILTO)).not.toBeNull();
  });

  it('site web : comptes, limites de débit et suspension, dix rubriques', async () => {
    const { container } = await mount('cgu', 'web');
    const text = textOf(container);
    expect(text).toContain('Le compte est personnel');
    expect(text).toContain('limites de débit');
    expect(headings(container)).toContain('9. Suspension');
    expect(headings(container)).toHaveLength(10);
    expect(headings(container)[9]).toBe('10. Évolution des conditions et droit applicable');
  });
});

describe('Surcharges par variables VITE_LEGAL_*', () => {
  it('éditeur, directeur, adresse, hébergeur : affichés à la place des valeurs par défaut (site vitrine et site web)', async () => {
    stub(OVERRIDES);
    for (const mode of ['showcase', 'web']) {
      cleanup();
      const { container } = await mount('mentions', mode);
      const text = textOf(container);
      expect(text, mode).toContain('Association Exemple');
      expect(text, mode).toContain('Directeur ou directrice de la publication : Mme Dupont.');
      expect(text, mode).toContain('Adresse : 1 rue de la Paix, 33000 Bordeaux');
      expect(text, mode).toContain('Hébergeur du site : Hébergeur Exemple, 2 avenue du Cloud.');
      expect(text, mode).not.toMatch(/Vercel|Juan Robin(?!, dans)/);
      // Avec une adresse publiée, la phrase de l'éditeur non professionnel n'a plus lieu d'être.
      expect(text, mode).not.toContain('article 6, III');
      expect(container.querySelector('a[href^="https://vercel.com"]'), mode).toBeNull();
    }
  });

  it('contact : l\'adresse e-mail du texte devient le lien, le reste du texte est conservé ; l\'adresse par défaut disparaît', async () => {
    stub(OVERRIDES);
    for (const mode of Object.keys(MODES)) {
      for (const page of PAGES) {
        cleanup();
        const { container } = await mount(page, mode);
        expect(textOf(container), `${page} en ${mode}`).toContain('Service Exemple, contact@exemple.test');
        expect(container.querySelector('a[href="mailto:contact@exemple.test"]'), `${page} en ${mode}`).not.toBeNull();
        expect(container.querySelector(DEFAULT_MAILTO), `${page} en ${mode}`).toBeNull();
        expect(textOf(container), `${page} en ${mode}`).not.toContain('juanrobin89');
      }
    }
  });

  it('contact de l\'administrateur du serveur : passe avant l\'adresse par défaut, après VITE_LEGAL_CONTACT', async () => {
    setRuntimeConfig({ mode: 'web', clerkPublishableKey: 'pk_test_x', adminContact: 'admin@exemple.test' });
    const first = await render(
      <MemoryRouter>
        <LegalPage page="cgu" />
      </MemoryRouter>,
    );
    expect(first.container.querySelector('a[href="mailto:admin@exemple.test"]')).not.toBeNull();
    expect(first.container.querySelector(DEFAULT_MAILTO)).toBeNull();
    cleanup();
    stub({ VITE_LEGAL_CONTACT: 'contact@exemple.test' });
    setRuntimeConfig({ mode: 'web', clerkPublishableKey: 'pk_test_x', adminContact: 'admin@exemple.test' });
    const second = await render(
      <MemoryRouter>
        <LegalPage page="cgu" />
      </MemoryRouter>,
    );
    expect(second.container.querySelector('a[href="mailto:contact@exemple.test"]')).not.toBeNull();
    expect(second.container.querySelector('a[href="mailto:admin@exemple.test"]')).toBeNull();
  });

  it('contact sans adresse e-mail (« par courrier ») : texte seul, jamais de lien « mailto: »', async () => {
    stub({ VITE_LEGAL_CONTACT: 'par courrier à la mairie' });
    const { container } = await mount('mentions', 'showcase');
    expect(textOf(container)).toContain('Contact : par courrier à la mairie');
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
  });

  it('région de la base de données : affichée sur le site web quand elle est renseignée, jamais sur le site vitrine', async () => {
    stub(OVERRIDES);
    const mentions = await mount('mentions', 'web');
    expect(textOf(mentions.container)).toContain('base de données Supabase, région : Union européenne (Paris).');
    cleanup();
    const privacy = await mount('confidentialite', 'web');
    expect(textOf(privacy.container)).toContain('Région : Union européenne (Paris)');
    cleanup();
    const showcase = await mount('confidentialite', 'showcase');
    expect(textOf(showcase.container)).not.toContain('Union européenne (Paris)');
  });

  it('hébergeur : une adresse https dans la valeur devient un lien ; rien d\'autre ne l\'est', async () => {
    stub({ VITE_LEGAL_HOST: 'Hébergeur Exemple (https://hebergeur.exemple/accueil), France' });
    const { container } = await mount('mentions', 'showcase');
    const link = container.querySelector('a[href="https://hebergeur.exemple/accueil"]');
    expect(link?.textContent).toBe('https://hebergeur.exemple/accueil');
    expect(textOf(container)).toContain('Hébergeur du site : Hébergeur Exemple (https://hebergeur.exemple/accueil), France.');
    cleanup();
    stub({ VITE_LEGAL_HOST: 'Hébergeur Exemple, http://pas-https.exemple, javascript:alert(1)' });
    const plain = await mount('mentions', 'showcase');
    expect(plain.container.querySelector('a[href^="http://pas-https"], a[href^="javascript"]')).toBeNull();
  });

  it('valeurs longues bornées et caractères de contrôle neutralisés', () => {
    const info = readLegalInfo({ VITE_LEGAL_PUBLISHER: 'x'.repeat(1000), VITE_LEGAL_HOST: 'Hébergeur\u0000\nExemple' });
    expect(info.publisher).toHaveLength(300);
    expect(info.host).toBe('Hébergeur Exemple');
  });
});
