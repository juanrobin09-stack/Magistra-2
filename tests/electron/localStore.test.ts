// Stockage local : écritures atomiques, récupération des fichiers corrompus, historique illimité,
// favoris, suppression, statistiques, documents.

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFERENCES, type StoredDocument } from '../../shared/ipc.js';
import type { NewGenerationRecord } from '../../shared/pipeline.js';
import { writeJsonAtomic } from '../../electron/jsonFile.js';
import { excerptOf, LocalStore } from '../../electron/localStore.js';
import { DOCUMENT_LIMITS, parseStoredPreferences, sanitizePreferencesUpdate, sanitizeStoredDocument } from '../../electron/validate.js';

let dir: string;
let now: Date;
let counter = 0;

function makeStore(): LocalStore {
  return new LocalStore(dir, {
    now: () => now,
    idFactory: () => `id-${String(++counter).padStart(5, '0')}`,
    warn: () => undefined,
  });
}

function record(i: number, matiere = 'mathematiques'): NewGenerationRecord {
  return {
    type: 'cours',
    niveau: 'licence_1',
    matiere,
    sujet: `Sujet ${i}`,
    contenu: `# Titre ${i}\n\nContenu **important** numéro ${i}. ${'Lorem ipsum dolor sit amet. '.repeat(20)}`,
    sources: [],
    params: { researchMode: 'documents' },
    model: 'ministral-3:14b',
  };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'magistra-store-'));
  now = new Date(2026, 8, 28, 15, 0, 0); // lundi 28 septembre 2026, 15 h (heure locale)
  counter = 0;
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('écriture atomique', () => {
  it('ne laisse jamais de fichier partiel ni de fichier temporaire', async () => {
    const file = path.join(dir, 'prefs.json');
    await writeJsonAtomic(file, { a: 1 });
    // Écriture impossible (valeur non sérialisable) : l'ancien contenu reste intact.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(writeJsonAtomic(file, circular)).rejects.toThrow();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: 1 });
    // Écritures concurrentes : sérialisées, le fichier final est complet et valide.
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeJsonAtomic(file, { i, pad: 'x'.repeat(10_000) })));
    expect(JSON.parse(readFileSync(file, 'utf8')).i).toBe(19);
    expect(readdirSync(dir).filter(n => n.endsWith('.tmp'))).toEqual([]);
  });

  it('passe par un fichier temporaire puis un renommage', async () => {
    const renameSpy = vi.spyOn(fsp, 'rename');
    const file = path.join(dir, 'x.json');
    await writeJsonAtomic(file, { ok: true });
    expect(renameSpy).toHaveBeenCalledWith(expect.stringMatching(/x\.json\.\d+\.[0-9a-f]+\.tmp$/), file);
    renameSpy.mockRestore();
  });

  it('supprime au démarrage les fichiers temporaires d’une écriture interrompue', async () => {
    writeFileSync(path.join(dir, 'preferences.json.123.abc.tmp'), '{"trunc');
    await makeStore().init();
    expect(existsSync(path.join(dir, 'preferences.json.123.abc.tmp'))).toBe(false);
  });
});

