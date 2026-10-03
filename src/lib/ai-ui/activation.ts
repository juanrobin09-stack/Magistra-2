// « Activer l'IA » en un clic (application Windows) : ce que l'activation va faire sur CET ordinateur (moteur IA à
// installer, mettre à jour ou démarrer ; modèle recommandé à télécharger), la taille totale annoncée AVANT le clic,
// puis une progression unique pendant l'enchaînement (étape en cours, pourcentage global, reste à télécharger).
// Fonctions pures : aucune dépendance à React ni au pont Electron (testées dans tests/ai-ui/activation.test.ts).
// L'enchaînement lui-même (installEngine → startEngine → pullModel) est fait par useAIStatus().activate().

import type { TierId } from '@shared/ai/models';
import { ENGINE_STARTING_MESSAGE, type AIStatus, type TierStatus } from '@shared/ipc';
import { formatMB, progressPercent } from './format';
import { isEngineBusy, isModelPulling, type AIProgressState } from './progress';
import { aiPhase, engineHostIfRemote, initialTierChoice, pullStatusText, tierLabelFor } from './status';

/**
 * Ce que l'activation fait du moteur IA :
 *  - install : installation automatique (Windows) ; update : mise à jour d'un moteur trop ancien (Windows) ;
 *  - manual : hors Windows, l'enseignant l'installe depuis la page officielle, Magistra attend puis poursuit ;
 *  - start : moteur installé mais arrêté (aucun téléchargement) ;
 *  - admin : moteur installé par le service informatique et trop ancien — Magistra ne peut rien faire seule.
 */
export type EngineAction = 'install' | 'update' | 'manual' | 'start' | 'admin';

export type ActivationStepId = 'engine' | 'model';

export interface ActivationPlan {
  /** Action sur le moteur ; null s'il fonctionne déjà. */
  engine: EngineAction | null;
  /** Taille du téléchargement du moteur (Mo) ; 0 si rien à télécharger. */
  engineMB: number;
  /** Taille du moteur estimée (taille réelle de l'installateur pas encore connue). */
  engineApprox: boolean;
  /** Niveau de modèle : celui déjà choisi s'il est installé, sinon celui recommandé pour cet ordinateur. */
  tier: TierId;
  tierLabel: string;
  /** Niveau déconseillé sur cet ordinateur (confirmation demandée avant le téléchargement). */
  tierNotRecommended: boolean;
  /** Taille du modèle (Mo) ; 0 s'il est déjà installé. */
  modelMB: number;
  /**
   * Moteur arrêté ou absent : Magistra ne peut pas encore savoir si le modèle est déjà sur l'ordinateur ;
   * la taille annoncée est alors un maximum (rien n'est retéléchargé s'il est présent).
   */
  modelUnknown: boolean;
  totalMB: number;
  /** Espace disque nécessaire (Go), à comparer à l'espace libre. */
  requiredDiskGB: number;
}

/** Mise à jour du moteur possible par Magistra elle-même (installateur officiel, Windows, hors service informatique). */
export function engineSelfUpdatable(status: AIStatus): boolean {
  return status.engineDownload.platformSupported && !status.engine.managedByAdmin;
}

/**
 * Une fenêtre d'Ollama peut-elle s'ouvrir pendant cette action sur le moteur ? Oui quand un installateur officiel
 * d'Ollama est lancé sur CET ordinateur sous Windows : « install » et « update » (Magistra le lance en silence),
 * « manual » (l'enseignant l'ouvre depuis la page officielle : l'installateur est alors lui-même une fenêtre visible, à
 * terminer d'abord, d'où une note dédiée : ENGINE_WINDOW_MANUAL_NOTE). L'installateur lance Ollama à la fin, sans les arguments
 * qui le cachent (OLLAMA_APP_ARGS, electron/ollamaSetup.ts) : l'application ouvre alors sa fenêtre d'accueil.
 * Non pour « start » (Magistra lance elle-même Ollama sans fenêtre), pour « admin » (rien ne s'installe), hors Windows
 * (installation à la main, aucune fenêtre n'est promise), ni quand Magistra utilise un serveur IA ou un moteur placé
 * sur un autre ordinateur (rien ne s'installe ici).
 */
export function engineWindowMayOpen(status: AIStatus, action: EngineAction | null): boolean {
  if (action !== 'install' && action !== 'update' && action !== 'manual') return false;
  return status.engineDownload.platformSupported
    && status.config.mode !== 'remote'
    && engineHostIfRemote(status.engine.url) === null;
}

