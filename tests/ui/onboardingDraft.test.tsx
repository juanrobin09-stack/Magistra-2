// @vitest-environment jsdom
// Assistant d'accueil : le profil en cours de saisie et l'étape courante survivent à la lecture d'une page légale dans
// l'application Windows (où les nouveaux onglets sont refusés, donc où l'assistant est quitté). Le brouillon vit dans
// le sessionStorage de l'onglet, est revalidé à la relecture et disparaît à la validation, à l'abandon, au changement
// de compte.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { TeacherProfile } from '@shared/types';
import LegalPage from '@/pages/LegalPage';
import OnboardingPage from '@/pages/OnboardingPage';
import { ONBOARDING_DRAFT_KEY } from '@/lib/onboardingDraft';
import { RuntimeContext } from '@/lib/runtime/context';
import { setRuntimeConfig } from '@/lib/runtime/mode';
import type { RuntimeMode } from '@/lib/runtime/types';
import { button, byText, cleanup, click, fakeRuntime, flush, MemoryStore, render, typeInto } from './helpers';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setRuntimeConfig(null);
  sessionStorage.clear();
});

interface Options {
  mode?: RuntimeMode;
  user?: { id: string } | null;
  profile?: TeacherProfile | null;
  url?: string;
  store?: MemoryStore;
}

async function mount({ mode = 'local', user = null, profile = null, url = '/onboarding', store = new MemoryStore([], profile) }: Options = {}) {
  setRuntimeConfig({ mode, ...(mode === 'web' ? { clerkPublishableKey: 'pk_test_x' } : {}) });
  const view = await render(
    <RuntimeContext.Provider value={fakeRuntime(store, { mode, user })}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/" element={<p>PAGE ACCUEIL</p>} />
          <Route path="/app" element={<p>PAGE APP</p>} />
          <Route path="/app/settings" element={<p>PAGE REGLAGES</p>} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/confidentialite" element={<LegalPage page="confidentialite" />} />
        </Routes>
      </MemoryRouter>
    </RuntimeContext.Provider>,
  );
  return { ...view, store };
}

/** Rouvre l'assistant (autre visite de la page) : le sessionStorage de l'onglet est conservé. */
async function reopen(options: Options = {}) {
  cleanup();
  return mount(options);
}

const pressed = (root: ParentNode, label: string) =>
  Array.from(root.querySelectorAll('button[aria-pressed="true"]')).some(b => b.textContent?.includes(label));
const heading = (root: ParentNode) => root.querySelector('h1, h2')?.textContent ?? '';
const field = (root: ParentNode, id: string) => root.querySelector<HTMLInputElement>(`#${id}`)!;
const stored = () => sessionStorage.getItem(ONBOARDING_DRAFT_KEY);
const storedDraft = () => JSON.parse(stored()!) as Record<string, unknown>;
const KNOWN_KEYS = ['cycle', 'discipline', 'displayName', 'etablissement', 'matiereChoisie', 'matiereSecondaire', 'niveaux', 'owner', 'step'];
const legalLink = (root: ParentNode) => root.querySelector<HTMLAnchorElement>('a[href="/confidentialite"]');

/** Remplit l'assistant jusqu'à l'étape « Matières » (étape 3). */
async function fillToMatieres(container: HTMLElement) {
  await click(button(container, /Continuer/)); // Bienvenue → Établissement
  await typeInto(field(container, 'onb-etablissement'), 'Collège Victor Hugo');
  await typeInto(field(container, 'onb-nom'), 'Mme Dupont');
  await click(button(container, /Continuer/)); // → Niveaux
  await click(button(container, /Collège/));
  await click(button(container, /^6ème$/));
  await click(button(container, /^4ème$/));
  await click(button(container, /Continuer/)); // → Matières
  await click(button(container, /SVT/));
  await click(container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]'));
  await click(Array.from(document.querySelectorAll('[role="option"]')).find(o => o.textContent?.includes('Mathématiques'))!);
  await typeInto(field(container, 'onb-discipline'), 'Section européenne');
}