describe('préférences concurrentes sur de vrais fichiers temporaires', () => {
  it.each(['retrait en premier', 'retrait en dernier'])('%s : un réglage indépendant ne réactive jamais les statistiques', async order => {
    const store = makeStore();
    await store.init();
    await store.setPreferences({ usageStatsEnabled: true, usageStatsChoiceMade: true, searxngUrl: 'https://searx.univ.fr' });
    const updates = [{ usageStatsEnabled: false, usageStatsChoiceMade: true }, { aiSetupRequested: true }];
    if (order === 'retrait en dernier') updates.reverse();
    await Promise.all(updates.map(update => store.setPreferences(update)));
    const expected = { usageStatsEnabled: false, usageStatsChoiceMade: true, aiSetupRequested: true, searxngUrl: 'https://searx.univ.fr' };
    expect(await store.getPreferences()).toMatchObject(expected);
    expect(JSON.parse(readFileSync(path.join(dir, 'preferences.json'), 'utf8'))).toMatchObject(expected);
    expect(await makeStore().getPreferences()).toMatchObject(expected);
  });

  it('une lecture demandée après le retrait attend l’écriture et son cache, même si le disque est lent', async () => {
    const store = makeStore();
    await store.init();
    await store.setPreferences({ usageStatsEnabled: true, usageStatsChoiceMade: true });
    let release!: () => void;
    let reached!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { reached = resolve; });
    const originalOpen = fsp.open;
    let blocked = false;
    const openSpy = vi.spyOn(fsp, 'open').mockImplementation(async (...args) => {
      if (!blocked && String(args[0]).startsWith(path.join(dir, 'preferences.json.'))) {
        blocked = true;
        reached();
        await held;
      }
      return originalOpen(...args);
    });
    try {
      const withdrawal = store.setPreferences({ usageStatsEnabled: false, usageStatsChoiceMade: true });
      await entered;
      const reading = store.getPreferences();
      const unrelated = store.setPreferences({ aiSetupRequested: true });
      release();
      const [, read] = await Promise.all([withdrawal, reading, unrelated]);
      expect(read.usageStatsEnabled).toBe(false);
      expect(await store.getPreferences()).toMatchObject({ usageStatsEnabled: false, aiSetupRequested: true });
      expect(await makeStore().getPreferences()).toMatchObject({ usageStatsEnabled: false, aiSetupRequested: true });
    } finally {
      release();
      openSpy.mockRestore();
    }
  });

  it('un échec ne publie pas un faux succès et ne bloque pas le retrait réessayé ni la mise à jour suivante', async () => {
    const store = makeStore();
    await store.init();
    await store.setPreferences({ usageStatsEnabled: true, usageStatsChoiceMade: true });
    const renameSpy = vi.spyOn(fsp, 'rename').mockRejectedValueOnce(Object.assign(new Error('disque indisponible'), { code: 'EIO' }));
    try {
      const results = await Promise.allSettled([
        store.setPreferences({ usageStatsEnabled: false, usageStatsChoiceMade: true }),
        store.setPreferences({ usageStatsEnabled: false, usageStatsChoiceMade: true }),
        store.setPreferences({ aiSetupRequested: true }),
      ]);
      expect(results[0]).toMatchObject({ status: 'rejected', reason: { code: 'STORAGE_ERROR' } });
      expect(results.slice(1).map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(await store.getPreferences()).toMatchObject({ usageStatsEnabled: false, usageStatsChoiceMade: true, aiSetupRequested: true });
      expect(await makeStore().getPreferences()).toMatchObject({ usageStatsEnabled: false, usageStatsChoiceMade: true, aiSetupRequested: true });
      expect(readdirSync(dir).filter(name => name.endsWith('.tmp'))).toEqual([]);
    } finally { renameSpy.mockRestore(); }
  });

  it('conserve les champs indépendants et capture la mise à jour au moment de son appel', async () => {
    const store = makeStore();
    await store.init();
    await store.setPreferences({ usageStatsEnabled: true, usageStatsChoiceMade: true });
    const withdrawal = { usageStatsEnabled: false };
    const pending = store.setPreferences(withdrawal);
    withdrawal.usageStatsEnabled = true;
    await Promise.all([pending,
      store.setPreferences({ aiSetupRequested: true }),
      store.setPreferences({ academicEnabled: false }),
      store.setPreferences({ wikipediaEnabled: false }),
      store.setPreferences({ defaultResearchMode: 'documents' }),
    ]);
    expect(await makeStore().getPreferences()).toMatchObject({ usageStatsEnabled: false, usageStatsChoiceMade: true,
      aiSetupRequested: true, academicEnabled: false, wikipediaEnabled: false, defaultResearchMode: 'documents' });
  });

  it('effacement total : le retrait préalable reste persisté malgré un ancien accord et un réglage indépendant', async () => {
    const store = makeStore();
    await store.init();
    await store.saveGeneration(record(1));
    await store.setPreferences({ setupCompleted: true, usageStatsEnabled: true, usageStatsChoiceMade: true });
    const olderAgreement = store.setPreferences({ usageStatsEnabled: true, usageStatsChoiceMade: true });
    // Même ordre que onClearUsage puis dataClearAll : retrait enregistré avant l'effacement des données.
    const clearing = (async () => {
      await store.setPreferences({ usageStatsEnabled: false, usageStatsChoiceMade: true });
      await store.clearAll();
    })();
    const unrelated = store.setPreferences({ aiSetupRequested: true });
    await Promise.all([olderAgreement, clearing, unrelated]);
    expect((await store.stats()).total).toBe(0);
    expect(await store.getPreferences()).toMatchObject({ usageStatsEnabled: false, usageStatsChoiceMade: true,
      setupCompleted: true, aiSetupRequested: true });
    expect(await makeStore().getPreferences()).toMatchObject({ usageStatsEnabled: false, usageStatsChoiceMade: true,
      setupCompleted: true, aiSetupRequested: true });
  });
});

