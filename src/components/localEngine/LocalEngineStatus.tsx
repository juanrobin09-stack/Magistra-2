// État de Magistra locale et actions possibles, pour chaque état du contrôleur (voir LocalEngineStateKind) :
// partagé par la carte du tableau de bord, le panneau de la page Générer, les réglages et la section Windows.
//
// Accessibilité : la ligne d'état est annoncée (aria-live) ; quand l'action de l'enseignant fait disparaître le bouton
// qu'il vient d'utiliser (« Connecter » → « Annuler »…), le focus est placé sur la ligne d'état au lieu d'être perdu.

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, ExternalLink, Info, Loader2, Monitor, Plug, RefreshCw, Search } from 'lucide-react';
import { defaultMessage } from '@shared/errors';
import { FOCUS_RING } from '@/components/generate/fieldUtils';
import { NOT_ANSWERED_PERMISSION_MESSAGE, type LocalEngineController, type LocalEngineState } from '@/lib/localConnector/controller';
import { useLocalActions, wasSearched, type LocalAction } from './localActions';
import { PermissionDeniedHelp, PermissionExplainer } from './PermissionNotes';
import {
  APP_CLOSED_DETAIL, APP_CLOSED_TEXT, CANCEL_LABEL, CONNECT_LABEL, CONNECTED_TEXT, DOWNLOAD_SHORT_LABEL, DOWNLOAD_WINDOWS_LABEL,
  ENGINE_BUSY_TEXT, FOUND_DETAIL, FOUND_TEXT, JUST_CONNECTED_TEXT, LOCAL_INTRO_DETAIL, LOCAL_INTRO_TEXT, localEngineMessage,
  localModelLabel, NEEDS_PERMISSION_TEXT, NOT_DETECTED_DETAIL, NOT_DETECTED_TEXT, OPEN_APP_LABEL, PAIRING_DETAIL, PAIRING_TEXT,
  PAIRING_CODE_HINT, PAIRING_CODE_LABEL, PERMISSION_DENIED_TEXT, RETRY_LABEL, SEARCH_EXISTING_LABEL, SEARCH_WITH_PERMISSION_LABEL, SEARCHING_TEXT,
} from './texts';
import { useWindowsRelease } from './windowsRelease';

export interface LocalEngineHandle {
  state: LocalEngineState;
  controller: LocalEngineController;
}

interface LocalEngineStatusProps {
  engine: LocalEngineHandle;
  /** Ligne d'état (« ✓ Magistra trouvée »…) ; faux dans le panneau de la page Générer, dont la cause la remplace. */
  headline?: boolean;
  /** Messages déjà affichés à côté (cause du panneau) : jamais répétés. */
  omit?: readonly string[];
  /** Préfixe des identifiants (plusieurs vues sur la même page). */
  idPrefix: string;
}

type Tone = 'ok' | 'warn' | 'info' | 'busy';

interface View {
  tone: Tone;
  headline: string;
  details: string[];
  /** Détail mis en avant (moteur non prêt, erreur utile). */
  alert?: string;
  /** Code de vérification de l'appairage en cours (affiché aussi par la boîte de Magistra). */
  code?: string;
}

const TONE_CLASS: Record<Tone, string> = {
  ok: 'text-success',
  warn: 'text-warning',
  info: 'text-mg-50',
  busy: 'text-mg-50',
};

const BTN_PRIMARY = `btn-primary text-sm py-2 px-4 ${FOCUS_RING}`;
const BTN_SECONDARY = `btn-secondary text-sm py-2 px-4 ${FOCUS_RING}`;
const BTN_GHOST = `btn-ghost text-sm py-2 px-3 ${FOCUS_RING}`;

function errorText(state: LocalEngineState): string | undefined {
  return state.error ? localEngineMessage(state.error.code, state.error.message) : undefined;
}

/** Demande du navigateur restée sans réponse : rien n'a pu être cherché (jamais « fermée » ni « téléchargez-la » seul). */
function permissionNotAnswered(state: LocalEngineState): boolean {
  return state.error?.code === 'LOCAL_NETWORK_PERMISSION_DENIED' && state.error.message === NOT_ANSWERED_PERMISSION_MESSAGE;
}

