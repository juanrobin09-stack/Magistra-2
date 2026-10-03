// @vitest-environment jsdom
// « Détails de vitesse » sous le résultat : visible seulement avec les mesures du moteur de l'ordinateur, texte honnête
// et prudent, accessible (details/summary natifs, aucun changement de focus), rien d'enregistré ni d'envoyé.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import ResultPanel from '@/components/generate/ResultPanel';
import SpeedDetails from '@/components/generate/SpeedDetails';
import { CPU_EXPLANATION, formatDuration, formatNumber, MIXED_EXPLANATION, speedView } from '@/lib/generation/speed';
import { initialGenerationState, type GenerationState } from '@/lib/generation/state';
import type { GenerationMetrics, GenerationRequest } from '@shared/types';
import { cleanup, MemoryStore, render } from '../ui/helpers';

afterEach(cleanup);

const REQ: GenerationRequest = { type: 'cours', niveau: '4eme', matiere: 'mathematiques', sujet: 'Pythagore', researchMode: 'documents' };

const METRICS: GenerationMetrics = {
  totalMs: 48_400,
  prepMs: 250,
  waitModelMs: 6_000,
  firstWordMs: 12_300,
  contextTokens: 12_288,
  promptTokens: 2_400,
  outputBudgetTokens: 3_000,
  engine: {
    totalMs: 41_000, loadMs: 800, promptTokens: 2_413, promptMs: 20_000, promptTokensPerSecond: 120.7,
    outputTokens: 300, outputMs: 26_000, tokensPerSecond: 11.5,
  },
  placement: { processor: 'cpu', gpuPercent: 0, sizeBytes: 4_000_000_000, sizeVramBytes: 0, contextTokens: 12_288 },
};

function doneState(metrics?: GenerationMetrics): GenerationState {
  return {
    ...initialGenerationState(), phase: 'done', runId: 1, request: REQ, text: 'Contenu',
    result: { type: 'done', content: 'Contenu', sources: [], truncated: false, internetUsed: false, saved: true, id: 'x', model: 'm', ...(metrics ? { metrics } : {}) },
  };
}

async function panel(state: GenerationState, extra: { example?: boolean; mode?: 'demo' | 'local' | 'web' } = {}) {
  return render(
    <MemoryRouter>
      <ResultPanel state={state} mode={extra.mode ?? 'local'} store={new MemoryStore()} onStop={vi.fn()} onRestart={vi.fn()} example={extra.example} />
    </MemoryRouter>,
  );
}

