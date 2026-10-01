// CLERK_AUTHORIZED_PARTIES vide en production : avertissement au démarrage (l'origine « azp » des jetons n'est
// alors pas vérifiée), sans valeur par défaut déduite et sans empêcher le serveur de démarrer.

import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../server/config.js';

const MESSAGE = /CLERK_AUTHORIZED_PARTIES est vide/;
const base = { CLERK_SECRET_KEY: 'sk_test_exemple' };

describe('CLERK_AUTHORIZED_PARTIES', () => {
  it('vide en production (NODE_ENV ou Vercel) : une ligne d’avertissement, aucune valeur déduite', () => {
    for (const env of [{ NODE_ENV: 'production' }, { VERCEL: '1' }]) {
      const cfg = loadConfig({ ...base, ...env });
      expect(cfg.problems.join('\n')).toMatch(MESSAGE);
      expect(cfg.clerk?.authorizedParties).toBeUndefined();
    }
  });

  it('renseignée : aucun avertissement', () => {
    const cfg = loadConfig({ ...base, NODE_ENV: 'production', CLERK_AUTHORIZED_PARTIES: 'https://magistra-2.vercel.app/' });
    expect(cfg.problems.join('\n')).not.toMatch(MESSAGE);
    expect(cfg.clerk?.authorizedParties).toEqual(['https://magistra-2.vercel.app']);
  });

  it('hors production : aucun avertissement', () => {
    expect(loadConfig({ ...base }).problems.join('\n')).not.toMatch(MESSAGE);
  });
});
