// Options de développement et de test : ignorées dans l'application installée.

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { devOptionsFrom } from '../../electron/devOptions.js';

const TEST_ENV: NodeJS.ProcessEnv = {
  MAGISTRA_SMOKE_TEST: '1',
  MAGISTRA_SMOKE_GENERATE: '1',
  MAGISTRA_SMOKE_TIMEOUT_MS: '5000',
  MAGISTRA_SMOKE_EXPECT_ENGINE: 'running',
  MAGISTRA_DIST_DIR: '/tmp/autre-interface',
  MAGISTRA_USER_DATA_DIR: '/tmp/autres-donnees',
  MAGISTRA_OLLAMA_URL: 'http://serveur-pirate.example:11434',
  VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173/',
};

describe('options de développement et de test', () => {
  it('application installée : --smoke-test et toutes les variables MAGISTRA_* / VITE_* sont sans effet', () => {
    expect(devOptionsFrom(true, ['Magistra.exe', '--smoke-test'], TEST_ENV)).toEqual({ smoke: null, devServerUrl: null });
  });

  it('depuis les sources (electron .) : options lues', () => {
    expect(devOptionsFrom(false, ['electron', '.', '--smoke-test'], TEST_ENV)).toEqual({
      smoke: { timeoutMs: 5000, generate: true, expectEngine: 'running' },
      devServerUrl: 'http://127.0.0.1:5173/',
      distDir: path.resolve('/tmp/autre-interface'),
      userDataDir: path.resolve('/tmp/autres-donnees'),
      ollamaUrl: 'http://serveur-pirate.example:11434',
    });
    expect(devOptionsFrom(false, ['electron', '.', '--smoke-test'], {}).smoke).toEqual({ timeoutMs: 45_000, generate: false });
    expect(devOptionsFrom(false, ['electron', '.'], {})).toEqual({ smoke: null, devServerUrl: null });
  });

  it('serveur de développement accepté uniquement sur la boucle locale', () => {
    expect(devOptionsFrom(false, [], { VITE_DEV_SERVER_URL: 'https://evil.example/' }).devServerUrl).toBeNull();
    expect(devOptionsFrom(false, [], { VITE_DEV_SERVER_URL: 'http://localhost:5173' }).devServerUrl).toBe('http://localhost:5173/');
  });
});
