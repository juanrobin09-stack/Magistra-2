// « Magistra pour Windows » avec le connecteur local : le panneau de téléchargement (WindowsDownloadPanel.tsx) et, après
// le clic sur « Télécharger », « J’ai installé Magistra » [Détecter maintenant] sur le site avec comptes.
// Le site vitrine, qui n'a rien à connecter, utilise le panneau seul (mode « showcase » : aucune requête vers
// l'ordinateur de l'enseignant, aucun bouton de détection).
// Accessibilité : après « Continuer » ou « Annuler » de l'explication (qui disparaît), le focus revient sur
// « Détecter maintenant » au lieu d'être perdu au début de la page.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { FOCUS_RING } from '@/components/generate/fieldUtils';
import { useLocalEngine } from '@/lib/localConnector/controller';
import type { PageMode, RuntimeMode } from '@/lib/runtime/types';
import { useLocalActions } from './localActions';
import LocalEngineStatus, { type LocalEngineHandle } from './LocalEngineStatus';
import { PermissionExplainer } from './PermissionNotes';
import { DETECT_NOW_LABEL, INSTALLED_TEXT, SIGNED_OUT_DETECT_TEXT } from './texts';
import WindowsDownloadPanel from './WindowsDownloadPanel';

interface WindowsDownloadSectionProps {
  /** « landing » : section publique autonome (titre h2) ; « settings » : contenu d'une section des réglages. */
  variant: 'landing' | 'settings';
  /**
   * Mode d'affichage : la version est demandée au serveur du site (web, mode personnel, démonstration — le site public
   * sans comptes garde son API) ; jamais dans l'application Windows, déjà installée. « showcase » : site vitrine, sans
   * connecteur ni détection.
   */
  mode: PageMode;
}

function DetectNow({ engine }: { engine: LocalEngineHandle }) {
  const actions = useLocalActions(engine);
  const [started, setStarted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** L'explication va disparaître : focus rendu à « Détecter maintenant » s'il a été perdu. */
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (actions.pending || !restoreFocus.current) return;
    restoreFocus.current = false;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) buttonRef.current?.focus({ preventScroll: true });
  }, [actions.pending]);
  if (actions.pending) {
    return (
      <PermissionExplainer
        onContinue={() => {
          restoreFocus.current = true;
          setStarted(true);
          actions.confirm();
        }}
        onCancel={() => {
          restoreFocus.current = true;
          actions.cancel();
        }}
        autoFocus
      />
    );
  }
  return (
    <div className="space-y-3">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (engine.state.permission !== 'prompt') setStarted(true);
          actions.request('detect');
        }}
        className={`btn-primary text-sm py-2 px-4 ${FOCUS_RING}`}
      >
        <Search size={15} aria-hidden="true" /> {DETECT_NOW_LABEL}
      </button>
      {started && <LocalEngineStatus engine={engine} idPrefix="windows" />}
    </div>
  );
}

/** Annonce (lecteurs d'écran) après le clic sur « Télécharger ». */
const AFTER_DOWNLOAD_ANNOUNCEMENT = `Téléchargement lancé. Une fois Magistra installée, la rubrique « ${INSTALLED_TEXT} », juste après, permet de la retrouver.`;

/** Hors du site avec comptes (rien à connecter) : où retrouver Magistra après l'installation (raccourcis créés par l'installateur). */
const OPENS_BY_ITSELF_TEXT = 'Magistra s’ouvre toute seule à la fin de l’installation. Ensuite, retrouvez-la dans le menu Démarrer ou sur le Bureau.';

function AfterDownload({ mode }: { mode: RuntimeMode }) {
  const engine = useLocalEngine();
  return (
    <div className="rounded-xl border border-accent/15 bg-accent/5 p-4 space-y-3" data-testid="windows-installed">
      <p className="text-sm font-semibold text-mg-50">{INSTALLED_TEXT}</p>
      {engine ? (
        <DetectNow engine={engine} />
      ) : mode === 'web' ? (
        <p className="text-sm text-mg-200">
          {SIGNED_OUT_DETECT_TEXT}{' '}
          <Link to="/app" className="text-accent hover:underline underline-offset-2">Se connecter</Link>
        </p>
      ) : (
        <p className="text-sm text-mg-200">{OPENS_BY_ITSELF_TEXT}</p>
      )}
    </div>
  );
}

export default function WindowsDownloadSection({ variant, mode }: WindowsDownloadSectionProps) {
  // Site vitrine : rien à connecter, donc rien après le clic.
  const afterDownload = mode === 'showcase' ? undefined : { announcement: AFTER_DOWNLOAD_ANNOUNCEMENT, render: () => <AfterDownload mode={mode} /> };
  // Seul le site avec comptes peut confier ses générations à l'application (connecteur local).
  const introExtra = mode === 'web' ? ' Depuis ce site, vous pourrez aussi l’utiliser pour vos générations.' : undefined;
  return <WindowsDownloadPanel variant={variant} mode={mode} afterDownload={afterDownload} introExtra={introExtra} />;
}
