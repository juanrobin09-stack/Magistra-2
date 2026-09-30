// Génération dans le processus principal : évènements, sauvegarde, une seule génération à la fois,
// annulation, capacités. Fournisseur simulé (MockProvider), aucun réseau.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockProvider } from '../../shared/ai/mock.js';
import type { AIProvider, PreloadOptions } from '../../shared/ai/provider.js';
import { MagistraError } from '../../shared/errors.js';
import type { GenerationEvent, PrivacyInfo } from '../../shared/types.js';
import {
  BUSY_EXTERNAL_MESSAGE, BUSY_WINDOW_MESSAGE, GenerationManager, maxDocumentCharsFor, type GenerationDeps, type GenerationPayload,
} from '../../electron/generation.js';
import { LocalStore } from '../../electron/localStore.js';

let dir: string;
let store: LocalStore;

beforeEach(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'magistra-gen-'));
  store = new LocalStore(dir, { warn: () => undefined });
  await store.init();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const REQUEST = {
  type: 'cours',
  niveau: 'licence_2',
  matiere: 'mathematiques',
  sujet: 'Espaces vectoriels',
  researchMode: 'documents',
  documents: [{ docId: 'd1', docName: 'poly.pdf', kind: 'pdf', locator: { type: 'pages', start: 3, end: 4 }, text: 'Un espace vectoriel est un ensemble muni de deux lois.' }],
};

type Active = Awaited<ReturnType<GenerationDeps['describeActive']>>;

function manager(
  provider: AIProvider | (() => Promise<AIProvider>),
  opts: { privacy?: PrivacyInfo; windowOpen?: () => boolean; active?: Partial<Active>; isLocalEngine?: () => boolean } = {},
) {
  const payloads: GenerationPayload[] = [];
  const gm = new GenerationManager({
    ...(opts.isLocalEngine ? { isLocalEngine: opts.isLocalEngine } : {}),
    store,
    resolveProvider: async (_signal, onStatus) => {
      onStatus('Démarrage du moteur IA…');
      return typeof provider === 'function' ? provider() : provider;
    },
    describeActive: async () => ({ label: 'Magistra Standard', contextTokens: 12_288, ready: true, privacy: opts.privacy ?? { level: 'local', message: 'IA locale' }, ...opts.active }),
    send: payload => {
      if (opts.windowOpen && !opts.windowOpen()) return false;
      payloads.push(payload);
      return true;
    },
    fetch: async () => {
      throw new Error('aucun accès réseau dans ce test');
    },
  });
  const finished = (jobId: string) =>
    new Promise<GenerationEvent[]>((resolve, reject) => {
      const deadline = Date.now() + 5_000;
      const check = () => {
        const events = payloads.filter(p => p.jobId === jobId).map(p => p.event);
        if (events.some(e => e.type === 'done' || e.type === 'error')) return resolve(events);
        if (Date.now() > deadline) return reject(new Error('génération non terminée'));
        setTimeout(check, 5);
      };
      check();
    });
  return { gm, payloads, finished };
}

