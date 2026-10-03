// @vitest-environment jsdom
import { act, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { getSujetSuggestions } from '@shared/suggestions';
import type { NiveauScolaire } from '@shared/levels';
import type { TeacherProfile } from '@shared/types';
import GenerateFormFields from '@/components/generate/GenerateFormFields';
import { createInitialForm, validateForm, type GenerateForm } from '@/lib/generation/request';
import { button, cleanup, click, render } from '../ui/helpers';

afterEach(cleanup);

const PROFILE: TeacherProfile = { displayName: '', etablissement: '', cycle: 'college', niveaux: ['4eme'], matierePrincipale: 'mathematiques' };

let latest: GenerateForm;

function Harness({ initial }: { initial: GenerateForm }) {
  const [form, setForm] = useState(initial);
  latest = form;
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

const chips = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="Suggestions de sujets"] button[aria-label^="Utiliser la suggestion"]'));
const texts = (container: HTMLElement) => chips(container).map(b => b.textContent ?? '');

describe('idées de sujets du formulaire', () => {
  it('6 idées de la classe, stables quand on tape puis efface le sujet', async () => {
    const { container } = await render(<Harness initial={createInitialForm(PROFILE)} />);
    const all = getSujetSuggestions('mathematiques', '4eme');
    expect(all.length).toBeGreaterThan(6);
    const first = texts(container);
    expect(first).toHaveLength(6);
    for (const s of first) expect(all).toContain(s);
    expect(new Set(first).size).toBe(6);

    // Le sujet saisi masque les idées ; l'effacer rend les mêmes (pas de nouveau tirage).
    const input = container.querySelector<HTMLInputElement>('#gen-sujet')!;
    await click(chips(container)[0]);
    expect(latest.sujet).toBe(first[0]);
    expect(chips(container)).toHaveLength(0);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(texts(container)).toEqual(first);
  });

  it('« Autres idées » renouvelle les 6 idées sans répéter les précédentes tant qu’il en reste', async () => {
    const { container } = await render(<Harness initial={createInitialForm(PROFILE)} />);
    const all = getSujetSuggestions('mathematiques', '4eme');
    const seen = new Set(texts(container));
    const more = button(container, /Autres idées/);
    expect(more).not.toBeNull();
    const rounds = Math.floor(all.length / 6) - 1;
    for (let i = 0; i < Math.min(rounds, 3); i++) {
      await click(button(container, /Autres idées/));
      const next = texts(container);
      expect(next).toHaveLength(6);
      expect(new Set(next).size).toBe(6);
      for (const s of next) {
        expect(seen.has(s), s).toBe(false);
        seen.add(s);
      }
    }
    // Épuisement : la série repart, toujours 6 idées distinctes.
    for (let i = 0; i < 12; i++) await click(button(container, /Autres idées/));
    expect(new Set(texts(container)).size).toBe(6);
  });

  it('cliquer une idée remplit le champ « Sujet » (nom accessible inchangé)', async () => {
    const { container } = await render(<Harness initial={createInitialForm(PROFILE)} />);
    const [chip] = chips(container);
    const text = chip.textContent ?? '';
    expect(chip.getAttribute('aria-label')).toBe(`Utiliser la suggestion « ${text} »`);
    await click(chip);
    expect(latest.sujet).toBe(text);
    expect(container.querySelector<HTMLInputElement>('#gen-sujet')!.value).toBe(text);
  });

  it('matière sans idée pour cette classe : pas de bouton « Autres idées » superflu', async () => {
    const form = { ...createInitialForm(PROFILE), niveau: 'cp' as const, matiere: 'sciences_primaire' as const };
    const { container } = await render(<Harness initial={form} />);
    expect(chips(container)).toHaveLength(0);
    expect(button(container, /Autres idées/)).toBeNull();
  });
});

describe('rappel : ne pas saisir de données d’élèves', () => {
  const html = async (patch: Partial<GenerateForm>) => {
    const { container } = await render(<Harness initial={{ ...createInitialForm(PROFILE), ...patch }} />);
    return container.textContent ?? '';
  };

  it('affiché pour la lettre aux parents, le corrigé et les appréciations, sans changer les exemples', async () => {
    expect(await html({ type: 'lettre_parents' })).toContain("N'indiquez ni nom, ni prénom, ni information permettant d'identifier un élève");
    expect(await html({ type: 'corrige' })).toContain("après avoir retiré son nom");
    expect(await html({ type: 'appreciations' })).toContain("N'indiquez ni nom, ni prénom");
    const form = createInitialForm(PROFILE, { type: 'lettre_parents' });
    const { container } = await render(<Harness initial={form} />);
    expect(container.querySelector<HTMLTextAreaElement>('#gen-consignes')!.placeholder).toBe("Ex : l'élève a été absent 5 fois ce mois-ci sans justificatif…");
  });

  it('absent des autres outils ; « étudiant » dans le supérieur', async () => {
    expect(await html({ type: 'cours' })).not.toContain("N'indiquez ni nom");
    expect(await html({ type: 'lettre_parents', niveau: 'licence_2', matiere: 'autre' })).toContain("identifier un étudiant");
  });
});
