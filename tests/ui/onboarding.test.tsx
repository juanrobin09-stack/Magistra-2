// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { TeacherProfile } from '@shared/types';
import OnboardingPage from '@/pages/OnboardingPage';
import { RuntimeContext } from '@/lib/runtime/context';
import type { RuntimeValue } from '@/lib/runtime/types';
import { button, cleanup, click, fakeRuntime, flush, MemoryStore, render, typeInto } from './helpers';

afterEach(cleanup);

async function mount(runtime: RuntimeValue, url = '/onboarding') {
  return render(
    <RuntimeContext.Provider value={runtime}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/app" element={<p>PAGE APP</p>} />
          <Route path="/app/settings" element={<p>PAGE REGLAGES</p>} />
        </Routes>
      </MemoryRouter>
    </RuntimeContext.Provider>,
  );
}

const pressed = (root: ParentNode, label: string) =>
  Array.from(root.querySelectorAll('button[aria-pressed="true"]')).some(b => b.textContent?.includes(label));

describe('Onboarding — première configuration', () => {
  it('maternelle : la matière par défaut est un domaine de maternelle, jamais « français »', async () => {
    const store = new MemoryStore();
    const { container } = await mount(fakeRuntime(store));
    await click(button(container, /Continuer/)); // Bienvenue → Établissement
    await click(button(container, /Continuer/)); // Établissement (facultatif) → Niveaux
    await click(button(container, /Maternelle/));
    await click(button(container, /Petite Section \(PS\)/));
    await click(button(container, /Continuer/)); // → Matières
    expect(pressed(container, 'Développement et structuration du langage — Oral')).toBe(true);
    expect(container.textContent).not.toContain('Français');
    await click(button(container, /Continuer/)); // → Récapitulatif
    await click(button(container, /Commencer à générer/));
    await flush();
    const saved = store.calls.find(c => c.method === 'saveProfile')!.args[0] as TeacherProfile;
    expect(saved.matierePrincipale).toBe('langage_oral');
    expect(saved.niveaux).toEqual(['maternelle_ps']);
    expect(saved.cycle).toBe('maternelle');
    expect(container.textContent).toContain('PAGE APP');
  });

  it('les niveaux sont obligatoires : pas de « Passer », « Continuer » désactivé', async () => {
    const store = new MemoryStore();
    const { container } = await mount(fakeRuntime(store));
    // Bienvenue : pas de lien « Passer » (il ne saute plus tout l'onboarding)
    expect(button(container, /Passer cette étape/)).toBeNull();
    await click(button(container, /Continuer/));
    // Établissement : facultatif, peut être passé
    expect(button(container, /Passer cette étape/)).not.toBeNull();
    await click(button(container, /Passer cette étape/));
    // Niveaux : obligatoires
    expect(container.textContent).toContain('Vos niveaux');
    expect(button(container, /Passer cette étape/)).toBeNull();
    expect(button(container, /Continuer/)!.disabled).toBe(true);
    await click(button(container, /Collège/));
    expect(button(container, /Continuer/)!.disabled).toBe(true);
    await click(button(container, /^6ème$/));
    expect(button(container, /Continuer/)!.disabled).toBe(false);
    expect(store.calls.some(c => c.method === 'saveProfile')).toBe(false);
  });

  it('changer de cycle revalide la matière ; matière secondaire et discipline enregistrées', async () => {
    const store = new MemoryStore();
    const { container } = await mount(fakeRuntime(store));
    await click(button(container, /Continuer/));
    await click(button(container, /Continuer/));
    await click(button(container, /Collège/));
    await click(button(container, /^4ème$/));
    await click(button(container, /Continuer/));
    // Choix explicite de SVT au collège
    await click(button(container, /SVT/));
    expect(pressed(container, 'SVT')).toBe(true);
    // Retour aux niveaux : passage au supérieur (SVT n'y existe pas)
    await click(button(container, /Retour/));
    await click(button(container, /Supérieur/));
    await click(button(container, /^Master 1$/));
    await click(button(container, /Continuer/));
    expect(pressed(container, 'SVT')).toBe(false);
    expect(container.querySelectorAll('button[aria-pressed="true"]').length).toBe(1);
    // Matière principale : Droit ; secondaire : Économie ; discipline libre
    await click(button(container, /Droit$/));
    const secondaryTrigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;
    await click(secondaryTrigger);
    const eco = Array.from(document.querySelectorAll('[role="option"]')).find(o => o.textContent?.includes('Économie'))!;
    await click(eco);
    await typeInto(container.querySelector<HTMLInputElement>('#onb-discipline'), '  Droit du numérique ');
    await click(button(container, /Continuer/));
    expect(container.textContent).toContain('Droit du numérique');
    await click(button(container, /Commencer à générer/));
    await flush();
    const saved = store.calls.find(c => c.method === 'saveProfile')!.args[0] as TeacherProfile;
    expect(saved).toMatchObject({
      cycle: 'superieur',
      niveaux: ['master_1'],
      matierePrincipale: 'droit',
      matiereSecondaire: 'economie',
      discipline: 'Droit du numérique',
    });
  });
});

