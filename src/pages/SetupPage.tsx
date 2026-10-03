// Page de l'intelligence artificielle (application Windows). Elle n'est plus imposée au premier lancement : on y arrive
// par l'indicateur de la barre latérale, les réglages (« Assistant de configuration ») ou « Configurer l'intelligence
// artificielle ». Une seule action principale : la carte « Activer l'IA » (un clic, taille annoncée, enchaînement
// automatique moteur → modèle). Le reste est replié : ordinateur et vérifications, autre version de l'IA, moteur
// installé depuis sa page officielle, puis « Options avancées » (adresse du moteur, modèle personnalisé, serveur IA
// distant). Aucun téléchargement sans un clic explicite ; jamais de PowerShell.

import { useId, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ChevronRight, ExternalLink, GraduationCap, Loader2, RefreshCw, Server } from 'lucide-react';
import ActivateAICard from '@/components/ai/ActivateAICard';
import AdvancedAIOptions from '@/components/ai/AdvancedAIOptions';
import HardwareSummary from '@/components/ai/HardwareSummary';
import ModelSetupPanel from '@/components/ai/ModelSetupPanel';
import { ErrorBox } from '@/components/ai/Notices';
import SetupChecklist from '@/components/ai/SetupChecklist';
import { useAIStatus, type AIController } from '@/hooks/useAIStatus';
import { isModelPulling } from '@/lib/ai-ui/progress';
import { aiPhase, engineHostIfRemote, setupChecks } from '@/lib/ai-ui/status';
import type { AIStatus } from '@shared/ipc';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

export default function SetupPage() {
  useDocumentTitle('Intelligence artificielle');
  const ai = useAIStatus();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromSettings = params.get('from') === 'settings';

  if (!ai) return <Navigate to="/app" replace />;
  const status = ai.status;
  const back = () => navigate(fromSettings ? '/app/settings' : '/app', { replace: true });

  return (
    <div className="min-h-screen bg-mg-900 px-4 py-8 sm:py-12">
      <main className="mx-auto max-w-2xl space-y-6">
        <header className="animate-fade-in">
          <div className="flex items-center gap-2.5 mb-6">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-accent-dim to-accent flex items-center justify-center">
              <GraduationCap size={20} className="text-mg-900" aria-hidden="true" />
            </div>
            <span className="text-xl font-semibold tracking-tight text-white" style={{ fontFamily: 'var(--font-display)' }}>
              Magistra<span className="text-gold">.</span>
            </span>
          </div>
          <h1 className="text-3xl text-white mb-2" style={{ fontFamily: 'var(--font-display)' }}>
            {fromSettings ? 'Assistant de configuration de l’IA' : 'L’intelligence artificielle de Magistra'}
          </h1>
          <p className="text-mg-100">
            Un clic suffit : Magistra prépare toute seule l’IA qui vous aide à créer vos cours, exercices et évaluations.
            Elle fonctionne ensuite sur cet ordinateur, même sans Internet.
          </p>
        </header>

        <div className="glow-line" />

        {!status && ai.errors.status && (
          <ErrorBox title="Magistra n'a pas pu vérifier l'intelligence artificielle." message={ai.errors.status.message}>
            <button type="button" className="btn-primary text-sm py-2 px-4 mt-3" onClick={() => void ai.refresh()} disabled={ai.pending.status}>
              <RefreshCw size={15} className={ai.pending.status ? 'animate-spin' : ''} aria-hidden="true" /> Réessayer
            </button>
          </ErrorBox>
        )}
        {!status && !ai.errors.status && (
          <p className="flex items-center gap-2 text-sm text-mg-100" role="status">
            <Loader2 size={15} className="animate-spin text-accent" aria-hidden="true" /> Vérification de votre ordinateur…
          </p>
        )}

        {status && (
          <div className="animate-fade-in">
            <MainStep ai={ai} status={status} fromSettings={fromSettings} onDone={back} />
          </div>
        )}

        {status && <MoreOptions ai={ai} status={status} />}
        {status && <AdvancedAIOptions ai={ai} status={status} />}

        {!status?.ready && (
          <footer className="pt-2 text-center">
            <button type="button" className="btn-ghost text-sm mx-auto" onClick={back}>
              {fromSettings ? 'Retour aux réglages' : 'Retour à Magistra'}
            </button>
            <p className="mt-1 text-xs text-mg-200">
              Historique, favoris et réglages restent disponibles pendant la préparation de l’IA.
              {(ai.activation.state === 'running' || isModelPulling(ai.progress.model)) && ' L’installation en cours continue.'}
            </p>
          </footer>
        )}
      </main>
    </div>
  );
}

