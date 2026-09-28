import { Link } from 'react-router-dom';
import { useAIStatus, useCapabilities } from '@/hooks/useAIStatus';
import { progressPercent } from '@/lib/ai-ui/format';
import { isEngineBusy, isModelPulling } from '@/lib/ai-ui/progress';
import { aiPhase, phaseInfo } from '@/lib/ai-ui/status';
import { useOptionalRuntime } from '@/lib/runtime/context';

const BASE = 'flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors border border-white/5 hover:border-accent/20 hover:bg-white/3';

interface BadgeView {
  to: string;
  /** null : pas de pastille (démonstration). */
  ok: boolean | null;
  text: string;
  title?: string;
}

function Badge({ to, ok, text, title }: BadgeView) {
  const color = ok === null ? 'text-mg-200' : ok ? 'text-mg-100' : 'text-warning';
  return (
    <Link to={to} className={`${BASE} ${color}`} title={title} aria-label={`État de l'intelligence artificielle : ${text}`}>
      {ok === null ? (
        <span aria-hidden="true" className="text-accent">◆</span>
      ) : (
        <span aria-hidden="true" className={ok ? 'text-success' : 'text-warning'}>{ok ? '●' : '○'}</span>
      )}
      <span className="truncate">{text}</span>
    </Link>
  );
}

/**
 * Petit indicateur d'état de l'IA pour la barre latérale.
 * Windows : IA locale ; site web : serveur IA ; démonstration : aucune IA.
 */
export default function AIStatusBadge() {
  const runtime = useOptionalRuntime();
  const mode = runtime?.mode ?? null;
  const ai = useAIStatus();
  const web = useCapabilities({ enabled: mode === 'web' });

  if (!runtime) return null;

  if (mode === 'demo') {
    return <Badge to="/app/settings" ok={null} text="Démonstration" title="Exemples pré-rédigés, aucune IA n'est utilisée" />;
  }

  if (mode === 'web') {
    if (web.loading && !web.capabilities) return <Badge to="/app/settings" ok={null} text="Vérification du serveur IA…" />;
    const ok = web.capabilities?.ready === true;
    return <Badge to="/app/settings" ok={ok} text={ok ? 'Serveur IA disponible' : 'Serveur IA indisponible'} />;
  }

  // Application Windows : IA locale (ou serveur distant choisi dans les options avancées).
  if (!ai) return null;
  const status = ai.status;
  if (!status) {
    return <Badge to="/app/settings" ok={null} text={ai.errors.status ? 'État de l’IA inconnu' : 'Vérification de l’IA…'} />;
  }

  const phase = aiPhase(status);
  const info = phaseInfo(phase);
  const pull = ai.progress.model;
  let text = info.badge;
  if (!info.ok && isModelPulling(pull)) {
    const percent = pull?.stage === 'pull' ? progressPercent({ percent: pull.percent, completed: pull.completedMB, total: pull.totalMB }) : null;
    text = percent !== null ? `Installation de l’IA : ${percent} %` : 'Installation de l’IA…';
  } else if (!info.ok && (ai.pending.engine || isEngineBusy(ai.progress.engine))) {
    text = 'Installation du moteur IA…';
  }
  const to = info.ok || phase === 'remote_unavailable' ? '/app/settings' : '/setup';
  const title = info.ok ? `${status.activeLabel} — ouvrir les réglages` : `${info.description} Cliquez pour terminer l’installation.`;
  return <Badge to={to} ok={info.ok} text={text} title={title} />;
}
