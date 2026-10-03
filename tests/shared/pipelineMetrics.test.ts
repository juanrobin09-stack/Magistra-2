// Mesures de vitesse jointes à l'évènement « done » (GenerationMetrics) : horloge injectable, jamais de texte,
// durées du moteur réservées au moteur de cet ordinateur, évènements et contenu inchangés.

import { describe, expect, it } from 'vitest';
import type { EnginePlacement, EngineTimings } from '../../shared/ai/timings';
import { MockProvider } from '../../shared/ai/mock';
import type { AIProvider, Usage } from '../../shared/ai/provider';
import { runGeneration, type NewGenerationRecord } from '../../shared/pipeline';
import type { DocumentPassage, GenerationEvent, GenerationMetrics, GenerationRequest } from '../../shared/types';
import { collect } from './helpers';

type Done = Extract<GenerationEvent, { type: 'done' }>;

const SECRET = 'Mot de passe du serveur pédagogique : Tournesol-42';
const DOCS: DocumentPassage[] = [
  { docId: 'a', docName: 'Cours confidentiel Dupont.pdf', kind: 'pdf', locator: { type: 'pages', start: 1, end: 2 }, text: `La gouvernance des SI aligne le système d’information. ${SECRET}.` },
];

function request(partial: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    type: 'cours', niveau: 'master_1', matiere: 'systemes_information', sujet: 'La gouvernance des SI',
    objectifs: 'Comprendre les référentiels', consignes: 'Consigne confidentielle : citer le partenariat Acme',
    researchMode: 'documents', documents: DOCS, ...partial,
  };
}

const TIMINGS: EngineTimings = {
  totalMs: 48_000, loadMs: 1_200, promptTokens: 2_400, promptMs: 20_000, promptTokensPerSecond: 120, outputTokens: 300, outputMs: 26_000, tokensPerSecond: 11.5,
};
const PLACEMENT: EnginePlacement = { processor: 'cpu', gpuPercent: 0, sizeBytes: 4_000_000_000, sizeVramBytes: 0, contextTokens: 12_288 };

function doneOf(events: GenerationEvent[]): Done {
  const done = events.at(-1);
  if (done?.type !== 'done') throw new Error(`« done » attendu, reçu ${done?.type}`);
  return done;
}

/** Horloge pilotée : le fournisseur de test la fait avancer, la pipeline la lit. */
function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

/** Feuilles de l'objet : chaque valeur doit être un nombre ou une énumération connue. */
function leaves(value: unknown, path = ''): [string, unknown][] {
  if (value !== null && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => leaves(v, `${path}.${k}`));
  return [[path, value]];
}

