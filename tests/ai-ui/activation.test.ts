// « Activer l'IA » : plan (ce qui sera fait sur CET ordinateur), taille annoncée avant le clic, durée indicative,
// progression globale unique (moteur + modèle), reste à télécharger.

import { describe, expect, it } from 'vitest';
import {
  activationBlocker, activationPlan, activationProgress, activationSizeDetail, activationSizeText, activationSteps, missingDiskGB,
  planFromProgress,
} from '@/lib/ai-ui/activation';
import { downloadDurationText } from '@/lib/ai-ui/format';
import { EMPTY_PROGRESS, type AIProgressState } from '@/lib/ai-ui/progress';
import { makeStatus } from './fixtures';

/** Texte lisible : espaces insécables remplacées par des espaces ordinaires. */
const plain = (text: string | null) => (text ?? '').replace(/\u00a0/g, ' ');

describe('activationPlan', () => {
  it('moteur absent (Windows) : installation du moteur + modèle recommandé, taille totale estimée', () => {
    // 16 Go sans carte graphique : Magistra Standard (9 Go) recommandé ; installateur ≈ 1 100 Mo (fixture).
    const plan = activationPlan(makeStatus({ engine: 'not_installed' }))!;
    expect(plan.engine).toBe('install');
    expect(plan.engineMB).toBe(1100);
    expect(plan.engineApprox).toBe(true);
    expect(plan.tier).toBe('standard');
    expect(plan.tierLabel).toBe('Magistra Standard');
    expect(plan.modelMB).toBe(9 * 1024);
    expect(plan.totalMB).toBe(1100 + 9 * 1024);
    expect(plan.requiredDiskGB).toBe(5 + 10);
    expect(plain(activationSizeText(plan))).toBe('Environ 10,1 Go à télécharger en tout, une seule fois.');
    expect(plain(activationSizeDetail(plan))).toBe('moteur IA : environ 1,1 Go · Magistra Standard : 9 Go');
  });

  it('taille exacte de l’installateur connue : plus d’« environ »', () => {
    const status = makeStatus({ engine: 'not_installed' });
    status.engineDownload.sizeMB = 1700;
    const plan = activationPlan(status)!;
    expect(plan.engineApprox).toBe(false);
    expect(plain(activationSizeText(plan))).toBe('10,7 Go à télécharger en tout, une seule fois.');
  });

  it('moteur en marche, modèle absent : seulement le modèle', () => {
    const plan = activationPlan(makeStatus({ engine: 'running', installed: [] }))!;
    expect(plan.engine).toBeNull();
    expect(plan.engineMB).toBe(0);
    expect(plan.totalMB).toBe(9 * 1024);
    expect(plain(activationSizeText(plan))).toBe('9 Go à télécharger en tout, une seule fois.');
    expect(activationSizeDetail(plan)).toBeNull();
    expect(activationSteps(plan).map(s => s.label)).toEqual(['Téléchargement de Magistra Standard']);
  });

  it('moteur arrêté : démarrage ; la taille du modèle est un maximum (il est peut-être déjà là)', () => {
    const plan = activationPlan(makeStatus({ engine: 'installed_stopped' }))!;
    expect(plan.engine).toBe('start');
    expect(plan.modelUnknown).toBe(true);
    expect(plain(activationSizeText(plan))).toBe('9 Go à télécharger au plus, une seule fois (rien si le modèle est déjà sur cet ordinateur).');
    expect(activationSteps(plan).map(s => s.label)).toEqual(['Démarrage du moteur IA', 'Téléchargement de Magistra Standard']);
  });

  it('moteur arrêté, modèle choisi déjà installé : aucun téléchargement', () => {
    const plan = activationPlan(makeStatus({ engine: 'installed_stopped', installed: ['standard'], ready: false }))!;
    expect(plan.totalMB).toBe(0);
    expect(activationSizeText(plan)).toBe('Aucun téléchargement : il suffit de démarrer le moteur IA.');
  });

  it('moteur trop ancien : mise à jour (Windows) ; installé par le service informatique : rien d’automatique', () => {
    expect(activationPlan(makeStatus({ engine: 'running', installed: [], outdated: true }))!.engine).toBe('update');
    expect(activationPlan(makeStatus({ engine: 'running', installed: [], outdated: true, managedByAdmin: true }))!.engine).toBe('admin');
  });

  it('hors Windows : installation depuis la page officielle (Magistra attend puis poursuit)', () => {
    const status = makeStatus({ engine: 'not_installed' });
    status.engineDownload.platformSupported = false;
    expect(activationPlan(status)!.engine).toBe('manual');
  });

  it('IA prête ou serveur IA distant : rien à activer', () => {
    expect(activationPlan(makeStatus({ engine: 'running', installed: ['standard'] }))).toBeNull();
    expect(activationPlan(makeStatus({ mode: 'remote', ready: false }))).toBeNull();
  });

  it('installation automatique du moteur en échec, recours à la page officielle : « manual » (Magistra attend puis poursuit)', () => {
    const plan = activationPlan(makeStatus({ engine: 'not_installed' }), { manualEngine: true })!;
    expect(plan.engine).toBe('manual');
    // Le modèle suit toujours ; le moteur compte dans la taille annoncée (téléchargé depuis sa page officielle).
    expect(plan.modelMB).toBe(9 * 1024);
    expect(activationSteps(plan).map(s => s.label)).toEqual(['Installation du moteur IA', 'Téléchargement de Magistra Standard']);
    expect(activationPlan(makeStatus({ engine: 'running', installed: [], outdated: true }), { manualEngine: true })!.engine).toBe('manual');
  });

  it('installation du moteur déjà en cours (fenêtre rechargée pendant l’installateur) : suivie, jamais « démarrer le moteur »', () => {
    // L'installateur officiel arrête l'ancien moteur : l'exécutable est là, le moteur ne répond pas (« arrêté »).
    expect(activationPlan(makeStatus({ engine: 'installed_stopped', installing: 'install' }))!.engine).toBe('install');
    expect(activationPlan(makeStatus({ engine: 'installed_stopped', installing: 'update' }))!.engine).toBe('update');
    expect(activationPlan(makeStatus({ engine: 'installed_stopped' }))!.engine).toBe('start');
  });

  it('modèle personnalisé ou moteur sur un autre ordinateur (options avancées) : pas d’activation en un clic', () => {
    // Modèle personnalisé absent : l'activation installerait Magistra Standard à sa place, sans le dire.
    const custom = makeStatus({ engine: 'running', installed: ['standard'], customModel: 'llama3.1:8b' });
    expect(custom.ready).toBe(false);
    expect(activationBlocker(custom)).toBe('custom-model');
    expect(activationPlan(custom)).toBeNull();
    // Moteur réglé sur une autre machine : rien ne s'installe ni ne démarre ici ; les données y partent.
    for (const engine of ['running', 'unknown'] as const) {
      const remote = makeStatus({ engine, installed: [], ollamaUrl: 'http://10.0.0.5:11434' });
      expect(activationBlocker(remote), engine).toBe('remote-engine');
      expect(activationPlan(remote), engine).toBeNull();
    }
    // IA de cet ordinateur, réglages par défaut : activation possible.
    expect(activationBlocker(makeStatus({ engine: 'not_installed' }))).toBeNull();
    expect(activationBlocker(makeStatus({ mode: 'remote', ready: false }))).toBeNull();
  });

  it('niveau déjà choisi et installé : conservé (aucun nouveau téléchargement)', () => {
    const plan = activationPlan(makeStatus({ engine: 'installed_stopped', installed: ['leger'], selectedTier: 'leger', ready: false }))!;
    expect(plan.tier).toBe('leger');
    expect(plan.modelMB).toBe(0);
  });

  it('espace disque insuffisant : nombre de Go à libérer', () => {
    // 8 Go libres : Magistra Léger (6 Go) recommandé ; moteur (5 Go) + modèle (6 + 1 Go) = 12 Go nécessaires.
    const plan = activationPlan(makeStatus({ engine: 'not_installed', hardware: { freeDiskGB: 8 } }))!;
    expect(plan.tier).toBe('leger');
    expect(plan.requiredDiskGB).toBe(12);
    expect(missingDiskGB(plan, 8)).toBe(4);
    expect(missingDiskGB(plan, 120)).toBeNull();
    expect(missingDiskGB(plan, undefined)).toBeNull();
  });
});