describe('Assistant d\'accueil — page légale lue dans l\'application Windows', () => {
  it('saisie → lien légal → retour : mêmes valeurs, même étape, puis enregistrement', async () => {
    const { container, store } = await mount({ mode: 'local' });
    await fillToMatieres(container);
    expect(heading(container)).toContain('Vos matières');

    await click(legalLink(container));
    expect(container.querySelector('h1')?.textContent).toBe('Politique de confidentialité');
    expect(container.textContent).not.toContain('Vos matières');

    await click(byText(container, 'a', 'Retour'));
    expect(heading(container)).toContain('Vos matières');
    expect(pressed(container, 'SVT')).toBe(true);
    expect(field(container, 'onb-discipline').value).toBe('Section européenne');
    await click(button(container, /Retour/)); // ← Niveaux
    expect(pressed(container, 'Collège')).toBe(true);
    expect(pressed(container, '6ème')).toBe(true);
    expect(pressed(container, '4ème')).toBe(true);
    await click(button(container, /Retour/)); // ← Établissement
    expect(field(container, 'onb-etablissement').value).toBe('Collège Victor Hugo');
    expect(field(container, 'onb-nom').value).toBe('Mme Dupont');

    await click(button(container, /Continuer/));
    await click(button(container, /Continuer/));
    await click(button(container, /Continuer/)); // → Récapitulatif
    await click(button(container, /Commencer à générer/));
    await flush();
    expect(store.profile).toMatchObject({
      displayName: 'Mme Dupont',
      etablissement: 'Collège Victor Hugo',
      cycle: 'college',
      niveaux: ['6eme', '4eme'],
      matierePrincipale: 'svt',
      matiereSecondaire: 'mathematiques',
      discipline: 'Section européenne',
    });
    expect(container.textContent).toContain('PAGE APP');
    expect(stored()).toBeNull();
  });

  it('plusieurs allers-retours vers les pages légales : rien ne se perd', async () => {
    const { container } = await mount({ mode: 'local' });
    await click(button(container, /Continuer/));
    await typeInto(field(container, 'onb-etablissement'), 'Lycée Test');
    for (let i = 0; i < 3; i++) {
      await click(legalLink(container));
      expect(container.querySelector('h1')?.textContent).toBe('Politique de confidentialité');
      await click(byText(container, 'a', 'Retour'));
      expect(field(container, 'onb-etablissement').value).toBe('Lycée Test');
    }
  });

  it('seuls les champs du profil, l\'étape et le propriétaire sont écrits', async () => {
    const { container } = await mount({ mode: 'local' });
    await fillToMatieres(container);
    expect(Object.keys(storedDraft()).sort()).toEqual(KNOWN_KEYS);
    expect(storedDraft()).toMatchObject({
      owner: null,
      step: 3,
      displayName: 'Mme Dupont',
      etablissement: 'Collège Victor Hugo',
      cycle: 'college',
      niveaux: ['6eme', '4eme'],
      matiereChoisie: 'svt',
      matiereSecondaire: 'mathematiques',
      discipline: 'Section européenne',
    });
  });

  it('étape finale restituée telle quelle', async () => {
    const { container } = await mount({ mode: 'local' });
    await fillToMatieres(container);
    await click(button(container, /Continuer/)); // → Récapitulatif
    await click(legalLink(container));
    await click(byText(container, 'a', 'Retour'));
    expect(heading(container)).toContain('Votre espace est prêt');
    expect(container.textContent).toContain('Collège Victor Hugo');
    expect(container.textContent).toContain('Section européenne');
  });
});

describe('Assistant d\'accueil — site web (nouvel onglet) et changement de compte', () => {
  it('site web : les liens s\'ouvrent toujours dans un nouvel onglet, l\'assistant reste en place', async () => {
    const { container } = await mount({ mode: 'web', user: { id: 'user_1' } });
    await click(button(container, /Continuer/));
    await typeInto(field(container, 'onb-etablissement'), 'Collège Test');
    const link = legalLink(container)!;
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    await click(link);
    expect(field(container, 'onb-etablissement').value).toBe('Collège Test');
  });

  it('même compte : le brouillon est restitué à la réouverture (étape et champs)', async () => {
    const { container } = await mount({ mode: 'web', user: { id: 'user_1' } });
    await click(button(container, /Continuer/));
    await typeInto(field(container, 'onb-etablissement'), 'Collège Test');
    await click(button(container, /Continuer/));
    await click(button(container, /Supérieur/));
    const again = await reopen({ mode: 'web', user: { id: 'user_1' } });
    expect(heading(again.container)).toContain('Vos niveaux');
    expect(pressed(again.container, 'Supérieur')).toBe(true);
    await click(button(again.container, /Retour/));
    expect(field(again.container, 'onb-etablissement').value).toBe('Collège Test');
  });

  it('autre compte sur le même onglet : le brouillon n\'est jamais restitué et il est effacé', async () => {
    const { container } = await mount({ mode: 'web', user: { id: 'user_1' } });
    await click(button(container, /Continuer/));
    await typeInto(field(container, 'onb-etablissement'), 'Collège de la collègue');
    await typeInto(field(container, 'onb-nom'), 'Mme Dupont');
    const other = await reopen({ mode: 'web', user: { id: 'user_2' } });
    expect(heading(other.container)).toContain('Bienvenue');
    await click(button(other.container, /Continuer/));
    expect(field(other.container, 'onb-etablissement').value).toBe('');
    expect(field(other.container, 'onb-nom').value).toBe('');
    expect(stored()).not.toContain('collègue');
    expect(stored()).not.toContain('Dupont');
    expect(storedDraft().owner).toBe('user_2');
  });
});

