import { useEffect, useState } from 'react';
import { ArrowUpCircle, CheckCircle2, Download, ExternalLink, Loader2, Play, RefreshCw, X } from 'lucide-react';
import { ENGINE_STARTING_MESSAGE, type AIStatus } from '@shared/ipc';
import type { AIController } from '@/hooks/useAIStatus';
import { engineDownloadText, formatGB, formatTransfer, progressPercent } from '@/lib/ai-ui/format';
import { engineWindowMayOpen } from '@/lib/ai-ui/activation';
import { isEngineBusy } from '@/lib/ai-ui/progress';
import {
  engineManagedByAdminText, engineOutdatedText, networkHint, recommendedTier,
} from '@/lib/ai-ui/status';
import EngineWindowNote from './EngineWindowNote';
import { ErrorBox, WarningNote } from './Notices';
import ProgressBar from './ProgressBar';

interface EngineSetupPanelProps {
  ai: AIController;
  status: AIStatus;
}

/**
 * Étape « moteur IA » : installation (avec consentement explicite avant tout téléchargement),
 * installation manuelle depuis la page officielle avec détection automatique, démarrage,
 * ou mise à jour d'un moteur trop ancien. Sous Windows, là où l'installateur officiel est lancé (consentement,
 * mise à jour, installation en cours, attente), la note « une fenêtre Ollama peut s'ouvrir : fermez-la » (EngineWindowNote) ;
 * en attente d'une installation depuis la page officielle, elle dit de terminer d'abord l'installateur.
 */
export default function EngineSetupPanel({ ai, status }: EngineSetupPanelProps) {
  const [wantInstall, setWantInstall] = useState(false);
  const progress = ai.progress.engine;
  const installing = ai.pending.engine || isEngineBusy(progress);
  const waiting = !installing && progress?.stage === 'waiting';
  const errorMessage = ai.errors.engine?.message ?? (progress?.stage === 'error' ? progress.message : undefined);
  const errorHint = errorMessage ? networkHint(ai.errors.engine?.code, errorMessage, 'engine') : null;
  const engineState = status.engine.state;
  const stopped = engineState === 'installed_stopped' || engineState === 'unknown';
  const refresh = ai.refresh;

  // Pendant l'attente, nouvelle vérification régulière (en plus des évènements du moteur).
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => window.clearInterval(id);
  }, [waiting, refresh]);

  if (installing) return <InstallingView ai={ai} status={status} update={ai.engineUpdate === true} />;
  if (waiting) return <WaitingView ai={ai} status={status} manual={ai.manualInstall} message={progress?.message} />;

  if (progress?.stage === 'ready') {
    return (
      <div className="card" role="status" aria-live="polite">
        <p className="flex items-center gap-2 text-mg-50">
          <CheckCircle2 size={18} className="text-success" aria-hidden="true" /> Moteur IA installé. Vérification…
        </p>
      </div>
    );
  }

  // Moteur en marche mais trop ancien : mise à jour (ou service informatique si installé pour toute la machine).
  if (engineState === 'running' && status.engine.outdated) {
    return <OutdatedView ai={ai} status={status} errorMessage={errorMessage} errorHint={errorHint} />;
  }

  if (stopped && !wantInstall) {
    return (
      <div className="card space-y-4">
        <h2 className="text-lg text-white" style={{ fontFamily: 'var(--font-display)' }}>Démarrer le moteur IA</h2>
        <p className="text-sm text-mg-100">
          {engineState === 'unknown'
            ? "Magistra n'a pas pu vérifier l'état du moteur d'intelligence artificielle. Essayez de le démarrer."
            : "Le moteur d'intelligence artificielle est installé sur cet ordinateur, mais il n'est pas démarré."}
        </p>
        {errorMessage && <ErrorBox title="Le moteur IA n'a pas démarré." message={errorMessage} />}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" onClick={() => void ai.startEngine()} disabled={ai.pending.start}>
            {ai.pending.start ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
            {ai.pending.start ? 'Démarrage…' : errorMessage ? 'Réessayer' : 'Démarrer le moteur IA'}
          </button>
        </div>
        {/* Le démarrage peut durer jusqu'à 2 minutes au premier lancement (cartes graphiques, antivirus). */}
        {ai.pending.start && <p className="text-sm text-mg-200" role="status" aria-live="polite">{ENGINE_STARTING_MESSAGE}</p>}
        {(engineState === 'unknown' || errorMessage) && (
          <p className="text-sm text-mg-200">
            {/* État inconnu : Magistra n'a pas pu savoir si le moteur est installé. Autrement, il est installé mais n'a pas démarré. */}
            {engineState === 'unknown'
              ? 'Magistra ne peut pas savoir si le moteur IA est installé sur cet ordinateur. Vous pouvez lancer son installation.'
              : 'Magistra a trouvé le moteur IA sur cet ordinateur, mais il ne démarre pas. Vous pouvez relancer son installation.'}{' '}
            <button type="button" className="text-accent underline underline-offset-2 hover:text-accent-bright" onClick={() => setWantInstall(true)}>
              Installer le moteur IA
            </button>
          </p>
        )}
      </div>
    );
  }

  return <ConsentView ai={ai} status={status} errorMessage={errorMessage} errorHint={errorHint} cancelled={progress?.stage === 'cancelled'} />;
}

