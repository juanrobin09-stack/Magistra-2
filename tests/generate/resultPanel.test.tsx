// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import ResultPanel, { LOADING_MODEL_HINT } from '@/components/generate/ResultPanel';
import { initialGenerationState, type GenerationState } from '@/lib/generation/state';
import type { GenerationRequest } from '@shared/types';
import { button, cleanup, MemoryStore, render } from '../ui/helpers';

afterEach(cleanup);

const REQ: GenerationRequest = { type: 'cours', niveau: '4eme', matiere: 'mathematiques', sujet: 'Pythagore', researchMode: 'documents' };

function panel(state: GenerationState, onStop = vi.fn(), onRestart = vi.fn(), mode: 'demo' | 'local' | 'web' = 'demo') {
  return render(
    <MemoryRouter>
      <ResultPanel state={state} mode={mode} store={new MemoryStore()} onStop={onStop} onRestart={onRestart} />
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

describe('ResultPanel — nouvelles étapes et erreurs', () => {
  it('« Chargement du modèle… » : explication de l’attente', async () => {
    const running: GenerationState = {
      ...initialGenerationState(), phase: 'running', runId: 1, request: REQ, stage: 'loading_model', status: 'Chargement du modèle…',
    };
    const { container } = await panel(running);
    expect(container.textContent).toContain('Chargement du modèle…');
    expect(container.textContent).toContain(LOADING_MODEL_HINT);
  });

  it('quota atteint : message avec l’heure de reprise et « Réessayer »', async () => {
    const failed: GenerationState = {
      ...initialGenerationState(), phase: 'error', runId: 1, request: REQ,
      error: { code: 'AI_QUOTA_EXCEEDED', message: 'Quota atteint : nouvel essai possible à 14 h 05.', retryable: true },
    };
    const { container } = await panel(failed, vi.fn(), vi.fn(), 'web');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('14 h 05');
    expect(button(container, 'Réessayer')).not.toBeNull();
  });

  it('moteur trop ancien (Windows) : pas de « Réessayer », lien vers la configuration de l’IA', async () => {
    const failed: GenerationState = {
      ...initialGenerationState(), phase: 'error', runId: 1, request: REQ,
      error: { code: 'ENGINE_OUTDATED', message: 'Le moteur IA (Ollama) est trop ancien pour ce modèle : mettez-le à jour.', retryable: false },
    };
    const { container } = await panel(failed, vi.fn(), vi.fn(), 'local');
    expect(button(container, 'Réessayer')).toBeNull();
    expect(container.querySelector('a[href="/setup"]')).not.toBeNull();
  });
});

describe('ResultPanel — document entouré d’un bloc « ```markdown » par le modèle', () => {
  it('affiché comme un document (titres, listes), pas comme du code', async () => {
    const running: GenerationState = {
      ...initialGenerationState(), phase: 'running', runId: 1, request: REQ,
      text: '```markdown\n# Le théorème de Pythagore\n\n- Niveau : 4e\n',
    };
    const { container } = await panel(running);
    expect(container.querySelector('.prose-content h1')?.textContent).toContain('Le théorème de Pythagore');
    expect(container.querySelector('.prose-content pre')).toBeNull();
  });
});
