import { describe, expect, it } from 'vitest';
import type { GenerationEvent, GenerationRequest } from '@shared/types';
import { buildExportDoc, resultHeading, saveStatus, SAVED_DEMO_MESSAGE, SAVED_MESSAGE } from '@/lib/generation/result';
import { generationReducer, initialGenerationState, type DoneEvent, type GenerationState } from '@/lib/generation/state';

const REQ: GenerationRequest = {
  type: 'exercices', niveau: 'licence_2', matiere: 'economie', discipline: 'Macroéconomie', sujet: 'Le multiplicateur', researchMode: 'documents',
};

const DONE: DoneEvent = {
  type: 'done', content: '# Final [1]\n\n## Sources utilisées', sources: [], truncated: false, internetUsed: false, saved: true, id: 'g1', model: 'm',
};

function run(events: GenerationEvent[], runId = 1): GenerationState {
  let s = generationReducer(initialGenerationState(), { type: 'start', runId, request: REQ });
  for (const event of events) s = generationReducer(s, { type: 'event', runId, event });
  return s;
}

describe('generationReducer', () => {
  it('flux complet : statut, texte progressif puis contenu final', () => {
    let s = run([
      { type: 'status', stage: 'generating', message: 'Rédaction en cours…' },
      { type: 'sources', sources: [], internetUsed: true },
      { type: 'delta', text: 'Bon' },
    ]);
    expect(s.phase).toBe('running');
    expect(s.status).toBe('Rédaction en cours…');
    expect(s.internetUsed).toBe(true);
    s = generationReducer(s, { type: 'append', runId: 1, text: 'jour' });
    expect(s.text).toBe('Bonjour');
    s = generationReducer(s, { type: 'event', runId: 1, event: DONE });
    expect(s.phase).toBe('done');
    expect(s.text).toBe(DONE.content);
    expect(s.status).toBeNull();
    expect(s.result).toEqual(DONE);
    expect(s.internetUsed).toBe(false);
  });

  it('ignore les évènements d’une exécution précédente', () => {
    let s = run([{ type: 'delta', text: 'A' }], 2);
    s = generationReducer(s, { type: 'event', runId: 1, event: { type: 'delta', text: 'B' } });
    s = generationReducer(s, { type: 'append', runId: 1, text: 'C' });
    expect(s.text).toBe('A');
  });

  it('arrêt : « interrompue », texte conservé, erreur d’annulation ignorée', () => {
    let s = run([{ type: 'delta', text: 'Début du cours' }]);
    s = generationReducer(s, { type: 'abort', runId: 1 });
    expect(s.phase).toBe('aborted');
    expect(s.text).toBe('Début du cours');
    s = generationReducer(s, { type: 'event', runId: 1, event: { type: 'error', code: 'GENERATION_ABORTED', message: 'x', retryable: true } });
    expect(s.phase).toBe('aborted');
    expect(s.error).toBeNull();
  });

  it('résultat final arrivé juste après l’arrêt : conservé', () => {
    let s = run([{ type: 'delta', text: 'x' }]);
    s = generationReducer(s, { type: 'abort', runId: 1 });
    s = generationReducer(s, { type: 'event', runId: 1, event: DONE });
    expect(s.phase).toBe('done');
  });

  it('erreur : message précis, texte partiel conservé', () => {
    const s = run([
      { type: 'delta', text: 'partiel' },
      { type: 'error', code: 'AI_TIMEOUT', message: "Le serveur d'IA n'a pas répondu à temps.", retryable: true },
    ]);
    expect(s.phase).toBe('error');
    expect(s.error).toEqual({ code: 'AI_TIMEOUT', message: "Le serveur d'IA n'a pas répondu à temps.", retryable: true });
    expect(s.text).toBe('partiel');
  });

  it('erreur GENERATION_ABORTED venue du moteur = interruption', () => {
    expect(run([{ type: 'error', code: 'GENERATION_ABORTED', message: 'x', retryable: true }]).phase).toBe('aborted');
  });

  it('avertissements dédoublonnés', () => {
    const w: GenerationEvent = { type: 'warning', code: 'RESEARCH_UNAVAILABLE', message: 'Recherche indisponible' };
    expect(run([w, w]).warnings).toHaveLength(1);
  });

  it('nouvelle exécution : état remis à zéro, requête instantanée', () => {
    let s = run([{ type: 'delta', text: 'ancien' }, DONE]);
    const other: GenerationRequest = { ...REQ, sujet: 'Autre' };
    s = generationReducer(s, { type: 'start', runId: 2, request: other });
    expect(s).toMatchObject({ phase: 'running', text: '', result: null, request: other, runId: 2 });
  });
});

describe('résultat', () => {
  it('en-tête issu de l’instantané de la requête (libellés du supérieur)', () => {
    const h = resultHeading(REQ);
    expect(h.toolLabel).toBe('TD / Exercices');
    expect(h.niveauLabel).toBe('Licence 2');
    expect(h.matiereLabel).toBe('Économie (Macroéconomie)');
    expect(h.title).toBe('TD / Exercices — Le multiplicateur');
    const noSubject = resultHeading({ ...REQ, type: 'appreciations', niveau: '4eme', sujet: '', discipline: undefined });
    expect(noSubject.title).toBe('Appréciations — Économie, 4ème');
  });

  it('document d’export', () => {
    const doc = buildExportDoc(REQ, '# Contenu', new Date(2026, 8, 28));
    expect(doc).toEqual({
      title: 'TD / Exercices — Le multiplicateur',
      content: '# Contenu',
      meta: { type: 'TD / Exercices', niveau: 'Licence 2', matiere: 'Économie (Macroéconomie)', date: '28 septembre 2026' },
    });
  });

  it('« Enregistré » seulement si done.saved', () => {
    expect(saveStatus(DONE, [], 'web')).toEqual({ saved: true, message: SAVED_MESSAGE });
    expect(saveStatus(DONE, [], 'demo').message).toBe("Enregistré dans l'historique de démonstration (ce navigateur)");
    expect(SAVED_DEMO_MESSAGE).toBe("Enregistré dans l'historique de démonstration (ce navigateur)");
    const unsaved = saveStatus({ ...DONE, saved: false, id: undefined }, [
      { code: 'STORAGE_ERROR', message: "Le contenu est affiché mais n'a pas pu être enregistré." },
    ], 'local');
    expect(unsaved).toEqual({ saved: false, message: 'Non enregistré', reason: "Le contenu est affiché mais n'a pas pu être enregistré." });
  });
});
