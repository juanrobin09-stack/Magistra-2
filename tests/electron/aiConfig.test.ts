// Configuration de l'IA : la clé API n'est JAMAIS renvoyée à la fenêtre ni écrite en clair.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AIConfigStore, safeStorageCipher, type SecretCipher } from '../../electron/aiConfig.js';

const SECRET = 'sk-univ-TRES-SECRET-0123456789';

/** Chiffrement simulé (réversible, mais le texte chiffré ne contient jamais la clé). */
function fakeCipher(available = true): SecretCipher {
  return {
    isAvailable: () => available,
    encrypt: plain => Buffer.from([...Buffer.from(plain, 'utf8')].map(b => b ^ 0x5a)).toString('base64'),
    decrypt: enc => Buffer.from([...Buffer.from(enc, 'base64')].map(b => b ^ 0x5a)).toString('utf8'),
  };
}

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'magistra-aicfg-'));
  file = path.join(dir, 'ai-config.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('clé API d’un serveur distant', () => {
  it('est chiffrée sur le disque et jamais renvoyée (seulement hasApiKey)', async () => {
    const store = new AIConfigStore(file, fakeCipher());
    await store.load();
    const pub = await store.update({
      mode: 'remote',
      remote: { kind: 'openai-compatible', baseUrl: 'https://ia.univ-exemple.fr/v1', model: 'mistral-small', apiKey: SECRET, label: 'Serveur universitaire' },
    });
    expect(pub.remote).toEqual({ kind: 'openai-compatible', baseUrl: 'https://ia.univ-exemple.fr/v1', model: 'mistral-small', hasApiKey: true, label: 'Serveur universitaire' });
    expect(JSON.stringify(pub)).not.toContain(SECRET);
    expect(JSON.stringify(store.publicConfig())).not.toContain(SECRET);
    expect(readFileSync(file, 'utf8')).not.toContain(SECRET);
    // Le processus principal, lui, peut la déchiffrer pour créer le fournisseur.
    const reloaded = new AIConfigStore(file, fakeCipher());
    await reloaded.load();
    expect(reloaded.getApiKey()).toBe(SECRET);
    expect(reloaded.publicConfig().remote?.hasApiKey).toBe(true);
  });

  it('refuse d’enregistrer la clé sans chiffrement sûr, avec un message clair', async () => {
    const store = new AIConfigStore(file, fakeCipher(false));
    await store.load();
    await expect(store.update({ remote: { kind: 'openai-compatible', baseUrl: 'https://ia.exemple.fr/v1', model: 'm', apiKey: SECRET } }))
      .rejects.toMatchObject({ code: 'STORAGE_ERROR', message: expect.stringContaining('chiffrement') });
    // Un serveur sans clé reste possible.
    const pub = await store.update({ remote: { kind: 'openai-compatible', baseUrl: 'https://ia.exemple.fr/v1', model: 'm' } });
    expect(pub.remote?.hasApiKey).toBe(false);
  });

  it('refuse d’envoyer une clé en clair (http) vers un serveur non local', async () => {
    const store = new AIConfigStore(file, fakeCipher());
    await store.load();
    await expect(store.update({ remote: { kind: 'openai-compatible', baseUrl: 'http://ia.exemple.fr/v1', model: 'm', apiKey: SECRET } }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(store.update({ remote: { kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', model: 'm', apiKey: SECRET } }))
      .resolves.toMatchObject({ remote: { hasApiKey: true } });
  });

  it('efface la clé si l’adresse du serveur change (jamais envoyée à un autre serveur)', async () => {
    const store = new AIConfigStore(file, fakeCipher());
    await store.load();
    await store.update({ remote: { kind: 'openai-compatible', baseUrl: 'https://ia.univ.fr/v1', model: 'a', apiKey: SECRET } });
    // Même serveur, autre modèle : la clé est conservée.
    expect((await store.update({ remote: { kind: 'openai-compatible', baseUrl: 'https://ia.univ.fr/v1', model: 'b' } })).remote?.hasApiKey).toBe(true);
    // Autre serveur : la clé est oubliée.
    expect((await store.update({ remote: { kind: 'openai-compatible', baseUrl: 'https://autre.example/v1', model: 'b' } })).remote?.hasApiKey).toBe(false);
    expect(store.getApiKey()).toBeUndefined();
  });

  it('chaîne vide = suppression de la clé ; remote null = retour en mode local', async () => {
    const store = new AIConfigStore(file, fakeCipher());
    await store.load();
    await store.update({ mode: 'remote', remote: { kind: 'ollama', baseUrl: 'https://gpu.labo.fr', model: 'mistral-small3.2:24b', apiKey: SECRET } });
    expect((await store.update({ remote: { kind: 'ollama', baseUrl: 'https://gpu.labo.fr', model: 'mistral-small3.2:24b', apiKey: '' } })).remote?.hasApiKey).toBe(false);
    const pub = await store.update({ remote: null });
    expect(pub.mode).toBe('local');
    expect(pub.remote).toBeUndefined();
  });

  it('mode distant impossible sans serveur configuré', async () => {
    const store = new AIConfigStore(file, fakeCipher());
    await store.load();
    await expect(store.update({ mode: 'remote' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

describe('niveau et fichier de configuration', () => {
  it('retient le niveau recommandé au premier démarrage seulement', async () => {
    const store = new AIConfigStore(file, fakeCipher());
    await store.load();
    expect(store.isFirstRun).toBe(true);
    await store.applyRecommendedTier('leger');
    expect(store.get().tier).toBe('leger');
    await store.applyRecommendedTier('qualite');
    expect(store.get().tier).toBe('leger');
    await store.update({ tier: 'standard', customModel: 'qwen3:8b' });
    expect(store.activeLocalModel()).toMatchObject({ model: 'qwen3:8b', custom: true });
    await store.update({ customModel: null });
    expect(store.activeLocalModel()).toMatchObject({ model: 'ministral-3:14b', label: 'Magistra Standard', contextTokens: 12_288 });
  });

  it('fichier corrompu : mis de côté et valeurs par défaut', async () => {
    writeFileSync(file, '{"mode": "remote", ');
    const store = new AIConfigStore(file, fakeCipher(), { ollamaUrl: 'http://127.0.0.1:12345' });
    await store.load();
    expect(store.get()).toMatchObject({ mode: 'local', tier: 'standard', ollamaUrl: 'http://127.0.0.1:12345' });
  });

  it('safeStorage : le mode « basic_text » de Linux n’est pas considéré comme sûr', () => {
    const base = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() };
    expect(safeStorageCipher({ ...base, getSelectedStorageBackend: () => 'basic_text' }, 'linux').isAvailable()).toBe(false);
    expect(safeStorageCipher({ ...base, getSelectedStorageBackend: () => 'gnome_libsecret' }, 'linux').isAvailable()).toBe(true);
    expect(safeStorageCipher(base, 'win32').isAvailable()).toBe(true);
    expect(safeStorageCipher({ ...base, isEncryptionAvailable: () => false }, 'win32').isAvailable()).toBe(false);
  });
});