/**
 * Action « Mettre à jour le moteur IA » (consentement explicite, taille annoncée), ou message pour le service
 * informatique si Ollama est installé pour toute la machine. Réutilisée par le choix du modèle (erreur ENGINE_OUTDATED).
 */
export function EngineUpdateAction({ ai, status }: { ai: AIController; status: AIStatus }) {
  if (status.engine.managedByAdmin) {
    return <p className="text-sm text-mg-100">{engineManagedByAdminText(status)}</p>;
  }
  const dl = status.engineDownload;
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-mg-200">Téléchargement</dt>
        <dd className="text-mg-50 mb-1 sm:mb-0">{engineDownloadText(dl)}</dd>
        <dt className="text-mg-200">Provenance</dt>
        <dd className="text-mg-50 mb-1 sm:mb-0">site officiel d'Ollama</dd>
        <dt className="text-mg-200">Vos modèles d'IA</dt>
        <dd className="text-mg-50">conservés (rien à retélécharger)</dd>
      </dl>
      {engineWindowMayOpen(status, 'update') && <EngineWindowNote moment="install" />}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" onClick={() => void ai.installEngine({ update: true })} disabled={ai.pending.engine}>
          <ArrowUpCircle size={16} aria-hidden="true" /> Mettre à jour le moteur IA
        </button>
      </div>
      <p className="text-xs text-mg-200">Rien n'est téléchargé tant que vous n'avez pas cliqué.</p>
    </div>
  );
}

function OutdatedView({ ai, status, errorMessage, errorHint }: {
  ai: AIController; status: AIStatus; errorMessage?: string; errorHint: string | null;
}) {
  return (
    <div className="card space-y-4">
      <h2 className="text-lg text-white" style={{ fontFamily: 'var(--font-display)' }}>Mettre à jour le moteur IA</h2>
      <p className="text-sm text-mg-100">{engineOutdatedText(status)}</p>
      {errorMessage && (
        <ErrorBox title="La mise à jour du moteur IA n'a pas abouti." message={errorMessage}>
          {errorHint && <p className="mt-2 text-mg-200">{errorHint}</p>}
        </ErrorBox>
      )}
      <EngineUpdateAction ai={ai} status={status} />
    </div>
  );
}

