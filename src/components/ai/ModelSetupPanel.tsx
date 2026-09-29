import { useState } from 'react';
import { Download, Loader2, RefreshCw, X } from 'lucide-react';
import { tierForModel, type TierId } from '@shared/ai/models';
import type { AIStatus } from '@shared/ipc';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { AIController } from '@/hooks/useAIStatus';
import { formatGB, formatTransfer, progressPercent } from '@/lib/ai-ui/format';
import { isModelPulling } from '@/lib/ai-ui/progress';
import { initialTierChoice, networkHint, pullStatusText, tierActionLabel, tierLabelFor } from '@/lib/ai-ui/status';
import { EngineUpdateAction } from './EngineSetupPanel';
import HardwareSummary from './HardwareSummary';
import { ErrorBox, SuccessNote, WarningNote } from './Notices';
import ProgressBar from './ProgressBar';
import TierPicker from './TierPicker';

interface ModelSetupPanelProps {
  ai: AIController;
  status: AIStatus;
  /** « setup » : premier démarrage (avec description de l'ordinateur) ; « settings » : réglages. */
  variant: 'setup' | 'settings';
}

/**
 * Choix et installation de la version de l'IA (Magistra Léger / Standard / Qualité).
 * Téléchargement avec progression, annulation et reprise là où il s'est arrêté.
 */
