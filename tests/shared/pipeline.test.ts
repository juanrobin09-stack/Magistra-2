import { describe, expect, it } from 'vitest';
import { MockProvider } from '../../shared/ai/mock';
import { MagistraError } from '../../shared/errors';
import { computeBudgets, runGeneration, type NewGenerationRecord, type PipelineDeps } from '../../shared/pipeline';
import { estimateTokens } from '../../shared/prompts/index';
import type { ResearchConfig } from '../../shared/research/index';
import type { DocumentPassage, GenerationEvent, GenerationRequest } from '../../shared/types';
import { collect, jsonResponse, mockFetch, networkError, never } from './helpers';

type EventOf<T extends GenerationEvent['type']> = Extract<GenerationEvent, { type: T }>;

const SECRET_DOC_PHRASE = 'Mot de passe du serveur pédagogique : Tournesol-42';

function passage(docName: string, start: number, end: number, text: string): DocumentPassage {
  return { docId: docName, docName, kind: 'pdf', locator: { type: 'pages', start, end }, text };
}

const DOCS: DocumentPassage[] = [
  passage('Cours gouvernance.pdf', 14, 18, `La gouvernance des SI aligne le système d’information sur la stratégie. ${SECRET_DOC_PHRASE}.`),
  passage('CM3.pdf', 2, 3, 'COBIT et ITIL sont deux référentiels complémentaires de gouvernance et de gestion des services.'),
];

function request(partial: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'cours', niveau: 'master_1', matiere: 'systemes_information', sujet: 'La gouvernance des SI',
    objectifs: 'Comprendre les référentiels', consignes: 'Consigne confidentielle : citer le partenariat Acme',
    researchMode: 'documents', documents: DOCS, ...partial,
  };
}

function ofType<T extends GenerationEvent['type']>(events: GenerationEvent[], type: T): EventOf<T>[] {
  return events.filter((e): e is EventOf<T> => e.type === type);
}

function last(events: GenerationEvent[]): GenerationEvent {
  return events[events.length - 1];
}

const RESEARCH_CONFIG: ResearchConfig = { academic: true, wikipedia: true, timeoutMs: 2_000 };

function academicFetch() {
  return mockFetch(url => {
    const host = new URL(url).hostname;
    if (host === 'api.archives-ouvertes.fr') {
      return jsonResponse({ response: { docs: [{ title_s: ['Gouvernance des SI et performance'], authFullName_s: ['Anne Martin'], producedDateY_i: 2020, doiId_s: '10.1000/hal.1', uri_s: 'https://hal.science/hal-1', abstract_s: ['Résumé : la gouvernance des systèmes d’information améliore la performance des organisations publiques.'] }] } });
    }
    if (host === 'api.crossref.org') return jsonResponse({ message: { items: [] } });
    if (host === 'fr.wikipedia.org') return jsonResponse({ query: { search: [] } });
    throw new Error(`hôte inattendu ${host}`);
  });
}

