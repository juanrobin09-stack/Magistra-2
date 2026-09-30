import { describe, expect, it } from 'vitest';
import {
  EMPTY_PROGRESS, isEngineBusy, isModelPulling, reduceProgress, type AIProgressState, type ProgressAction,
} from '@/lib/ai-ui/progress';

const run = (actions: ProgressAction[], from: AIProgressState = EMPTY_PROGRESS) => actions.reduce(reduceProgress, from);

describe('installation du moteur', () => {
  it('suit le téléchargement, l’installation puis le démarrage', () => {
    let s = run([{ kind: 'engine-start' }]);
    expect(s.engine).toEqual({ stage: 'starting' });
    expect(isEngineBusy(s.engine)).toBe(true);

    s = run([{ kind: 'engine-download', receivedMB: 100, totalMB: 1000 }, { kind: 'engine-download', receivedMB: 400 }], s);
    expect(s.engine).toEqual({ stage: 'download', receivedMB: 400, totalMB: 1000 });

    s = run([{ kind: 'engine-install', message: 'Installation en cours…' }], s);
    expect(s.engine?.stage).toBe('install');
    expect(isEngineBusy(s.engine)).toBe(true);

    s = run([{ kind: 'engine-waiting', message: 'Démarrage du moteur IA…' }], s);
    expect(s.engine?.stage).toBe('waiting');
    expect(isEngineBusy(s.engine)).toBe(false);

    s = run([{ kind: 'engine-ready', version: '0.12.3' }], s);
    expect(s.engine).toEqual({ stage: 'ready', version: '0.12.3' });
  });

  it('affiche une erreur, sauf après une annulation demandée', () => {
    expect(run([{ kind: 'engine-start' }, { kind: 'engine-error', message: 'Connexion perdue.' }]).engine)
      .toMatchObject({ stage: 'error', message: 'Connexion perdue.' });
    expect(run([{ kind: 'engine-start' }, { kind: 'engine-cancelled' }, { kind: 'engine-error', message: 'aborted' }]).engine)
      .toEqual({ stage: 'cancelled' });
  });
});

describe('téléchargement d’un modèle', () => {
  it('calcule le pourcentage et conserve les informations connues', () => {
    let s = run([{ kind: 'model-start', model: 'ministral-3:14b', tier: 'standard' }]);
    expect(isModelPulling(s.model)).toBe(true);

    s = run([
      { kind: 'model-pull', model: 'ministral-3:14b', status: 'pulling manifest' },
      { kind: 'model-pull', model: 'ministral-3:14b', status: 'pulling abc', completedMB: 2304, totalMB: 9216 },
    ], s);
    expect(s.model).toMatchObject({ stage: 'pull', tier: 'standard', completedMB: 2304, totalMB: 9216, percent: 25 });

    // Étape sans quantités (vérification) : on garde la dernière progression connue.
    s = run([{ kind: 'model-pull', model: 'ministral-3:14b', status: 'verifying sha256 digest' }], s);
    expect(s.model).toMatchObject({ stage: 'pull', status: 'verifying sha256 digest', percent: 25, totalMB: 9216 });

    s = run([{ kind: 'model-ready', model: 'ministral-3:14b' }], s);
    expect(s.model).toMatchObject({ stage: 'ready', percent: 100 });
    expect(isModelPulling(s.model)).toBe(false);
  });

  it('préfère le pourcentage fourni par le moteur', () => {
    const s = run([{ kind: 'model-pull', model: 'm', status: 'pulling', completedMB: 10, totalMB: 100, percent: 42.9 }]);
    expect(s.model?.percent).toBe(42);
  });

  it('annulation : les évènements tardifs ne relancent pas la progression', () => {
    const s = run([
      { kind: 'model-start', model: 'm', tier: 'leger' },
      { kind: 'model-pull', model: 'm', status: 'pulling', completedMB: 30, totalMB: 100 },
      { kind: 'model-cancelled' },
      { kind: 'model-pull', model: 'm', status: 'pulling', completedMB: 31, totalMB: 100 },
      { kind: 'model-error', model: 'm', message: 'context canceled' },
    ]);
    expect(s.model).toMatchObject({ stage: 'cancelled', percent: 30, tier: 'leger' });
  });

  it('reprise après annulation ou erreur', () => {
    const errored = run([{ kind: 'model-start', model: 'm' }, { kind: 'model-error', model: 'm', message: 'Connexion perdue.' }]);
    expect(errored.model).toMatchObject({ stage: 'error', message: 'Connexion perdue.' });
    const resumed = run([{ kind: 'model-start', model: 'm', tier: 'standard' }], errored);
    expect(resumed.model).toEqual({ stage: 'starting', model: 'm', tier: 'standard' });
    expect(run([{ kind: 'model-clear' }], resumed).model).toBeNull();
  });
});