describe('downloadDurationText', () => {
  it('durée indicative pour la fibre et une connexion plus lente', () => {
    expect(plain(downloadDurationText(9 * 1024))).toBe('environ 15 minutes avec la fibre, 1 h avec une connexion plus lente');
    expect(plain(downloadDurationText(1700 + 9 * 1024))).toBe('environ 15 minutes avec la fibre, 1 h 30 avec une connexion plus lente');
    expect(plain(downloadDurationText(15 * 1024))).toBe('environ 20 minutes avec la fibre, 2 h avec une connexion plus lente');
    expect(plain(downloadDurationText(200))).toBe('environ 5 minutes avec la fibre, 5 minutes avec une connexion plus lente');
  });

  it('rien à télécharger : aucune durée', () => {
    expect(downloadDurationText(0)).toBeNull();
    expect(downloadDurationText(Number.NaN)).toBeNull();
  });
});

describe('activationProgress', () => {
  const plan = activationPlan(makeStatus({ engine: 'not_installed' }))!;

  it('étape 1 : téléchargement du moteur, pourcentage GLOBAL et reste', () => {
    const progress: AIProgressState = { engine: { stage: 'download', receivedMB: 550, totalMB: 1100 }, model: null };
    const view = activationProgress(plan, 'engine', progress);
    expect(view.steps.map(s => s.label)).toEqual(['Installation du moteur IA', 'Téléchargement de Magistra Standard']);
    expect(view.current).toBe(0);
    expect(view.stageText).toBe('Téléchargement du moteur IA…');
    expect(view.percent).toBe(Math.floor((550 / (1100 + 9216)) * 100));
    expect(plain(view.transferText)).toBe('550 Mo sur 10,1 Go');
    expect(plain(view.remainingText)).toBe('reste 9,5 Go');
  });

  it('installateur en cours : message du moteur, moteur compté comme téléchargé', () => {
    const progress: AIProgressState = { engine: { stage: 'install', message: 'Installation du moteur IA en cours…', totalMB: 1100 }, model: null };
    const view = activationProgress(plan, 'engine', progress);
    expect(view.stageText).toBe('Installation du moteur IA en cours…');
    expect(view.percent).toBe(10);
  });

  it('étape 2 : modèle (tailles réelles reçues du moteur), pourcentage global cumulé', () => {
    const progress: AIProgressState = {
      engine: null,
      model: { stage: 'pull', model: 'ministral-3:14b', tier: 'standard', status: 'pulling abc', completedMB: 4608, totalMB: 9216 },
    };
    const view = activationProgress(plan, 'model', progress);
    expect(view.current).toBe(1);
    expect(view.stageText).toBe('Téléchargement en cours…');
    expect(view.percent).toBe(Math.floor(((1100 + 4608) / (1100 + 9216)) * 100));
    expect(plain(view.remainingText)).toBe('reste 4,5 Go');
  });

  it('démarrage du moteur : barre indéterminée (jamais un « 0 % » figé)', () => {
    const stopped = activationPlan(makeStatus({ engine: 'installed_stopped' }))!;
    const view = activationProgress(stopped, 'engine', EMPTY_PROGRESS);
    expect(view.percent).toBeNull();
    expect(view.transferText).toBeNull();
    expect(view.stageText).toContain('Le moteur IA démarre');
  });

  it('téléchargement déjà en cours sans activation (fenêtre rechargée) : l’étape visible seulement', () => {
    const status = makeStatus({ engine: 'running', installed: [] });
    const progress: AIProgressState = {
      engine: null,
      model: { stage: 'pull', model: 'ministral-3:14b', tier: 'standard', status: 'pulling', completedMB: 2304, totalMB: 9216 },
    };
    const derived = planFromProgress(progress, status.tiers);
    const view = activationProgress(derived, null, progress);
    expect(view.steps.map(s => s.label)).toEqual(['Téléchargement de Magistra Standard']);
    expect(view.percent).toBe(25);
  });

  it('attente d’une installation depuis la page officielle, hors activation, après un téléchargement raté : ni « 100 % » ni Go', () => {
    const status = makeStatus({ engine: 'not_installed' });
    // Le réducteur garde les tailles du téléchargement raté (1,7 Go reçus… sur 1,7 Go) dans l'étape « waiting ».
    const progress: AIProgressState = {
      engine: { stage: 'waiting', receivedMB: 400, totalMB: 1700, message: 'En attente de l’installation du moteur IA…' },
      model: null,
    };
    const derived = planFromProgress(progress, status.tiers, { manual: true });
    expect(derived.engine).toBe('manual');
    const view = activationProgress(derived, null, progress);
    expect(view.stageText).toBe('En attente de l’installation du moteur IA depuis sa page officielle…');
    expect(view.percent).toBeNull();
    expect(view.transferText).toBeNull();
    // Opération sur le moteur seul (aucune activation) : aucune « étape 2 » annoncée qui ne viendrait jamais.
    expect(view.steps.map(s => s.label)).toEqual(['Installation du moteur IA']);
  });

  it('installation du moteur lancée hors activation (réglages) : une seule étape ; activation reprise après rechargement : le modèle suit', () => {
    const status = makeStatus({ engine: 'not_installed' });
    const progress: AIProgressState = { engine: { stage: 'download', receivedMB: 400, totalMB: 1700 }, model: null };
    expect(activationSteps(planFromProgress(progress, status.tiers)).map(s => s.label)).toEqual(['Installation du moteur IA']);
    // Niveau pas encore connu : « du modèle d'IA », jamais « de le modèle d'IA ».
    expect(activationSteps(planFromProgress(progress, status.tiers, { activation: true })).map(s => s.label))
      .toEqual(['Installation du moteur IA', 'Téléchargement du modèle d\'IA']);
  });

  it('téléchargement du modèle annulé pendant sa préparation : l’étape reste celle du modèle (jamais « Installation du moteur IA »)', () => {
    const status = makeStatus({ engine: 'running', installed: [] });
    const progress: AIProgressState = { engine: null, model: { stage: 'cancelled', model: 'ministral-3:14b', tier: 'standard' } };
    const derived = planFromProgress(progress, status.tiers, { modelPending: true });
    expect(derived.engine).toBeNull();
    const view = activationProgress(derived, null, progress);
    expect(view.steps.map(s => s.label)).toEqual(['Téléchargement de Magistra Standard']);
    expect(view.stageText).toBe('Arrêt du téléchargement…');
    expect(view.stageText).not.toMatch(/moteur/);
  });

  it('hors Windows : attente du moteur installé depuis sa page officielle — ni pourcentage ni Go inventés ; ensuite, le modèle seul', () => {
    const status = makeStatus({ engine: 'not_installed' });
    status.engineDownload.platformSupported = false;
    const manual = activationPlan(status)!;
    // Attente : le processus principal n'envoie qu'un message générique ; rien n'est téléchargé par Magistra.
    const waiting = activationProgress(manual, 'engine', { engine: { stage: 'waiting', message: 'En attente de l’installation du moteur IA…' }, model: null });
    expect(waiting.stageText).toBe('En attente de l’installation du moteur IA depuis sa page officielle…');
    expect(waiting.percent).toBeNull();
    expect(waiting.transferText).toBeNull();
    expect(waiting.remainingText).toBeNull();
    // Moteur installé par l'enseignant : la barre ne compte que le modèle, que Magistra télécharge.
    const model = activationProgress(manual, 'model', {
      engine: null,
      model: { stage: 'pull', model: 'ministral-3:14b', tier: 'standard', status: 'pulling', completedMB: 2304, totalMB: 9216 },
    });
    expect(model.current).toBe(1);
    expect(model.percent).toBe(25);
    expect(plain(model.transferText)).toBe('2,3 Go sur 9 Go');
  });
});
