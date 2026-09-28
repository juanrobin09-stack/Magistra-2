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
});