/**
 * Une application Magistra répond sans reconnaître ce navigateur (celle d'une autre session Windows, ou la sienne qui
 * a perdu ses autorisations) : appairage gardé, « Connecter » proposé en plus de « Ouvrir Magistra ».
 */
function unrecognized(state: LocalEngineState): boolean {
  return state.kind === 'app-closed' && state.paired && state.error?.code === 'CONNECTOR_UNPAIRED';
}

/** Texte, ton et détails de l'état (fonction pure, testée à travers les composants). */
function describe(state: LocalEngineState, searched: boolean, justConnected: boolean): View {
  const error = errorText(state);
  switch (state.kind) {
    case 'idle':
    case 'checking':
      return { tone: 'busy', headline: SEARCHING_TEXT, details: [] };
    case 'needs-permission':
      return { tone: 'info', headline: NEEDS_PERMISSION_TEXT, details: [], ...(error ? { alert: error } : {}) };
    case 'permission-denied':
      return { tone: 'warn', headline: PERMISSION_DENIED_TEXT, details: [] };
    case 'not-found': {
      const plainUnreachable = state.error?.code === 'CONNECTOR_UNREACHABLE' && state.error.message === defaultMessage('CONNECTOR_UNREACHABLE');
      if (!searched && !error) return { tone: 'info', headline: LOCAL_INTRO_TEXT, details: [LOCAL_INTRO_DETAIL] };
      // Cause d'abord : l'autorisation du navigateur, pas l'absence de Magistra.
      if (permissionNotAnswered(state)) return { tone: 'warn', headline: NOT_DETECTED_TEXT, details: [], alert: error };
      return { tone: 'warn', headline: NOT_DETECTED_TEXT, details: [NOT_DETECTED_DETAIL], ...(error && !plainUnreachable ? { alert: error } : {}) };
    }
    case 'found':
      return { tone: 'ok', headline: FOUND_TEXT, details: [FOUND_DETAIL], ...(error ? { alert: error } : {}) };
    case 'pairing':
      return { tone: 'busy', headline: PAIRING_TEXT, details: [PAIRING_DETAIL], ...(state.pairingCode ? { code: state.pairingCode } : {}) };
    case 'app-closed':
      return { tone: 'warn', headline: APP_CLOSED_TEXT, details: error ? [] : [APP_CLOSED_DETAIL], ...(error ? { alert: error } : {}) };
    case 'connected': {
      const status = state.status;
      const headline = justConnected ? JUST_CONNECTED_TEXT : CONNECTED_TEXT;
      if (!status) return { tone: 'ok', headline, details: [] };
      const model = localModelLabel(status.engine.label);
      const details = model ? [`Modèle : ${model}`] : [];
      if (!status.engine.local) {
        const notice = status.engine.notReady ?? { code: 'LOCAL_ENGINE_REMOTE' as const, message: defaultMessage('LOCAL_ENGINE_REMOTE') };
        return { tone: 'ok', headline, details: [], alert: localEngineMessage(notice.code, notice.message) };
      }
      if (!status.engine.ready) {
        const notice = status.engine.notReady ?? { code: 'ENGINE_NOT_RUNNING' as const, message: '' };
        return { tone: 'ok', headline, details, alert: localEngineMessage(notice.code, notice.message) };
      }
      if (status.busy) details.push(ENGINE_BUSY_TEXT);
      else if (status.engine.warning) details.push(localEngineMessage(status.engine.warning.code, status.engine.warning.message));
      return { tone: 'ok', headline, details };
    }
  }
}

/** L'état « connectée » attend-il une action dans l'application (moteur non prêt, réglé sur un serveur distant) ? */
function engineNeedsApp(state: LocalEngineState): boolean {
  return state.kind === 'connected' && Boolean(state.status) && !(state.status!.engine.ready && state.status!.engine.local);
}

