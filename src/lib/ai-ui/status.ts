// Libellés simples de l'état de l'IA locale (pour un enseignant qui ne connaît rien à l'IA).
// Fonctions pures, testées dans tests/ai-ui.

import type { TierFit, TierId } from '@shared/ai/models';
import type { AIStatus, TierStatus } from '@shared/ipc';

// ─── Badges d'adéquation d'un niveau à l'ordinateur ─────────────────────────

export type Tone = 'success' | 'accent' | 'warning' | 'danger';

export function fitBadge(fit: TierFit): { label: string; tone: Tone } {
  switch (fit) {
    case 'recommended':
      return { label: 'Recommandé', tone: 'success' };
    case 'ok':
      return { label: 'Adapté', tone: 'accent' };
    case 'slow':
      return { label: 'Lent sur cet ordinateur', tone: 'warning' };
    case 'not_recommended':
    default:
      return { label: 'Déconseillé', tone: 'danger' };
  }
}

/** Classes CSS d'un badge selon sa tonalité (identité visuelle Magistra). */
export function toneBadgeClass(tone: Tone): string {
  switch (tone) {
    case 'success':
      return 'badge badge-success';
    case 'accent':
      return 'badge badge-accent';
    case 'warning':
      return 'badge bg-warning/10 text-warning border border-warning/20';
    case 'danger':
    default:
      return 'badge bg-danger/10 text-danger border border-danger/25';
  }
}

// ─── Phase globale ──────────────────────────────────────────────────────────

export type AIPhase = 'ready' | 'engine_missing' | 'engine_stopped' | 'model_missing' | 'remote_unavailable';

export function aiPhase(status: AIStatus): AIPhase {
  if (status.ready) return 'ready';
  if (status.config.mode === 'remote') return 'remote_unavailable';
  switch (status.engine.state) {
    case 'not_installed':
      return 'engine_missing';
    case 'running':
      return 'model_missing';
    case 'installed_stopped':
    case 'unknown':
    default:
      return 'engine_stopped';
  }
}

export interface PhaseInfo {
  ok: boolean;
  /** Libellé court (réglages) : « Prête », « Non installée »… */
  label: string;
  /** Libellé de la barre latérale : « IA prête », « IA non installée »… */
  badge: string;
  /** Phrase d'explication. */
  description: string;
}

export function phaseInfo(phase: AIPhase): PhaseInfo {
  switch (phase) {
    case 'ready':
      return { ok: true, label: 'Prête', badge: 'IA prête', description: "L'intelligence artificielle est prête." };
    case 'engine_missing':
      return {
        ok: false, label: 'Non installée', badge: 'IA non installée',
        description: "Le moteur d'intelligence artificielle n'est pas encore installé sur cet ordinateur.",
      };
    case 'engine_stopped':
      return { ok: false, label: 'Moteur arrêté', badge: 'Moteur arrêté', description: "Le moteur IA est installé, mais il n'est pas démarré." };
    case 'model_missing':
      return {
        ok: false, label: 'Modèle non installé', badge: 'Modèle non installé',
        description: "Le moteur IA fonctionne, mais le modèle d'IA choisi n'est pas encore installé.",
      };
    case 'remote_unavailable':
    default:
      return {
        ok: false, label: 'Serveur distant indisponible', badge: 'Serveur IA indisponible',
        description: 'Le serveur IA distant configuré ne répond pas.',
      };
  }
}

/** « ● Prête », « ○ Moteur arrêté »… */
export function phaseLine(phase: AIPhase): string {
  const info = phaseInfo(phase);
  return `${info.ok ? '●' : '○'} ${info.label}`;
}

// ─── Vérifications de l'assistant ───────────────────────────────────────────

export type CheckState = 'ok' | 'missing' | 'waiting' | 'unknown';

export interface SetupCheck {
  id: string;
  label: string;
  state: CheckState;
  detail?: string;
}

/** Texte lu par les lecteurs d'écran pour chaque état de vérification. */
export function checkStateText(state: CheckState): string {
  switch (state) {
    case 'ok':
      return 'oui';
    case 'missing':
      return 'non';
    case 'waiting':
      return "en attente de l'étape précédente";
    case 'unknown':
    default:
      return 'impossible à vérifier';
  }
}

export function recommendedTier(status: AIStatus): TierStatus | undefined {
  return status.tiers.find(t => t.id === status.recommendation.tier);
}