describe('fichiers corrompus', () => {
  it('préférences illisibles : mises de côté, valeurs par défaut, autres réglages intacts', async () => {
    const store = makeStore();
    await store.init();
    await store.setProfile({ displayName: 'Mme Martin', etablissement: 'Université de Lyon', cycle: 'superieur', niveaux: ['licence_1'], matierePrincipale: 'mathematiques' });
    writeFileSync(path.join(dir, 'ai-config.json'), '{"mode":"local","tier":"qualite"}');
    writeFileSync(path.join(dir, 'preferences.json'), '{ "setupCompleted": tru');

    const fresh = makeStore();
    await fresh.init();
    expect(await fresh.getPreferences()).toEqual(DEFAULT_PREFERENCES);
    const names = readdirSync(dir);
    expect(names.some(n => /^preferences\.json\.corrupt-\d{4}-\d{2}-\d{2}T/.test(n))).toBe(true);
    expect((await fresh.getProfile())?.displayName).toBe('Mme Martin');
    expect(readFileSync(path.join(dir, 'ai-config.json'), 'utf8')).toBe('{"mode":"local","tier":"qualite"}');
    // Un nouvel enregistrement fonctionne ensuite normalement.
    await fresh.setPreferences({ setupCompleted: true });
    expect((await makeStore().getPreferences()).setupCompleted).toBe(true);
  });

  it('préférences partiellement invalides : chaque champ invalide reprend sa valeur par défaut', async () => {
    writeFileSync(path.join(dir, 'preferences.json'), JSON.stringify({ setupCompleted: true, academicEnabled: 'oui', defaultResearchMode: 'n-importe-quoi', searxngUrl: 'javascript:1' }));
    const prefs = await makeStore().getPreferences();
    expect(prefs.setupCompleted).toBe(true);
    expect(prefs.academicEnabled).toBe(DEFAULT_PREFERENCES.academicEnabled);
    expect(prefs.defaultResearchMode).toBe(DEFAULT_PREFERENCES.defaultResearchMode);
    expect(prefs.searxngUrl).toBeUndefined();
  });

  it('activation de l’IA demandée (aiSetupRequested) : faux par défaut, persistée, relue ; valeur invalide ignorée', async () => {
    expect(DEFAULT_PREFERENCES.aiSetupRequested).toBe(false);
    const store = makeStore();
    expect((await store.getPreferences()).aiSetupRequested).toBe(false);
    await store.setPreferences({ aiSetupRequested: true });
    // Nouveau lancement de Magistra : la demande est retrouvée (reprise automatique de l'activation).
    expect((await makeStore().getPreferences()).aiSetupRequested).toBe(true);
    expect(JSON.parse(readFileSync(path.join(dir, 'preferences.json'), 'utf8')).aiSetupRequested).toBe(true);
    await store.setPreferences({ aiSetupRequested: false });
    expect((await makeStore().getPreferences()).aiSetupRequested).toBe(false);

    writeFileSync(path.join(dir, 'preferences.json'), JSON.stringify({ aiSetupRequested: 'oui', keepDocuments: true }));
    const prefs = await makeStore().getPreferences();
    expect(prefs.aiSetupRequested).toBe(false);
    expect(prefs.keepDocuments).toBe(true);
    // Préférences d'une version précédente (sans ce champ) : valeur par défaut.
    expect(parseStoredPreferences({ setupCompleted: true })?.aiSetupRequested).toBe(false);
  });

  it('mise à jour venue de la fenêtre : aiSetupRequested booléen uniquement', () => {
    expect(sanitizePreferencesUpdate({ aiSetupRequested: true })).toEqual({ aiSetupRequested: true });
    expect(sanitizePreferencesUpdate({ aiSetupRequested: false })).toEqual({ aiSetupRequested: false });
    for (const bad of ['true', 1, null, {}]) {
      expect(() => sanitizePreferencesUpdate({ aiSetupRequested: bad })).toThrow(/Paramètre invalide : aiSetupRequested/);
    }
  });

  it('génération illisible : ignorée et mise de côté, les autres restent listées', async () => {
    const store = makeStore();
    await store.init();
    await store.saveGeneration(record(1));
    await store.saveGeneration(record(2));
    writeFileSync(path.join(dir, 'generations', 'broken-1.json'), '{"id":"broken-1", "contenu": ');
    const fresh = makeStore();
    await fresh.init();
    const page = await fresh.list({ favoritesOnly: false, limit: 50 });
    expect(page.items.map(i => i.sujet).sort()).toEqual(['Sujet 1', 'Sujet 2']);
    expect(readdirSync(path.join(dir, 'generations')).some(n => n.startsWith('broken-1.json.corrupt-'))).toBe(true);
  });
});