/**
 * Pourquoi l'activation en un clic ne s'applique pas, alors que l'IA de cet ordinateur n'est pas prête (réglages des
 * options avancées) :
 *  - remote-engine : adresse du moteur IA réglée sur un autre ordinateur — rien ne s'installe ni ne démarre ici, et
 *    les données de génération partent vers cette machine : jamais « sur cet ordinateur », jamais « démarrer le
 *    moteur », jamais de demande mémorisée qui échouerait à chaque lancement ;
 *  - custom-model : modèle personnalisé choisi — l'activation, qui installe une version Magistra, le remplacerait sans
 *    le dire (« Aucun téléchargement : il suffit de démarrer le moteur IA » était faux, le moteur tournant déjà).
 * La vraie cause et les options avancées sont affichées à la place. null : activation possible, ou sans objet (IA
 * prête, serveur IA distant).
 */
export type ActivationBlocker = 'remote-engine' | 'custom-model';

export function activationBlocker(status: AIStatus): ActivationBlocker | null {
  if (status.ready || status.config.mode === 'remote') return null;
  if (engineHostIfRemote(status.engine.url)) return 'remote-engine';
  if (status.config.customModel) return 'custom-model';
  return null;
}

export interface ActivationOptions {
  /**
   * Le registre a refusé le modèle faute d'un moteur assez récent (erreur ENGINE_OUTDATED au téléchargement, alors
   * que la version du moteur semblait suffire) : le moteur est d'abord mis à jour, sa taille comprise dans le total.
   */
  engineUpdate?: boolean;
  /**
   * L'installation automatique du moteur a échoué : l'enseignant l'installe depuis sa page officielle (« Ouvrir la
   * page officielle d'installation »), Magistra attend sa détection puis poursuit toute seule avec le modèle.
   */
  manualEngine?: boolean;
}

/**
 * Plan d'activation pour l'état courant ; null si l'IA est prête, si Magistra utilise un serveur IA distant
 * (l'activation ne concerne que l'IA de cet ordinateur) ou si elle ne s'applique pas (activationBlocker).
 * Installation du moteur déjà en cours dans le processus principal (fenêtre rechargée pendant l'installateur, qui
 * arrête l'ancien moteur) : c'est elle que le plan suit — jamais « démarrer le moteur » en parallèle.
 */
export function activationPlan(status: AIStatus, options: ActivationOptions = {}): ActivationPlan | null {
  if (status.ready || status.config.mode === 'remote' || activationBlocker(status)) return null;
  const phase = aiPhase(status);
  const dl = status.engineDownload;
  const exact = typeof dl.sizeMB === 'number' && dl.sizeMB > 0;
  const automatic = dl.platformSupported && !options.manualEngine;
  let engine: EngineAction | null = null;
  if (status.engine.installing) engine = status.engine.installing;
  else if (phase === 'engine_missing') engine = automatic ? 'install' : 'manual';
  else if (phase === 'engine_outdated') engine = status.engine.managedByAdmin ? 'admin' : automatic ? 'update' : 'manual';
  else if (options.engineUpdate && engineSelfUpdatable(status)) engine = 'update';
  else if (phase === 'engine_stopped') engine = 'start';
  const downloadsEngine = engine === 'install' || engine === 'update' || engine === 'manual';
  const engineMB = downloadsEngine ? (exact ? dl.sizeMB! : dl.approxSizeMB) : 0;

  const tierId = initialTierChoice(status, 'setup');
  const tier: TierStatus | undefined = status.tiers.find(t => t.id === tierId) ?? status.tiers[0];
  const modelMB = tier && !tier.installed ? tier.downloadGB * 1024 : 0;
  const requiredDiskGB = (engine === 'install' || engine === 'update' ? dl.requiredDiskGB : 0) + (tier && !tier.installed ? tier.downloadGB + 1 : 0);
  return {
    engine,
    engineMB,
    engineApprox: downloadsEngine && !exact,
    tier: tier?.id ?? tierId,
    tierLabel: tier?.label ?? "le modèle d'IA",
    tierNotRecommended: tier?.fit === 'not_recommended',
    modelMB,
    modelUnknown: status.engine.state !== 'running',
    totalMB: engineMB + modelMB,
    requiredDiskGB,
  };
}

/** Espace disque manquant (Go) pour ce plan, ou null s'il suffit (ou s'il est inconnu). */
export function missingDiskGB(plan: ActivationPlan, freeDiskGB: number | undefined): number | null {
  if (typeof freeDiskGB !== 'number' || plan.requiredDiskGB <= 0 || freeDiskGB >= plan.requiredDiskGB) return null;
  return Math.ceil(plan.requiredDiskGB - freeDiskGB);
}

/**
 * Taille annoncée à côté du bouton « Activer l'IA » : « 10,7 Go à télécharger en tout, une seule fois »,
 * « environ 10,7 Go… », « 9 Go au plus… » (modèle peut-être déjà présent), ou aucun téléchargement.
 */