describe('GenerationManager', () => {
  it('diffuse les évènements dans l’ordre, cite la source et enregistre dans l’historique', async () => {
    const provider = new MockProvider({ reply: '# Espaces vectoriels\n\nUn espace vectoriel possède deux lois [S1].', model: 'ministral-3:14b', contextTokens: 12_288 });
    const { gm, finished } = manager(provider);
    const { jobId } = gm.start(REQUEST);
    const events = await finished(jobId);
    const types = events.map(e => e.type);
    expect(types[0]).toBe('status');
    expect(types).toContain('sources');
    expect(types).toContain('delta');
    const done = events.at(-1) as Extract<GenerationEvent, { type: 'done' }>;
    expect(done).toMatchObject({ type: 'done', saved: true, truncated: false, internetUsed: false, model: 'ministral-3:14b' });
    expect(done.sources).toHaveLength(1);
    expect(done.content).toContain('[S1]');
    const saved = await store.get(done.id!);
    expect(saved).toMatchObject({ sujet: 'Espaces vectoriels', type: 'cours', niveau: 'licence_2', model: 'ministral-3:14b' });
    // Le texte des documents n'est pas conservé dans l'historique, seulement leur nom.
    expect(JSON.stringify(saved)).not.toContain('muni de deux lois');
    expect(gm.busy).toBe(false);
  });

  it('une seule génération à la fois (GENERATION_BUSY), aucune limite ensuite', async () => {
    const provider = new MockProvider({ reply: 'x'.repeat(400), chunkSize: 10, delayMs: 5 });
    const { gm, finished } = manager(provider);
    const first = gm.start(REQUEST);
    expect(() => gm.start(REQUEST)).toThrow(expect.objectContaining({ code: 'GENERATION_BUSY' }));
    await finished(first.jobId);
    await new Promise(r => setTimeout(r, 0));
    // Génération illimitée : pas de quota, on enchaîne.
    for (let i = 0; i < 5; i++) {
      const { jobId } = gm.start(REQUEST);
      const events = await finished(jobId);
      expect(events.at(-1)?.type).toBe('done');
      await new Promise(r => setTimeout(r, 0));
    }
    expect((await store.stats()).total).toBe(6);
  });

  it('annulation : évènement GENERATION_ABORTED, rien n’est enregistré', async () => {
    const provider = new MockProvider({ reply: 'y'.repeat(2_000), chunkSize: 10, delayMs: 5 });
    const { gm, finished, payloads } = manager(provider);
    const { jobId } = gm.start(REQUEST);
    await new Promise(r => setTimeout(r, 40));
    gm.cancel('autre-job');
    expect(gm.busy).toBe(true);
    gm.cancel(jobId);
    const events = await finished(jobId);
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'GENERATION_ABORTED' });
    expect(payloads.filter(p => p.event.type === 'error')).toHaveLength(1);
    expect((await store.stats()).total).toBe(0);
    await new Promise(r => setTimeout(r, 0));
    expect(gm.busy).toBe(false);
  });

  it('demande invalide : refus immédiat (INVALID_REQUEST), rien ne démarre', () => {
    const { gm } = manager(new MockProvider());
    expect(() => gm.start({ ...REQUEST, type: 'inconnu' })).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(() => gm.start({ ...REQUEST, sujet: '' })).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(gm.busy).toBe(false);
  });

  it('moteur indisponible : erreur claire transmise comme évènement', async () => {
    const { gm, finished } = manager(async () => {
      throw new MagistraError('MODEL_NOT_INSTALLED', 'Le modèle Magistra Standard n’est pas encore installé.');
    });
    const { jobId } = gm.start(REQUEST);
    const events = await finished(jobId);
    expect(events.map(e => e.type)).toEqual(['status', 'status', 'error']);
    expect(events.at(-1)).toMatchObject({ code: 'MODEL_NOT_INSTALLED', message: 'Le modèle Magistra Standard n’est pas encore installé.' });
  });

  it('mémoire insuffisante : message compréhensible', async () => {
    const { gm, finished } = manager(new MockProvider({ failWith: new MagistraError('OUT_OF_MEMORY') }));
    const { jobId } = gm.start(REQUEST);
    expect((await finished(jobId)).at(-1)).toMatchObject({ type: 'error', code: 'OUT_OF_MEMORY', retryable: true });
  });

  it('moteur local : le modèle est préchargé (« Chargement du modèle… ») avant la rédaction ; serveur distant : non', async () => {
    const order: string[] = [];
    class PreloadingProvider extends MockProvider {
      async preload(options?: PreloadOptions): Promise<void> {
        void options;
        order.push('preload');
      }
    }
    const local = new PreloadingProvider({ reply: 'Texte [S1].', local: true });
    const { gm, finished } = manager(local);
    const events = await finished(gm.start(REQUEST).jobId);
    expect(order).toEqual(['preload']);
    const statuses = events.filter((e): e is Extract<GenerationEvent, { type: 'status' }> => e.type === 'status');
    expect(statuses.map(e => e.message)).toContain('Chargement du modèle…');
    expect(statuses.find(e => e.message === 'Chargement du modèle…')?.stage).toBe('loading_model');
    expect(events.at(-1)?.type).toBe('done');

    order.length = 0;
    const remote = new PreloadingProvider({ reply: 'Texte.', local: false });
    const other = manager(remote);
    await other.finished(other.gm.start(REQUEST).jobId);
    expect(order).toEqual([]);
  });

  it('fenêtre fermée pendant la génération : le travail est interrompu', async () => {
    let open = true;
    const provider = new MockProvider({ reply: 'z'.repeat(3_000), chunkSize: 10, delayMs: 5 });
    const { gm } = manager(provider, { windowOpen: () => open });
    gm.start(REQUEST);
    await new Promise(r => setTimeout(r, 30));
    open = false;
    await new Promise(r => setTimeout(r, 100));
    expect(gm.busy).toBe(false);
    expect((await store.stats()).total).toBe(0);
  });
});