describe('runGeneration — déroulé nominal', () => {
  it('ordre des évènements, sources numérotées (documents d’abord), citations finalisées, sauvegarde', async () => {
    const provider = new MockProvider({
      reply: 'La gouvernance aligne SI et stratégie [S1]. Les référentiels [S2, S3] se complètent. Étude inventée [S9], doi:10.9999/faux.1.\n\n## Bibliographie\n\n- Auteur inventé (2020).',
      chunkSize: 7,
    });
    const saved: NewGenerationRecord[] = [];
    const fetchImpl = academicFetch();
    const events = await collect(runGeneration(request({ researchMode: 'documents_internet' }), {
      provider,
      research: { config: RESEARCH_CONFIG, deps: { fetch: fetchImpl } },
      save: async record => {
        saved.push(record);
        return { id: 'gen_1' };
      },
    }));

    const order = events.map(e => (e.type === 'status' ? `status:${e.stage}` : e.type)).filter((t, i, all) => t !== 'delta' || all[i - 1] !== 'delta');
    expect(order).toEqual(['status:context', 'status:research', 'sources', 'status:generating', 'delta', 'status:finalizing', 'done']);

    const sources = ofType(events, 'sources')[0];
    expect(sources.sources.map(s => [s.n, s.kind])).toEqual([[1, 'document'], [2, 'document'], [3, 'hal']]);
    expect(sources.sources[0]).toMatchObject({ docName: 'Cours gouvernance.pdf', locator: { type: 'pages', start: 14, end: 18 } });
    expect(sources.internetUsed).toBe(true);

    const deltas = ofType(events, 'delta').map(e => e.text).join('');
    expect(deltas).toContain('[S1]');

    const done = last(events) as EventOf<'done'>;
    expect(done.content).toContain('La gouvernance aligne SI et stratégie [S1].');
    expect(done.content).toContain('Les référentiels [S2, S3] se complètent.');
    expect(done.content).not.toMatch(/\[S9\]|\[9\]|10\.9999|Auteur inventé|## Bibliographie/);
    expect(done.content).toContain('- [S1] Cours gouvernance.pdf — pages 14 à 18');
    expect(done.content).toContain('- [S3] Anne Martin. Gouvernance des SI et performance (2020) — HAL. https://doi.org/10.1000/hal.1');
    expect(done).toMatchObject({ saved: true, id: 'gen_1', truncated: false, internetUsed: true, model: 'mock-model' });
    expect(done.sources.map(s => s.n)).toEqual([1, 2, 3]);

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ type: 'cours', niveau: 'master_1', sujet: 'La gouvernance des SI', contenu: done.content, internetUsed: true, model: 'mock-model' });
    expect(saved[0].params.documents).toEqual(['Cours gouvernance.pdf', 'CM3.pdf']);
    expect(JSON.stringify(saved[0].params)).not.toContain(SECRET_DOC_PHRASE);
  });

  it('les moteurs de recherche ne reçoivent ni le texte des documents ni les consignes', async () => {
    const fetchImpl = academicFetch();
    await collect(runGeneration(request({ researchMode: 'documents_internet' }), {
      provider: new MockProvider({ reply: 'ok' }),
      research: { config: RESEARCH_CONFIG, deps: { fetch: fetchImpl } },
    }));
    expect(fetchImpl.calls.length).toBeGreaterThan(0);
    for (const call of fetchImpl.calls) {
      const url = decodeURIComponent(call.url.replace(/\+/g, ' '));
      expect(url).not.toContain('Tournesol');
      expect(url).not.toContain('Acme');
      expect(url).not.toContain('aligne le système');
      expect(call.init?.body).toBeUndefined();
    }
    expect(decodeURIComponent(fetchImpl.calls.find(c => c.url.includes('crossref'))!.url).replace(/\+/g, ' '))
      .toContain('La gouvernance des SI Comprendre les référentiels');
  });

  it('mode « Mes documents » : aucun appel réseau, internetUsed = false', async () => {
    const fetchImpl = academicFetch();
    const events = await collect(runGeneration(request(), {
      provider: new MockProvider({ reply: 'Texte [S2].' }),
      research: { config: RESEARCH_CONFIG, deps: { fetch: fetchImpl } },
    }));
    expect(fetchImpl.calls).toHaveLength(0);
    expect(last(events)).toMatchObject({ type: 'done', internetUsed: false, saved: false });
    expect(ofType(events, 'status').map(s => s.stage)).not.toContain('research');
  });

  it('mode « Internet » : les documents ne sont jamais transmis au modèle', async () => {
    const provider = new MockProvider({ reply: 'ok' });
    await collect(runGeneration(request({ researchMode: 'internet' }), { provider }));
    const prompt = provider.calls[0].messages.map(m => m.content).join('\n');
    expect(prompt).not.toContain('Tournesol');
    expect(prompt).not.toContain('Cours gouvernance.pdf');
  });

  it('les passages documentaires sont transmis avec leur numéro et leur localisation', async () => {
    const provider = new MockProvider({ reply: 'ok' });
    await collect(runGeneration(request(), { provider }));
    const user = provider.calls[0].messages[1].content;
    expect(user).toContain("[S1] Document de l'enseignant « Cours gouvernance.pdf » — pages 14 à 18");
    expect(user).toContain("[S2] Document de l'enseignant « CM3.pdf » — pages 2 à 3");
  });
});