describe('speedView — texte des mesures', () => {
  it('processeur : durée, premier mot, chargement (attente comprise), lecture, rédaction, calcul, explication prudente', () => {
    const view = speedView(METRICS);
    expect(view?.headline).toBe('Rédigé en 48 s');
    expect(view?.firstWord).toBe('Premier mot après 12 s');
    expect(view?.rows).toEqual([
      { label: 'Chargement du modèle', value: '6,8 s' },
      { label: 'Lecture de la demande', value: '2 413 jetons · 20 s · 121 jetons/s' },
      { label: 'Rédaction', value: '300 jetons · 26 s · 11,5 jetons/s' },
      { label: 'Calcul', value: 'sur le processeur' },
    ]);
    expect(view?.explanation).toBe("Cet ordinateur calcule avec le processeur : la rédaction est plus lente qu'avec une carte graphique compatible.");
    expect(view?.explanation).toBe(CPU_EXPLANATION);
  });

  it('partagé : pourcentage de carte graphique, le reste sur le processeur, explication du ralentissement', () => {
    const view = speedView({ ...METRICS, placement: { processor: 'mixed', gpuPercent: 40, sizeBytes: 1_000, sizeVramBytes: 400 } });
    expect(view?.rows.find(r => r.label === 'Calcul')?.value).toBe('partagé : 40 % carte graphique, le reste sur le processeur');
    expect(view?.explanation).toBe(MIXED_EXPLANATION);
    expect(MIXED_EXPLANATION).toBe("D'après le moteur, le modèle ne tient qu'en partie dans la mémoire de la carte graphique : une partie du calcul se fait sur le processeur, ce qui ralentit.");
  });

  it('carte graphique : rien à améliorer, donc aucune explication', () => {
    const view = speedView({ ...METRICS, placement: { processor: 'gpu', gpuPercent: 100, sizeBytes: 1_000, sizeVramBytes: 1_000 } });
    expect(view?.rows.find(r => r.label === 'Calcul')?.value).toBe('sur la carte graphique');
    expect(view?.explanation).toBeUndefined();
  });

  it('jetons déjà en mémoire : non comptés comme lus, signalés à part', () => {
    const view = speedView({ ...METRICS, engine: { ...METRICS.engine, promptTokens: 1_537, promptCachedTokens: 534, promptMs: 20_000, promptTokensPerSecond: 50.1 } });
    expect(view?.rows.find(r => r.label === 'Lecture de la demande')?.value).toBe('1\u00a0003 jetons (534 déjà en mémoire) · 20 s · 50,1 jetons/s');
    // Quelques jetons seulement (« Recommencer » : presque tout est déjà en mémoire) : pas de vitesse, elle ne voudrait rien dire.
    const few = speedView({ ...METRICS, engine: { ...METRICS.engine, promptTokens: 544, promptCachedTokens: 534, promptMs: 2_000, promptTokensPerSecond: 5 } });
    expect(few?.rows.find(r => r.label === 'Lecture de la demande')?.value).toBe('10 jetons (534 déjà en mémoire) · 2 s');
    // Valeur incohérente (plus que le prompt) : ignorée.
    const odd = speedView({ ...METRICS, engine: { ...METRICS.engine, promptTokens: 100, promptCachedTokens: 534 } });
    expect(odd?.rows.find(r => r.label === 'Lecture de la demande')?.value).toMatch(/^100 jetons · /);
  });

  it('placement inconnu : aucune ligne « Calcul » ni explication (rien n’est affirmé sans mesure)', () => {
    const { placement: _placement, ...withoutPlacement } = METRICS;
    const view = speedView(withoutPlacement);
    expect(view?.rows.some(r => r.label === 'Calcul')).toBe(false);
    expect(view?.explanation).toBeUndefined();
  });

  it('chargement fait pendant la préparation de la demande : sa vraie durée, et la part réellement attendue', () => {
    const loading = (extra: Record<string, unknown>) => speedView({ ...METRICS, ...extra })?.rows.find(r => r.label === 'Chargement du modèle')?.value;
    expect(loading({ preloadLoadMs: 14_000, waitModelMs: 0, engine: { ...METRICS.engine, loadMs: 12 } }))
      .toBe('14 s, sans attente (pendant la préparation de la demande)');
    expect(loading({ preloadLoadMs: 14_000, waitModelMs: 3_000, engine: { ...METRICS.engine, loadMs: 12 } }))
      .toBe('14 s, dont 3 s d’attente (le reste pendant la préparation de la demande)');
    // Aucun recouvrement : toute la durée a été attendue.
    expect(loading({ preloadLoadMs: 6_000, waitModelMs: 6_000, engine: { ...METRICS.engine, loadMs: 0 } })).toBe('6 s');
    // Modèle déjà chargé : rien à attendre, même si le moteur annonce quelques millisecondes.
    expect(loading({ preloadLoadMs: 40, waitModelMs: 0, engine: { ...METRICS.engine, loadMs: 12 } })).toBe('aucune attente (modèle déjà en mémoire)');
    // Valeur invalide : ignorée comme les autres mesures.
    expect(loading({ preloadLoadMs: Number.NaN, waitModelMs: 0, engine: { ...METRICS.engine, loadMs: 12 } })).toBe('aucune attente (modèle déjà en mémoire)');
  });

  it('modèle déjà en mémoire : « aucune attente » plutôt que 0 s', () => {
    const view = speedView({ ...METRICS, waitModelMs: 0, engine: { ...METRICS.engine, loadMs: 12 } });
    expect(view?.rows[0]).toEqual({ label: 'Chargement du modèle', value: 'aucune attente (modèle déjà en mémoire)' });
  });

  it('préparation : signalée seulement si elle dure au moins une seconde', () => {
    expect(speedView({ ...METRICS, prepMs: 4_200 })?.rows[0]).toEqual({ label: 'Préparation de la demande', value: '4,2 s' });
    expect(speedView(METRICS)?.rows.some(r => r.label === 'Préparation de la demande')).toBe(false);
  });

  it('sans mesures du moteur (serveur distant, exemple, ancienne application) : rien à montrer', () => {
    const { engine: _engine, ...withoutEngine } = METRICS;
    expect(speedView(withoutEngine)).toBeUndefined();
    expect(speedView(undefined)).toBeUndefined();
    expect(speedView({ totalMs: 5_000, contextTokens: 1, engine: {} })).toBeUndefined();
    for (const junk of [null, 'x', 4, [], {}]) expect(speedView(junk)).toBeUndefined();
  });

  it('mesures reçues d’une autre application : champs invalides omis, jamais « NaN » ni « undefined »', () => {
    const view = speedView({
      totalMs: Number.NaN, firstWordMs: -4, prepMs: 'long', waitModelMs: Number.POSITIVE_INFINITY, contextTokens: 'x',
      engine: { totalMs: 9_000, loadMs: 'x', promptTokens: -1, outputTokens: 120, outputMs: 30_000, tokensPerSecond: 4 },
      placement: { processor: 'tpu' },
    });
    expect(view?.headline).toBe('Rédigé en 9 s');
    expect(view?.firstWord).toBeUndefined();
    expect(view?.rows).toEqual([{ label: 'Rédaction', value: '120 jetons · 30 s · 4 jetons/s' }]);
    const text = JSON.stringify(view);
    expect(text).not.toMatch(/NaN|undefined|Infinity|null/);
  });

  it('formats : secondes, minutes, nombres à la française', () => {
    expect(formatDuration(400)).toBe("moins d'une seconde");
    expect(formatDuration(4_200)).toBe('4,2 s');
    expect(formatDuration(9_000)).toBe('9 s');
    expect(formatDuration(48_000)).toBe('48 s');
    expect(formatDuration(125_000)).toBe('2 min 05 s');
    expect(formatDuration(120_000)).toBe('2 min');
    expect(formatNumber(1_234_567)).toBe('1 234 567');
    expect(formatNumber(12.34, 1)).toBe('12,3');
  });

  it('premier mot immédiat : formulé sans « après moins d’une seconde »', () => {
    expect(speedView({ ...METRICS, firstWordMs: 300 })?.firstWord).toBe("Premier mot en moins d'une seconde");
  });
});

