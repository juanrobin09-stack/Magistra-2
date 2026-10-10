// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PersonalAPISettings from '@/components/ai/PersonalAPISettings';
import type { AIController } from '@/hooks/useAIStatus';
import type { AIStatus } from '@shared/ipc';
import { MagistraError } from '@shared/errors';
import { PERSONAL_PROVIDERS } from '@shared/ai/personalProviders';
import { makeStatus } from '../ai-ui/fixtures';
import { button, cleanup, click, render, typeInto } from './helpers';

afterEach(cleanup);
const aiFor = (status: AIStatus) => ({ pending: { config: false }, activation: { state: 'idle' }, setConfig: vi.fn(async () => ({ status, error: null })) }) as unknown as AIController;

async function select(container: HTMLElement, value: string) {
  const el = container.querySelector('select')!;
  await act(async () => { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); });
}

describe.each(PERSONAL_PROVIDERS)('réglage $label', preset => {
  it('est accessible sans moteur local et transmet la clé une seule fois, avec la bonne destination', async () => {
    const status = makeStatus({ engine: 'not_installed' });
    const ai = aiFor(status);
    const { container } = await render(<PersonalAPISettings ai={ai} status={status} />);
    await select(container, preset.id);
    const key = container.querySelector<HTMLInputElement>('input[type=password]')!;
    expect(container.textContent).toContain(`envoyés à ${preset.label}`);
    expect(container.textContent).toContain('frais et quotas');
    await typeInto(key, '  test-private-key  ');
    await click(button(container, 'Enregistrer et utiliser l’API'));
    expect(ai.setConfig).toHaveBeenCalledExactlyOnceWith({ mode: 'remote', remote: { kind: preset.kind, baseUrl: preset.baseUrl, model: preset.model, label: preset.label, apiKey: 'test-private-key' } });
    expect(key.value).toBe('');
    expect(container.innerHTML).not.toContain('test-private-key');
  });
});

describe('clé enregistrée et navigation', () => {
  it('conserve la clé pour le même fournisseur, exige une nouvelle clé quand on change et revient au local', async () => {
    const preset = PERSONAL_PROVIDERS[3];
    const status = makeStatus({ mode: 'remote', ready: true });
    status.config.remote = { ...preset, hasApiKey: true };
    const ai = aiFor(status);
    const { container } = await render(<PersonalAPISettings ai={ai} status={status} />);
    expect(container.querySelector('select')!.value).toBe('anthropic');
    await click(button(container, 'Enregistrer et utiliser l’API'));
    expect(ai.setConfig).toHaveBeenLastCalledWith({ mode: 'remote', remote: { kind: preset.kind, baseUrl: preset.baseUrl, model: preset.model, label: preset.label } });
    await select(container, 'gemini');
    await click(button(container, 'Enregistrer et utiliser l’API'));
    expect(ai.setConfig).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Ajoutez votre clé API');
    await click(button(container, 'Utiliser l’IA locale'));
    expect(ai.setConfig).toHaveBeenLastCalledWith({ mode: 'local' });
    await click(button(container, 'Supprimer la clé API'));
    expect(ai.setConfig).toHaveBeenLastCalledWith({ mode: 'local', remote: null });
  });

  it('vide le champ après une erreur et empêche une modification pendant l’enregistrement', async () => {
    const status = makeStatus({ engine: 'not_installed' });
    const ai = aiFor(status);
    vi.mocked(ai.setConfig).mockResolvedValue({ status: null, error: new MagistraError('STORAGE_ERROR', 'Chiffrement indisponible') });
    const view = await render(<PersonalAPISettings ai={ai} status={status} />);
    const key = view.container.querySelector<HTMLInputElement>('input[type=password]')!;
    await typeInto(key, 'test-key');
    await click(button(view.container, 'Enregistrer et utiliser l’API'));
    expect(key.value).toBe('');
    expect(view.container.textContent).toContain('Chiffrement indisponible');
    ai.pending.config = true;
    await view.rerender(<PersonalAPISettings ai={ai} status={status} />);
    expect(view.container.querySelector('fieldset')!.disabled).toBe(true);
    await click(button(view.container, 'Enregistrer et utiliser l’API'));
    expect(ai.setConfig).toHaveBeenCalledTimes(1);
  });
});