describe('runGeneration — avertissements et cas dégradés', () => {
  it('réponse tronquée (finish length) → avertissement + truncated', async () => {
    const events = await collect(runGeneration(request(), { provider: new MockProvider({ reply: 'Début', finishReason: 'length' }) }));
    expect(ofType(events, 'warning').map(w => w.code)).toContain('GENERATION_TRUNCATED');
    // Documents fournis mais non cités : mention honnête ajoutée après le texte (voir finalizeCitations).
    expect(last(events)).toMatchObject({ type: 'done', truncated: true, content: expect.stringMatching(/^Début\n\n> Aucune des sources fournies n'est citée/) });
  });

  it('flux coupé sans fin explicite (« unknown ») → avertissement + truncated', async () => {
    const events = await collect(runGeneration(request(), { provider: new MockProvider({ reply: 'Début', finishReason: 'unknown' }) }));
    expect(ofType(events, 'warning').find(w => w.code === 'GENERATION_TRUNCATED')?.message).toMatch(/arrêtée avant la fin/);
    expect(last(events)).toMatchObject({ type: 'done', truncated: true });
  });

  it('échec de sauvegarde → avertissement, contenu conservé, done(saved=false)', async () => {
    const events = await collect(runGeneration(request(), {
      provider: new MockProvider({ reply: 'Contenu précieux [S1].' }),
      save: async () => { throw new Error('ECONNRESET supabase.co secret-key'); },
    }));
    const warning = ofType(events, 'warning').find(w => w.code === 'STORAGE_ERROR');
    expect(warning?.message).toMatch(/n'a pas pu être enregistré/);
    expect(warning?.message).not.toMatch(/supabase|secret/);
    const done = last(events) as EventOf<'done'>;
    expect(done).toMatchObject({ type: 'done', saved: false });
    expect(done.id).toBeUndefined();
    expect(done.content).toContain('Contenu précieux [S1].');
  });

  it('sauvegarde bloquée → délai, avertissement, done(saved=false)', async () => {
    const events = await collect(runGeneration(request(), {
      provider: new MockProvider({ reply: 'Contenu.' }),
      save: () => never(),
      saveTimeoutMs: 30,
    }));
    expect(ofType(events, 'warning').map(w => w.code)).toContain('STORAGE_ERROR');
    expect(last(events)).toMatchObject({ type: 'done', saved: false, content: expect.stringMatching(/^Contenu\.\n/) });
  });

  it('recherche non disponible dans cet environnement → avertissement, génération poursuivie', async () => {
    const events = await collect(runGeneration(request({ researchMode: 'documents_internet' }), { provider: new MockProvider({ reply: 'ok' }) }));
    expect(ofType(events, 'warning').map(w => w.code)).toEqual(['RESEARCH_UNAVAILABLE']);
    expect(last(events)).toMatchObject({ type: 'done', internetUsed: false });
  });

  it('sans Internet → avertissement clair, génération à partir des documents', async () => {
    const offline = mockFetch(() => { throw networkError('ENOTFOUND'); });
    const events = await collect(runGeneration(request({ researchMode: 'documents_internet' }), {
      provider: new MockProvider({ reply: 'Selon le cours [S1].' }),
      research: { config: { ...RESEARCH_CONFIG, searxngUrl: 'https://searx.example.fr' }, deps: { fetch: offline } },
    }));
    const warnings = ofType(events, 'warning');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/Pas de connexion Internet/);
    expect(ofType(events, 'sources')[0]).toMatchObject({ internetUsed: false });
    expect(last(events)).toMatchObject({ type: 'done', internetUsed: false });
    expect((last(events) as EventOf<'done'>).content).toContain('Selon le cours [S1].');
  });

  it('panne imprévue de la recherche (fetch fourni défaillant) → avertissement, génération poursuivie', async () => {
    const events = await collect(runGeneration(request({ researchMode: 'documents_internet' }), {
      provider: new MockProvider({ reply: 'Selon le cours [S1].' }),
      research: { config: RESEARCH_CONFIG, deps: { fetch: (() => { throw new Error('bug'); }) as unknown as typeof fetch } },
    }));
    expect(ofType(events, 'warning').map(w => w.code)).toEqual(['RESEARCH_UNAVAILABLE']);
    expect(last(events)).toMatchObject({ type: 'done', internetUsed: false });
  });

  it('outil sans recherche (courrier) en mode Internet → aucun appel, avertissement explicite', async () => {
    const fetchImpl = academicFetch();
    const events = await collect(runGeneration(
      { type: 'lettre_parents', niveau: '4eme', matiere: 'francais', sujet: '', typeLettre: 'reunion', researchMode: 'internet' },
      { provider: new MockProvider({ reply: 'Madame, Monsieur,' }), research: { config: RESEARCH_CONFIG, deps: { fetch: fetchImpl } } },
    ));
    expect(fetchImpl.calls).toHaveLength(0);
    expect(ofType(events, 'warning')[0].message).toMatch(/n'est pas utilisée pour cet outil/);
    expect(last(events).type).toBe('done');
  });

  it('pas de sujet → pas de recherche (le contenu à adapter n’est jamais envoyé aux moteurs)', async () => {
    const fetchImpl = academicFetch();
    const events = await collect(runGeneration(
      { type: 'differenciation', niveau: 'licence_1', matiere: 'mathematiques', sujet: '', contenuSource: 'Exercice confidentiel', researchMode: 'internet' },
      { provider: new MockProvider({ reply: 'Versions.' }), research: { config: RESEARCH_CONFIG, deps: { fetch: fetchImpl } } },
    ));
    expect(fetchImpl.calls).toHaveLength(0);
    expect(ofType(events, 'warning')[0].message).toMatch(/indiquez un sujet/);
  });

  it('réponse vide → erreur explicite', async () => {
    const events = await collect(runGeneration(request(), { provider: new MockProvider({ reply: '   ' }) }));
    expect(last(events)).toMatchObject({ type: 'error', code: 'AI_BAD_RESPONSE', message: "Le modèle n'a produit aucun contenu. Réessayez." });
  });
});

describe('runGeneration — erreurs et annulation (jamais d’exception)', () => {
  it('erreur du fournisseur au démarrage → évènement error propre', async () => {
    const events = await collect(runGeneration(request(), { provider: new MockProvider({ failWith: new MagistraError('OUT_OF_MEMORY') }) }));
    expect(last(events)).toEqual({
      type: 'error', code: 'OUT_OF_MEMORY', retryable: true,
      message: 'Mémoire insuffisante pour ce modèle. Fermez d’autres applications ou choisissez un modèle plus léger.',
    });
    expect(ofType(events, 'done')).toHaveLength(0);
  });

  it('erreur du fournisseur en cours de génération → évènement error après les deltas', async () => {
    const events = await collect(runGeneration(request(), {
      provider: new MockProvider({ reply: 'abcdefghijklmnop', chunkSize: 4, failAfterChunks: 2, failWith: new MagistraError('AI_SERVER_UNAVAILABLE', 'Serveur universitaire indisponible. Réessayez dans quelques instants.') }),
    }));
    expect(ofType(events, 'delta').map(d => d.text)).toEqual(['abcd', 'efgh']);
    expect(last(events)).toMatchObject({ type: 'error', code: 'AI_SERVER_UNAVAILABLE', message: 'Serveur universitaire indisponible. Réessayez dans quelques instants.' });
  });

  it('serveur d’IA surchargé avant le premier mot : nouveaux essais automatiques, puis succès', async () => {
    const provider = new MockProvider({ reply: 'Contenu final.' });
    const original = provider.stream.bind(provider);
    let attempts = 0;
    provider.stream = async function* (options) {
      attempts++;
      if (attempts <= 2) throw new MagistraError(attempts === 1 ? 'AI_BUSY' : 'AI_SERVER_UNAVAILABLE');
      yield* original(options);
    };
    const events = await collect(runGeneration(request(), { provider, retryDelaysMs: [5, 5] }));
    expect(attempts).toBe(3);
    expect(ofType(events, 'status').filter(s => /nouvel essai automatique/.test(s.message))).toHaveLength(2);
    expect(last(events)).toMatchObject({ type: 'done', content: expect.stringMatching(/^Contenu final\.\n/) });
  });

  it('surcharge persistante : erreur après les nouveaux essais ; jamais de nouvel essai après le premier mot', async () => {
    let attempts = 0;
    const busy = new MockProvider();
    busy.stream = async function* () {
      attempts++;
      yield* [];
      throw new MagistraError('AI_BUSY');
    };
    const events = await collect(runGeneration(request(), { provider: busy, retryDelaysMs: [1, 1] }));
    expect(attempts).toBe(3);
    expect(last(events)).toMatchObject({ type: 'error', code: 'AI_BUSY', retryable: true });

    const midStream = new MockProvider({ reply: 'abcdefgh', chunkSize: 4, failAfterChunks: 1, failWith: new MagistraError('AI_BUSY') });
    let midAttempts = 0;
    const originalMid = midStream.stream.bind(midStream);
    midStream.stream = options => {
      midAttempts++;
      return originalMid(options);
    };
    const midEvents = await collect(runGeneration(request(), { provider: midStream, retryDelaysMs: [1, 1] }));
    expect(midAttempts).toBe(1);
    expect(last(midEvents)).toMatchObject({ type: 'error', code: 'AI_BUSY', partial: 'abcd' });
  });

  it('429 court : l’attente conseillée par le serveur (Retry-After) remplace 2 s puis 5 s (WEB-AI-03)', async () => {
    const provider = new MockProvider({ reply: 'Contenu final.' });
    const original = provider.stream.bind(provider);
    let attempts = 0;
    provider.stream = async function* (options) {
      attempts++;
      if (attempts === 1) throw new MagistraError('AI_BUSY', undefined, { retryAfterMs: 30 });
      yield* original(options);
    };
    const started = Date.now();
    const events = await collect(runGeneration(request(), { provider, retryDelaysMs: [10_000, 10_000] }));
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(attempts).toBe(2);
    expect(ofType(events, 'status').some(s => s.message === "Le moteur IA est momentanément occupé : nouvel essai automatique dans 1 s…")).toBe(true);
    expect(last(events)).toMatchObject({ type: 'done', content: expect.stringMatching(/^Contenu final\.\n/) });
  });

  it('attente conseillée trop longue (> 15 s), serveur injoignable, quota, moteur trop ancien : AUCUN nouvel essai automatique (F5)', async () => {
    const cases = [
      new MagistraError('AI_BUSY', undefined, { retryAfterMs: 60_000 }),
      new MagistraError('AI_SERVER_UNREACHABLE', "Le serveur d'IA est injoignable à l'adresse configurée (connexion refusée)."),
      new MagistraError('AI_QUOTA_EXCEEDED', 'Quota atteint : réessayez dans environ 12 minutes.'),
      new MagistraError('ENGINE_OUTDATED'),
    ];
    for (const failure of cases) {
      let attempts = 0;
      const provider = new MockProvider({ local: false });
      provider.stream = async function* () {
        attempts++;
        yield* [];
        throw failure;
      };
      const events = await collect(runGeneration(request(), { provider, retryDelaysMs: [1, 1] }));
      expect(attempts, failure.code).toBe(1);
      expect(ofType(events, 'status').filter(st => /nouvel essai/.test(st.message)), failure.code).toHaveLength(0);
      expect(last(events), failure.code).toMatchObject({ type: 'error', code: failure.code, message: failure.message, retryable: failure.retryable });
    }
  });

  it('message de nouvel essai grammatical pour un serveur distant', async () => {
    const provider = new MockProvider({ local: false, reply: 'ok' });
    const original = provider.stream.bind(provider);
    let attempts = 0;
    provider.stream = async function* (options) {
      if (++attempts === 1) throw new MagistraError('AI_SERVER_UNAVAILABLE');
      yield* original(options);
    };
    const events = await collect(runGeneration(request(), { provider, retryDelaysMs: [5] }));
    expect(ofType(events, 'status').some(st => st.message === "Le serveur d'IA est momentanément occupé : nouvel essai automatique dans 1 s…")).toBe(true);
  });

  it('« Arrêter » pendant l’attente d’un nouvel essai : arrêt immédiat', async () => {
    const controller = new AbortController();
    const provider = new MockProvider();
    provider.stream = async function* () {
      yield* [];
      throw new MagistraError('AI_BUSY');
    };
    const started = Date.now();
    const events: GenerationEvent[] = [];
    for await (const event of runGeneration(request(), { provider, signal: controller.signal, retryDelaysMs: [10_000] })) {
      events.push(event);
      if (event.type === 'status' && /nouvel essai/.test(event.message)) controller.abort();
    }
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(last(events)).toMatchObject({ type: 'error', code: 'GENERATION_ABORTED' });
  });

  it('liens : celui des consignes de l’enseignant est gardé, un lien inventé est retiré', async () => {
    const provider = new MockProvider({ reply: 'Déposez le devoir sur https://moodle.univ.fr/devoir/7. Voir aussi https://rapport-invente.fr/x.' });
    const events = await collect(runGeneration(request({ consignes: 'Rappeler le lien de dépôt https://moodle.univ.fr/devoir/7' }), { provider }));
    const done = last(events) as EventOf<'done'>;
    expect(done.type).toBe('done');
    expect(done.content).toContain('https://moodle.univ.fr/devoir/7.');
    expect(done.content).not.toContain('rapport-invente.fr');
    expect(done.content).toContain('[lien non vérifié retiré]');
  });

  it('exception technique inattendue → erreur générique, sans détail technique', async () => {
    const provider = new MockProvider();
    provider.stream = async function* () {
      yield { type: 'delta' as const, text: 'x' };
      throw new Error('TypeError: cannot read properties of undefined (reading "choices") at /srv/app.js:12');
    };
    const events = await collect(runGeneration(request(), { provider }));
    expect(last(events)).toEqual({ type: 'error', code: 'INTERNAL', message: 'Erreur inattendue. Réessayez.', retryable: true, partial: 'x' });
  });

  it('annulation pendant la génération → GENERATION_ABORTED, pas de done ni de sauvegarde', async () => {
    const controller = new AbortController();
    let saveCalled = false;
    const deps: PipelineDeps = {
      provider: new MockProvider({ reply: 'x'.repeat(200), chunkSize: 10, delayMs: 5 }),
      signal: controller.signal,
      save: async () => { saveCalled = true; return { id: 'x' }; },
    };
    const events: GenerationEvent[] = [];
    for await (const event of runGeneration(request(), deps)) {
      events.push(event);
      if (event.type === 'delta' && ofType(events, 'delta').length === 2) controller.abort();
    }
    expect(last(events)).toMatchObject({ type: 'error', code: 'GENERATION_ABORTED', message: 'Génération interrompue.', retryable: true });
    expect(ofType(events, 'done')).toHaveLength(0);
    expect(saveCalled).toBe(false);
  });

  it('texte interrompu : renvoyé APRÈS vérification des citations (jamais brut)', async () => {
    const provider = new MockProvider({
      reply: 'Définition [S1]. Martin [S7] l’a montré, doi:10.9999/invente.2019.\n\n## Bibliographie\n\n- Dupont (2019), titre inventé',
      chunkSize: 400,
      failWith: new MagistraError('AI_TIMEOUT'),
      failAfterChunks: 1,
    });
    const events = await collect(runGeneration(request({ documents: [passage('cours.pdf', 1, 2, 'Texte de cours')] }), { provider }));
    const error = last(events) as Extract<GenerationEvent, { type: 'error' }>;
    expect(error.code).toBe('AI_TIMEOUT');
    expect(error.partial).toContain('Définition [S1].');
    expect(error.partial).not.toMatch(/\[S7\]|10\.9999|Dupont|## Bibliographie/);
    expect(error.partial).toContain('## Sources utilisées');
  });

  it('annulation pendant la recherche → GENERATION_ABORTED', async () => {
    const controller = new AbortController();
    const fetchImpl = mockFetch((_url, init) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const pending = collect(runGeneration(request({ researchMode: 'documents_internet' }), {
      provider: new MockProvider({ reply: 'ok' }),
      research: { config: RESEARCH_CONFIG, deps: { fetch: fetchImpl } },
      signal: controller.signal,
    }));
    setTimeout(() => controller.abort(), 20);
    const events = await pending;
    expect(last(events)).toMatchObject({ type: 'error', code: 'GENERATION_ABORTED' });
  });

  it('signal déjà annulé → erreur immédiate, aucun appel au modèle', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new MockProvider();
    const events = await collect(runGeneration(request(), { provider, signal: controller.signal }));
    expect(events).toEqual([{ type: 'error', code: 'GENERATION_ABORTED', message: 'Génération interrompue.', retryable: true }]);
    expect(provider.calls).toHaveLength(0);
  });
});

describe('runGeneration — budget de contexte', () => {
  function promptTokens(provider: MockProvider): number {
    return provider.calls[0].messages.reduce((n, m) => n + estimateTokens(m.content), 0);
  }

  it('petit contexte : documents réduits aux passages pertinents, avertissement, prompt + sortie ≤ contexte', async () => {
    const big = Array.from({ length: 8 }, (_, i) => passage(`chapitre-${i}.pdf`, i * 10 + 1, i * 10 + 9,
      `${i === 5 ? 'La gouvernance des SI repose sur COBIT. ' : 'Chapitre sans rapport : histoire de l’informatique. '}${'Texte de remplissage. '.repeat(90)}`));
    const provider = new MockProvider({ reply: 'Cours [S1].', contextTokens: 4_096 });
    const events = await collect(runGeneration(request({ documents: big }), { provider }));
    const warning = ofType(events, 'warning').find(w => w.code === 'CONTEXT_TOO_LARGE');
    expect(warning?.message).toBe('Vos documents dépassent la capacité du modèle : seuls les passages les plus pertinents ont été utilisés.');
    const sources = ofType(events, 'sources')[0].sources;
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.length).toBeLessThan(big.length);
    expect(sources[0].docName).toBe('chapitre-5.pdf');
    const call = provider.calls[0];
    expect(promptTokens(provider) + (call.maxTokens ?? 0)).toBeLessThanOrEqual(provider.contextTokens);
    expect(last(events).type).toBe('done');
  });

  it('un seul document trop long : le début du passage est gardé (tronqué) plutôt que rien', async () => {
    const huge = [passage('these.pdf', 1, 60, `La gouvernance des SI. ${'Phrase longue du document de thèse. '.repeat(400)}`)];
    const provider = new MockProvider({ reply: 'ok', contextTokens: 4_096 });
    const events = await collect(runGeneration(request({ documents: huge }), { provider }));
    expect(ofType(events, 'warning').map(w => w.code)).toContain('CONTEXT_TOO_LARGE');
    const user = provider.calls[0].messages[1].content;
    expect(user).toContain('these.pdf');
    expect(user).toContain('[…]');
    expect(promptTokens(provider) + (provider.calls[0].maxTokens ?? 0)).toBeLessThanOrEqual(provider.contextTokens);
  });

  it('grand contexte : tout est transmis, sans avertissement', async () => {
    const provider = new MockProvider({ reply: 'ok', contextTokens: 32_768 });
    const events = await collect(runGeneration(request(), { provider }));
    expect(ofType(events, 'warning')).toHaveLength(0);
    expect(ofType(events, 'sources')[0].sources).toHaveLength(2);
  });

  it('demande seule trop longue pour le modèle → CONTEXT_TOO_LARGE (et non une troncature silencieuse)', async () => {
    const provider = new MockProvider({ reply: 'ok', contextTokens: 2_048 });
    const events = await collect(runGeneration(
      { type: 'corrige', niveau: '3eme', matiere: 'francais', sujet: '', texteEleve: 'Copie très longue. '.repeat(900), researchMode: 'documents' },
      { provider },
    ));
    expect(last(events)).toMatchObject({ type: 'error', code: 'CONTEXT_TOO_LARGE' });
    expect(provider.calls).toHaveLength(0);
  });

  it('computeBudgets : sortie ≤ 40 % du contexte, plafond de l’appelant respecté', () => {
    const b = computeBudgets(new MockProvider({ contextTokens: 12_288 }), request());
    expect(b.outputTokens).toBe(Math.floor(12_288 * 0.4));
    expect(b.fits).toBe(true);
    expect(b.promptTokens + b.outputTokens + b.sourcesChars / 3.2).toBeLessThanOrEqual(12_288);
    expect(computeBudgets(new MockProvider({ contextTokens: 12_288 }), request(), 800).outputTokens).toBe(800);
  });
});

describe('runGeneration — chargement du modèle (preloadModel)', () => {
  function withPreload(impl: (options?: { signal?: AbortSignal }) => Promise<void>) {
    const provider = new MockProvider({ reply: 'Contenu.' }) as MockProvider & { preload?: (options?: { signal?: AbortSignal }) => Promise<void> };
    let calls = 0;
    provider.preload = async options => {
      calls++;
      await impl(options);
    };
    return { provider, calls: () => calls };
  }

  it('statut « Chargement du modèle… » (étape loading_model) avant la rédaction', async () => {
    const { provider, calls } = withPreload(async () => {});
    const events = await collect(runGeneration(request(), { provider, preloadModel: true }));
    expect(calls()).toBe(1);
    const stages = ofType(events, 'status').map(e => e.stage);
    expect(stages.indexOf('loading_model')).toBeGreaterThanOrEqual(0);
    expect(stages.indexOf('loading_model')).toBeLessThan(stages.indexOf('generating'));
    expect(ofType(events, 'status').find(e => e.stage === 'loading_model')?.message).toBe('Chargement du modèle…');
    expect(last(events)).toMatchObject({ type: 'done' });
  });

  it('désactivé par défaut ; sans méthode preload, rien ne change', async () => {
    const { provider, calls } = withPreload(async () => {});
    await collect(runGeneration(request(), { provider }));
    expect(calls()).toBe(0);
    const plain = await collect(runGeneration(request(), { provider: new MockProvider(), preloadModel: true }));
    expect(ofType(plain, 'status').some(e => e.stage === 'loading_model')).toBe(false);
  });

  it('échec du chargement (modèle absent, mémoire) → erreur claire, sans rédaction ; panne passagère → la rédaction tente quand même', async () => {
    const missing = withPreload(async () => {
      throw new MagistraError('MODEL_NOT_INSTALLED', "Le modèle Magistra Standard n'est pas encore installé.");
    });
    const events = await collect(runGeneration(request(), { provider: missing.provider, preloadModel: true }));
    expect(last(events)).toMatchObject({ type: 'error', code: 'MODEL_NOT_INSTALLED' });
    expect(ofType(events, 'delta')).toHaveLength(0);

    const transient = withPreload(async () => {
      throw new MagistraError('AI_SERVER_UNAVAILABLE');
    });
    expect(last(await collect(runGeneration(request(), { provider: transient.provider, preloadModel: true })))).toMatchObject({ type: 'done' });
  });

  it('« Arrêter » pendant le chargement : arrêt immédiat', async () => {
    const controller = new AbortController();
    const { provider } = withPreload(options => new Promise((_, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new MagistraError('GENERATION_ABORTED')));
    }));
    const events: GenerationEvent[] = [];
    for await (const event of runGeneration(request(), { provider, preloadModel: true, signal: controller.signal })) {
      events.push(event);
      if (event.type === 'status' && event.stage === 'loading_model') setTimeout(() => controller.abort(), 10);
    }
    expect(last(events)).toMatchObject({ type: 'error', code: 'GENERATION_ABORTED' });
  });
});