export function activationSizeText(plan: ActivationPlan): string {
  if (plan.totalMB <= 0) return 'Aucun téléchargement : il suffit de démarrer le moteur IA.';
  const size = formatMB(plan.totalMB);
  if (plan.modelUnknown && plan.modelMB > 0 && plan.engine !== 'install' && plan.engine !== 'manual') {
    return `${size} à télécharger au plus, une seule fois (rien si le modèle est déjà sur cet ordinateur).`;
  }
  return `${plan.engineApprox ? `Environ ${size}` : size} à télécharger en tout, une seule fois.`;
}

/** Détail de la taille : « moteur IA : environ 1,7 Go · Magistra Standard : 9 Go ». */
export function activationSizeDetail(plan: ActivationPlan): string | null {
  const parts: string[] = [];
  if (plan.engineMB > 0) parts.push(`moteur IA : ${plan.engineApprox ? 'environ ' : ''}${formatMB(plan.engineMB)}`);
  if (plan.modelMB > 0) parts.push(`${plan.tierLabel} : ${formatMB(plan.modelMB)}`);
  return parts.length > 1 ? parts.join(' · ') : null;
}

// ─── Progression ────────────────────────────────────────────────────────────

export interface ActivationStep {
  id: ActivationStepId;
  label: string;
}

export interface ActivationProgressView {
  steps: ActivationStep[];
  /** Index de l'étape en cours. */
  current: number;
  /** Ce qui se passe maintenant (« Téléchargement du moteur IA… »). */
  stageText: string;
  /** Pourcentage global (téléchargements cumulés du moteur et du modèle) ; null s'il n'a pas de sens (démarrage). */
  percent: number | null;
  /** « 1,2 Go sur 10,7 Go ». */
  transferText: string | null;
  /** « reste 9,5 Go ». */
  remainingText: string | null;
}

const ENGINE_STEP_LABEL: Record<EngineAction, string> = {
  install: 'Installation du moteur IA',
  update: 'Mise à jour du moteur IA',
  manual: 'Installation du moteur IA',
  start: 'Démarrage du moteur IA',
  admin: 'Mise à jour du moteur IA',
};

/** Ce que la progression affiche : le plan de l'activation, ou celui déduit de la progression (planFromProgress). */
export type ProgressPlan = Pick<ActivationPlan, 'engine' | 'engineMB' | 'tierLabel' | 'modelMB'> & {
  /**
   * Étape « modèle » annoncée (par défaut : oui). Non pour une opération sur le moteur seul, hors activation (page
   * officielle ouverte depuis la page de l'IA, mise à jour depuis les réglages) : aucun modèle ne suivra tout seul.
   */
  modelStep?: boolean;
};

/**
 * « Téléchargement de Magistra Standard » ; niveau inconnu (nom générique « le modèle d'IA ») : « Téléchargement du
 * modèle d'IA », jamais « de le ».
 */
function modelStepLabel(tierLabel: string): string {
  return tierLabel.startsWith('le ') ? `Téléchargement du ${tierLabel.slice(3)}` : `Téléchargement de ${tierLabel}`;
}

/** Étapes affichées pour un plan : moteur (s'il y a quelque chose à faire), puis modèle (sauf opération sur le moteur seul). */
export function activationSteps(plan: Pick<ProgressPlan, 'engine' | 'tierLabel' | 'modelStep'>): ActivationStep[] {
  const steps: ActivationStep[] = [];
  if (plan.engine) steps.push({ id: 'engine', label: ENGINE_STEP_LABEL[plan.engine] });
  if (plan.modelStep !== false || !plan.engine) steps.push({ id: 'model', label: modelStepLabel(plan.tierLabel) });
  return steps;
}

/** Ce que la vue sait, en plus de la progression, pour en déduire l'étape visible (planFromProgress). */
export interface ProgressContext {
  /** Installation du moteur depuis sa page officielle : Magistra attend, sans rien télécharger elle-même. */
  manual?: boolean;
  /** Activation en cours (fenêtre rechargée, plan pas encore relu) : le modèle suivra le moteur. */
  activation?: boolean;
  /** Téléchargement de modèle demandé, réponse du processus principal attendue (annulation comprise). */
  modelPending?: boolean;
}

/**
 * Plan déduit de la seule progression en cours (fenêtre rechargée pendant un téléchargement, opération lancée depuis
 * les réglages ou la page de l'IA) : l'étape visible, sans ce qui l'a précédée. Attente d'une installation depuis la
 * page officielle : « manual » — ni pourcentage ni Go (le téléchargement raté d'avant n'est pas « terminé »). Étape
 * « modèle » seulement si un modèle est réellement demandé ou si une activation le téléchargera ensuite.
 */
