// @vitest-environment jsdom
// Pages légales du site vitrine (mode « showcase ») : mentions légales (éditeur, directeur, contact, hébergeur ; jamais
// de région de base de données), politique de confidentialité exacte et prudente, conditions d'utilisation adaptées.
// L'éditeur, son contact et l'hébergeur ont des valeurs par défaut (Juan Robin, juanrobin89@gmail.com, Vercel) que les
// variables VITE_LEGAL_* remplacent ; l'adresse n'est affichée que si elle est renseignée. Valeurs par défaut et
// absence de formulation d'éditeur dans tous les modes : tests/ui/legalDefaults.test.tsx.

import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { readLegalInfo, type LegalPageKind } from '@/lib/legal';
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
};

async function mount(page: LegalPageKind, env: Record<string, unknown> = {}) {
  return render(
    <MemoryRouter>
      <ShowcaseLegalPage page={page} info={readLegalInfo(env)} />
    </MemoryRouter>,
  );
}

describe('Showcase : mentions légales', () => {
  it('éditeur, directeur, adresse, contact et hébergeur renseignés par le build', async () => {
    const { container } = await mount('mentions', FULL);
    const text = container.textContent ?? '';
    expect(container.querySelector('h1')?.textContent).toBe('Mentions légales');
    expect(text).toContain('Association Exemple');
    expect(text).toContain('Directeur ou directrice de la publication : Camille Exemple.');
    expect(text).toContain('Adresse : 1 rue de l\'Exemple, 33000 Bordeaux');
    expect(container.querySelector('a[href="mailto:contact@exemple.fr"]')).not.toBeNull();
    expect(text).toContain('Hébergeur du site : Hébergeur Exemple, 2 avenue du Serveur, 75000 Paris.');
    // Une adresse est publiée : la phrase de l'éditeur non professionnel n'a plus lieu d'être.
    expect(text).not.toContain('article 6, III');
    expect(container.querySelector('[role="note"]')).toBeNull();
  });

  it('sans variable : Juan Robin éditeur et directeur de la publication, juanrobin89@gmail.com, Vercel ; ni adresse ni avis', async () => {
    const { container } = await mount('mentions');
    const text = container.textContent ?? '';
    expect(text).toContain('Juan Robin');
    expect(text).toContain('Directeur ou directrice de la publication : Juan Robin.');
    expect(text).toContain('Contact : juanrobin89@gmail.com');
    expect(container.querySelector('a[href="mailto:juanrobin89@gmail.com"]')).not.toBeNull();
    expect(text).toContain('Hébergeur du site : Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis (https://vercel.com).');
    expect(text).not.toContain('Adresse :');
    expect(text).toContain(
      "L'éditeur, personne physique éditant le site à titre non professionnel, a communiqué ses éléments d'identification à l'hébergeur et ne publie pas son adresse personnelle (article 6, III, 2° de la loi n° 2004-575 du 21 juin 2004).",
    );
    expect(container.querySelector('[role="note"]')).toBeNull();
    expect(container.querySelector('[data-legal-todo]')).toBeNull();
  });

  it('jamais de région de base de données : ni Supabase, ni compte, ni région, même si la variable existe', async () => {
    for (const env of [{}, FULL]) {
      cleanup();
      const { container } = await mount('mentions', env);
      expect(container.textContent ?? '').not.toMatch(/Supabase|Clerk|base de données|région|dataRegion/i);
    }
  });

  it('attribution : conçu et développé par Juan Robin, dans le cadre du projet FutureAI ; vitrine sans compte', async () => {
    const { container } = await mount('mentions', FULL);
    const text = container.textContent ?? '';
    expect(text).toContain('Magistra est une application pédagogique gratuite, conçue et développée par Juan Robin, dans le cadre du projet FutureAI (Bordeaux, France).');
    expect(text).toContain('Ce site est une vitrine');
    expect(text).toContain('Ce site ne produit aucun contenu.');
  });

  it('conservé : conditions de licence, propriété intellectuelle, contenus d\'IA à relire, empreinte du téléchargement servi par GitHub', async () => {
    const { container } = await mount('mentions');
    const text = container.textContent ?? '';
    expect(text).toContain('conditions de licence applicables au logiciel sont fournies avec l’application');
    expect([...container.querySelectorAll('h2')].map(h => h.textContent)).toEqual(
      expect.arrayContaining(['Propriété intellectuelle', 'Contenus générés par intelligence artificielle', 'Données personnelles']),
    );
    expect(text).toContain('ils peuvent contenir des erreurs, des approximations ou des références inexactes');
    expect(text).toContain('il est servi par GitHub');
  });
});