/** Lecture refusée (antivirus, droits cassés) pour les fichiers dont le nom contient `needle`. */
function denyReads(needle: string, code = 'EPERM') {
  const real = fsp.readFile.bind(fsp);
  return vi.spyOn(fsp, 'readFile').mockImplementation((async (file: unknown, ...rest: unknown[]) => {
    if (typeof file === 'string' && file.includes(needle)) throw Object.assign(new Error(`${code}: accès refusé`), { code });
    return (real as (...a: unknown[]) => unknown)(file, ...rest);
  }) as never);
}

describe('fichiers inaccessibles (EPERM, EBUSY)', () => {
  it('une génération verrouillée n’empêche pas le démarrage : les autres sont listées, le fichier n’est pas renommé', async () => {
    const store = makeStore();
    await store.init();
    await store.saveGeneration(record(1));
    const locked = await store.saveGeneration(record(2));
    await store.saveGeneration(record(3));
    for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
      const spy = denyReads(`${locked.id}.json`, code);
      const warnings: string[] = [];
      const fresh = new LocalStore(dir, { warn: m => void warnings.push(m) });
      await expect(fresh.init()).resolves.toBeUndefined();
      const page = await fresh.list({ favoritesOnly: false, limit: 50 });
      expect(page.items.map(i => i.sujet).sort()).toEqual(['Sujet 1', 'Sujet 3']);
      expect(warnings).toEqual([`Génération inaccessible ignorée : ${locked.id}.json`]);
      spy.mockRestore();
    }
    expect(readdirSync(path.join(dir, 'generations')).filter(n => n.includes('.corrupt-'))).toEqual([]);
    // Redevenu lisible : le fichier réapparaît au lancement suivant.
    const later = makeStore();
    await later.init();
    expect((await later.list({ favoritesOnly: false, limit: 50 })).items).toHaveLength(3);
  });

  it('un document verrouillé : les autres documents restent listés', async () => {
    const store = makeStore();
    await store.init();
    await store.setPreferences({ keepDocuments: true });
    const doc = (id: string): StoredDocument => ({
      id, name: `${id}.pdf`, kind: 'pdf', description: '', savedAt: '2026-09-28T10:00:00.000Z',
      units: [{ locator: { type: 'pages', start: 1, end: 1 }, text: 'texte' }], chars: 5,
    });
    await store.saveDocument(doc('doc-1'));
    await store.saveDocument(doc('doc-2'));
    const spy = denyReads('doc-1.json', 'EBUSY');
    const fresh = makeStore();
    await fresh.init();
    expect((await fresh.listDocuments()).map(d => d.id)).toEqual(['doc-2']);
    spy.mockRestore();
    expect(readdirSync(path.join(dir, 'documents')).filter(n => n.includes('.corrupt-'))).toEqual([]);
  });
});