describe('Assistant d\'accueil — brouillon corrompu ou hostile', () => {
  it.each(['{"owner":null,"step":', 'pas du json', '[]', 'null', '"x"', '12'])('contenu illisible (%s) : assistant neuf, aucune erreur', async raw => {
    sessionStorage.setItem(ONBOARDING_DRAFT_KEY, raw);
    const { container } = await mount({ mode: 'local' });
    expect(heading(container)).toContain('Bienvenue');
    await click(button(container, /Continuer/));
    expect(field(container, 'onb-etablissement').value).toBe('');
    // Le brouillon illisible est remplacé par celui de la session courante.
    expect(Object.keys(storedDraft()).sort()).toEqual(KNOWN_KEYS);
  });

  it('contenu hostile : valeurs revalidées, bornées, rien d\'étranger relu ni réécrit', async () => {
    sessionStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify({
      owner: null,
      step: 1,
      displayName: `<img src=x onerror="document.title='piraté'">${'N'.repeat(500)}`,
      etablissement: `Collège\u0000\nTest${'E'.repeat(2000)}`,
      cycle: '__proto__',
      niveaux: ['__proto__', 'master_1', 7],
      matiereChoisie: '<script>',
      matiereSecondaire: 'constructor',
      discipline: 'D'.repeat(1000),
      token: 'jeton-secret',
      apiKey: 'sk-secret',
      generations: [{ contenu: 'texte généré' }],
    }));
    const { container } = await mount({ mode: 'local' });
    expect(heading(container)).toContain('Votre établissement');
    expect(field(container, 'onb-nom').value).toHaveLength(80);
    expect(field(container, 'onb-etablissement').value).toHaveLength(160);
    expect(field(container, 'onb-etablissement').value).not.toMatch(/[\u0000-\u001f]/); // eslint-disable-line no-control-regex
    expect(container.querySelector('img')).toBeNull();
    expect(document.title).not.toBe('piraté');
    // Cycle inconnu : aucun niveau retenu, l'étape « Niveaux » reste obligatoire.
    await click(button(container, /Continuer/));
    expect(container.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(0);
    expect(button(container, /Continuer/)!.disabled).toBe(true);
    expect(Object.keys(storedDraft()).sort()).toEqual(KNOWN_KEYS);
    expect(stored()).not.toContain('secret');
    expect(stored()).not.toContain('texte généré');
  });

  it('étape finale sans niveau dans le brouillon : ramenée à « Niveaux »', async () => {
    sessionStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify({
      owner: null, step: 4, displayName: '', etablissement: '', cycle: 'college', niveaux: ['inconnu'], matiereChoisie: null, matiereSecondaire: null, discipline: '',
    }));
    const { container } = await mount({ mode: 'local' });
    expect(heading(container)).toContain('Vos niveaux');
    expect(button(container, /Continuer/)!.disabled).toBe(true);
  });

  it('étape hors bornes : ramenée à la dernière étape', async () => {
    sessionStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify({
      owner: null, step: 99, displayName: 'Mme X', etablissement: '', cycle: 'college', niveaux: ['6eme'], matiereChoisie: null, matiereSecondaire: null, discipline: '',
    }));
    const { container } = await mount({ mode: 'local' });
    expect(heading(container)).toContain('Votre espace est prêt');
  });
});

describe('Assistant d\'accueil — stockage de session indisponible', () => {
  const denied = () => {
    throw new DOMException('Accès refusé', 'SecurityError');
  };

  it('lecture et écriture refusées : l\'assistant fonctionne et enregistre le profil', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(denied);
    const { container, store } = await mount({ mode: 'local' });
    await click(button(container, /Continuer/));
    await click(button(container, /Continuer/));
    await click(button(container, /Maternelle/));
    await click(button(container, /Petite Section \(PS\)/));
    await click(button(container, /Continuer/));
    await click(button(container, /Continuer/));
    await click(button(container, /Commencer à générer/));
    await flush();
    expect(store.profile?.niveaux).toEqual(['maternelle_ps']);
    expect(container.textContent).toContain('PAGE APP');
  });

  it('sans brouillon possible, le lien légal fait repartir l\'assistant de zéro, sans erreur', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied);
    const { container } = await mount({ mode: 'local' });
    await click(button(container, /Continuer/));
    await typeInto(field(container, 'onb-etablissement'), 'Collège Test');
    await click(legalLink(container));
    await click(byText(container, 'a', 'Retour'));
    expect(heading(container)).toContain('Bienvenue');
  });

  it('accès à sessionStorage lui-même refusé : aucune erreur', async () => {
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(denied);
    const { container } = await mount({ mode: 'local' });
    expect(heading(container)).toContain('Bienvenue');
    await click(button(container, /Continuer/));
    await typeInto(field(container, 'onb-etablissement'), 'Collège Test');
    await click(button(container, /Continuer/));
    expect(heading(container)).toContain('Vos niveaux');
  });
});