export default function LocalEngineStatus({ engine, headline = true, omit = [], idPrefix }: LocalEngineStatusProps) {
  const { state, controller } = engine;
  const actions = useLocalActions(engine);
  const statusRef = useRef<HTMLDivElement>(null);
  const acted = useRef(false);

  // « ✓ Intelligence locale connectée » juste après l'appairage (transition « pairing » → « connected »).
  const [previousKind, setPreviousKind] = useState(state.kind);
  const [justConnected, setJustConnected] = useState(false);
  if (previousKind !== state.kind) {
    setPreviousKind(state.kind);
    setJustConnected(previousKind === 'pairing' && state.kind === 'connected');
  }

  // Téléchargement proposé seulement quand Magistra n'est pas trouvée (installateur direct si la version est connue).
  const needsDownload = state.kind === 'not-found' && !state.paired;
  const release = useWindowsRelease(needsDownload);
  const download = release.status === 'ready'
    ? { href: release.release.downloadUrl, direct: true }
    : { href: release.status === 'fallback' ? release.releasesUrl : undefined, direct: false };

  // Focus rendu à la ligne d'état quand le bouton utilisé a disparu : une seule fois, au premier changement qui suit
  // l'action de l'enseignant, et seulement si le focus a été perdu (jamais volé à un autre élément de la page).
  const kind = state.kind;
  useEffect(() => {
    if (!acted.current) return;
    acted.current = false;
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    if (!active || active === document.body) statusRef.current?.focus({ preventScroll: true });
  }, [kind, actions.pending]);

  const searched = wasSearched(controller);
  const view = describe(state, searched, justConnected);
  const shown = (text: string | undefined) => Boolean(text) && !omit.includes(text!);

  const act = (action: LocalAction, direct = false) => () => {
    acted.current = true;
    if (direct) actions.run(action);
    else actions.request(action);
  };
  const cancelPairing = () => {
    acted.current = true;
    controller.cancelPairing();
  };

  const headlineId = `${idPrefix}-local-state`;
  const HeadIcon = view.tone === 'busy' ? Loader2 : view.tone === 'ok' ? CheckCircle2 : view.tone === 'warn' ? AlertTriangle : Info;

  function downloadLink(label: string, primary: boolean) {
    const className = primary ? BTN_PRIMARY : BTN_SECONDARY;
    if (!download.href) {
      return (
        <span className={`${className} opacity-60 cursor-wait`} aria-busy="true" aria-disabled="true">
          <Download size={15} aria-hidden="true" /> {label}
        </span>
      );
    }
    return download.direct ? (
      <a href={download.href} className={className} rel="noopener noreferrer">
        <Download size={15} aria-hidden="true" /> {label}
      </a>
    ) : (
      <a href={download.href} target="_blank" rel="noopener noreferrer" className={className}>
        <Download size={15} aria-hidden="true" /> {label}
        <ExternalLink size={12} aria-hidden="true" />
      </a>
    );
  }

  function buttons() {
    if (actions.pending) {
      return (
        <PermissionExplainer
          onContinue={() => {
            acted.current = true;
            actions.confirm();
          }}
          onCancel={() => {
            acted.current = true;
            actions.cancel();
          }}
          autoFocus
        />
      );
    }
    switch (state.kind) {
      case 'idle':
      case 'checking':
        return null;
      case 'needs-permission':
        return <PermissionExplainer actionLabel={SEARCH_WITH_PERMISSION_LABEL} onContinue={act('detect', true)} />;
      case 'permission-denied':
        return (
          <div className="space-y-3">
            <PermissionDeniedHelp />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={act('detect', true)} className={BTN_PRIMARY}>
                <RefreshCw size={15} aria-hidden="true" /> {RETRY_LABEL}
              </button>
            </div>
          </div>
        );
      case 'not-found':
        if (view.headline === LOCAL_INTRO_TEXT) {
          return (
            <div className="flex flex-wrap items-center gap-2">
              {downloadLink(DOWNLOAD_WINDOWS_LABEL, true)}
              <button type="button" onClick={act('detect')} className={BTN_GHOST}>
                <Search size={15} aria-hidden="true" /> {SEARCH_EXISTING_LABEL}
              </button>
            </div>
          );
        }
        return (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={act('detect')} className={BTN_PRIMARY}>
              <RefreshCw size={15} aria-hidden="true" /> {RETRY_LABEL}
            </button>
            {downloadLink(DOWNLOAD_SHORT_LABEL, false)}
          </div>
        );
      case 'found':
        return (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={act('connect')} className={BTN_PRIMARY}>
              <Plug size={15} aria-hidden="true" /> {CONNECT_LABEL}
            </button>
          </div>
        );
      case 'pairing':
        return (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={cancelPairing} className={BTN_SECONDARY}>
              {CANCEL_LABEL}
            </button>
          </div>
        );
      case 'app-closed':
        return (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={act('openApp')} className={BTN_PRIMARY}>
              <Monitor size={15} aria-hidden="true" /> {OPEN_APP_LABEL}
            </button>
            <button type="button" onClick={act('detect')} className={BTN_SECONDARY}>
              <RefreshCw size={15} aria-hidden="true" /> {RETRY_LABEL}
            </button>
            {unrecognized(state) && (
              <button type="button" onClick={act('connect')} className={BTN_SECONDARY}>
                <Plug size={15} aria-hidden="true" /> {CONNECT_LABEL}
              </button>
            )}
          </div>
        );
      case 'connected':
        if (!engineNeedsApp(state)) return null;
        return (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={act('openApp')} className={BTN_PRIMARY}>
              <Monitor size={15} aria-hidden="true" /> {OPEN_APP_LABEL}
            </button>
            <button type="button" onClick={act('detect')} className={BTN_SECONDARY}>
              <RefreshCw size={15} aria-hidden="true" /> {RETRY_LABEL}
            </button>
          </div>
        );
    }
  }

  const actionArea = buttons();
  const details = view.details.filter(shown);
  const alert = shown(view.alert) ? view.alert : undefined;

  return (
    <div className="space-y-3 min-w-0">
      <div
        ref={statusRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-labelledby={headline ? headlineId : undefined}
        aria-label={headline ? undefined : 'État de Magistra locale'}
        className="space-y-1.5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        {headline ? (
          <p id={headlineId} className={`flex items-start gap-2 text-sm font-semibold ${TONE_CLASS[view.tone]}`}>
            {/* Les textes « ✓ … » portent déjà leur coche : pas d'icône en double. */}
            {!view.headline.startsWith('✓') && (
              <HeadIcon size={16} className={`shrink-0 mt-0.5 ${view.tone === 'busy' ? 'animate-spin text-accent' : ''}`} aria-hidden="true" />
            )}
            <span className="min-w-0 [overflow-wrap:anywhere]">{view.headline}</span>
          </p>
        ) : view.tone === 'busy' ? (
          <p className="flex items-center gap-2 text-sm text-mg-100">
            <Loader2 size={15} className="animate-spin text-accent shrink-0" aria-hidden="true" /> {view.headline}
          </p>
        ) : null}
        {details.map(text => (
          <p key={text} className="text-sm text-mg-200 leading-relaxed [overflow-wrap:anywhere]">{text}</p>
        ))}
        {view.code && (
          <p className="text-sm text-mg-100 leading-relaxed [overflow-wrap:anywhere]" data-testid="pairing-code">
            {PAIRING_CODE_LABEL} <strong className="font-mono text-base tracking-widest text-white">{view.code}</strong>. {PAIRING_CODE_HINT}
          </p>
        )}
        {alert && (
          <p className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2 text-sm text-mg-100 [overflow-wrap:anywhere]">
            <AlertTriangle size={15} className="text-warning shrink-0 mt-0.5" aria-hidden="true" />
            <span>{alert}</span>
          </p>
        )}
      </div>
      {/* Une clé par état : un bouton n'est jamais réutilisé pour une autre action (« Connecter » ne devient pas
          « Annuler » sous le focus ou sous un double clic). */}
      {actionArea && <div key={`${state.kind}|${actions.pending ?? ''}`}>{actionArea}</div>}
    </div>
  );
}