describe('historique', () => {
  it('pagination par curseur, sans limite de taille, plus récent d’abord', async () => {
    const store = makeStore();
    await store.init();
    const total = 257;
    for (let i = 0; i < total; i++) {
      now = new Date(2026, 0, 1, 8, 0, i); // une seconde d'écart
      await store.saveGeneration(record(i));
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await store.list({ favoritesOnly: false, limit: 40, cursor });
      seen.push(...page.items.map(i => i.sujet));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
    expect(seen[0]).toBe('Sujet 256');
    expect(seen[total - 1]).toBe('Sujet 0');
    expect(pages).toBe(Math.ceil(total / 40));
    // L'index est reconstruit à partir des fichiers au redémarrage.
    const fresh = makeStore();
    await fresh.init();
    expect((await fresh.stats()).total).toBe(total);
  });

  it('résumés avec un extrait d’environ 240 caractères, sans Markdown', async () => {
    const store = makeStore();
    await store.init();
    await store.saveGeneration(record(1));
    const [item] = (await store.list({ favoritesOnly: false, limit: 10 })).items;
    expect(item.excerpt.length).toBeLessThanOrEqual(241);
    expect(item.excerpt).not.toMatch(/[#*]/);
    expect(item.excerpt.startsWith('Titre 1 Contenu important numéro 1.')).toBe(true);
    expect(excerptOf('[lien](https://x.fr) et `code`')).toBe('lien et code');
  });

  it('extrait d’un contenu démesuré (100 000 crochets) : immédiat, et identique pour un contenu ordinaire', () => {
    const t0 = Date.now();
    excerptOf('['.repeat(100_000));
    excerptOf(`${'Texte utile. '.repeat(10)}${'[]('.repeat(60_000)}`);
    // Borne très large (machine chargée) : une quinzaine de millisecondes en temps normal.
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(excerptOf('# Titre\n\nUn paragraphe **important**.')).toBe(excerptOf('# Titre\n\nUn paragraphe **important**.'.slice(0, 4_000)));
    expect(excerptOf('# Titre\n\nUn paragraphe **important**.').startsWith('Titre Un paragraphe important')).toBe(true);
  });

  it('favoris, lecture, suppression', async () => {
    const store = makeStore();
    await store.init();
    const { id: a } = await store.saveGeneration(record(1));
    const { id: b } = await store.saveGeneration(record(2));
    await store.setFavorite(a, true);
    expect((await store.get(a))?.isFavorite).toBe(true);
    expect((await store.list({ favoritesOnly: true, limit: 10 })).items.map(i => i.id)).toEqual([a]);
    await store.delete(b);
    expect(await store.get(b)).toBeNull();
    expect((await store.list({ favoritesOnly: false, limit: 10 })).items.map(i => i.id)).toEqual([a]);
    await expect(store.setFavorite('inexistant', true)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await store.get('../ai-config')).toBeNull();
  });

  it('statistiques exactes selon l’heure locale', async () => {
    const store = makeStore();
    await store.init();
    const at = async (d: Date, matiere = 'mathematiques') => {
      now = d;
      return store.saveGeneration(record(0, matiere));
    };
    await at(new Date(2026, 8, 28, 0, 5)); // aujourd'hui, juste après minuit
    await at(new Date(2026, 8, 28, 14, 0), 'physique');
    await at(new Date(2026, 8, 27, 23, 59)); // hier soir
    await at(new Date(2026, 8, 22, 0, 1)); // il y a 6 jours → dans la semaine
    await at(new Date(2026, 8, 21, 23, 59), 'physique'); // il y a 7 jours → hors semaine
    const { id } = await at(new Date(2026, 5, 1, 10, 0));
    await store.setFavorite(id, true);
    now = new Date(2026, 8, 28, 15, 0);
    expect(await store.stats()).toEqual({ total: 6, favorites: 1, today: 2, week: 4, topMatiere: { matiere: 'mathematiques', count: 4 } });
  });

  it('clearAll efface historique, profil et documents mais garde les préférences', async () => {
    const store = makeStore();
    await store.init();
    await store.saveGeneration(record(1));
    await store.setProfile({ displayName: 'M. Durand', etablissement: '', cycle: '', niveaux: [], matierePrincipale: 'autre' });
    await store.setPreferences({ setupCompleted: true, keepDocuments: true });
    await store.clearAll();
    expect((await store.stats()).total).toBe(0);
    expect(await store.getProfile()).toBeNull();
    expect((await store.getPreferences()).setupCompleted).toBe(true);
  });
});

describe('documents conservés (texte extrait uniquement)', () => {
  const doc: StoredDocument = {
    id: 'doc-1',
    name: 'cours.pdf',
    kind: 'pdf',
    description: 'Cours de L1',
    savedAt: '2026-09-28T10:00:00.000Z',
    units: [{ locator: { type: 'pages', start: 1, end: 1 }, text: 'Texte de la page 1' }],
    chars: 18,
  };

  it("n'enregistre rien si l'enseignant n'a pas choisi de conserver ses documents", async () => {
    const store = makeStore();
    await store.init();
    expect(await store.saveDocument(doc)).toBe(false);
    expect(await store.listDocuments()).toEqual([]);
  });

  it('enregistre, liste, recharge, et efface tout quand la conservation est désactivée', async () => {
    const store = makeStore();
    await store.init();
    await store.setPreferences({ keepDocuments: true });
    expect(await store.saveDocument(doc)).toBe(true);
    expect(await store.listDocuments()).toEqual([{ id: 'doc-1', name: 'cours.pdf', kind: 'pdf', description: 'Cours de L1', savedAt: doc.savedAt, chars: 18 }]);
    expect((await makeStore().loadDocument('doc-1'))?.units[0].text).toBe('Texte de la page 1');
    await store.setPreferences({ keepDocuments: false });
    expect(await store.listDocuments()).toEqual([]);
    expect(await makeStore().loadDocument('doc-1')).toBeNull();
  });

  it('conserve les avertissements de lecture et de reconnaissance après un redémarrage', async () => {
    const store = makeStore();
    await store.init();
    await store.setPreferences({ keepDocuments: true });
    const warnings = ['1 page sans texte a été ignorée.', 'Texte reconnu localement : vérifiez les nombres et le japonais.'];
    await store.saveDocument({ ...doc, warnings });
    expect((await store.listDocuments())[0].warnings).toEqual(warnings);
    const fresh = makeStore();
    await fresh.init();
    expect((await fresh.loadDocument(doc.id))?.warnings).toEqual(warnings);
    expect((await fresh.listDocuments())[0].warnings).toEqual(warnings);
  });

  it('ne partage pas le tableau des avertissements entre les appelants et l’index', async () => {
    const store = makeStore();
    await store.init();
    await store.setPreferences({ keepDocuments: true });
    const warnings = ['Lecture partielle.'];
    await store.saveDocument({ ...doc, warnings });
    warnings.push('Modification de l’appelant.');
    const [summary] = await store.listDocuments();
    expect(summary.warnings).toEqual(['Lecture partielle.']);
    summary.warnings?.push('Modification du résumé.');
    expect((await store.listDocuments())[0].warnings).toEqual(['Lecture partielle.']);
    expect((await store.loadDocument(doc.id))?.warnings).toEqual(['Lecture partielle.']);
  });

  it('relit les anciens documents sans champ warnings et garde leurs bornes de texte', () => {
    expect(sanitizeStoredDocument(doc).warnings).toBeUndefined();
    expect(() => sanitizeStoredDocument({ ...doc, units: [{ locator: doc.units[0].locator, text: 'x'.repeat(DOCUMENT_LIMITS.unitChars + 1) }] }))
      .toThrow(expect.objectContaining({ code: 'DOCUMENT_TOO_LARGE' }));
  });

  it('nettoie les avertissements valides sans perdre les accents et les caractères japonais', () => {
    const raw = ['  Vérifiez 猫 et École.  ', '', '\u0000Lecture partielle.', 'Vérifiez 猫 et École.'];
    expect(sanitizeStoredDocument({ ...doc, warnings: raw }).warnings).toEqual(['Vérifiez 猫 et École.', 'Lecture partielle.']);
    expect(raw).toHaveLength(4);
  });

  for (const [label, warnings] of [
    ['un tableau manquant', 'Lecture partielle.'],
    ['un message non textuel', [true]],
    ['trop de messages', Array.from({ length: DOCUMENT_LIMITS.warnings + 1 }, () => 'Lecture partielle.')],
    ['un message trop long', ['x'.repeat(DOCUMENT_LIMITS.warningChars + 1)]],
    ['des caractères de contrôle', ['Lecture\u0001partielle.']],
  ]) {
    it(`refuse ${label} dans les avertissements enregistrés`, () => {
      expect(() => sanitizeStoredDocument({ ...doc, warnings }))
        .toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    });
  }
});
