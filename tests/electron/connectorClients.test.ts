// Navigateurs autorisés du connecteur local (local-connector.json) : clés chiffrées par le système, JAMAIS en clair
// sur le disque ; mémoire seule si le chiffrement est indisponible ; limite de navigateurs ; retrait ; réglage
// « activé » ; fichier corrompu ; échec d'écriture.

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SecretCipher } from '../../electron/aiConfig.js';
import { canonicalRevoked } from '../../shared/localConnector.js';
import { ConnectorClientStore, MAX_REVOKED_MARKS } from '../../electron/connector/clients.js';
import { hmacBase64Url, toBase64Url } from '../../electron/connector/crypto.js';
import { withFileLock } from '../../electron/jsonFile.js';

const ORIGIN = 'https://magistra-2.vercel.app';

/** Chiffrement simulé (réversible, mais le texte chiffré ne contient jamais la clé). */
function fakeCipher(options: { available?: boolean; failDecrypt?: boolean } = {}): SecretCipher & { available: boolean } {
  const cipher = {
    available: options.available ?? true,
    isAvailable: () => cipher.available,
    encrypt: (plain: string) => Buffer.from([...Buffer.from(plain, 'utf8')].map(b => b ^ 0x5a)).toString('base64'),
    decrypt: (enc: string) => {
      if (options.failDecrypt) throw new Error('clé du système introuvable');
      return Buffer.from([...Buffer.from(enc, 'base64')].map(b => b ^ 0x5a)).toString('utf8');
    },
  };
  return cipher;
}

function key(fill: number): Buffer {
  return Buffer.alloc(32, fill);
}

/** Toutes les écritures possibles d'une clé : aucune ne doit apparaître sur le disque. */
function keyForms(k: Buffer): string[] {
  return [toBase64Url(k), k.toString('base64'), k.toString('hex'), JSON.stringify([...k])];
}

/** Écriture du fichier retenue (verrou d'antivirus, file d'écritures) jusqu'à `release`. */
async function holdFile(target: string): Promise<{ held: Promise<void>; release: () => void }> {
  let release!: () => void;
  let started!: () => void;
  const running = new Promise<void>(resolve => (started = resolve));
  const held = withFileLock(target, () => new Promise<void>(resolve => {
    release = resolve;
    started();
  }));
  await running;
  return { held, release };
}

let dir: string;
let file: string;
let clock: number;
const warnings: string[] = [];

