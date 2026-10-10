// Configuration de l'IA : la clé API n'est JAMAIS renvoyée à la fenêtre ni écrite en clair.

import { mkdirSync, mkdtempSync, promises as fsp, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('clé API d’un serveur distant', () => {
  it('relit une clé Anthropic chiffrée et l’oublie si le protocole d’API change', async () => {
    const store = new AIConfigStore(file, fakeCipher());
    await store.load();
    await store.update({ mode: 'remote', remote: { kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5', apiKey: SECRET } });
    const reloaded = new AIConfigStore(file, fakeCipher());
    await reloaded.load();
    expect(reloaded.getApiKey()).toBe(SECRET);
    expect(reloaded.publicConfig().remote?.kind).toBe('anthropic');
    await reloaded.update({ remote: { kind: 'openai-compatible', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5' } });
    expect(reloaded.getApiKey()).toBeUndefined();
  });
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

describe('lecture de la configuration', () => {
  it('fichier illisible (EISDIR, comme EBUSY ou EPERM sous Windows) : réglages par défaut, jamais d’échec au démarrage, fichier intact', async () => {
    // Un dossier à la place du fichier : la lecture échoue avec un code autre que ENOENT.
    mkdirSync(file);
    writeFileSync(path.join(file, 'x'), 'garde');
    const store = new AIConfigStore(file, fakeCipher());
    await expect(store.load()).resolves.toBeUndefined();
    expect(store.get().mode).toBe('local');
    expect(readFileSync(path.join(file, 'x'), 'utf8')).toBe('garde');
  });
});

/** Lecture refusée (antivirus, droits) pour le fichier de configuration, tant que `state.denied` est vrai. */
function denyConfigReads(state: { denied: boolean }, code = 'EBUSY') {
  const real = fsp.readFile.bind(fsp);
  return vi.spyOn(fsp, 'readFile').mockImplementation((async (target: unknown, ...rest: unknown[]) => {
    if (state.denied && target === file) throw Object.assign(new Error(`${code}: fichier verrouillé`), { code });
    return (real as (...a: unknown[]) => unknown)(target, ...rest);
  }) as never);
}

describe('fichier existant illisible au démarrage : jamais écrasé en silence', () => {
  const existing = {
    version: 1,
    mode: 'remote',
    tier: 'qualite',
    tierChosen: false,
    customModel: 'qwen3:8b',
    ollamaUrl: 'http://127.0.0.1:12345',
    remote: { kind: 'openai-compatible', baseUrl: 'https://ia.univ.fr/v1', model: 'mistral-small', apiKeyEnc: fakeCipher().encrypt(SECRET) },
  };

  async function loadWhileLocked(state: { denied: boolean }): Promise<AIConfigStore> {
    writeFileSync(file, JSON.stringify(existing));
    const store = new AIConfigStore(file, fakeCipher());
    await expect(store.load()).resolves.toBeUndefined();
    // Les réglages par défaut servent en mémoire : l'application continue de fonctionner.
    expect(store.get()).toMatchObject({ mode: 'local', tier: 'standard', tierChosen: false });
    expect(state.denied).toBe(true);
    return store;
  }

  it('redevenu lisible : update() adopte son contenu (serveur, clé chiffrée, modèle) au lieu des réglages par défaut', async () => {
    const state = { denied: true };
    denyConfigReads(state);
    const store = await loadWhileLocked(state);
    state.denied = false;
    const pub = await store.update({ ollamaUrl: 'http://127.0.0.1:23456' });
    expect(pub).toMatchObject({ mode: 'remote', customModel: 'qwen3:8b', ollamaUrl: 'http://127.0.0.1:23456', remote: { baseUrl: 'https://ia.univ.fr/v1', hasApiKey: true } });
    const onDisk = JSON.parse(readFileSync(file, 'utf8'));
    expect(onDisk).toMatchObject({ mode: 'remote', customModel: 'qwen3:8b', remote: existing.remote });
    expect(store.getApiKey()).toBe(SECRET);
  });

  it('redevenu lisible : adoptInstalledTier() part de son contenu, sans perdre le serveur ni la clé', async () => {
    const state = { denied: true };
    denyConfigReads(state);
    writeFileSync(file, JSON.stringify({ ...existing, mode: 'local', customModel: undefined }));
    const store = new AIConfigStore(file, fakeCipher());
    await store.load();
    state.denied = false;
    await expect(store.adoptInstalledTier('leger')).resolves.toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ mode: 'local', tier: 'leger', tierChosen: false, ollamaUrl: 'http://127.0.0.1:12345', remote: existing.remote });
  });

  it('redevenu lisible avec un niveau choisi par l’enseignant : adoptInstalledTier() ne le remplace pas', async () => {
    const state = { denied: true };
    denyConfigReads(state);
    writeFileSync(file, JSON.stringify({ ...existing, mode: 'local', customModel: undefined, tierChosen: true }));
    const store = new AIConfigStore(file, fakeCipher());
    await store.load();
    state.denied = false;
    await expect(store.adoptInstalledTier('leger')).resolves.toBe(false);
    expect(JSON.parse(readFileSync(file, 'utf8')).tier).toBe('qualite');
  });

  it('toujours illisible à l’écriture : copie « .unreadable-<date> » de l’original, puis l’application continue avec les réglages par défaut', async () => {
    const state = { denied: true };
    denyConfigReads(state, 'EPERM');
    const store = await loadWhileLocked(state);
    await expect(store.adoptInstalledTier('leger')).resolves.toBe(true);
    await expect(store.update({ ollamaUrl: 'http://127.0.0.1:23456' })).resolves.toMatchObject({ tier: 'leger', ollamaUrl: 'http://127.0.0.1:23456' });
    const copies = readdirSync(dir).filter(n => n.startsWith('ai-config.json.unreadable-'));
    expect(copies).toHaveLength(1);
    expect(JSON.parse(readFileSync(path.join(dir, copies[0]), 'utf8'))).toEqual(existing);
  });

  it('illisible ET copie impossible : rien n’est écrit, le fichier reste intact ; une fois le verrou levé, son contenu est adopté', async () => {
    const state = { denied: true };
    denyConfigReads(state, 'EPERM');
    const copyFile = vi.spyOn(fsp, 'copyFile').mockRejectedValue(Object.assign(new Error('EPERM: fichier verrouillé'), { code: 'EPERM' }));
    const store = await loadWhileLocked(state);
    await expect(store.adoptInstalledTier('leger')).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    await expect(store.update({ ollamaUrl: 'http://127.0.0.1:23456' })).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    await expect(store.update({ tier: 'leger' })).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(existing);
    expect(readdirSync(dir)).toEqual(['ai-config.json']);
    state.denied = false;
    copyFile.mockRestore();
    await expect(store.update({ ollamaUrl: 'http://127.0.0.1:23456' })).resolves.toMatchObject({ mode: 'remote', customModel: 'qwen3:8b', remote: { hasApiKey: true } });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ mode: 'remote', remote: existing.remote });
    expect(readdirSync(dir)).toEqual(['ai-config.json']);
  });

  it('des écritures simultanées ne font qu’une copie', async () => {
    const state = { denied: true };
    denyConfigReads(state);
    const store = await loadWhileLocked(state);
    await Promise.all([store.update({ ollamaUrl: 'http://127.0.0.1:23456' }), store.update({ tier: 'leger' }), store.adoptInstalledTier('leger')]);
    expect(readdirSync(dir).filter(n => n.startsWith('ai-config.json.unreadable-'))).toHaveLength(1);
  });

  it('une lecture réussie au démarrage ne laisse aucune copie', async () => {
    writeFileSync(file, JSON.stringify(existing));
    const store = new AIConfigStore(file, fakeCipher());
    await store.load();
    await store.update({ ollamaUrl: 'http://127.0.0.1:23456' });
    expect(readdirSync(dir)).toEqual(['ai-config.json']);
  });
});