describe('Showcase : politique de confidentialité', () => {
  async function privacyText(env: Record<string, unknown> = FULL): Promise<{ text: string; container: HTMLElement }> {
    const { container } = await mount('confidentialite', env);
    return { text: container.textContent ?? '', container };
  }

  it('ce que le site n’a pas : compte, formulaire, publicité, statistiques d’audience, police tierce ; aucun cookie ni stockage', async () => {
    const { text } = await privacyText();
    expect(text).toContain('il n\'a ni compte, ni connexion, ni formulaire');
    expect(text).toContain('il ne vous demande aucune information');
    expect(text).toContain('aucune publicité');
    expect(text).toContain('ne mesure pas son audience');
    expect(text).toContain('il charge ses polices depuis lui-même');
    expect(text).toContain('Ce site ne dépose aucun cookie, de suivi ou autre, et n\'enregistre rien dans le stockage de votre navigateur.');
  });

  it('chaque affirmation n’est dite qu’une fois : cookies, durée de conservation, politique de l’application', async () => {
    const { text } = await privacyText();
    expect(text.match(/aucun cookie/g)).toHaveLength(1);
    expect(text.match(/fixée par l'hébergeur/g)).toHaveLength(1);
    expect(text.match(/est affichée dans l'application/g)).toHaveLength(1);
  });

  it('ce qui est traité : journaux de l’hébergeur (IP, date, page), recherche de version depuis le serveur, téléchargement servi par GitHub', async () => {
    const { text } = await privacyText();
    expect(text).toContain('adresse IP, date et heure, page demandée');
    expect(text).toContain('Hébergeur Exemple');
    expect(text).toContain('c\'est ce serveur, non votre navigateur, qui appelle GitHub');
    expect(text).toContain('le fichier d\'installation est servi par GitHub');
    expect(text).toContain('votre navigateur contacte GitHub');
    expect(text).toContain('dont votre adresse IP');
  });

  it('liens externes qui quittent le site, et application Windows : sa propre politique est dans l’application', async () => {
    const { text } = await privacyText();
    expect(text).toContain('quittent ce site');
    expect(text).toContain('profil professionnel de l\'auteur');
    expect(text).toContain('Sa politique de confidentialité, qui précise ce qui peut en sortir et dans quels cas, est affichée dans l\'application');
  });

  it('exacte : aucun prestataire de l’application (comptes, base de données, IA en ligne) n’est cité ; Vercel seulement comme hébergeur', async () => {
    const { text } = await privacyText({});
    expect(text).not.toMatch(/Clerk|Supabase|Cloudflare|Turnstile|OpenAI|Ollama|historique|favoris|profil enseignant/i);
    expect(text.match(/Vercel/g)).toHaveLength(2);
    expect(text).toContain('L\'hébergeur du site : Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis (https://vercel.com).');
  });

  it('prudente : aucune durée de conservation inventée pour les journaux ; l’hébergeur est celui que le build donne', async () => {
    const { text } = await privacyText();
    expect(text).toContain('la durée de conservation est fixée par l\'hébergeur');
    expect(text).not.toMatch(/\d+\s*(jours?|mois|ans)\b/);
    expect(text).not.toContain('Vercel');
  });

  it('responsable et droits : contact, CNIL', async () => {
    const { text, container } = await privacyText();
    expect(text).toContain('Le responsable du traitement est Association Exemple, éditeur du site, 1 rue de l\'Exemple, 33000 Bordeaux.');
    expect(container.querySelector('a[href="mailto:contact@exemple.fr"]')).not.toBeNull();
    expect(container.querySelector('a[href="https://www.cnil.fr/fr/plaintes"]')).not.toBeNull();
    expect(text).toContain('droit d\'accès, de rectification, d\'effacement, de limitation, d\'opposition et de portabilité');
  });

  it('responsable par défaut : Juan Robin, éditeur du site, sans adresse ; droits exercés auprès de juanrobin89@gmail.com', async () => {
    const { text, container } = await privacyText({});
    expect(text).toContain('Le responsable du traitement est Juan Robin, éditeur du site. Contact : juanrobin89@gmail.com.');
    expect(container.querySelectorAll('a[href="mailto:juanrobin89@gmail.com"]').length).toBeGreaterThanOrEqual(2);
  });

  it('transferts hors Union européenne : les garanties annoncées, sans consigne à l’éditeur', async () => {
    const { text } = await privacyText({});
    expect(text).toContain('clauses contractuelles types');
    expect(text).not.toMatch(/à vérifier|avant publication|par l'éditeur/);
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

  it('contact : celui du build, sinon juanrobin89@gmail.com ; limites de responsabilité et licence conservées', async () => {
    const custom = await mount('cgu', FULL);
    expect(custom.container.querySelector('a[href="mailto:contact@exemple.fr"]')).not.toBeNull();
    cleanup();
    const { container } = await mount('cgu');
    expect(container.querySelector('a[href="mailto:juanrobin89@gmail.com"]')).not.toBeNull();
    const text = container.textContent ?? '';
    expect(text).toContain('Dans les limites permises par la loi, l\'éditeur n\'est pas responsable');
    expect(text).toContain('conditions de licence applicables au logiciel sont fournies avec l’application');
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