/** Les quatre vérifications affichées au premier démarrage. */
export function setupChecks(status: AIStatus): SetupCheck[] {
  if (status.config.mode === 'remote') {
    return [
      { id: 'remote-configured', label: 'Serveur IA distant configuré', state: status.config.remote ? 'ok' : 'missing', detail: status.config.remote?.label },
      { id: 'remote-ready', label: 'Serveur IA distant disponible', state: status.ready ? 'ok' : 'missing' },
    ];
  }
  const engine = status.engine.state;
  const installed = engine === 'running' || engine === 'installed_stopped';
  const running = engine === 'running';
  const count = status.installedModels.length;
  const rec = recommendedTier(status);

  const checks: SetupCheck[] = [
    {
      id: 'engine-installed',
      label: 'Moteur IA installé',
      state: installed ? 'ok' : engine === 'unknown' ? 'unknown' : 'missing',
    },
    {
      id: 'engine-running',
      label: 'Moteur IA en marche',
      state: running ? 'ok' : installed || engine === 'unknown' ? 'missing' : 'waiting',
    },
    {
      id: 'models',
      label: "Modèles d'IA disponibles",
      state: !running ? 'waiting' : count > 0 ? 'ok' : 'missing',
      detail: running ? (count === 0 ? 'aucun modèle installé' : count === 1 ? '1 modèle installé' : `${count} modèles installés`) : undefined,
    },
  ];
  if (status.ready) {
    checks.push({ id: 'model', label: 'Modèle installé', state: 'ok', detail: status.activeLabel });
  } else {
    checks.push({
      id: 'model',
      label: 'Modèle recommandé installé',
      state: !running ? 'waiting' : rec?.installed ? 'ok' : 'missing',
      detail: rec?.label,
    });
  }
  return checks;
}

// ─── Téléchargement d'un modèle ─────────────────────────────────────────────

/** Traduit les étapes techniques du téléchargement (« pulling manifest »…) en français simple. */
export function pullStatusText(status: string | undefined | null): string {
  const s = (status ?? '').trim();
  if (!s) return 'Téléchargement en cours…';
  const lower = s.toLowerCase();
  if (lower.startsWith('pulling manifest')) return 'Préparation du téléchargement…';
  if (lower.startsWith('pulling') || lower.startsWith('downloading')) return 'Téléchargement en cours…';
  if (lower.startsWith('verifying')) return 'Vérification des fichiers…';
  if (lower.startsWith('writing manifest')) return 'Finalisation…';
  if (lower.startsWith('removing')) return 'Nettoyage…';
  if (lower === 'success') return 'Terminé';
  // Message déjà rédigé en français par Magistra : on le garde tel quel.
  if (/[àâçéèêëîïôûùüÿœ]/i.test(s) || /^[A-ZÀ-Ý]/.test(s)) return s;
  return 'Téléchargement en cours…';
}

/** Libellé du bouton principal de la carte de choix du modèle. */
export function tierActionLabel(tier: Pick<TierStatus, 'label' | 'installed'>, isCurrent: boolean): string {
  if (!tier.installed) return `Installer ${tier.label}`;
  if (isCurrent) return `${tier.label} est utilisé`;
  return `Utiliser ${tier.label}`;
}

/** Nom affiché d'un modèle en cours de téléchargement (jamais le nom technique si un niveau correspond). */
export function tierLabelFor(tiers: TierStatus[], target: { tier?: TierId; model?: string }): string {
  const byTier = target.tier ? tiers.find(t => t.id === target.tier) : undefined;
  if (byTier) return byTier.label;
  const byModel = target.model ? tiers.find(t => t.model === target.model) : undefined;
  if (byModel) return byModel.label;
  return target.model || "le modèle d'IA";
}

/** Niveau présélectionné : la recommandation au premier démarrage, le niveau actuel dans les réglages. */
export function initialTierChoice(status: AIStatus, variant: 'setup' | 'settings'): TierId {
  if (variant === 'settings') return status.selectedTier;
  const selected = status.tiers.find(t => t.id === status.selectedTier);
  // Si l'enseignant a déjà un niveau installé, on ne lui propose pas d'en télécharger un autre.
  if (selected?.installed) return selected.id;
  return status.recommendation.tier;
}

/**
 * Hôte du moteur Ollama s'il n'est PAS sur cet ordinateur (null sinon) : la confidentialité affichée
 * dépend de l'adresse réelle du moteur, pas seulement du mode choisi.
 */
export function engineHostIfRemote(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    const loopback = host === 'localhost' || host === '::1' || host.startsWith('127.');
    return loopback ? null : new URL(url).host;
  } catch {
    return null;
  }
}