function store(cipher: SecretCipher = fakeCipher(), maxClients?: number): ConnectorClientStore {
  return new ConnectorClientStore(file, cipher, {
    now: () => new Date(clock),
    warn: message => warnings.push(message),
    ...(maxClients ? { maxClients } : {}),
  });
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'magistra-connector-'));
  file = path.join(dir, 'local-connector.json');
  clock = Date.parse('2026-09-01T08:00:00.000Z');
  warnings.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('autorisations enregistrées', () => {
  it('clé chiffrée sur le disque (jamais en clair), relue à l’identique au démarrage suivant', async () => {
    const s = store();
    await s.load();
    expect(s.enabled).toBe(true);
    expect(s.persistent).toBe(true);
    const k = key(0x42);
    const info = await s.add({ origin: ORIGIN, browser: 'Microsoft Edge', key: k });
    expect(info).toEqual({ clientId: info.clientId, site: 'magistra-2.vercel.app', browser: 'Microsoft Edge', pairedAt: '2026-09-01T08:00:00.000Z', lastUsedAt: '2026-09-01T08:00:00.000Z' });

    const text = readFileSync(file, 'utf8');
    for (const form of keyForms(k)) expect(text).not.toContain(form);
    const saved = JSON.parse(text);
    expect(saved).toMatchObject({ version: 1, enabled: true, clients: [{ clientId: info.clientId, origin: ORIGIN, browser: 'Microsoft Edge' }] });
    expect(Object.keys(saved.clients[0]).sort()).toEqual(['browser', 'clientId', 'keyEnc', 'lastUsedAt', 'origin', 'pairedAt']);

    const reloaded = store();
    await reloaded.load();
    expect(reloaded.find(info.clientId)).toEqual({ clientId: info.clientId, origin: ORIGIN, key: k });
    expect(reloaded.list()).toEqual([info]);
    // La liste affichée dans les réglages ne contient aucun secret.
    for (const form of keyForms(k)) expect(JSON.stringify(reloaded.list())).not.toContain(form);
  });

  it('chiffrement du système indisponible : autorisation en mémoire seulement, rien sur le disque', async () => {
    const s = store(fakeCipher({ available: false }));
    await s.load();
    expect(s.persistent).toBe(false);
    const k = key(0x17);
    const info = await s.add({ origin: ORIGIN, browser: 'Google Chrome', key: k });
    expect(s.find(info.clientId)?.key.equals(k)).toBe(true);
    expect(existsSync(file)).toBe(false);
    await s.setEnabled(false);
    const text = readFileSync(file, 'utf8');
    expect(JSON.parse(text)).toEqual({ version: 1, enabled: false, clients: [] });
    for (const form of keyForms(k)) expect(text).not.toContain(form);
    const reloaded = store(fakeCipher({ available: false }));
    await reloaded.load();
    expect(reloaded.find(info.clientId)).toBeUndefined();
    expect(reloaded.enabled).toBe(false);
  });

  it('chiffrement momentanément indisponible au démarrage : autorisations inutilisables mais conservées chiffrées', async () => {
    const s = store();
    await s.load();
    const info = await s.add({ origin: ORIGIN, browser: 'Mozilla Firefox', key: key(1) });
    const before = JSON.parse(readFileSync(file, 'utf8')).clients[0];

    const offline = store(fakeCipher({ available: false }));
    await offline.load();
    expect(offline.find(info.clientId)).toBeUndefined();
    expect(offline.list()).toEqual([]);
    expect(warnings.some(w => w.includes('Chiffrement du système indisponible'))).toBe(true);
    await offline.setEnabled(false);
    expect(JSON.parse(readFileSync(file, 'utf8')).clients).toEqual([before]);

    const back = store();
    await back.load();
    expect(back.find(info.clientId)?.key.equals(key(1))).toBe(true);
    expect(back.enabled).toBe(false);
  });

  it('clé illisible sur cet ordinateur (autre profil Windows) : autorisation abandonnée', async () => {
    const s = store();
    await s.load();
    const info = await s.add({ origin: ORIGIN, browser: 'Google Chrome', key: key(2) });
    const broken = store(fakeCipher({ failDecrypt: true }));
    await broken.load();
    expect(broken.find(info.clientId)).toBeUndefined();
    expect(warnings.some(w => w.includes('illisible'))).toBe(true);
  });

  it(`au plus maxClients navigateurs : le plus anciennement appairé est retiré`, async () => {
    const s = store(fakeCipher(), 2);
    await s.load();
    const a = await s.add({ origin: ORIGIN, browser: 'Google Chrome', key: key(10) });
    clock += 1_000;
    const b = await s.add({ origin: ORIGIN, browser: 'Microsoft Edge', key: key(11) });
    clock += 1_000;
    const c = await s.add({ origin: ORIGIN, browser: 'Mozilla Firefox', key: key(12) });
    expect(s.find(a.clientId)).toBeUndefined();
    expect(s.list().map(i => i.clientId)).toEqual([c.clientId, b.clientId]);
    const reloaded = store(fakeCipher(), 2);
    await reloaded.load();
    expect(reloaded.list().map(i => i.clientId)).toEqual([c.clientId, b.clientId]);
  });

  it('éviction au-delà de maxClients : navigateurs évincés signalés (génération à arrêter), marque de retrait gardée', async () => {
    const s = store(fakeCipher(), 1);
    await s.load();
    const a = await s.add({ origin: ORIGIN, browser: 'Google Chrome', key: key(13) });
    expect(a).not.toHaveProperty('evicted');
    clock += 1_000;
    const b = await s.add({ origin: ORIGIN, browser: 'Microsoft Edge', key: key(14) });
    expect(b.evicted).toEqual([a.clientId]);
    expect(s.find(a.clientId)).toBeUndefined();
    // Marque calculée avec la clé du navigateur évincé AVANT son effacement : il saura qu'il a été retiré.
    expect(s.revokedMark(a.clientId, ORIGIN)).toBe(hmacBase64Url(key(13), canonicalRevoked(a.clientId)));
  });

  it('éviction : marque servie seulement une fois l’éviction enregistrée ; écriture impossible → éviction annulée, AUCUNE marque servie (elle resterait valable pour un navigateur toujours autorisé)', async () => {
    const s = store(fakeCipher(), 1);
    await s.load();
    const a = await s.add({ origin: ORIGIN, browser: 'Google Chrome', key: key(15) });
    clock += 1_000;
    // Écriture retenue (verrou d'antivirus, file d'écritures) puis impossible (disque plein, dossier disparu).
    const { held, release } = await holdFile(file);
    const adding = s.add({ origin: ORIGIN, browser: 'Microsoft Edge', key: key(16) });
    // Pendant l'écriture : le navigateur évincé est déjà refusé, mais sans marque de retrait.
    expect(s.find(a.clientId)).toBeUndefined();
    expect(s.revokedMark(a.clientId, ORIGIN)).toBeUndefined();
    rmSync(dir, { recursive: true, force: true });
    writeFileSync(dir, 'fichier à la place du dossier');
    release();
    await held;
    await expect(adding).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    // Éviction annulée : A reste autorisé (même clé), aucune marque n'a jamais été servie.
    expect(s.find(a.clientId)?.key).toEqual(key(15));
    expect(s.revokedMark(a.clientId, ORIGIN)).toBeUndefined();
    expect(s.list().map(c => c.clientId)).toEqual([a.clientId]);
    rmSync(dir, { force: true });
  });

  it('éviction enregistrée : marque servie ensuite, relue au démarrage', async () => {
    const s = store(fakeCipher(), 1);
    await s.load();
    const a = await s.add({ origin: ORIGIN, browser: 'Google Chrome', key: key(17) });
    clock += 1_000;
    const { held, release } = await holdFile(file);
    const adding = s.add({ origin: ORIGIN, browser: 'Microsoft Edge', key: key(18) });
    expect(s.revokedMark(a.clientId, ORIGIN)).toBeUndefined();
    release();
    await held;
    await adding;
    const mark = hmacBase64Url(key(17), canonicalRevoked(a.clientId));
    expect(s.revokedMark(a.clientId, ORIGIN)).toBe(mark);
    const reloaded = store(fakeCipher(), 1);
    await reloaded.load();
    expect(reloaded.revokedMark(a.clientId, ORIGIN)).toBe(mark);
  });

  it('marque de retrait : calculée avec la clé avant son effacement, pour ce site seulement, enregistrée et bornée', async () => {
    const s = store();
    await s.load();
    const a = await s.add({ origin: ORIGIN, browser: 'Google Chrome', key: key(22) });
    expect(s.revokedMark(a.clientId, ORIGIN)).toBeUndefined();
    await s.revoke(a.clientId);
    const mark = hmacBase64Url(key(22), canonicalRevoked(a.clientId));
    expect(s.revokedMark(a.clientId, ORIGIN)).toBe(mark);
    expect(s.revokedMark(a.clientId, 'http://localhost:5173')).toBeUndefined();
    expect(s.revokedMark('AAAAAAAAAAAAAAAAAAAAAA', ORIGIN)).toBeUndefined();
    // Ni la clé ni rien qui permette de signer : seule la marque est écrite.
    const text = readFileSync(file, 'utf8');
    for (const form of keyForms(key(22))) expect(text).not.toContain(form);
    expect(JSON.parse(text).revoked).toEqual([{ clientId: a.clientId, origin: ORIGIN, mark, revokedAt: new Date(clock).toISOString() }]);
    const reloaded = store();
    await reloaded.load();
    expect(reloaded.revokedMark(a.clientId, ORIGIN)).toBe(mark);
    // Bornée : les plus anciennes marques sont oubliées d'abord.
    const ids: string[] = [a.clientId];
    for (let i = 0; i < MAX_REVOKED_MARKS; i++) {
      clock += 1_000;
      const info = await reloaded.add({ origin: ORIGIN, browser: 'Google Chrome', key: key(i % 200) });
      await reloaded.revoke(info.clientId);
      ids.push(info.clientId);
    }
    expect(reloaded.revokedMark(ids[0], ORIGIN)).toBeUndefined();
    expect(reloaded.revokedMark(ids[1], ORIGIN)).toBeDefined();
    expect(JSON.parse(readFileSync(file, 'utf8')).revoked).toHaveLength(MAX_REVOKED_MARKS);
    const again = store();
    await again.load();
    expect(again.revokedMark(ids[1], ORIGIN)).toBeDefined();
    expect(again.revokedMark(ids.at(-1)!, ORIGIN)).toBeDefined();
  });

  it('retrait : effet immédiat, enregistré ; retrait inconnu sans effet', async () => {
    const s = store();
    await s.load();
    let changes = 0;
    s.onChange(() => changes++);
    const a = await s.add({ origin: ORIGIN, browser: 'Google Chrome', key: key(20) });
    const b = await s.add({ origin: ORIGIN, browser: 'Microsoft Edge', key: key(21) });
    expect(changes).toBe(2);
    expect(await s.revoke(a.clientId)).toBe(true);
    expect(s.find(a.clientId)).toBeUndefined();
    expect(await s.revoke(a.clientId)).toBe(false);
    expect(changes).toBe(3);
    expect(JSON.parse(readFileSync(file, 'utf8')).clients.map((c: { clientId: string }) => c.clientId)).toEqual([b.clientId]);
  });

  it('réglage « activé » : vrai par défaut, enregistré', async () => {
    const s = store();
    await s.load();
    let changes = 0;
    s.onChange(() => changes++);
    await s.setEnabled(true);
    expect(changes).toBe(0);
    await s.setEnabled(false);
    expect(changes).toBe(1);
    const reloaded = store();
    await reloaded.load();
    expect(reloaded.enabled).toBe(false);
  });

  it('date de dernière utilisation : mise à jour en mémoire, écrite au plus toutes les heures', async () => {
    const s = store();
    await s.load();
    const info = await s.add({ origin: ORIGIN, browser: 'Google Chrome', key: key(30) });
    clock += 60_000;
    s.touch(info.clientId);
    expect(s.list()[0].lastUsedAt).toBe(new Date(clock).toISOString());
    await s.flush();
    expect(JSON.parse(readFileSync(file, 'utf8')).clients[0].lastUsedAt).toBe(new Date(clock).toISOString());
    clock += 2 * 60 * 60_000;
    s.touch(info.clientId);
    await new Promise(r => setTimeout(r, 50));
    expect(JSON.parse(readFileSync(file, 'utf8')).clients[0].lastUsedAt).toBe(new Date(clock).toISOString());
    s.touch('inconnu');
  });
});

