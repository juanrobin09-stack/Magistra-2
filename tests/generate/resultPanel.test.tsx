// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import ResultPanel from '@/components/generate/ResultPanel';
import { initialGenerationState, type GenerationState } from '@/lib/generation/state';
import type { GenerationRequest } from '@shared/types';
import { button, cleanup, MemoryStore, render } from '../ui/helpers';

afterEach(cleanup);

const REQ: GenerationRequest = { type: 'cours', niveau: '4eme', matiere: 'mathematiques', sujet: 'Pythagore', researchMode: 'documents' };

function panel(state: GenerationState, onStop = vi.fn(), onRestart = vi.fn()) {
  return render(
    <MemoryRouter>
      <ResultPanel state={state} mode="demo" store={new MemoryStore()} onStop={onStop} onRestart={onRestart} />
    </MemoryRouter>,
  );
}

async function clickWithDetail(el: Element | null, detail: number) {
  if (!el) throw new Error('bouton introuvable');
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }));
  });
}

describe('ResultPanel — « Arrêter » et « Recommencer » au même endroit', () => {
  it('le second clic d’un double-clic est ignoré (pas d’action inverse)', async () => {
    const onStop = vi.fn();
    const onRestart = vi.fn();
    const running: GenerationState = { ...initialGenerationState(), phase: 'running', runId: 1, request: REQ };
    const { container } = await panel(running, onStop, onRestart);
    await clickWithDetail(button(container, 'Arrêter'), 1);
    await clickWithDetail(button(container, 'Arrêter'), 2);
    expect(onStop).toHaveBeenCalledOnce();

    const aborted: GenerationState = { ...running, phase: 'aborted' };
    const view = await panel(aborted, onStop, onRestart);
    await clickWithDetail(button(view.container, 'Recommencer'), 2);
    expect(onRestart).not.toHaveBeenCalled();
    // Clavier (detail = 0) et clic simple restent actifs.
    await clickWithDetail(button(view.container, 'Recommencer'), 0);
    expect(onRestart).toHaveBeenCalledOnce();
  });

  it('fin de génération annoncée aux lecteurs d’écran avec l’état d’enregistrement', async () => {
    const done: GenerationState = {
      ...initialGenerationState(), phase: 'done', runId: 1, request: REQ, text: 'Contenu',
      result: { type: 'done', content: 'Contenu', sources: [], truncated: false, internetUsed: false, saved: true, id: 'x', model: 'm' },
    };
    const { container } = await panel(done);
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe('Génération terminée, contenu enregistré.');
  });
});