export default function ModelSetupPanel({ ai, status, variant }: ModelSetupPanelProps) {
  const [selected, setSelected] = useState<TierId>(() => initialTierChoice(status, variant));
  const [confirming, setConfirming] = useState<TierId | null>(null);
  const [justSwitched, setJustSwitched] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const tier = status.tiers.find(t => t.id === selected) ?? status.tiers[0];
  const progress = ai.progress.model;
  const pulling = ai.pending.model || isModelPulling(progress);
  const selectedTier = status.tiers.find(t => t.id === status.selectedTier);
  const currentTier = status.config.mode === 'local' && !status.config.customModel && selectedTier?.installed ? selectedTier.id : null;
  const errorMessage = ai.errors.model?.message ?? (progress?.stage === 'error' ? progress.message : undefined);
  // Moteur trop ancien (erreur 412 du registre) : reprendre le téléchargement ne servirait à rien.
  const engineOutdated = ai.errors.model?.code === 'ENGINE_OUTDATED';
  // Proxy d'établissement ignoré par le moteur : le message explique déjà que « Reprendre le téléchargement » relance
  // le moteur avec le proxy (accord de l'enseignant) ; les conseils génériques le contrediraient.
  const proxyRestart = Boolean(errorMessage) && !engineOutdated && status.engine.proxyRestart === true;
  const errorHint = errorMessage && !engineOutdated && !proxyRestart ? networkHint(ai.errors.model?.code, errorMessage, 'model') : null;
  const cancelled = progress?.stage === 'cancelled';
  const resumeTier: TierId | undefined = progress ? progress.tier ?? tierForModel(progress.model)?.id : undefined;
  // Après une interruption, « Reprendre » remplace le bouton d'installation du même niveau.
  const resumeShown = (cancelled || (Boolean(errorMessage) && !engineOutdated)) && resumeTier !== undefined;

  function run(id: TierId) {
    const target = status.tiers.find(t => t.id === id);
    if (!target) return;
    setJustSwitched(null);
    setSwitchError(null);
    if (target.installed) {
      void ai.selectTier(id).then(({ status: s, error }) => {
        if (s) setJustSwitched(target.label);
        else setSwitchError(error?.message ?? null);
      });
    } else {
      void ai.installTier(id);
    }
  }

  function requestRun(id: TierId) {
    const target = status.tiers.find(t => t.id === id);
    if (target?.fit === 'not_recommended') setConfirming(id);
    else run(id);
  }

  const confirmTier = confirming ? status.tiers.find(t => t.id === confirming) : undefined;
  const Heading = variant === 'setup' ? 'h2' : 'h3';

  return (
    <div className={variant === 'setup' ? 'card space-y-5' : 'space-y-4'}>
      {variant === 'setup' ? (
        <div>
          <Heading className="text-lg text-white mb-2" style={{ fontFamily: 'var(--font-display)' }}>
            Choisissez la version de l'IA
          </Heading>
          <p className="text-sm text-mg-100">
            Le moteur IA est prêt. Il reste à télécharger le modèle d'IA, le « cerveau » qui rédige vos contenus.
            Magistra vous recommande la version la mieux adaptée à votre ordinateur.
          </p>
        </div>
      ) : (
        <div>
          <Heading className="text-sm font-semibold text-white mb-1">Version de l'IA</Heading>
          <p className="text-sm text-mg-200">{status.recommendation.summary}</p>
          {status.recommendation.warning && (
            <div className="mt-2">
              <WarningNote>{status.recommendation.warning}</WarningNote>
            </div>
          )}
        </div>
      )}

      {variant === 'setup' && <HardwareSummary hardware={status.hardware} recommendation={status.recommendation} />}

      {pulling ? (
        <PullProgress ai={ai} status={status} />
      ) : (
        <>
          {cancelled && (
            <div className="rounded-xl border border-white/10 bg-mg-700/40 p-4 text-sm space-y-3" role="status">
              <p className="text-mg-50">
                Téléchargement de {tierLabelFor(status.tiers, { tier: resumeTier, model: progress?.model })} interrompu
                {typeof progress?.percent === 'number' ? ` à ${progress.percent} %` : ''}. Vous pouvez le reprendre là où il s'est arrêté.
              </p>
              <button type="button" className="btn-primary text-sm py-2 px-4" onClick={() => resumeTier && run(resumeTier)} disabled={!resumeTier}>
                <RefreshCw size={15} aria-hidden="true" /> Reprendre le téléchargement
              </button>
            </div>
          )}
          {errorMessage && engineOutdated && (
            <ErrorBox title="Le moteur IA doit d'abord être mis à jour." message={errorMessage}>
              <div className="mt-3">
                {status.engine.outdated && !status.engine.managedByAdmin
                  ? <p className="text-mg-200">Utilisez le bouton « Mettre à jour le moteur IA » ci-dessus, puis installez de nouveau cette version.</p>
                  : <EngineUpdateAction ai={ai} status={status} />}
              </div>
            </ErrorBox>
          )}
          {errorMessage && !engineOutdated && (
            <ErrorBox title="Le téléchargement n'a pas abouti." message={errorMessage}>
              {errorHint && <p className="mt-2 text-mg-200">{errorHint}</p>}
              {!proxyRestart && (
                <p className="mt-2 text-mg-200">Vérifiez votre connexion Internet et l'espace disque, puis reprenez : le téléchargement repartira là où il s'est arrêté.</p>
              )}
              {resumeTier && (
                <button type="button" className="btn-primary text-sm py-2 px-4 mt-3" onClick={() => run(resumeTier)}>
                  <RefreshCw size={15} aria-hidden="true" /> Reprendre le téléchargement
                </button>
              )}
            </ErrorBox>
          )}

          <TierPicker
            tiers={status.tiers}
            selected={selected}
            onSelect={id => {
              setSelected(id);
              setJustSwitched(null);
            }}
            currentTier={variant === 'settings' ? currentTier : null}
            disabled={ai.pending.config}
            name={`magistra-tier-${variant}`}
          />

          {switchError && <ErrorBox title="Le changement n'a pas pu être enregistré." message={switchError} />}
          {justSwitched && <SuccessNote>Magistra utilise maintenant {justSwitched}.</SuccessNote>}

          {tier && !(currentTier === tier.id && variant === 'settings') && !(resumeShown && resumeTier === tier.id) && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-primary"
                onClick={() => requestRun(tier.id)}
                disabled={ai.pending.config || currentTier === tier.id}
              >
                {ai.pending.config ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
                {tierActionLabel(tier, currentTier === tier.id)}
              </button>
              {!tier.installed && (
                <span className="text-sm text-mg-200">Téléchargement de {formatGB(tier.downloadGB)}, une seule fois.</span>
              )}
            </div>
          )}
          {!tier?.installed && variant === 'setup' && !resumeShown && (
            <p className="text-xs text-mg-200">
              Le téléchargement peut prendre de quelques minutes à plus d'une heure selon votre connexion.
              Rien n'est téléchargé tant que vous n'avez pas cliqué.
            </p>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title="Version déconseillée sur cet ordinateur"
        message={`${confirmTier?.note ?? ''} ${confirmTier?.label ?? 'Cette version'} risque d'être très lent ou de ralentir fortement votre ordinateur. Voulez-vous continuer quand même ?`.trim()}
        confirmLabel={confirmTier?.installed ? 'Utiliser quand même' : 'Installer quand même'}
        cancelLabel="Annuler"
        danger
        onConfirm={() => {
          const id = confirming;
          setConfirming(null);
          if (id) run(id);
        }}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}

function PullProgress({ ai, status }: { ai: AIController; status: AIStatus }) {
  const p = ai.progress.model;
  const label = tierLabelFor(status.tiers, { tier: p?.tier, model: p?.model });
  const percent = p?.stage === 'pull' ? progressPercent({ percent: p.percent, completed: p.completedMB, total: p.totalMB }) : null;
  const stageText = p?.stage === 'pull' ? pullStatusText(p.status) : 'Préparation du téléchargement…';
  const transfer = p?.stage === 'pull' && typeof p.completedMB === 'number' ? formatTransfer(p.completedMB, p.totalMB) : null;
  return (
    <div className="space-y-3 rounded-xl border border-accent/20 bg-accent/5 p-4">
      <p className="font-semibold text-white">Téléchargement de {label}</p>
      <p className="flex items-center gap-2 text-sm text-mg-50" role="status" aria-live="polite">
        <Loader2 size={15} className="animate-spin text-accent" aria-hidden="true" /> {stageText}
      </p>
      <ProgressBar
        percent={percent}
        label={`Téléchargement de ${label}`}
        valueText={[percent !== null ? `${percent} %` : null, transfer].filter(Boolean).join(', ') || undefined}
      />
      {(percent !== null || transfer) && (
        <p className="text-sm text-mg-200">
          {percent !== null && <span className="font-semibold text-mg-50">{percent} %</span>}
          {percent !== null && transfer && ' · '}
          {transfer}
        </p>
      )}
      <p className="text-xs text-mg-200">
        Vous pouvez continuer à utiliser votre ordinateur. Si vous fermez Magistra, vous pourrez reprendre le
        téléchargement là où il s'est arrêté.
      </p>
      <button type="button" className="btn-secondary text-sm py-2 px-4" onClick={() => void ai.cancelPull()}>
        <X size={15} aria-hidden="true" /> Annuler le téléchargement
      </button>
    </div>
  );
}