function ConsentView({ ai, status, errorMessage, errorHint, cancelled }: {
  ai: AIController; status: AIStatus; errorMessage?: string; errorHint: string | null; cancelled: boolean;
}) {
  const dl = status.engineDownload;
  const freeDisk = status.hardware.freeDiskGB;
  const diskTooSmall = typeof freeDisk === 'number' && freeDisk < dl.requiredDiskGB;
  const rec = recommendedTier(status);
  return (
    <div className="card space-y-5">
      <div>
        <h2 className="text-lg text-white mb-2" style={{ fontFamily: 'var(--font-display)' }}>Installer le moteur IA</h2>
        <p className="text-mg-50">Magistra utilise une intelligence artificielle locale gratuite qui fonctionne sur votre ordinateur.</p>
        <p className="text-sm text-mg-200 mt-2">
          Pour cela, Magistra doit d'abord installer le moteur IA (Ollama, un logiciel libre et gratuit).
          Vos documents et vos contenus restent sur cet ordinateur.
        </p>
      </div>

      <section aria-labelledby="engine-consent-title" className="rounded-xl border border-white/8 bg-mg-700/40 p-4">
        <h3 id="engine-consent-title" className="text-sm font-semibold text-white mb-3">Avant de commencer</h3>
        <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-mg-200">Téléchargement</dt>
          <dd className="text-mg-50 mb-1 sm:mb-0">{engineDownloadText(dl)}</dd>
          <dt className="text-mg-200">Espace disque nécessaire</dt>
          <dd className="text-mg-50 mb-1 sm:mb-0">
            {formatGB(dl.requiredDiskGB)}
            {typeof freeDisk === 'number' && <span className="text-mg-200"> (disponible : {formatGB(freeDisk)})</span>}
          </dd>
          {rec && (
            <>
              <dt className="text-mg-200">Étape suivante</dt>
              <dd className="text-mg-50 mb-1 sm:mb-0">
                téléchargement du modèle d'IA ({rec.label} : {formatGB(rec.downloadGB)}), après votre accord
              </dd>
            </>
          )}
          <dt className="text-mg-200">Provenance</dt>
          <dd className="text-mg-50">site officiel d'Ollama</dd>
        </dl>
        {(status.recommendation.warning || diskTooSmall) && (
          <div className="mt-3 space-y-2">
            {status.recommendation.warning && <WarningNote>{status.recommendation.warning}</WarningNote>}
            {diskTooSmall && (
              <WarningNote>
                Espace disque insuffisant : libérez au moins {formatGB(dl.requiredDiskGB - (freeDisk ?? 0))} avant de continuer.
              </WarningNote>
            )}
          </div>
        )}
      </section>

      {engineWindowMayOpen(status, 'install') && <EngineWindowNote moment="install" />}

      {cancelled && !errorMessage && (
        <p className="text-sm text-mg-200" role="status">Installation annulée. Vous pouvez la relancer quand vous le souhaitez.</p>
      )}

      {errorMessage && (
        <ErrorBox title="L'installation du moteur IA n'a pas abouti." message={errorMessage}>
          {errorHint && <p className="mt-2 text-mg-200">{errorHint}</p>}
          <p className="mt-2 text-mg-200">
            Vous pouvez réessayer, ou installer le moteur vous-même depuis la page officielle : Magistra détectera
            automatiquement la fin de l'installation.
          </p>
        </ErrorBox>
      )}

      {dl.platformSupported ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" onClick={() => void ai.installEngine()}>
            {errorMessage ? <RefreshCw size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
            {errorMessage ? 'Réessayer' : 'Installer le moteur IA'}
          </button>
          <button type="button" className="btn-ghost text-sm" onClick={() => void ai.openEngineDownload()}>
            <ExternalLink size={15} aria-hidden="true" /> Ouvrir la page officielle d'installation
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-mg-100">
            L'installation automatique n'est pas disponible sur ce système. Installez le moteur IA depuis la page officielle :
            Magistra détectera automatiquement la fin de l'installation.
          </p>
          <button type="button" className="btn-primary" onClick={() => void ai.openEngineDownload()}>
            <ExternalLink size={16} aria-hidden="true" /> Ouvrir la page officielle d'installation
          </button>
        </div>
      )}
      <p className="text-xs text-mg-200">Rien n'est téléchargé tant que vous n'avez pas cliqué.</p>
    </div>
  );
}