describe('Assistant d\'accueil — brouillon effacé', () => {
  it('à la validation du profil', async () => {
    const { container } = await mount({ mode: 'local' });
    await click(button(container, /Continuer/));
    await typeInto(field(container, 'onb-etablissement'), 'Collège Test');
    expect(stored()).not.toBeNull();
    await click(button(container, /Continuer/));
    await click(button(container, /Maternelle/));
    await click(button(container, /Petite Section \(PS\)/));
    await click(button(container, /Continuer/));
    await click(button(container, /Continuer/));
    await click(button(container, /Commencer à générer/));
    await flush();
    expect(container.textContent).toContain('PAGE APP');
    expect(stored()).toBeNull();
  });

  it('échec de l\'enregistrement : le brouillon est conservé, effacé à la réussite suivante', async () => {
    const store = new MemoryStore();
    store.failures.saveProfile = 1;
    const { container } = await mount({ mode: 'local', store });
    await click(button(container, /Continuer/));
    await click(button(container, /Continuer/));
    await click(button(container, /Maternelle/));
    await click(button(container, /Petite Section \(PS\)/));
    await click(button(container, /Continuer/));
    await click(button(container, /Continuer/));
    await click(button(container, /Commencer à générer/));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Enregistrement impossible');
    expect(stored()).not.toBeNull();
    await click(button(container, /Commencer à générer/));
    await flush();
    expect(store.profile?.niveaux).toEqual(['maternelle_ps']);
    expect(stored()).toBeNull();
  });

  it('à l\'abandon : « Présentation » (premier lancement de l\'application Windows)', async () => {
    const { container } = await mount({ mode: 'local' });
    await click(button(container, /Continuer/));
    await typeInto(field(container, 'onb-etablissement'), 'Collège Test');
    await click(button(container, /Retour/)); // ← Bienvenue
    expect(stored()).not.toBeNull();
    await click(byText(container, 'a', '← Présentation'));
    expect(container.textContent).toContain('PAGE ACCUEIL');
    expect(stored()).toBeNull();
    const again = await reopen({ mode: 'local' });
    await click(button(again.container, /Continuer/));
    expect(field(again.container, 'onb-etablissement').value).toBe('');
  });

  it('à l\'abandon : « Annuler » efface aussi un brouillon resté dans l\'onglet', async () => {
    const profile: TeacherProfile = { displayName: 'Mme Durand', etablissement: 'Université', cycle: 'superieur', niveaux: ['master_1'], matierePrincipale: 'droit' };
    sessionStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify({
      owner: null, step: 2, displayName: 'Autre', etablissement: 'Autre', cycle: 'college', niveaux: ['6eme'], matiereChoisie: null, matiereSecondaire: null, discipline: '',
    }));
    const { container, store } = await mount({ mode: 'local', profile, url: '/onboarding?edit=1' });
    await click(button(container, 'Annuler'));
    expect(container.textContent).toContain('PAGE REGLAGES');
    expect(stored()).toBeNull();
    expect(store.profile).toEqual(profile);
  });
});

describe('Assistant d\'accueil — modification d\'un profil existant', () => {
  const profile: TeacherProfile = {
    displayName: 'Mme Durand',
    etablissement: 'Université de Bordeaux',
    cycle: 'superieur',
    niveaux: ['licence_3'],
    matierePrincipale: 'droit',
  };

  it('le profil enregistré prime : un brouillon d\'un autre usage n\'est pas restitué', async () => {
    sessionStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify({
      owner: null, step: 3, displayName: 'Autre', etablissement: 'Autre établissement', cycle: 'college', niveaux: ['6eme'], matiereChoisie: null, matiereSecondaire: null, discipline: '',
    }));
    const { container } = await mount({ mode: 'local', profile, url: '/onboarding?edit=1' });
    expect(field(container, 'onb-etablissement').value).toBe('Université de Bordeaux');
    expect(field(container, 'onb-nom').value).toBe('Mme Durand');
  });

  it('les modifications en cours ne sont pas écrites dans le brouillon', async () => {
    const { container } = await mount({ mode: 'local', profile, url: '/onboarding?edit=1' });
    await typeInto(field(container, 'onb-etablissement'), 'Autre établissement');
    expect(stored()).toBeNull();
  });
});
