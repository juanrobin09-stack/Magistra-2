// Options de développement et de test : ignorées dans l'application installée.

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { devOptionsFrom, isLoopbackDevOrigin, parseConnectorDevOrigins, parseConnectorPorts } from '../../electron/devOptions.js';

const TEST_ENV: NodeJS.ProcessEnv = {
  MAGISTRA_SMOKE_TEST: '1',
  MAGISTRA_SMOKE_GENERATE: '1',
  MAGISTRA_SMOKE_TIMEOUT_MS: '5000',
  MAGISTRA_SMOKE_EXPECT_ENGINE: 'running',
  MAGISTRA_DIST_DIR: '/tmp/autre-interface',
  MAGISTRA_USER_DATA_DIR: '/tmp/autres-donnees',
  MAGISTRA_OLLAMA_URL: 'http://serveur-pirate.example:11434',
  VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173/',
  MAGISTRA_CONNECTOR_PORTS: '47900,47901',
  MAGISTRA_CONNECTOR_DEV_ORIGINS: 'http://localhost:5173,https://evil.example',
  MAGISTRA_CONNECTOR_DISABLED: '1',
};

describe('options de développement et de test', () => {
  it('application installée : --smoke-test et toutes les variables MAGISTRA_* / VITE_* sont sans effet (connecteur compris)', () => {
    expect(devOptionsFrom(true, ['Magistra.exe', '--smoke-test'], TEST_ENV)).toEqual({ smoke: null, devServerUrl: null });
  });

  it('depuis les sources (electron .) : options lues', () => {
    expect(devOptionsFrom(false, ['electron', '.', '--smoke-test'], TEST_ENV)).toEqual({
      smoke: { timeoutMs: 5000, generate: true, expectEngine: 'running' },
      devServerUrl: 'http://127.0.0.1:5173/',
      distDir: path.resolve('/tmp/autre-interface'),
      userDataDir: path.resolve('/tmp/autres-donnees'),
      ollamaUrl: 'http://serveur-pirate.example:11434',
      connectorPorts: [47900, 47901],
      // Seules les origines de la boucle locale sont retenues.
      connectorDevOrigins: ['http://localhost:5173'],
      connectorDisabled: true,
    });
    expect(devOptionsFrom(false, ['electron', '.', '--smoke-test'], {}).smoke).toEqual({ timeoutMs: 45_000, generate: false });
    expect(devOptionsFrom(false, ['electron', '.'], {})).toEqual({ smoke: null, devServerUrl: null });
  });

  it('serveur de développement accepté uniquement sur la boucle locale', () => {
    expect(devOptionsFrom(false, [], { VITE_DEV_SERVER_URL: 'https://evil.example/' }).devServerUrl).toBeNull();
    expect(devOptionsFrom(false, [], { VITE_DEV_SERVER_URL: 'http://localhost:5173' }).devServerUrl).toBe('http://localhost:5173/');
  });
});

describe('options de développement du connecteur local', () => {
  it('ports : liste d’entiers 1024–65535 ; une seule valeur invalide et l’option est ignorée', () => {
    expect(parseConnectorPorts('47900')).toEqual([47900]);
    expect(parseConnectorPorts(' 47900 , 47901,47900 ')).toEqual([47900, 47901]);
    for (const bad of ['', '0', '80', '65536', '47900,abc', '47900;47901', '-1', '4.79e4', '47900,', '1,2,3,4,5,6,7,8,9'.split(',').map(n => 47900 + Number(n)).join(',')]) {
      expect(parseConnectorPorts(bad), bad).toBeUndefined();
    }
    expect(parseConnectorPorts(undefined)).toBeUndefined();
  });

  it('origines de développement : http(s) de la boucle locale uniquement, origine exacte', () => {
    for (const ok of ['http://localhost:5173', 'http://127.0.0.1:4173', 'https://localhost:5173', 'http://localhost']) expect(isLoopbackDevOrigin(ok), ok).toBe(true);
    for (const bad of [
      'https://evil.example', 'http://192.168.1.10:5173', 'http://localhost:5173/', 'http://localhost:5173/app', 'http://[::1]:5173',
      'file:///C:/magistra', 'null', '*', 'http://localhost.evil.example', 'http://user@localhost:5173', 'https://magistra-2.vercel.app', 'https://www.mag-istra.fr',
    ]) {
      expect(isLoopbackDevOrigin(bad), bad).toBe(false);
    }
    expect(parseConnectorDevOrigins('https://evil.example, http://localhost:5173 ,http://localhost:5173')).toEqual(['http://localhost:5173']);
    expect(parseConnectorDevOrigins('https://evil.example')).toBeUndefined();
    // Les origines officielles du site ne s'ajoutent pas par l'environnement : elles viennent de OFFICIAL_WEB_ORIGINS.
    expect(parseConnectorDevOrigins('https://www.mag-istra.fr,https://magistra-2.vercel.app')).toBeUndefined();
    expect(parseConnectorDevOrigins(undefined)).toBeUndefined();
  });

  it('connecteur éteint seulement avec MAGISTRA_CONNECTOR_DISABLED=1', () => {
    expect(devOptionsFrom(false, [], { MAGISTRA_CONNECTOR_DISABLED: 'true' }).connectorDisabled).toBeUndefined();
    expect(devOptionsFrom(false, [], { MAGISTRA_CONNECTOR_DISABLED: '1' }).connectorDisabled).toBe(true);
  });
});
