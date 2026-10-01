// @vitest-environment jsdom
// « Autres idées » : les idées sont remplacées sans que le focus bouge. Une région role="status" (masquée à l'écran)
// annonce le renouvellement aux lecteurs d'écran, sur le tableau de bord comme dans le formulaire « Générer ».

import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { NiveauScolaire } from '@shared/levels';
import type { TeacherProfile } from '@shared/types';
import GenerateFormFields from '@/components/generate/GenerateFormFields';
import { createInitialForm, validateForm, type GenerateForm } from '@/lib/generation/request';
import DashboardPage from '@/pages/DashboardPage';
import { RuntimeContext } from '@/lib/runtime/context';
import { button, cleanup, click, fakeRuntime, flush, MemoryStore, PROFILE_COLLEGE, render } from './helpers';

afterEach(cleanup);

function FormHarness({ initial }: { initial: GenerateForm }) {
  const [form, setForm] = useState(initial);
  return (
    <GenerateFormFields
      form={form}
      onChange={patch => setForm(f => ({ ...f, ...patch }))}
      onNiveauChange={(niveau: NiveauScolaire) => setForm(f => ({ ...f, niveau }))}
      problems={validateForm(form)}
      showErrors={false}
    />
  );
}

const statusOf = (root: ParentNode) => root.querySelector<HTMLElement>('[role="status"].sr-only[aria-live="polite"]');

describe('« Autres idées » annoncé aux lecteurs d\'écran', () => {
  it('formulaire : la région existe d\'emblée, vide, puis annonce « 6 nouvelles idées affichées » après le clic', async () => {
    const profile: TeacherProfile = { ...PROFILE_COLLEGE, matierePrincipale: 'mathematiques' };
    const { container } = await render(<FormHarness initial={createInitialForm(profile)} />);
    const region = statusOf(container.querySelector('[aria-label="Suggestions de sujets"]')!);
    expect(region).not.toBeNull();
    expect(region!.textContent).toBe('');

    await click(button(container, /Autres idées/));
    expect(region!.textContent).toBe('6 nouvelles idées affichées');
    // La région annonce aussi le renouvellement suivant : le texte identique est remplacé, pas conservé.
    const first = region!.firstElementChild;
    await click(button(container, /Autres idées/));
    expect(region!.textContent).toBe('6 nouvelles idées affichées');
    expect(region!.firstElementChild).not.toBe(first);
  });

  it('tableau de bord : annonce « 4 nouvelles idées affichées » après le clic', async () => {
    const store = new MemoryStore();
    store.profile = PROFILE_COLLEGE;
    const { container } = await render(
      <RuntimeContext.Provider value={fakeRuntime(store, { profile: PROFILE_COLLEGE })}>
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </RuntimeContext.Provider>,
    );
    await flush();
    const region = statusOf(container.querySelector('section[aria-labelledby="ideas-title"]')!);
    expect(region).not.toBeNull();
    expect(region!.textContent).toBe('');

    await click(button(container, /Autres idées/));
    expect(region!.textContent).toBe('4 nouvelles idées affichées');
    const first = region!.firstElementChild;
    await click(button(container, /Autres idées/));
    expect(region!.textContent).toBe('4 nouvelles idées affichées');
    expect(region!.firstElementChild).not.toBe(first);
  });
});
