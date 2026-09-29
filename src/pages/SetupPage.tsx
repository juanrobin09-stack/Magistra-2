// Assistant de premier démarrage (application Windows) : préparation de l'IA locale.
// Magistra vérifie tout seul ce qui est installé, puis guide l'enseignant bouton par bouton.
// Aucun téléchargement n'a lieu sans un clic explicite ; jamais de PowerShell.

import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, GraduationCap, Loader2, RefreshCw, Server } from 'lucide-react';
import AdvancedAIOptions from '@/components/ai/AdvancedAIOptions';
import EngineSetupPanel from '@/components/ai/EngineSetupPanel';
import ModelSetupPanel from '@/components/ai/ModelSetupPanel';
import { ErrorBox } from '@/components/ai/Notices';
import SetupChecklist from '@/components/ai/SetupChecklist';
import { useAIStatus, type AIController } from '@/hooks/useAIStatus';
import { isModelPulling } from '@/lib/ai-ui/progress';
import { aiPhase, engineHostIfRemote, setupChecks } from '@/lib/ai-ui/status';
import { fromIpcError, getBridge } from '@/lib/runtime/local';
import type { AIStatus } from '@shared/ipc';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

/** Délai d'affichage entre deux vérifications (lisibilité de l'avancement). */
const REVEAL_MS = 300;

export default function SetupPage() {
  useDocumentTitle('Préparation de l’intelligence artificielle');
  const ai = useAIStatus();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromSettings = params.get('from') === 'settings';
  const [finishing, setFinishing] = useState<'start' | 'later' | null>(null);
  const [finishError, setFinishError] = useState<string | null>(null);

  const status = ai?.status ?? null;
  const checks = useMemo(() => (status ? setupChecks(status) : null), [status]);
  const [revealed, setRevealed] = useState(0);
  const total = checks?.length ?? 0;

  // Les résultats des vérifications apparaissent l'un après l'autre (une seule fois).
  useEffect(() => {
    if (!checks || revealed >= total) return;
    const id = window.setTimeout(() => setRevealed(r => r + 1), REVEAL_MS);
    return () => window.clearTimeout(id);
  }, [checks, revealed, total]);

  if (!ai) return <Navigate to="/app" replace />;

  const allRevealed = checks !== null && revealed >= total;

  async function finish(kind: 'start' | 'later') {
    const bridge = getBridge();
    setFinishing(kind);
    setFinishError(null);
    try {
      await bridge?.prefs.set({ setupCompleted: true });
    } catch (err) {
      setFinishError(fromIpcError(err).message);
      setFinishing(null);
      return;
    }
    navigate(fromSettings ? '/app/settings' : '/app', { replace: true });
  }

  return (
    <div className="min-h-screen bg-mg-900 px-4 py-8 sm:py-12">
      <main className="mx-auto max-w-2xl space-y-6">
        <header className="animate-fade-in">
          <div className="flex items-center gap-2.5 mb-6">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-accent-dim to-accent flex items-center justify-center">
              <GraduationCap size={20} className="text-mg-900" aria-hidden="true" />
            </div>
            <span className="text-xl font-semibold tracking-tight text-white" style={{ fontFamily: 'var(--font-display)' }}>
              Magistra<span className="text-accent">.</span>
            </span>
          </div>
          <h1 className="text-3xl text-white mb-2" style={{ fontFamily: 'var(--font-display)' }}>
            {fromSettings ? 'Assistant de configuration de l’IA' : 'Bienvenue dans Magistra'}
          </h1>
          <p className="text-mg-100">
            Préparons ensemble l'intelligence artificielle qui vous aidera à créer vos cours, exercices et évaluations.
            Tout se fait ici, en quelques clics.
          </p>
        </header>

        <div className="glow-line" />

        <SetupChecklist checks={checks} revealed={revealed} />

        {ai.errors.status && !status && (
          <ErrorBox title="Magistra n'a pas pu vérifier l'intelligence artificielle." message={ai.errors.status.message}>
            <button type="button" className="btn-primary text-sm py-2 px-4 mt-3" onClick={() => void ai.refresh()} disabled={ai.pending.status}>
              <RefreshCw size={15} className={ai.pending.status ? 'animate-spin' : ''} aria-hidden="true" /> Réessayer
            </button>
          </ErrorBox>
        )}

        {status && allRevealed && (
          <div className="animate-fade-in">
            <SetupStep ai={ai} status={status} finishing={finishing} onStart={() => void finish('start')} />
          </div>
        )}

        {finishError && <ErrorBox title="Impossible d'enregistrer votre choix." message={finishError} />}

        {status && allRevealed && <AdvancedAIOptions ai={ai} status={status} />}

        {!(status?.ready && allRevealed) && (
          <footer className="pt-2 text-center">
            <button
              type="button"
              className="btn-ghost text-sm mx-auto"
              onClick={() => void finish('later')}
              disabled={finishing !== null}
            >
              {finishing === 'later' && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {fromSettings ? 'Retour aux réglages' : 'Plus tard'}
            </button>
            {!fromSettings && (
              <p className="mt-1 text-xs text-mg-200">
                Vous pourrez consulter l'historique et les favoris, et terminer l'installation à tout moment depuis Réglages.
                {isModelPulling(ai.progress.model) && ' Le téléchargement en cours continue.'}
              </p>
            )}
          </footer>
        )}
      </main>
    </div>
  );
}

function SetupStep({ ai, status, finishing, onStart }: {
  ai: AIController;
  status: AIStatus;
  finishing: 'start' | 'later' | null;
  onStart(): void;
}) {
  const phase = aiPhase(status);

  if (phase === 'ready') {
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
        <button type="button" className="btn-primary mx-auto" onClick={onStart} disabled={finishing !== null} autoFocus>
          {finishing === 'start' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
          Commencer <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    );
  }

  if (phase === 'remote_unavailable') {
    return <RemoteUnavailable ai={ai} status={status} />;
  }

  if (phase === 'engine_missing' || phase === 'engine_stopped' || phase === 'engine_outdated') {
    return <EngineSetupPanel ai={ai} status={status} />;
  }

  return <ModelSetupPanel ai={ai} status={status} variant="setup" />;
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
