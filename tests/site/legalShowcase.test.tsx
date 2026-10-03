// @vitest-environment jsdom
// Pages légales du site vitrine (mode « showcase ») : mentions légales (éditeur, directeur, adresse, contact, hébergeur ;
// jamais de région de base de données), politique de confidentialité exacte et prudente, conditions d'utilisation
// adaptées. Même mécanique « à compléter » / VITE_LEGAL_VALIDATED que les autres modes ; les modes existants ne changent pas.

import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { readLegalInfo, relevantFields, LEGAL_ENV_NAMES, type LegalField, type LegalPageKind } from '@/lib/legal';
import { setRuntimeConfig } from '@/lib/runtime/mode';
import LegalPage from '@/pages/LegalPage';
import ShowcaseLegalPage from '@/pages/legal/ShowcaseLegal';
import { cleanup, render } from '../ui/helpers';

afterEach(() => {
  cleanup();
  setRuntimeConfig(null);
});

const PAGES: LegalPageKind[] = ['mentions', 'confidentialite', 'cgu'];

const FULL = {
  VITE_LEGAL_PUBLISHER: 'Association Exemple',
  VITE_LEGAL_DIRECTOR: 'Camille Exemple',
  VITE_LEGAL_ADDRESS: '1 rue de l\'Exemple, 33000 Bordeaux',
  VITE_LEGAL_CONTACT: 'Contact Exemple, contact@exemple.fr',
  VITE_LEGAL_HOST: 'Hébergeur Exemple, 2 avenue du Serveur, 75000 Paris',
  VITE_LEGAL_DATA_REGION: 'Paris',
  VITE_LEGAL_VALIDATED: 'oui',
};

async function mount(page: LegalPageKind, env: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter>
      <ShowcaseLegalPage page={page} info={readLegalInfo(env)} />
    </MemoryRouter>,
  );
}

const marked = (container: HTMLElement) =>
  [...new Set(Array.from(container.querySelectorAll('[data-legal-todo]')).map(el => el.getAttribute('data-legal-todo') as LegalField))].sort();
const listed = (container: HTMLElement) => Array.from(container.querySelectorAll('[data-legal-missing] code')).map(el => el.textContent).sort();

describe('Showcase : mentions légales', () => {
  it('éditeur, directeur, adresse, contact et hébergeur renseignés', async () => {
    const { container } = await mount('mentions', FULL);
    const text = container.textContent ?? '';
    expect(container.querySelector('h1')?.textContent).toBe('Mentions légales');
    expect(text).toContain('Association Exemple');
    expect(text).toContain('Directeur ou directrice de la publication : Camille Exemple.');
    expect(text).toContain('Adresse : 1 rue de l\'Exemple, 33000 Bordeaux');
    expect(container.querySelector('a[href="mailto:contact@exemple.fr"]')).not.toBeNull();
    expect(text).toContain('Hébergeur du site : Hébergeur Exemple, 2 avenue du Serveur, 75000 Paris.');
    // Tout est renseigné et validé : plus aucun avis.
    expect(container.querySelector('[role="note"]')).toBeNull();
  });

  it('jamais de région de base de données : ni Supabase, ni compte, ni région', async () => {
    const { container } = await mount('mentions');
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/Supabase|Clerk|base de données|région|dataRegion/i);
    expect(marked(container)).not.toContain('dataRegion');
    expect(listed(container)).not.toContain(LEGAL_ENV_NAMES.dataRegion);
  });

  it('éditeur, directeur, adresse, contact et hébergeur manquants : marques « à compléter » et liste des variables', async () => {
    const { container } = await mount('mentions');
    expect(marked(container)).toEqual(['address', 'contact', 'director', 'host', 'publisher']);
    expect(listed(container)).toEqual(
      ['address', 'contact', 'director', 'host', 'publisher'].map(field => LEGAL_ENV_NAMES[field as LegalField]).sort(),
    );
    expect(container.textContent).toContain('Projet de texte, à faire valider avant mise en ligne');
  });

  it('attribution : conçu et développé par Juan Robin, dans le cadre du projet FutureAI ; vitrine sans compte', async () => {
    const { container } = await mount('mentions', FULL);
    const text = container.textContent ?? '';
    expect(text).toContain('Magistra est conçu et développé par Juan Robin, dans le cadre du projet FutureAI (Bordeaux, France).');
    expect(text).toContain('Ce site est une vitrine');
    expect(text).toContain('Ce site ne produit aucun contenu.');
  });
});