export function planFromProgress(progress: AIProgressState, tiers: TierStatus[], context: ProgressContext = {}): ProgressPlan {
  const model = progress.model;
  const engine = progress.engine;
  const tierLabel = tierLabelFor(tiers, { tier: model?.tier, model: model?.model });
  const engineActive = engine !== null && (isEngineBusy(engine) || engine.stage === 'waiting');
  // Modèle demandé : en cours, ou réponse attendue (préparation, annulation) — jamais « Installation du moteur IA ».
  if (model && (isModelPulling(model) || (context.modelPending && !engineActive))) {
    const tier = tiers.find(t => t.id === model.tier || t.model === model.model);
    return { engine: null, engineMB: 0, tierLabel, modelMB: model.totalMB ?? (tier ? tier.downloadGB * 1024 : 0) };
  }
  return {
    engine: context.manual ? 'manual' : 'install',
    engineMB: engine?.totalMB ?? 0,
    tierLabel,
    modelMB: 0,
    modelStep: context.activation === true,
  };
}

/**
 * Vue unique de la progression : étape en cours, pourcentage GLOBAL (octets du moteur + octets du modèle, sur le
 * total annoncé), reste à télécharger. Les tailles réelles reçues du moteur remplacent les tailles annoncées.
 */
export function activationProgress(plan: ProgressPlan, step: ActivationStepId | null, progress: AIProgressState): ActivationProgressView {
  const steps = activationSteps(plan);
  const engineP = progress.engine;
  const modelP = progress.model;
  // Sans étape connue : le modèle s'il n'y a rien à faire du moteur, ou s'il se télécharge déjà.
  const onModel = step === 'model' || (step === null && (plan.engine === null || isModelPulling(modelP)));
  const current = onModel ? steps.length - 1 : 0;

  // Hors Windows (« manual »), l'enseignant installe le moteur depuis sa page officielle : Magistra ne le télécharge pas
  // elle-même, il n'entre donc pas dans la progression — jamais un pourcentage ni des Go qui ne correspondent à rien
  // pendant l'attente. La barre ne compte que ce que Magistra télécharge (le modèle, ensuite).
  const downloadsEngine = plan.engine === 'install' || plan.engine === 'update';
  const engineTotal = downloadsEngine ? (engineP?.totalMB && engineP.totalMB > 0 ? engineP.totalMB : plan.engineMB) : 0;
  let engineDone = 0;
  if (onModel) engineDone = engineTotal;
  else if (engineP?.stage === 'download') engineDone = Math.min(engineTotal, engineP.receivedMB ?? 0);
  else if (engineP && ['install', 'waiting', 'ready'].includes(engineP.stage)) engineDone = engineTotal;

  const modelTotal = modelP?.totalMB && modelP.totalMB > 0 ? modelP.totalMB : plan.modelMB;
  let modelDone = 0;
  if (onModel && modelP?.stage === 'ready') modelDone = modelTotal;
  else if (onModel && modelP?.stage === 'pull') {
    const pct = progressPercent({ percent: modelP.percent, completed: modelP.completedMB, total: modelP.totalMB });
    modelDone = typeof modelP.completedMB === 'number' ? modelP.completedMB : pct !== null ? (pct / 100) * modelTotal : 0;
    modelDone = Math.min(modelTotal, modelDone);
  }

  const total = engineTotal + modelTotal;
  const done = engineDone + modelDone;
  // Démarrage du moteur (aucun octet) : barre indéterminée plutôt qu'un « 0 % » qui semblerait bloqué.
  const bytesFlowing = done > 0 || (onModel && modelP?.stage === 'pull') || engineP?.stage === 'download';
  const percent = total > 0 && bytesFlowing ? progressPercent({ completed: done, total }) : null;

  let stageText: string;
  if (onModel) {
    stageText = modelP?.stage === 'pull' ? pullStatusText(modelP.status)
      : modelP?.stage === 'cancelled' ? 'Arrêt du téléchargement…'
        : 'Préparation du téléchargement du modèle…';
  } else if (plan.engine === 'start') {
    stageText = ENGINE_STARTING_MESSAGE;
  } else if (plan.engine === 'manual') {
    // Plus précis que le message générique d'attente du processus principal : où l'installation se fait.
    stageText = 'En attente de l’installation du moteur IA depuis sa page officielle…';
  } else if (engineP?.stage === 'download') {
    stageText = 'Téléchargement du moteur IA…';
  } else if (engineP?.stage === 'install' || engineP?.stage === 'waiting') {
    stageText = engineP.message || 'Installation du moteur IA…';
  } else {
    stageText = 'Préparation du téléchargement du moteur IA…';
  }

  return {
    steps,
    current,
    stageText,
    percent,
    transferText: total > 0 && bytesFlowing ? `${formatMB(done)} sur ${formatMB(total)}` : null,
    remainingText: total > 0 && bytesFlowing && done < total ? `reste ${formatMB(total - done)}` : null,
  };
}