/** Action principale : IA prête, serveur distant injoignable, ou « Activer l'IA ». */
function MainStep({ ai, status, fromSettings, onDone }: {
  ai: AIController; status: AIStatus; fromSettings: boolean; onDone(): void;
}) {
  const phase = aiPhase(status);
  if (phase === 'ready' && ai.activation.state !== 'running') {
    const remote = status.config.mode === 'remote';
    // Ollama configuré sur un autre ordinateur : les données partent vers cette machine.
    const engineHost = remote ? null : engineHostIfRemote(status.engine.url);
    return (
      <div className="card text-center py-10 space-y-4 border-success/20" role="status" aria-live="polite">
        <CheckCircle2 size={44} className="mx-auto text-success" aria-hidden="true" />
        <h2 className="text-2xl text-white" style={{ fontFamily: 'var(--font-display)' }}>✓ Intelligence artificielle prête</h2>
        <p className="text-mg-100 max-w-md mx-auto">
          {remote
            ? `Magistra utilise le serveur IA distant${status.config.remote?.label ? ` « ${status.config.remote.label} »` : ''}.`
            : engineHost
              ? `Magistra utilise ${status.activeLabel} sur le serveur Ollama « ${engineHost} ». Les données utilisées pour la génération sont transmises à cette machine.`
              : `Magistra utilise ${status.activeLabel}, directement sur votre ordinateur. Vos documents et vos contenus restent chez vous.`}
        </p>
        <button type="button" className="btn-primary mx-auto" onClick={onDone} autoFocus>
          {fromSettings ? 'Retour aux réglages' : 'Commencer'} <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    );
  }
  if (phase === 'remote_unavailable') return <RemoteUnavailable ai={ai} status={status} />;
  return <ActivateAICard variant="setup" />;
}

/** Section repliable (même présentation que « Options avancées »). */
function Disclosure({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <section aria-label={title} className="rounded-xl border border-white/8">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-4 py-3 text-sm text-mg-100 hover:text-accent transition-colors"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(o => !o)}
      >
        <ChevronRight size={16} className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
        {title}
        {hint && <span className="text-xs text-mg-200">{hint}</span>}
      </button>
      {open && <div id={panelId} className="px-4 pb-5 space-y-5 border-t border-white/5 pt-4">{children}</div>}
    </section>
  );
}

/**
 * Replié : ce que Magistra a vérifié, l'ordinateur et sa recommandation, une autre version de l'IA (moteur en marche),
 * ou l'installation du moteur depuis sa page officielle (si l'installation automatique est bloquée).
 */
function MoreOptions({ ai, status }: { ai: AIController; status: AIStatus }) {
  const checks = useMemo(() => setupChecks(status), [status]);
  const local = status.config.mode === 'local';
  // Choix de la version (moteur en marche et à jour) : il redit lui-même la recommandation, absente alors du résumé.
  const versions = local && status.engine.state === 'running' && !status.engine.outdated;
  return (
    <Disclosure title="Votre ordinateur et la version de l’IA" hint="(vérifications, autre version)">
      <SetupChecklist checks={checks} revealed={checks.length} />
      {local && <HardwareSummary hardware={status.hardware} recommendation={status.recommendation} withRecommendation={!versions} />}
      {versions && <ModelSetupPanel ai={ai} status={status} variant="settings" />}
      {local && (status.engine.state === 'not_installed' || status.engine.outdated) && !status.engine.managedByAdmin && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-white">Installer le moteur IA vous-même</h3>
          <p className="text-sm text-mg-200">
            Si l’installation automatique est bloquée (antivirus, poste géré), installez le moteur depuis sa page
            officielle : Magistra détecte la fin de l’installation, sans redémarrer.
          </p>
          <button type="button" className="btn-secondary text-sm py-2 px-4" onClick={() => void ai.openEngineDownload()}>
            <ExternalLink size={15} aria-hidden="true" /> Ouvrir la page officielle d'installation
          </button>
        </div>
      )}
    </Disclosure>
  );
}

function RemoteUnavailable({ ai, status }: { ai: AIController; status: AIStatus }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="card space-y-4">
      <h2 className="flex items-center gap-2 text-lg text-white" style={{ fontFamily: 'var(--font-display)' }}>
        <Server size={18} className="text-accent" aria-hidden="true" /> Le serveur IA distant ne répond pas
      </h2>
      <p className="text-sm text-mg-100">
        Magistra est réglé pour utiliser un serveur IA distant{status.config.remote?.label ? ` (« ${status.config.remote.label} »)` : ''},
        mais celui-ci ne répond pas. Vérifiez votre connexion, ou revenez à l'IA de cet ordinateur.
      </p>
      {error && <ErrorBox title="Changement impossible." message={error} />}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-primary text-sm py-2 px-4" onClick={() => void ai.refresh()} disabled={ai.pending.status}>
          <RefreshCw size={15} className={ai.pending.status ? 'animate-spin' : ''} aria-hidden="true" /> Vérifier à nouveau
        </button>
        <button
          type="button"
          className="btn-secondary text-sm py-2 px-4"
          disabled={ai.pending.config}
          onClick={() => {
            setError(null);
            void ai.setConfig({ mode: 'local' }).then(r => setError(r.error ? r.error.message : null));
          }}
        >
          Revenir à l'IA locale
        </button>
      </div>
    </div>
  );
}
