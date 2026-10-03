// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import ResultPanel, { LOADING_MODEL_HINT } from '@/components/generate/ResultPanel';
import { initialGenerationState, type GenerationState } from '@/lib/generation/state';
import type { GenerationRequest, SourceRef } from '@shared/types';
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

describe('ResultPanel — fiabilité des sources citées', () => {
  const sources: SourceRef[] = [
    { n: 1, kind: 'document', title: 'cours.pdf', docName: 'cours.pdf' },
    { n: 2, kind: 'institutional', title: 'Éducation', venue: 'UNESCO', url: 'https://www.unesco.org/fr/esd' },
    { n: 3, kind: 'institutional', title: 'Programme', venue: 'Éduscol', url: 'https://eduscol.education.fr/x' },
    { n: 4, kind: 'openalex', title: 'Photosynthesis', doi: '10.1000/x1' },
    { n: 5, kind: 'wikipedia', title: 'Photosynthèse', venue: 'Wikipédia', url: 'https://fr.wikipedia.org/wiki/P' },
  ];
  const done = (cited: SourceRef[]): GenerationState => ({
    ...initialGenerationState(), phase: 'done', runId: 1, request: REQ, text: 'Contenu',
    result: { type: 'done', content: 'Contenu', sources: cited, truncated: false, internetUsed: true, saved: true, id: 'x', model: 'm' },
  });

  it('un badge par niveau, du plus fiable au moins fiable, avec le nombre de sources ; Wikipédia ressort « à recouper »', async () => {
    const { container } = await panel(done(sources));
    const list = container.querySelector('[aria-label="Fiabilité des sources citées"]');
    expect([...list!.querySelectorAll('li')].map(li => li.textContent?.trim())).toEqual([
      "Document de l'enseignant : 1", 'Source officielle : 2', 'Publication scientifique : 1', 'Encyclopédie collaborative (à recouper) : 1',
    ]);
    expect(list!.querySelectorAll('li')[3].className).toContain('text-warning');
    expect(list!.querySelectorAll('li')[1].className).toContain('badge-success');
  });

  it('« Source scientifique » et « Publication scientifique » : un badge chacun, le même quel que soit l’ordre des sources ; plateforme ouverte « à recouper » avant Wikipédia', async () => {
    const organism: SourceRef = { n: 6, kind: 'institutional', title: 'CNRS', url: 'https://www.cnrs.fr/fr/x' };
    const open: SourceRef = { n: 7, kind: 'institutional', title: 'Dépôt', url: 'https://hal.science/hal-01234567' };
    const badges = async (cited: SourceRef[]) => {
      const { container } = await panel(done(cited));
      const items = [...container.querySelectorAll('[aria-label="Fiabilité des sources citées"] li')];
      return { texts: items.map(li => li.textContent?.trim()), classes: items.map(li => li.className) };
    };
    const forward = await badges([sources[3], organism, sources[3], organism, open, sources[4]]);
    const backward = await badges([sources[4], open, organism, sources[3], organism, sources[3]]);
    expect(forward.texts).toEqual(['Publication scientifique : 2', 'Source scientifique : 2', 'Plateforme ouverte, à recouper : 1', 'Encyclopédie collaborative (à recouper) : 1']);
    expect(backward.texts).toEqual(forward.texts);
    // Pas de clé dupliquée entre deux badges du même niveau, et la plateforme ouverte ressort « à recouper ».
    expect(forward.classes[2]).toContain('text-warning');
  });

  it('aucune source citée, ou génération en cours : aucun badge', async () => {
    expect((await panel(done([]))).container.querySelector('[aria-label="Fiabilité des sources citées"]')).toBeNull();
    const running: GenerationState = { ...initialGenerationState(), phase: 'running', runId: 1, request: REQ, sources };
    expect((await panel(running)).container.querySelector('[aria-label="Fiabilité des sources citées"]')).toBeNull();
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