describe('capacités', () => {
  it('taille des documents dérivée du contexte du modèle, recherche selon les préférences', async () => {
    expect(maxDocumentCharsFor(12_288)).toBe(Math.floor((12_288 * 0.55 - 2500) * 3.2));
    expect(maxDocumentCharsFor(16_384)).toBe(20_835);
    await store.setPreferences({ academicEnabled: false, searxngUrl: 'https://searx.univ.fr' });
    const { gm } = manager(new MockProvider(), { privacy: { level: 'local', message: 'IA locale — Vos documents et générations restent sur cet ordinateur.' } });
    expect(await gm.capabilities()).toEqual({
      maxDocumentChars: maxDocumentCharsFor(12_288),
      research: { academic: false, web: true, institutional: true, wikipedia: true },
      privacy: { level: 'local', message: 'IA locale — Vos documents et générations restent sur cet ordinateur.' },
      engineLabel: 'Magistra Standard',
      ready: true,
    });
  });

  it('IA non prête : cause précise (notReady) ; serveur distant : prestataire annoncé (providerInfo)', async () => {
    const notReady = { code: 'ENGINE_OUTDATED' as const, message: 'Le moteur IA installé (Ollama 0.12.3) est trop ancien.' };
    const providerInfo = { label: 'Mistral AI (La Plateforme)', thirdParty: true };
    const { gm } = manager(new MockProvider(), { active: { ready: false, notReady, providerInfo } });
    expect(await gm.capabilities()).toMatchObject({ ready: false, notReady, providerInfo });
    const ok = manager(new MockProvider(), { active: { ready: true, notReady } });
    expect((await ok.gm.capabilities()).notReady).toBeUndefined();
  });
});

