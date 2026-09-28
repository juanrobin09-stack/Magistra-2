// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { button, cleanup, click, keyDown, render } from './helpers';

function Harness({ onConfirm, onCancel, danger = true }: { onConfirm: () => void; onCancel: () => void; danger?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Supprimer…</button>
      <ConfirmDialog
        open={open}
        danger={danger}
        title="Supprimer ce contenu ?"
        message="Cette action est irréversible."
        confirmLabel="Supprimer"
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
        onCancel={() => {
          onCancel();
          setOpen(false);
        }}
      />
    </>
  );
}

const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"], [role="dialog"]');

afterEach(cleanup);

describe('ConfirmDialog', () => {
  it('n’affiche rien quand il est fermé', async () => {
    await render(<ConfirmDialog open={false} title="T" message="M" confirmLabel="OK" onConfirm={() => undefined} onCancel={() => undefined} />);
    expect(dialog()).toBeNull();
  });

  it('dialogue modal étiqueté ; action destructrice : alertdialog et focus sur « Annuler »', async () => {
    const { container } = await render(<Harness onConfirm={vi.fn()} onCancel={vi.fn()} />);
    await click(button(container, 'Supprimer…'));
    const d = dialog()!;
    expect(d.getAttribute('role')).toBe('alertdialog');
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent).toBe('Supprimer ce contenu ?');
    expect(document.getElementById(d.getAttribute('aria-describedby')!)?.textContent).toBe('Cette action est irréversible.');
    expect(document.activeElement?.textContent).toBe('Annuler');
  });

  it('Échap appelle onCancel et rend le focus au déclencheur', async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { container } = await render(<Harness onConfirm={onConfirm} onCancel={onCancel} />);
    const trigger = button(container, 'Supprimer…')!;
    trigger.focus();
    await click(trigger);
    await keyDown(document.activeElement, 'Escape');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('la confirmation appelle onConfirm', async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { container } = await render(<Harness onConfirm={onConfirm} onCancel={onCancel} />);
    await click(button(container, 'Supprimer…'));
    await click(button(dialog()!, 'Supprimer'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('le focus reste piégé dans le dialogue (Tab / Maj+Tab)', async () => {
    const { container } = await render(<Harness onConfirm={vi.fn()} onCancel={vi.fn()} />);
    await click(button(container, 'Supprimer…'));
    const d = dialog()!;
    const cancel = button(d, 'Annuler')!;
    const confirm = button(d, 'Supprimer')!;
    confirm.focus();
    const tab = await keyDown(confirm, 'Tab');
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);
    const shiftTab = await keyDown(cancel, 'Tab', { shiftKey: true });
    expect(shiftTab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(confirm);
  });

  it('dialogue non destructif : role="dialog" et focus sur la confirmation', async () => {
    const { container } = await render(<Harness onConfirm={vi.fn()} onCancel={vi.fn()} danger={false} />);
    await click(button(container, 'Supprimer…'));
    expect(dialog()!.getAttribute('role')).toBe('dialog');
    expect(document.activeElement?.textContent).toBe('Supprimer');
  });

  it('un clic sur le fond annule', async () => {
    const onCancel = vi.fn();
    const { container } = await render(<Harness onConfirm={vi.fn()} onCancel={onCancel} />);
    await click(button(container, 'Supprimer…'));
    const backdrop = dialog()!.parentElement!.querySelector('[aria-hidden="true"]');
    await click(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