describe('Onboarding — mode édition', () => {
  const existing: TeacherProfile = {
    displayName: 'Mme Durand',
    etablissement: 'Université de Bordeaux',
    cycle: 'superieur',
    niveaux: ['licence_3', 'master_1'],
    matierePrincipale: 'systemes_information',
    discipline: 'Gouvernance des SI',
  };

  it('pré-remplit le profil ; « Annuler » revient aux Réglages sans rien enregistrer', async () => {
    const store = new MemoryStore([], existing);
    const { container } = await mount(fakeRuntime(store), '/onboarding?edit=1');
    const etab = container.querySelector<HTMLInputElement>('#onb-etablissement')!;
    expect(etab.value).toBe('Université de Bordeaux');
    await typeInto(etab, 'Autre établissement');
    await click(button(container, 'Annuler'));
    expect(container.textContent).toContain('PAGE REGLAGES');
    expect(store.calls.some(c => c.method === 'saveProfile')).toBe(false);
    expect(store.profile).toEqual(existing);
  });

  it('« Enregistrer » sauvegarde les modifications puis ouvre /app', async () => {
    const store = new MemoryStore([], existing);
    const { container } = await mount(fakeRuntime(store), '/onboarding?edit=1');
    await typeInto(container.querySelector<HTMLInputElement>('#onb-nom'), 'Pr Durand');
    await click(button(container, /Continuer/)); // → Niveaux (pré-remplis)
    expect(pressed(container, 'Licence 3')).toBe(true);
    expect(pressed(container, 'Master 1')).toBe(true);
    await click(button(container, /Continuer/)); // → Matières
    expect(pressed(container, "Systèmes d'information")).toBe(true);
    expect(container.querySelector<HTMLInputElement>('#onb-discipline')!.value).toBe('Gouvernance des SI');
    await click(button(container, /Continuer/));
    await click(button(container, /Enregistrer/));
    await flush();
    expect(store.profile).toMatchObject({ ...existing, displayName: 'Pr Durand' });
    expect(container.textContent).toContain('PAGE APP');
  });

  it('un profil existant n’est jamais écrasé sans action explicite (/onboarding sans ?edit)', async () => {
    const store = new MemoryStore([], existing);
    const { container } = await mount(fakeRuntime(store));
    // Mode édition implicite : pré-rempli, bouton « Annuler » vers /app
    expect(container.querySelector<HTMLInputElement>('#onb-etablissement')!.value).toBe('Université de Bordeaux');
    await click(button(container, 'Annuler'));
    expect(container.textContent).toContain('PAGE APP');
    expect(store.calls.some(c => c.method === 'saveProfile')).toBe(false);
  });

  it('corrige un ancien profil incohérent (« français » en maternelle)', async () => {
    const legacy: TeacherProfile = { displayName: '', etablissement: 'École', cycle: 'maternelle', niveaux: ['maternelle_gs'], matierePrincipale: 'francais' };
    const store = new MemoryStore([], legacy);
    const { container } = await mount(fakeRuntime(store), '/onboarding?edit=1');
    await click(button(container, /Continuer/));
    await click(button(container, /Continuer/));
    await click(button(container, /Continuer/));
    await click(button(container, /Enregistrer/));
    await flush();
    expect(store.profile?.matierePrincipale).toBe('langage_oral');
  });

  it('erreur d’enregistrement : message visible, profil conservé', async () => {
    const store = new MemoryStore([], existing);
    store.failures.saveProfile = 1;
    const { container } = await mount(fakeRuntime(store), '/onboarding?edit=1');
    await click(button(container, /Continuer/));
    await click(button(container, /Continuer/));
    await click(button(container, /Continuer/));
    await click(button(container, /Enregistrer/));
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Enregistrement impossible');
    expect(container.textContent).not.toContain('PAGE APP');
    expect(store.profile).toEqual(existing);
  });
});