describe('Showcase : politique de confidentialité', () => {
  async function privacyText(env: Record<string, unknown> = FULL): Promise<{ text: string; container: HTMLElement }> {
    const { container } = await mount('confidentialite', env);
    return { text: container.textContent ?? '', container };
  }

  it('ce que le site n’a pas : compte, formulaire, cookie de suivi, statistiques d’audience, police tierce', async () => {
    const { text } = await privacyText();
    expect(text).toContain('il n\'a ni compte, ni connexion');
    expect(text).toContain('il n\'a aucun formulaire');
    expect(text).toContain('ne dépose aucun cookie de suivi');
    expect(text).toContain('ne mesure pas son audience');
    expect(text).toContain('il charge ses polices depuis lui-même');
    expect(text).toContain('Ce site ne dépose aucun cookie et n\'enregistre rien dans le stockage de votre navigateur.');
  });

  it('ce qui est traité : journaux de l’hébergeur (IP, date, page), recherche de version depuis le serveur, téléchargement servi par GitHub', async () => {
    const { text } = await privacyText();
    expect(text).toContain('adresse IP, date et heure, page demandée');
    expect(text).toContain('Hébergeur Exemple');
    expect(text).toContain('c\'est ce serveur, non votre navigateur, qui appelle GitHub');
    expect(text).toContain('le fichier d\'installation est servi par GitHub');
    expect(text).toContain('votre navigateur contacte GitHub');
  });

  it('liens externes qui quittent le site, et application Windows : sa propre politique est dans l’application', async () => {
    const { text } = await privacyText();
    expect(text).toContain('quittent ce site');
    expect(text).toContain('profil professionnel de l\'auteur');
    expect(text).toContain('sa propre politique de confidentialité est affichée dans l\'application');
  });

  it('exacte : aucun prestataire de l’application (comptes, base de données, IA en ligne) n’est cité', async () => {
    const { text } = await privacyText();
    expect(text).not.toMatch(/Clerk|Supabase|Cloudflare|Turnstile|Vercel|OpenAI|Ollama|historique|favoris|profil enseignant/i);
  });

  it('prudente : aucune durée de conservation inventée pour les journaux, aucun nom d’hébergeur écrit en dur', async () => {
    const { text } = await privacyText();
    expect(text).toContain('leur durée de conservation est fixée par l\'hébergeur');
    expect(text).not.toMatch(/\d+\s*(jours?|mois|ans)\b/);
    const missing = await privacyText({});
    expect(missing.text).toContain('[à compléter : hébergeur du site (nom et adresse)]');
  });

  it('responsable et droits : contact, CNIL', async () => {
    const { text, container } = await privacyText();
    expect(text).toContain('Association Exemple');
    expect(container.querySelector('a[href="mailto:contact@exemple.fr"]')).not.toBeNull();
    expect(container.querySelector('a[href="https://www.cnil.fr/fr/plaintes"]')).not.toBeNull();
  });

  it('seuls l’éditeur, l’adresse, le contact et l’hébergeur sont « à compléter » (jamais la région de base de données)', async () => {
    const { container } = await mount('confidentialite');
    expect(marked(container)).toEqual(['address', 'contact', 'host', 'publisher']);
    expect(listed(container)).toEqual(['address', 'contact', 'host', 'publisher'].map(field => LEGAL_ENV_NAMES[field as LegalField]).sort());
  });

  it('garanties de transfert : à vérifier tant que les textes ne sont pas validés ; plus ensuite', async () => {
    const draft = await privacyText({ ...FULL, VITE_LEGAL_VALIDATED: '' });
    expect(draft.text).toContain('Ces garanties sont à vérifier par l\'éditeur avant publication.');
    cleanup();
    const validated = await privacyText(FULL);
    expect(validated.text).not.toContain('à vérifier par l\'éditeur');
  });
});

