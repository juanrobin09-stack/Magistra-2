// Stockage en fichiers (MAGISTRA_STORE=file, mode personnel) : persistance, isolement des utilisateurs,
// écritures atomiques, fichiers abîmés mis de côté, anti-abus.

import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NewGenerationRecord } from '../../shared/pipeline.js';
import { FileStore } from '../../server/fileStore.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'magistra-fichiers-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function record(sujet: string, matiere = 'mathematiques'): NewGenerationRecord {
  return { type: 'cours', niveau: 'terminale_gen', matiere, sujet, contenu: `# ${sujet}\n\nContenu du cours.`, sources: [], params: {} };
}

function filesUnder(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => path.join(e.parentPath, e.name));
}

describe('FileStore', () => {
  it('conserve l’historique, les favoris et le profil après un redémarrage', async () => {
    let t = Date.parse('2026-09-28T08:00:00Z');
    const now = () => new Date((t += 1_000));
    const store = new FileStore(dir, { now });
    const a = await store.saveGeneration('enseignant_local', record('Les suites'));
    const b = await store.saveGeneration('enseignant_local', record('Les intégrales'));
    await store.setFavorite('enseignant_local', a.id, true);
    await store.saveProfile('enseignant_local', { displayName: 'M. Martin', etablissement: 'Lycée', cycle: 'lycee', niveaux: ['terminale_gen'], matierePrincipale: 'mathematiques' });

    const reopened = new FileStore(dir, { now });
    const page = await reopened.listGenerations('enseignant_local', { limit: 10 });
    expect(page.items.map(i => i.sujet)).toEqual(['Les intégrales', 'Les suites']);
    expect(page.items[1].isFavorite).toBe(true);
    expect((await reopened.getGeneration('enseignant_local', b.id)).contenu).toContain('Contenu du cours');
    expect((await reopened.listGenerations('enseignant_local', { limit: 10, favoritesOnly: true })).items.map(i => i.id)).toEqual([a.id]);
    expect((await reopened.getProfile('enseignant_local'))?.displayName).toBe('M. Martin');
    const stats = await reopened.getStats('enseignant_local', 'Europe/Paris');
    expect(stats).toMatchObject({ total: 2, favorites: 1, topMatiere: { matiere: 'mathematiques', count: 2 } });
  });

  it('pagination par curseur, comme les autres stockages', async () => {
    let t = Date.parse('2026-09-01T08:00:00Z');
    const store = new FileStore(dir, { now: () => new Date((t += 60_000)) });
    for (let i = 0; i < 5; i++) await store.saveGeneration('u1', record(`Sujet ${i}`));
    const first = await store.listGenerations('u1', { limit: 2 });
    expect(first.items.map(i => i.sujet)).toEqual(['Sujet 4', 'Sujet 3']);
    const second = await store.listGenerations('u1', { limit: 2, cursor: first.nextCursor });
    expect(second.items.map(i => i.sujet)).toEqual(['Sujet 2', 'Sujet 1']);
    const third = await store.listGenerations('u1', { limit: 2, cursor: second.nextCursor });
    expect(third.items.map(i => i.sujet)).toEqual(['Sujet 0']);
    expect(third.nextCursor).toBeUndefined();
  });

  it('isole les utilisateurs ; aucun identifiant dans les noms de fichiers ; fichiers en 0600', async () => {
    const store = new FileStore(dir);
    const own = await store.saveGeneration('user_A', record('Privé A'));
    await store.saveGeneration('user:B|x@y', record('Privé B'));
    await expect(store.getGeneration('user:B|x@y', own.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(store.deleteGeneration('user:B|x@y', own.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(store.setFavorite('user:B|x@y', own.id, true)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await store.listGenerations('user:B|x@y', { limit: 10 })).items.map(i => i.sujet)).toEqual(['Privé B']);
    const files = filesUnder(dir);
    expect(files.join('\n')).not.toMatch(/user_A|user:B/);
    if (process.platform !== 'win32') for (const f of files) expect(statSync(f).mode & 0o077, f).toBe(0);
  });

  it('suppression d’un contenu et du compte entier', async () => {
    const store = new FileStore(dir);
    const a = await store.saveGeneration('u1', record('A'));
    await store.saveGeneration('u1', record('B'));
    await store.deleteGeneration('u1', a.id);
    expect((await new FileStore(dir).listGenerations('u1', { limit: 10 })).items.map(i => i.sujet)).toEqual(['B']);
    await store.saveProfile('u1', { displayName: 'X', etablissement: '', cycle: '', niveaux: [], matierePrincipale: 'autre' });
    await store.deleteAccount('u1');
    expect((await store.listGenerations('u1', { limit: 10 })).items).toEqual([]);
    expect(await store.getProfile('u1')).toBeNull();
    expect(filesUnder(dir)).toEqual([]);
  });

  it('fichier abîmé : mis de côté sans bloquer le reste de l’historique', async () => {
    const warnings: string[] = [];
    const store = new FileStore(dir);
    const ok = await store.saveGeneration('u1', record('Intact'));
    const bad = await store.saveGeneration('u1', record('Abîmé'));
    const badFile = filesUnder(dir).find(f => f.endsWith(`${bad.id}.json`))!;
    writeFileSync(badFile, '{ "id": ');
    const reopened = new FileStore(dir, { warn: m => warnings.push(m) });
    expect((await reopened.listGenerations('u1', { limit: 10 })).items.map(i => i.id)).toEqual([ok.id]);
    expect(warnings.join('\n')).toContain('mis de côté');
    expect(warnings.join('\n')).not.toContain('Abîmé');
    expect(filesUnder(dir).some(f => /\.corrupt-/.test(f))).toBe(true);
  });

  it('anti-abus en mémoire, même sémantique que les autres stockages', async () => {
    const store = new FileStore(dir);
    const limits = { windowSeconds: 60, maxRequests: 2, maxGlobalRequests: 0, maxActive: 1, activeTtlSeconds: 300 };
    const first = await store.beginGeneration('u1', limits);
    expect(first.status).toBe('ok');
    expect(await store.beginGeneration('u1', limits)).toEqual({ status: 'busy' });
    if (first.status === 'ok' && first.slotId) await store.endGeneration('u1', first.slotId);
    expect((await store.beginGeneration('u1', limits)).status).toBe('ok');
  });
});