describe('générations du site (connecteur local)', () => {
  /** Destinataire d'une génération du site (flux NDJSON simulé). */
  function sink(open: () => boolean = () => true) {
    const events: GenerationEvent[] = [];
    return { events, send: (event: GenerationEvent) => (open() ? (events.push(event), true) : false) };
  }

  it('évènements vers leur propre destinataire, jamais vers la fenêtre ; « done » porte la génération, rien n’est enregistré', async () => {
    const { gm, payloads } = manager(new MockProvider({ reply: '# Espaces vectoriels\n\nDeux lois [S1].', model: 'ministral-3:14b' }));
    const out = sink();
    const handle = gm.startExternal(REQUEST, { owner: 'navigateur-A', send: out.send, requireLocal: true });
    expect(gm.busy).toBe(true);
    expect(gm.busyExternal).toBe(true);
    await handle.finished;
    // Créneau libéré dès la fin : une nouvelle génération est aussitôt possible.
    expect(gm.busy).toBe(false);
    expect(payloads).toEqual([]);
    const done = out.events.at(-1) as Extract<GenerationEvent, { type: 'done' }>;
    expect(done).toMatchObject({ type: 'done', saved: false, model: 'ministral-3:14b' });
    expect(done.id).toBeUndefined();
    expect(done.record).toMatchObject({ type: 'cours', sujet: 'Espaces vectoriels', contenu: done.content, model: 'ministral-3:14b' });
    expect(done.record?.sources).toHaveLength(1);
    expect(JSON.stringify(done.record)).not.toContain('muni de deux lois');
    expect((await store.stats()).total).toBe(0);
  });

  it('même créneau unique que la fenêtre, avec la cause dans le message', async () => {
    const provider = new MockProvider({ reply: 'x'.repeat(2_000), chunkSize: 10, delayMs: 5 });
    const { gm, finished } = manager(provider);
    const win = gm.start(REQUEST);
    expect(() => gm.startExternal(REQUEST, { owner: 'A', send: sink().send })).toThrow(expect.objectContaining({ code: 'GENERATION_BUSY', message: BUSY_WINDOW_MESSAGE }));
    gm.cancel(win.jobId);
    await finished(win.jobId);
    await new Promise(r => setTimeout(r, 0));
    const handle = gm.startExternal(REQUEST, { owner: 'A', send: sink().send });
    expect(() => gm.start(REQUEST)).toThrow(expect.objectContaining({ code: 'GENERATION_BUSY', message: BUSY_EXTERNAL_MESSAGE }));
    expect(() => gm.startExternal(REQUEST, { owner: 'B', send: sink().send })).toThrow(expect.objectContaining({ code: 'GENERATION_BUSY' }));
    gm.cancelExternal(handle.jobId, 'A');
    await handle.finished;
    expect(gm.busy).toBe(false);
  });

  it('moteur distant : LOCAL_ENGINE_REMOTE avant tout évènement (réglage), ou avant tout envoi au moteur (fournisseur)', async () => {
    const remote = new MockProvider({ reply: 'jamais', local: false });
    const bySetting = manager(remote, { isLocalEngine: () => false });
    expect(() => bySetting.gm.startExternal(REQUEST, { owner: 'A', send: sink().send, requireLocal: true }))
      .toThrow(expect.objectContaining({ code: 'LOCAL_ENGINE_REMOTE', status: 409 }));
    expect(bySetting.gm.busy).toBe(false);
    // La fenêtre, elle, peut utiliser le serveur distant choisi par l'enseignant.
    expect(() => bySetting.gm.start(REQUEST)).not.toThrow();
    bySetting.gm.cancelAll();

    const byProvider = manager(remote);
    const out = sink();
    await byProvider.gm.startExternal(REQUEST, { owner: 'A', send: out.send, requireLocal: true }).finished;
    expect(out.events.at(-1)).toMatchObject({ type: 'error', code: 'LOCAL_ENGINE_REMOTE' });
    expect(remote.calls).toHaveLength(0);
  });

  it('demande invalide : refus immédiat, créneau libre', () => {
    const { gm } = manager(new MockProvider());
    expect(() => gm.startExternal({ ...REQUEST, sujet: '' }, { owner: 'A', send: sink().send })).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(() => gm.startExternal(REQUEST, { owner: '', send: sink().send })).toThrow(expect.objectContaining({ code: 'INTERNAL' }));
    expect(gm.busy).toBe(false);
  });

  it('arrêt par le propriétaire seulement ; la fenêtre et le rechargement de sa page ne l’arrêtent pas', async () => {
    const { gm } = manager(new MockProvider({ reply: 'y'.repeat(3_000), chunkSize: 10, delayMs: 5 }));
    const out = sink();
    const handle = gm.startExternal(REQUEST, { owner: 'A', send: out.send });
    await new Promise(r => setTimeout(r, 30));
    expect(gm.cancelExternal(handle.jobId, 'B')).toBe(false);
    expect(gm.cancelExternal('autre-job', 'A')).toBe(false);
    gm.cancel(handle.jobId);
    gm.cancelWindow();
    gm.cancelOwner('B');
    expect(gm.busy).toBe(true);
    expect(gm.cancelExternal(handle.jobId, 'A')).toBe(true);
    await handle.finished;
    expect(out.events.at(-1)).toMatchObject({ type: 'error', code: 'GENERATION_ABORTED' });
    expect(out.events.filter(e => e.type === 'error')).toHaveLength(1);
  });

  it('retrait du navigateur, désactivation du connecteur, connexion fermée : génération interrompue', async () => {
    const slow = () => new MockProvider({ reply: 'z'.repeat(3_000), chunkSize: 10, delayMs: 5 });
    const a = manager(slow());
    const byOwner = a.gm.startExternal(REQUEST, { owner: 'A', send: sink().send });
    await new Promise(r => setTimeout(r, 20));
    a.gm.cancelOwner('A');
    await byOwner.finished;

    const b = manager(slow());
    const all = b.gm.startExternal(REQUEST, { owner: 'A', send: sink().send });
    await new Promise(r => setTimeout(r, 20));
    b.gm.cancelExternalAll();
    await all.finished;

    let open = true;
    const c = manager(slow());
    const out = sink(() => open);
    const closed = c.gm.startExternal(REQUEST, { owner: 'A', send: out.send });
    await new Promise(r => setTimeout(r, 20));
    open = false;
    await closed.finished;
    expect(c.gm.busy).toBe(false);
  });

  it('page de la fenêtre remplacée : seule la génération de la fenêtre s’arrête', async () => {
    const { gm, finished } = manager(new MockProvider({ reply: 'w'.repeat(2_000), chunkSize: 10, delayMs: 5 }));
    const { jobId } = gm.start(REQUEST);
    await new Promise(r => setTimeout(r, 20));
    gm.cancelExternalAll();
    expect(gm.busy).toBe(true);
    gm.cancelWindow();
    expect((await finished(jobId)).at(-1)).toMatchObject({ type: 'error', code: 'GENERATION_ABORTED' });
  });
});
