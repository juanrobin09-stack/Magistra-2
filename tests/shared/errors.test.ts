import { describe, expect, it } from 'vitest';
import { defaultMessage, isErrorCode, MagistraError, toMagistraError } from '../../shared/errors';

describe('erreurs compréhensibles', () => {
  it('messages attendus par l’enseignant', () => {
    expect(defaultMessage('ENGINE_NOT_RUNNING')).toBe('Moteur IA non démarré.');
    expect(defaultMessage('OUT_OF_MEMORY')).toMatch(/^Mémoire insuffisante pour ce modèle\./);
    expect(defaultMessage('GENERATION_ABORTED')).toBe('Génération interrompue.');
    expect(defaultMessage('GENERATION_TRUNCATED')).toMatch(/longueur maximale/);
  });

  it('toMagistraError ne propage jamais de détail technique', () => {
    const e = toMagistraError(new Error('ECONNRESET at Socket.onEnd (node:net:123) key=sk-123'));
    expect(e).toBeInstanceOf(MagistraError);
    expect(e.toJSON()).toEqual({ code: 'INTERNAL', message: 'Erreur inattendue. Réessayez.', retryable: true });
    expect(toMagistraError(Object.assign(new Error('x'), { name: 'AbortError' })).code).toBe('GENERATION_ABORTED');
  });

  it('un objet MagistraError sérialisé (IPC/JSON) est reconstruit en vraie instance', () => {
    const e = toMagistraError({ name: 'MagistraError', code: 'AI_BUSY', message: 'Serveur surchargé.' });
    expect(e).toBeInstanceOf(MagistraError);
    expect(e.toJSON()).toEqual({ code: 'AI_BUSY', message: 'Serveur surchargé.', retryable: true });
    expect(toMagistraError({ name: 'MagistraError', code: 'CODE_INCONNU', message: 'x' }).code).toBe('INTERNAL');
  });

  it('isErrorCode n’accepte pas les propriétés héritées', () => {
    expect(isErrorCode('AI_TIMEOUT')).toBe(true);
    expect(isErrorCode('toString')).toBe(false);
    expect(isErrorCode('constructor')).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });

  it('nouveaux codes IA : messages, statut HTTP, réessai à la demande (jamais automatique pour ceux-ci)', () => {
    expect(defaultMessage('ENGINE_OUTDATED')).toBe('Le moteur IA (Ollama) est trop ancien pour ce modèle : mettez-le à jour.');
    expect(defaultMessage('AI_SERVER_UNREACHABLE')).toBe("Le serveur d'IA est injoignable à l'adresse configurée.");
    expect(defaultMessage('AI_QUOTA_EXCEEDED')).toMatch(/quota/);
    expect(defaultMessage('AI_STATUS_UNKNOWN')).toMatch(/n'a pas pu être vérifié : la génération reste possible/);

    const quota = new MagistraError('AI_QUOTA_EXCEEDED');
    expect([quota.status, quota.retryable]).toEqual([429, true]);
    const outdated = new MagistraError('ENGINE_OUTDATED');
    expect(outdated.retryable).toBe(false);
    const unreachable = new MagistraError('AI_SERVER_UNREACHABLE');
    expect([unreachable.status, unreachable.retryable]).toEqual([502, true]);
    for (const code of ['AI_QUOTA_EXCEEDED', 'ENGINE_OUTDATED', 'AI_SERVER_UNREACHABLE', 'AI_STATUS_UNKNOWN']) expect(isErrorCode(code)).toBe(true);
  });

  it('retryAfterMs : conservé sur l’erreur, jamais sérialisé, ignoré s’il est invalide', () => {
    const e = new MagistraError('AI_BUSY', undefined, { retryAfterMs: 2_400.4 });
    expect(e.retryAfterMs).toBe(2_400);
    expect(e.toJSON()).toEqual({ code: 'AI_BUSY', message: "Le serveur d'IA est surchargé. Réessayez dans quelques instants.", retryable: true });
    expect(new MagistraError('AI_BUSY', undefined, { retryAfterMs: -1 }).retryAfterMs).toBeUndefined();
    expect(new MagistraError('AI_BUSY', undefined, { retryAfterMs: Number.NaN }).retryAfterMs).toBeUndefined();
    expect(new MagistraError('AI_BUSY').retryAfterMs).toBeUndefined();
  });
});