function InstallingView({ ai, status, update }: { ai: AIController; status: AIStatus; update: boolean }) {
  const p = ai.progress.engine;
  const stage = p?.stage ?? 'starting';
  const percent = stage === 'download' ? progressPercent({ completed: p?.receivedMB, total: p?.totalMB }) : null;
  const title = stage === 'download'
    ? 'Téléchargement du moteur IA…'
    : stage === 'install'
      ? (p?.message || (update ? 'Mise à jour du moteur IA…' : 'Installation du moteur IA…'))
      : 'Préparation du téléchargement…';
  const canCancel = stage === 'starting' || stage === 'download';
  return (
    <div className="card space-y-4">
      <h2 className="text-lg text-white" style={{ fontFamily: 'var(--font-display)' }}>
        {update ? 'Mise à jour du moteur IA' : 'Installation du moteur IA'}
      </h2>
      <p className="flex items-center gap-2 text-mg-50" role="status" aria-live="polite">
        <Loader2 size={16} className="animate-spin text-accent" aria-hidden="true" /> {title}
      </p>
      <ProgressBar
        percent={percent}
        label="Installation du moteur IA"
        valueText={stage === 'download' ? formatTransfer(p?.receivedMB, p?.totalMB) : undefined}
      />
      {stage === 'download' && (
        <p className="text-sm text-mg-200">
          {formatTransfer(p?.receivedMB, p?.totalMB)}
          {percent !== null && ` · ${percent} %`}
        </p>
      )}
      {engineWindowMayOpen(status, update ? 'update' : 'install') && <EngineWindowNote moment="install" />}
      <p className="text-xs text-mg-200">Vous pouvez continuer à utiliser votre ordinateur pendant ce temps.</p>
      {canCancel && (
        <button type="button" className="btn-secondary text-sm py-2 px-4" onClick={() => void ai.cancelEngineInstall()}>
          <X size={15} aria-hidden="true" /> {update ? 'Annuler la mise à jour' : "Annuler l'installation"}
        </button>
      )}
    </div>
  );
}

function WaitingView({ ai, status, manual, message }: { ai: AIController; status: AIStatus; manual: boolean; message?: string }) {
  return (
    <div className="card space-y-4">
      <h2 className="text-lg text-white" style={{ fontFamily: 'var(--font-display)' }}>
        {manual ? 'Installation depuis la page officielle' : 'Installation du moteur IA'}
      </h2>
      <p className="flex items-center gap-2 text-mg-50" role="status" aria-live="polite">
        <Loader2 size={16} className="animate-spin text-accent" aria-hidden="true" />
        {message || "En attente de l'installation du moteur IA…"}
      </p>
      <ProgressBar percent={null} label="En attente du moteur IA" />
      {engineWindowMayOpen(status, manual ? 'manual' : 'install') && <EngineWindowNote moment={manual ? 'manual' : 'install'} />}
      {manual && (
        <ol className="list-decimal pl-5 space-y-1.5 text-sm text-mg-100">
          <li>Sur la page qui s'est ouverte dans votre navigateur, téléchargez Ollama pour Windows.</li>
          <li>Ouvrez le fichier téléchargé et suivez les étapes de l'installation.</li>
          <li>
            Revenez dans Magistra : la fin de l'installation est détectée automatiquement, sans redémarrer Magistra.
          </li>
        </ol>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-secondary text-sm py-2 px-4" onClick={() => void ai.refresh()} disabled={ai.pending.status}>
          <RefreshCw size={15} className={ai.pending.status ? 'animate-spin' : ''} aria-hidden="true" /> Vérifier maintenant
        </button>
        {manual && (
          <button type="button" className="btn-ghost text-sm" onClick={() => void ai.openEngineDownload()}>
            <ExternalLink size={15} aria-hidden="true" /> Rouvrir la page d'installation
          </button>
        )}
        <button type="button" className="btn-ghost text-sm" onClick={() => void ai.cancelEngineInstall()}>
          <X size={15} aria-hidden="true" /> Annuler
        </button>
      </div>
    </div>
  );
}
