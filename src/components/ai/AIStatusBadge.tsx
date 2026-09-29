import { Link } from 'react-router-dom';
import { useEngineRoute, useRouteCapsHeal } from '@/components/localEngine/engineRoute';
import { LOCAL_BANNER_TEXT } from '@/components/localEngine/texts';
import { useAIStatus, useCapabilities } from '@/hooks/useAIStatus';
import { progressPercent } from '@/lib/ai-ui/format';
import { isEngineBusy, isModelPulling } from '@/lib/ai-ui/progress';
import { serverAIView } from '@/lib/ai-ui/server';
import { aiPhase, phaseInfo } from '@/lib/ai-ui/status';
import { useLocalEngine, type LocalEngineState } from '@/lib/localConnector/controller';
import { useOptionalRuntime } from '@/lib/runtime/context';
import { usesServerApi } from '@/lib/runtime/types';

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

/** Site web, Magistra locale choisie : état court de l'IA de cet ordinateur (jamais « serveur »). */
function localBadge(state: LocalEngineState): BadgeView {
  const to = '/app/settings';
  switch (state.kind) {
    case 'idle':
    case 'checking':
      return { to, ok: null, text: 'Recherche de Magistra…' };
    case 'pairing':
      return { to, ok: null, text: 'Connexion de Magistra locale…' };
    case 'connected': {
      const engine = state.status?.engine;
      if (engine?.ready && engine.local) return { to, ok: true, text: 'Magistra locale', title: LOCAL_BANNER_TEXT };
      return { to, ok: false, text: 'Magistra locale : IA pas prête' };
    }
    case 'app-closed':
      return { to, ok: false, text: 'Magistra locale fermée' };
    case 'needs-permission':
      return { to, ok: false, text: 'Magistra locale : autorisation requise' };
    case 'permission-denied':
      return { to, ok: false, text: 'Magistra locale bloquée' };
    case 'found':
    case 'not-found':
      return { to, ok: false, text: 'Magistra locale non connectée' };
  }
}

/**
 * Petit indicateur d'état de l'IA pour la barre latérale.
 * Windows : IA locale ; site web et mode personnel : serveur IA (avec la vraie cause), ou Magistra locale quand
 * l'enseignant l'a choisie sur le site ; démonstration : aucune IA.
 */
export default function AIStatusBadge() {
  const runtime = useOptionalRuntime();
  const mode = runtime?.mode ?? null;
  const ai = useAIStatus();
  const server = mode !== null && usesServerApi(mode);
  // Site web : Magistra locale (IA de cet ordinateur) ou serveur en ligne, selon le choix de l'enseignant.
  const localEngine = useLocalEngine();
  const engine = mode === 'web' ? localEngine : null;
  const { route } = useEngineRoute(engine?.state ?? null);
  // Capacités du serveur : lues seulement quand il est le moteur choisi (relues quand il le redevient).
  const web = useCapabilities({ enabled: server && (!engine || route === 'server'), refreshKey: engine ? (route ?? '') : '' });
  useRouteCapsHeal(engine?.controller ?? null, route === 'server' ? route : null, web.capabilities, web.loading, web.reload);

  if (!runtime) return null;

  if (mode === 'demo') {
    return <Badge to="/app/settings" ok={null} text="Démonstration" title="Exemples pré-rédigés, aucune IA n'est utilisée" />;
  }

  if (engine && route !== 'server') {
    return route === null ? <Badge to="/app/settings" ok={null} text="Vérification de l’IA…" /> : <Badge {...localBadge(engine.state)} />;
  }

  if (mode === 'web' || mode === 'personal') {
    // Capacités d'un autre moteur (lecture antérieure) : jamais affichées comme celles du serveur.
    const serverCaps = engine && web.capabilities?.route === 'local-connector' ? null : web.capabilities;
    const view = serverAIView(serverCaps, { mode, loading: web.loading || (serverCaps === null && web.capabilities !== null), checkError: web.error?.message ?? null });
    if (view.state === 'checking') return <Badge to="/app/settings" ok={null} text={view.badge} />;
    // État non vérifié : ni vert ni orange, la génération reste possible.
    if (view.state === 'unverified') return <Badge to="/app/settings" ok={null} text={view.badge} title={view.detail ?? undefined} />;
    const ok = view.state === 'ready';
    const title = ok ? undefined : [view.detail, view.code ? `(code ${view.code})` : null].filter(Boolean).join(' ');
    return <Badge to="/app/settings" ok={ok} text={view.badge} title={title || undefined} />;
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