describe('fichier et erreurs', () => {
  it('fichier corrompu : mis de côté, réglages par défaut', async () => {
    writeFileSync(file, '{ pas du json');
    const s = store();
    await s.load();
    expect(s.enabled).toBe(true);
    expect(s.list()).toEqual([]);
    expect(readdirSync(dir).some(n => n.startsWith('local-connector.json.corrupt-'))).toBe(true);
  });

  it('entrées invalides ignorées une à une (identifiant, origine, clé chiffrée, date)', async () => {
    const s = store();
    await s.load();
    const good = await s.add({ origin: ORIGIN, browser: 'Google Chrome', key: key(40) });
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    const valid = saved.clients[0];
    saved.clients.push(
      { ...valid, clientId: '../../etc' },
      { ...valid, clientId: 'BBBBBBBBBBBBBBBBBBBBBB', origin: 'javascript:alert(1)' },
      { ...valid, clientId: 'CCCCCCCCCCCCCCCCCCCCCC', keyEnc: '<script>' },
      { ...valid, clientId: 'DDDDDDDDDDDDDDDDDDDDDD', pairedAt: 'hier' },
      { ...valid }, // doublon
      'texte',
    );
    saved.clients.push({ ...valid, clientId: 'EEEEEEEEEEEEEEEEEEEEEE', browser: 'Chrome\u0000<b>' });
    writeFileSync(file, JSON.stringify(saved));
    const reloaded = store();
    await reloaded.load();
    expect(reloaded.list().map(c => c.clientId).sort()).toEqual([good.clientId, 'EEEEEEEEEEEEEEEEEEEEEE'].sort());
    expect(reloaded.list().find(c => c.clientId === 'EEEEEEEEEEEEEEEEEEEEEE')?.browser).toBe('Navigateur');
  });

  it('lecture et écriture impossibles : STORAGE_ERROR, rien n’est ajouté ; la désactivation, elle, s’applique quand même', async () => {
    writeFileSync(path.join(dir, 'bloque'), 'fichier à la place d’un dossier');
    file = path.join(dir, 'bloque', 'local-connector.json');
    const s = store();
    // Fichier impossible à lire : jamais d'erreur au démarrage de l'application, réglages par défaut.
    await s.load();
    expect(s.enabled).toBe(true);
    expect(warnings.some(w => w.includes('impossibles à lire'))).toBe(true);
    await expect(s.add({ origin: ORIGIN, browser: 'Google Chrome', key: key(50) })).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    expect(s.list()).toEqual([]);
    await expect(s.setEnabled(false)).rejects.toMatchObject({ code: 'STORAGE_ERROR' });
    expect(s.enabled).toBe(false);
  });

  it('entrées refusées : origine mal formée, clé de mauvaise taille', async () => {
    const s = store();
    await s.load();
    await expect(s.add({ origin: 'https://magistra-2.vercel.app/chemin', browser: 'x', key: key(1) })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(s.add({ origin: ORIGIN, browser: 'x', key: Buffer.alloc(16) })).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});