describe('runGeneration — metrics de l’évènement « done »', () => {
  it('durées mesurées avec l’horloge injectée : préparation, attente du modèle, premier mot, total', async () => {
    const c = clock();
    const provider = new MockProvider({
      reply: () => {
        c.advance(2_000); // lecture de la demande avant le premier mot
        return 'Contenu simulé.';
      },
      usage: { timings: TIMINGS, placement: PLACEMENT },
    }) as MockProvider & { preload?: () => Promise<void> };
    let finishLoading = () => {};
    provider.preload = () => new Promise<void>(resolve => {
      finishLoading = resolve;
    });
    const events: GenerationEvent[] = [];
    for await (const event of runGeneration(request(), {
      provider, preloadModel: true, now: c.now,
      save: async (_record: NewGenerationRecord) => {
        c.advance(50);
        return { id: 'gen_1' };
      },
    })) {
      events.push(event);
      if (event.type === 'status' && event.stage === 'context') c.advance(300); // sélection des passages
      if (event.type === 'status' && event.stage === 'loading_model') {
        // La pipeline attend le chargement : il se termine 700 ms plus tard, après sa mise en attente.
        setTimeout(() => {
          c.advance(700);
          finishLoading();
        }, 0);
      }
    }
    const { metrics } = doneOf(events);
    expect(metrics).toMatchObject({ prepMs: 300, waitModelMs: 700, firstWordMs: 3_000, totalMs: 3_050 });
  });

  it('durée de chargement annoncée au préchargement : jointe aux mesures du moteur de cet ordinateur seulement', async () => {
    for (const local of [true, false]) {
      const provider = new MockProvider({ reply: 'Contenu.', local, usage: { timings: TIMINGS } });
      (provider as MockProvider & { preload?: () => Promise<{ loadMs: number }> }).preload = async () => ({ loadMs: 14_000 });
      const events = await collect(runGeneration(request(), { provider, preloadModel: true }));
      const { metrics } = doneOf(events);
      if (local) expect(metrics?.preloadLoadMs).toBe(14_000);
      else expect(metrics).not.toHaveProperty('preloadLoadMs');
    }
  });

  it('préchargement sans durée annoncée (ou qui échoue de façon passagère) : pas de preloadLoadMs', async () => {
    const provider = new MockProvider({ reply: 'Contenu.', local: true, usage: { timings: TIMINGS } });
    (provider as MockProvider & { preload?: () => Promise<void> }).preload = async () => undefined;
    const { metrics } = doneOf(await collect(runGeneration(request(), { provider, preloadModel: true })));
    expect(metrics).not.toHaveProperty('preloadLoadMs');
  });

  it('préparation : le temps passé avant « sources » (documents, recherche) est compté à part', async () => {
    const c = clock();
    const fetchImpl = async () => {
      c.advance(900);
      return new Response(JSON.stringify({ response: { docs: [] }, message: { items: [] }, query: { search: [] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const events = await collect(runGeneration(request({ researchMode: 'documents_internet' }), {
      provider: new MockProvider({ reply: 'Contenu.' }), now: c.now,
      research: { config: { academic: true, wikipedia: true, timeoutMs: 2_000 }, deps: { fetch: fetchImpl as never } },
    }));
    expect(doneOf(events).metrics?.prepMs).toBeGreaterThanOrEqual(900);
  });

  it('moteur de cet ordinateur : durées et placement du moteur, contexte, prompt estimé et budget de réponse', async () => {
    const provider = new MockProvider({ reply: 'Contenu.', local: true, contextTokens: 12_288, usage: { timings: TIMINGS, placement: PLACEMENT } });
    const done = doneOf(await collect(runGeneration(request(), { provider, maxOutputTokens: 900 })));
    expect(done.metrics).toMatchObject({ engine: TIMINGS, placement: PLACEMENT, contextTokens: 12_288 });
    expect(done.metrics?.promptTokens).toBeGreaterThan(50);
    expect(done.metrics?.outputBudgetTokens).toBe(provider.calls[0].maxTokens);
    expect(done.metrics?.outputBudgetTokens).toBe(900);
    expect(done.metrics?.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('serveur distant : jamais de durées ni de placement du moteur', async () => {
    const provider = new MockProvider({ reply: 'Contenu.', local: false, usage: { timings: TIMINGS, placement: PLACEMENT } });
    const { metrics } = doneOf(await collect(runGeneration(request(), { provider })));
    expect(metrics?.engine).toBeUndefined();
    expect(metrics?.placement).toBeUndefined();
    expect(metrics).toMatchObject({ contextTokens: provider.contextTokens });
    expect(metrics?.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('fournisseur sans mesures : metrics présent (durée, contexte), sans moteur', async () => {
    const { metrics } = doneOf(await collect(runGeneration(request(), { provider: new MockProvider({ reply: 'Contenu.' }) })));
    expect(metrics).toBeDefined();
    expect(metrics).not.toHaveProperty('engine');
    expect(metrics).not.toHaveProperty('placement');
    expect(metrics).not.toHaveProperty('waitModelMs');
  });

  it('uniquement des nombres et des énumérations : aucun texte du prompt, des documents, des consignes ni de la réponse', async () => {
    // Un fournisseur qui glisserait du texte dans ses mesures : filtré champ par champ.
    const hostile = {
      timings: { ...TIMINGS, prompt: SECRET, content: 'Contenu simulé.', promptMs: 'beaucoup', nested: { secret: SECRET } },
      placement: { ...PLACEMENT, name: 'Cours confidentiel Dupont.pdf' },
      query: 'La gouvernance des SI',
    } as unknown as Usage;
    const provider = new MockProvider({ reply: 'Contenu simulé.', local: true, usage: hostile });
    const { metrics } = doneOf(await collect(runGeneration(request(), { provider })));
    const json = JSON.stringify(metrics);
    for (const forbidden of [SECRET, 'Dupont', 'gouvernance', 'Acme', 'Contenu simulé', 'confidentiel', 'beaucoup']) expect(json).not.toContain(forbidden);
    const allowed = new Set(['gpu', 'cpu', 'mixed']);
    for (const [path, value] of leaves(metrics)) {
      expect(typeof value === 'number' || allowed.has(value as string), `${path} = ${String(value)}`).toBe(true);
      if (typeof value === 'number') expect(Number.isFinite(value) && value >= 0, path).toBe(true);
    }
  });

  it('mesures de moteur incohérentes (NaN, négatif, texte) : ignorées', async () => {
    const usage = { timings: { totalMs: Number.NaN, loadMs: -5, promptMs: Number.POSITIVE_INFINITY }, placement: { processor: 'tpu' } } as unknown as Usage;
    const { metrics } = doneOf(await collect(runGeneration(request(), { provider: new MockProvider({ reply: 'Contenu.', usage }) })));
    expect(metrics?.engine).toBeUndefined();
    expect(metrics?.placement).toBeUndefined();
  });

  it('génération à enregistrer (includeRecord) : metrics sur « done », jamais dans l’enregistrement', async () => {
    const provider = new MockProvider({ reply: 'Contenu.', usage: { timings: TIMINGS } });
    const done = doneOf(await collect(runGeneration(request(), { provider, includeRecord: true })));
    expect(done.metrics?.engine).toEqual(TIMINGS);
    expect(done.record).toBeDefined();
    expect(JSON.stringify(done.record)).not.toContain('totalMs');
    expect(done.record).not.toHaveProperty('metrics');
  });

  it('sauvegarde locale : l’enregistrement ne contient aucune mesure', async () => {
    const saved: NewGenerationRecord[] = [];
    const provider = new MockProvider({ reply: 'Contenu.', usage: { timings: TIMINGS, placement: PLACEMENT } });
    await collect(runGeneration(request(), { provider, save: async record => { saved.push(record); return { id: 'g' }; } }));
    expect(saved).toHaveLength(1);
    expect(JSON.stringify(saved[0])).not.toMatch(/totalMs|tokensPerSecond|gpuPercent|metrics/);
  });

  it('ordre des évènements et contenu inchangés par les mesures', async () => {
    const plain = new MockProvider({ reply: 'Réponse [S1].', chunkSize: 5 });
    const measured = new MockProvider({ reply: 'Réponse [S1].', chunkSize: 5, usage: { timings: TIMINGS, placement: PLACEMENT } });
    const a = await collect(runGeneration(request(), { provider: plain }));
    const b = await collect(runGeneration(request(), { provider: measured }));
    const strip = (events: GenerationEvent[]) => events.map(e => (e.type === 'done' ? { ...e, metrics: undefined } : e));
    expect(strip(b)).toEqual(strip(a));
    expect(a.map(e => e.type)).toEqual(b.map(e => e.type));
  });

  it('erreur : aucun évènement « done », donc aucune mesure', async () => {
    const provider = new MockProvider({ reply: '' });
    const events = await collect(runGeneration(request(), { provider }));
    expect(events.at(-1)).toMatchObject({ type: 'error' });
    expect(JSON.stringify(events)).not.toContain('totalMs');
  });

  it('fournisseur dont les nombres sont absurdes : contexte jamais NaN', async () => {
    const provider: AIProvider = Object.assign(new MockProvider({ reply: 'Contenu.' }), { contextTokens: 16_384 });
    const { metrics } = doneOf(await collect(runGeneration(request(), { provider })));
    expect(metrics?.contextTokens).toBe(16_384);
    const m: GenerationMetrics | undefined = metrics;
    expect(Number.isInteger(m?.promptTokens)).toBe(true);
  });
});
