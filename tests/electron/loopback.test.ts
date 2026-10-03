// Prédicat unique « adresse de cet ordinateur » : mêmes réponses partout (fournisseur, Electron, interface).

import { describe, expect, it } from 'vitest';
import { isLoopbackHostname, isLoopbackUrl } from '../../shared/ai/loopback.js';
import { isLoopbackUrl as reExported, OllamaClient, OllamaProvider } from '../../shared/ai/ollama.js';
import { isLoopbackHost } from '../../electron/security.js';
import { engineHostIfRemote } from '../../src/lib/ai-ui/status';

const LOCAL = ['localhost', 'LOCALHOST', '127.0.0.1', '127.0.0.2', '127.1.2.3', '[::1]', '::1'];
const REMOTE = ['127.evil.com', '127.0.0.1.evil.com', '127.0.0.1.nip.io', 'localhost.evil.com', '127.0.0', '127.0.0.1.5', '127.0.0.256', '192.168.1.20', 'ia.univ.fr', ''];

describe('prédicat de boucle locale unique', () => {
  it('hôtes : mêmes réponses pour le partagé et pour electron/security', () => {
    for (const h of LOCAL) {
      expect(isLoopbackHostname(h), h).toBe(true);
      expect(isLoopbackHost(h), h).toBe(true);
    }
    for (const h of REMOTE) {
      expect(isLoopbackHostname(h), h).toBe(false);
      expect(isLoopbackHost(h), h).toBe(false);
    }
  });

  it('adresses : 127.1 est normalisé par URL ; un faux « 127.* » ne passe jamais', () => {
    expect(reExported).toBe(isLoopbackUrl);
    for (const url of ['http://127.0.0.1:11434', 'http://127.1:11434', 'http://[::1]:11434', 'http://localhost:11434']) expect(isLoopbackUrl(url), url).toBe(true);
    for (const url of ['http://127.evil.com:11434', 'http://127.0.0.1.nip.io:11434', 'http://127.attacker.example:11434']) expect(isLoopbackUrl(url), url).toBe(false);
  });

  it('interface : la confidentialité affichée suit le même prédicat (engineHostIfRemote)', () => {
    expect(engineHostIfRemote('http://127.0.0.1:11434')).toBeNull();
    expect(engineHostIfRemote('http://127.evil.com:11434')).toBe('127.evil.com:11434');
    expect(engineHostIfRemote('http://127.0.0.1.nip.io:11434')).toBe('127.0.0.1.nip.io:11434');
  });

  it('fournisseur et client Ollama : « local » faux pour 127.evil.com', () => {
    expect(new OllamaProvider({ baseUrl: 'http://127.evil.com:11434', model: 'm', label: 'x' }).local).toBe(false);
    expect(new OllamaClient('http://127.evil.com:11434').local).toBe(false);
    expect(new OllamaProvider({ baseUrl: 'http://127.0.0.1:11434', model: 'm', label: 'x' }).local).toBe(true);
  });
});
