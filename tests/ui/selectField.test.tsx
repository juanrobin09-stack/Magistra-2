// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import SelectField, { type SelectGroup, type SelectOption } from '@/components/ui/SelectField';
import { cleanup, click, keyDown, render } from './helpers';

const OPTIONS: SelectOption[] = [
  { value: 'francais', label: 'Français', prefix: '📖' },
  { value: 'mathematiques', label: 'Mathématiques', prefix: '🔢' },
  { value: 'histoire', label: 'Histoire' },
  { value: 'musique', label: 'Musique' },
  { value: 'maths_expertes', label: 'Maths expertes' },
];

function Controlled({ onChange, initial = 'francais', ...rest }: { onChange?: (v: string) => void; initial?: string; groups?: SelectGroup[] }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <span id="label-matiere">Matière</span>
      <SelectField
        value={value}
        onChange={v => {
          setValue(v);
          onChange?.(v);
        }}
        options={rest.groups ? undefined : OPTIONS}
        groups={rest.groups}
        ariaLabelledBy="label-matiere"
      />
      <button type="button">Après</button>
    </>
  );
}

const trigger = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;
const listbox = () => document.querySelector<HTMLElement>('[role="listbox"]');
const activeOption = () => {
  const id = listbox()?.getAttribute('aria-activedescendant');
  return id ? document.getElementById(id) : null;
};

afterEach(cleanup);

describe('SelectField — rôles ARIA', () => {
  it('expose un bouton aria-haspopup="listbox" relié à la listbox', async () => {
    const { container } = await render(<Controlled />);
    const btn = trigger(container);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBeTruthy();
    // Nom accessible = libellé + valeur courante
    const labelledBy = btn.getAttribute('aria-labelledby')!.split(' ');
    expect(labelledBy[0]).toBe('label-matiere');
    expect(document.getElementById(labelledBy[1])?.textContent).toBe('📖 Français');
    expect(listbox()).toBeNull();

    await click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    const lb = listbox()!;
    expect(lb).not.toBeNull();
    expect(lb.id).toBe(btn.getAttribute('aria-controls'));
    expect(lb.getAttribute('aria-labelledby')).toBe('label-matiere');
    const options = lb.querySelectorAll('[role="option"]');
    expect(options).toHaveLength(OPTIONS.length);
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(options[1].getAttribute('aria-selected')).toBe('false');
    // Le focus passe dans la liste, l'option active est l'option sélectionnée
    expect(document.activeElement).toBe(lb);
    expect(activeOption()?.textContent).toContain('Français');
  });

  it('regroupe les options (role="group" étiqueté)', async () => {
    const groups: SelectGroup[] = [
      { label: 'Collège', options: [{ value: '6eme', label: '6ème' }, { value: '5eme', label: '5ème' }] },
      { label: 'Supérieur', options: [{ value: 'licence_1', label: 'Licence 1' }] },
    ];
    const { container } = await render(<Controlled groups={groups} initial="licence_1" />);
    await click(trigger(container));
    const groupEls = document.querySelectorAll('[role="group"]');
    expect(groupEls).toHaveLength(2);
    const labelId = groupEls[1].getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelId)?.textContent).toBe('Supérieur');
    // Index globaux cohérents : l'option active est bien « Licence 1 »
    expect(activeOption()?.textContent).toContain('Licence 1');
    expect(activeOption()?.getAttribute('aria-selected')).toBe('true');
  });
});

describe('SelectField — clavier', () => {
  it('Flèche bas ouvre, flèches déplacent, Entrée sélectionne et rend le focus au bouton', async () => {
    const onChange = vi.fn();
    const { container } = await render(<Controlled onChange={onChange} />);
    const btn = trigger(container);
    btn.focus();
    await keyDown(btn, 'ArrowDown');
    expect(listbox()).not.toBeNull();
    const lb = listbox()!;
    await keyDown(lb, 'ArrowDown');
    await keyDown(lb, 'ArrowDown');
    expect(activeOption()?.textContent).toContain('Histoire');
    await keyDown(lb, 'ArrowUp');
    expect(activeOption()?.textContent).toContain('Mathématiques');
    await keyDown(lb, 'Enter');
    expect(onChange).toHaveBeenCalledWith('mathematiques');
    expect(listbox()).toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(btn);
    expect(btn.textContent).toContain('Mathématiques');
  });

  it('Échap ferme sans modifier la valeur et rend le focus au bouton', async () => {
    const onChange = vi.fn();
    const { container } = await render(<Controlled onChange={onChange} />);
    const btn = trigger(container);
    await click(btn);
    await keyDown(listbox(), 'ArrowDown');
    const escape = await keyDown(listbox(), 'Escape');
    expect(escape.defaultPrevented).toBe(true);
    expect(listbox()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(btn);
  });

  it('Début / Fin et Espace', async () => {
    const onChange = vi.fn();
    const { container } = await render(<Controlled onChange={onChange} initial="histoire" />);
    await click(trigger(container));
    await keyDown(listbox(), 'End');
    expect(activeOption()?.textContent).toContain('Maths expertes');
    await keyDown(listbox(), 'Home');
    expect(activeOption()?.textContent).toContain('Français');
    await keyDown(listbox(), ' ');
    expect(onChange).toHaveBeenCalledWith('francais');
  });

  it('recherche par première lettre (insensible aux accents), répétition = option suivante', async () => {
    const { container } = await render(<Controlled />);
    await click(trigger(container));
    await keyDown(listbox(), 'm');
    expect(activeOption()?.textContent).toContain('Mathématiques');
    await keyDown(listbox(), 'm');
    expect(activeOption()?.textContent).toContain('Musique');
    await keyDown(listbox(), 'm');
    expect(activeOption()?.textContent).toContain('Maths expertes');
  });

  it('recherche par lettre depuis le bouton fermé : ouvre sur l’option correspondante', async () => {
    const { container } = await render(<Controlled />);
    const btn = trigger(container);
    await keyDown(btn, 'h');
    expect(listbox()).not.toBeNull();
    expect(activeOption()?.textContent).toContain('Histoire');
  });

  it('Tab ferme la liste sans changer la valeur et laisse la tabulation native agir depuis le bouton', async () => {
    const onChange = vi.fn();
    const { container } = await render(<Controlled onChange={onChange} />);
    const btn = trigger(container);
    await click(btn);
    await keyDown(listbox(), 'ArrowDown');
    const tab = await keyDown(listbox(), 'Tab');
    expect(tab.defaultPrevented).toBe(false);
    expect(listbox()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(btn);
  });

  it('se ferme au clic extérieur', async () => {
    const { container } = await render(<Controlled />);
    await click(trigger(container));
    expect(listbox()).not.toBeNull();
    const outside = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Après')!;
    await click(outside);
    expect(listbox()).toBeNull();
  });

  it('clic sur une option : sélection et fermeture', async () => {
    const onChange = vi.fn();
    const { container } = await render(<Controlled onChange={onChange} />);
    await click(trigger(container));
    const opt = Array.from(document.querySelectorAll('[role="option"]')).find(o => o.textContent?.includes('Musique'))!;
    await click(opt);
    expect(onChange).toHaveBeenCalledWith('musique');
    expect(listbox()).toBeNull();
  });

  it('avec ariaLabel seul, le nom du bouton inclut la valeur', async () => {
    const { container } = await render(<SelectField value="histoire" onChange={() => undefined} options={OPTIONS} ariaLabel="Matière" />);
    expect(trigger(container).getAttribute('aria-label')).toBe('Matière : Histoire');
  });
});