describe('SpeedDetails — affichage', () => {
  it('une ligne sobre et des détails repliés (details/summary natifs), fermés par défaut', async () => {
    const { container } = await render(<SpeedDetails metrics={METRICS} />);
    expect(container.querySelector('[data-testid="speed-details"] p')?.textContent).toContain('Rédigé en 48 s');
    expect(container.textContent).toContain('Premier mot après 12 s');
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent?.replace(/[▸▾]/g, '').trim()).toBe('Détails de vitesse');
    expect(details?.firstElementChild?.tagName).toBe('SUMMARY');
    const text = details?.textContent ?? '';
    for (const expected of ['Chargement du modèle', 'Lecture de la demande', 'Rédaction', 'Calcul', 'sur le processeur', CPU_EXPLANATION]) expect(text).toContain(expected);
  });

  it('ne déplace pas le focus et ne contient aucun lien ni bouton superflu', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const { container } = await render(<SpeedDetails metrics={METRICS} />);
    expect(document.activeElement).toBe(outside);
    expect(container.querySelectorAll('a, button, input')).toHaveLength(0);
    expect(container.querySelector('[aria-live], [role="alert"]')).toBeNull();
    outside.remove();
  });

  it('sans mesures du moteur : rien n’est rendu', async () => {
    const { engine: _engine, ...withoutEngine } = METRICS;
    expect((await render(<SpeedDetails metrics={withoutEngine} />)).container.innerHTML).toBe('');
    expect((await render(<SpeedDetails />)).container.innerHTML).toBe('');
  });
});

describe('ResultPanel — vitesse sous le résultat', () => {
  it('moteur de l’ordinateur : affiché sous le contenu, après les actions', async () => {
    const { container } = await panel(doneState(METRICS));
    const speed = container.querySelector('[data-testid="speed-details"]');
    expect(speed).not.toBeNull();
    const actions = container.querySelector('[role="group"][aria-label="Actions sur le contenu"]');
    expect(actions && speed && (actions.compareDocumentPosition(speed) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
    expect(container.textContent).toContain('Détails de vitesse');
  });

  it('absent quand la génération n’a pas de mesures du moteur (serveur distant, ancienne application)', async () => {
    expect((await panel(doneState())).container.querySelector('[data-testid="speed-details"]')).toBeNull();
    const { engine: _engine, ...remote } = METRICS;
    expect((await panel(doneState(remote), { mode: 'web' })).container.querySelector('[data-testid="speed-details"]')).toBeNull();
  });

  it('jamais pour un exemple pré-rédigé ni pendant la génération', async () => {
    expect((await panel(doneState(METRICS), { example: true })).container.querySelector('[data-testid="speed-details"]')).toBeNull();
    const running: GenerationState = { ...doneState(METRICS), phase: 'running', result: null };
    expect((await panel(running)).container.querySelector('[data-testid="speed-details"]')).toBeNull();
  });

  it('affichage de la session seulement : ni historique, ni envoi (aucun accès au stockage ni au réseau)', async () => {
    const store = new MemoryStore();
    const writes = vi.spyOn(store, 'setFavorite');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await render(
        <MemoryRouter>
          <ResultPanel state={doneState(METRICS)} mode="local" store={store} onStop={vi.fn()} onRestart={vi.fn()} />
        </MemoryRouter>,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(writes).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