describe('Showcase : conditions d’utilisation', () => {
  it('site vitrine gratuit, sans compte ; contenus d’IA à relire ; pas de données d’élèves ; pas de suspension de compte', async () => {
    const { container } = await mount('cgu', FULL);
    const text = container.textContent ?? '';
    expect(container.querySelector('h1')?.textContent).toBe('Conditions générales d\'utilisation');
    expect(text).toContain('Ce site présente Magistra');
    expect(text).toContain('sans compte ni connexion');
    expect(text).toContain('relit, vérifie et adapte');
    expect(text).toContain('données personnelles d\'élèves');
    expect(text).not.toMatch(/Le compte est personnel|supprimer vos données et votre compte|Suspension/);
    expect(container.querySelector('[role="note"]')).toBeNull();
  });

  it('seul le contact est « à compléter »', async () => {
    const { container } = await mount('cgu');
    expect(marked(container)).toEqual(['contact']);
    expect(listed(container)).toEqual([LEGAL_ENV_NAMES.contact]);
  });
});

describe('Showcase : mécanique « à compléter » / VITE_LEGAL_VALIDATED', () => {
  it.each(PAGES)('%s : validé mais incomplet : la liste seule, sans « projet de texte »', async page => {
    const { container } = await mount(page, { VITE_LEGAL_VALIDATED: 'true' });
    expect(container.textContent).not.toContain('Projet de texte, à faire valider');
    expect(container.querySelector('[data-legal-missing]')).not.toBeNull();
  });

  it.each(PAGES)('%s : l’avis liste exactement les variables dont la page affiche la marque', async page => {
    const { container } = await mount(page);
    const expected = marked(container).map(field => LEGAL_ENV_NAMES[field]).sort();
    expect(listed(container)).toEqual(expected);
    expect(marked(container).sort()).toEqual(relevantFields(page, 'showcase').slice().sort());
  });

  it('relevantFields : hébergeur oui, région de base de données non', () => {
    for (const page of ['mentions', 'confidentialite'] as const) {
      expect(relevantFields(page, 'showcase')).toContain('host');
      expect(relevantFields(page, 'showcase')).not.toContain('dataRegion');
    }
    // Les modes existants ne changent pas.
    expect(relevantFields('mentions', 'web')).toEqual(['publisher', 'director', 'address', 'contact', 'host', 'dataRegion']);
    expect(relevantFields('confidentialite', 'web')).toEqual(['publisher', 'address', 'contact', 'host', 'dataRegion']);
    for (const mode of ['personal', 'demo', 'local'] as const) {
      expect(relevantFields('mentions', mode)).toEqual(['publisher', 'director', 'address', 'contact']);
      expect(relevantFields('confidentialite', mode)).toEqual(['publisher', 'contact']);
    }
    for (const mode of ['web', 'personal', 'demo', 'local', 'showcase'] as const) expect(relevantFields('cgu', mode)).toEqual(['contact']);
  });
});

describe('LegalPage en mode « showcase »', () => {
  it.each(PAGES)('%s : rend la page du site vitrine, sans lire le mode d’exécution', async page => {
    // Le mode d'exécution (démonstration, web…) ne change rien : le mode d'affichage demandé l'emporte.
    setRuntimeConfig({ mode: 'web', clerkPublishableKey: 'pk_test_x' });
    const { container } = await render(
      <MemoryRouter>
        <LegalPage page={page} mode="showcase" />
      </MemoryRouter>,
    );
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/Clerk|Supabase|dataRegion|Région de la base/i);
    if (page === 'mentions') expect(text).toContain('Ce site est une vitrine');
    if (page === 'confidentialite') expect(text).toContain('Ce que ce site ne fait pas');
    if (page === 'cgu') expect(text).toContain('Ce site présente Magistra');
  });
});
