// « Magistra pour Windows » : téléchargement de la dernière version STABLE publiée (GET /api/windows-release), avec sa
// version, sa taille, sa date et son empreinte SHA-256 ; trois étapes très courtes ; ce que l'application apporte.
// Après le téléchargement : « J’ai installé Magistra » [Détecter maintenant]. Aucune version n'est écrite en dur :
// sans réponse du serveur, le lien mène à la page officielle des versions.
// Accessibilité : après « Continuer » ou « Annuler » de l'explication (qui disparaît), le focus revient sur
// « Détecter maintenant » au lieu d'être perdu au début de la page.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, Cpu, Download, ExternalLink, KeyRound, Search, ShieldCheck, WifiOff, type LucideIcon } from 'lucide-react';
import { FOCUS_RING } from '@/components/generate/fieldUtils';
import { useLocalEngine } from '@/lib/localConnector/controller';
import type { RuntimeMode } from '@/lib/runtime/types';
import { useLocalActions } from './localActions';
import LocalEngineStatus, { type LocalEngineHandle } from './LocalEngineStatus';
import { PermissionExplainer } from './PermissionNotes';
import { DETECT_NOW_LABEL, DOWNLOAD_WINDOWS_LABEL, INSTALLED_TEXT, SIGNED_OUT_DETECT_TEXT } from './texts';
import { formatDate, formatSize, useWindowsRelease, WINDOWS_REQUIREMENTS_TEXT, type WindowsReleaseState } from './windowsRelease';

const POINTS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Cpu, title: 'IA locale', text: 'L’intelligence artificielle fonctionne directement sur votre ordinateur.' },
  { icon: KeyRound, title: 'Aucune clé API', text: 'Rien à configurer : Magistra installe et prépare l’IA toute seule.' },
  {
    icon: WifiOff,
    title: 'Fonctionne hors connexion',
    text: 'L’application fonctionne sans Internet. Le site Magistra, lui, nécessite une connexion.',
  },
  { icon: ShieldCheck, title: 'Confidentialité locale', text: 'Dans l’application, vos documents et vos générations restent sur votre ordinateur.' },
];

const STEPS = ['Téléchargez l’installateur.', 'Ouvrez-le et suivez les étapes.', 'Lancez Magistra : l’IA se prépare toute seule.'];

interface WindowsDownloadSectionProps {
  /** « landing » : section publique autonome (titre h2) ; « settings » : contenu d'une section des réglages. */
  variant: 'landing' | 'settings';
  /** Mode d'exécution : la version n'est demandée qu'à un serveur Magistra (site web, mode personnel). */
  mode: RuntimeMode;
}

function Sha256({ value }: { value: string }) {
  const [copied, setCopied] = useState<'ok' | 'manual' | null>(null);
  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error('presse-papiers indisponible');
      await navigator.clipboard.writeText(value);
      setCopied('ok');
    } catch {
      setCopied('manual');
    }
  }
  return (
    <details className="group rounded-xl border border-white/8 bg-white/[0.02]">
      <summary className={`cursor-pointer list-none px-3 py-2 text-xs text-mg-200 rounded-xl [&::-webkit-details-marker]:hidden ${FOCUS_RING}`}>
        <span className="text-accent group-open:hidden">▸</span><span className="text-accent hidden group-open:inline">▾</span> Empreinte SHA-256
        <span className="text-mg-300"> (vérification facultative)</span>
      </summary>
      <div className="px-3 pb-3 space-y-2">
        <code className="block font-mono text-[11px] leading-relaxed text-mg-100 break-all select-all" data-testid="windows-sha256">{value}</code>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void copy()} className={`btn-ghost text-xs py-1.5 px-2.5 ${FOCUS_RING}`}>
            {copied === 'ok' ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />} Copier l’empreinte
          </button>
          <span role="status" className="text-xs text-mg-200">
            {copied === 'ok' ? 'Empreinte copiée.' : copied === 'manual' ? 'Sélectionnez l’empreinte, puis copiez-la (Ctrl+C).' : ''}
          </span>
        </div>
      </div>
    </details>
  );
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
        <p className="text-sm text-mg-200">Lancez Magistra depuis le menu Démarrer de Windows.</p>
      )}
    </div>
  );
}

function ReleaseFacts({ state, queried }: { state: WindowsReleaseState; queried: boolean }) {
  if (state.status === 'loading') {
    return <p className="text-xs text-mg-200" role="status">Recherche de la dernière version…</p>;
  }
  if (state.status === 'fallback') {
    return (
      <div className="space-y-1 text-xs text-mg-200">
        {queried && (
          <p role="note">
            {state.reason === 'none'
              ? 'Aucune version stable n’est encore publiée : la page des versions indique où en est Magistra pour Windows.'
              : 'Les informations sur la dernière version ne sont pas disponibles pour le moment : le lien ouvre la page officielle des versions.'}
          </p>
        )}
        <p>{WINDOWS_REQUIREMENTS_TEXT}</p>
      </div>
    );
  }
  const { release } = state;
  const date = formatDate(release.publishedAt);
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-mg-200">Version</dt>
        <dd className="text-mg-50" data-testid="windows-version">{release.version}</dd>
        <dt className="text-mg-200">Taille</dt>
        <dd className="text-mg-50" data-testid="windows-size">{formatSize(release.sizeBytes)}</dd>
        {date && (
          <>
            <dt className="text-mg-200">Publiée le</dt>
            <dd className="text-mg-50" data-testid="windows-date">{date}</dd>
          </>
        )}
        <dt className="text-mg-200">Configuration</dt>
        <dd className="text-mg-50">{release.requirements}</dd>
      </dl>
      {release.sha256 && <Sha256 value={release.sha256} />}
      <p className="text-xs">
        <a href={release.releaseUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline underline-offset-2">
          Notes de version <ExternalLink size={11} aria-hidden="true" />
        </a>
      </p>
    </div>
  );
}

export default function WindowsDownloadSection({ variant, mode }: WindowsDownloadSectionProps) {
  const queried = mode === 'web' || mode === 'personal';
  const release = useWindowsRelease(queried);
  const [downloaded, setDownloaded] = useState(false);
  const landing = variant === 'landing';
  const buttonClass = `${landing ? 'btn-secondary' : 'btn-primary'} text-sm py-2.5 px-5 justify-center ${FOCUS_RING}`;

  const button = release.status === 'loading' ? (
    <span className={`${buttonClass} opacity-60 cursor-wait`} aria-busy="true" aria-disabled="true">
      <Download size={16} aria-hidden="true" /> {DOWNLOAD_WINDOWS_LABEL}
    </span>
  ) : release.status === 'ready' ? (
    <a href={release.release.downloadUrl} rel="noopener noreferrer" className={buttonClass} onClick={() => setDownloaded(true)}>
      <Download size={16} aria-hidden="true" /> {DOWNLOAD_WINDOWS_LABEL}
    </a>
  ) : (
    <a href={release.releasesUrl} target="_blank" rel="noopener noreferrer" className={buttonClass} onClick={() => setDownloaded(true)}>
      <Download size={16} aria-hidden="true" /> {DOWNLOAD_WINDOWS_LABEL} <ExternalLink size={13} aria-hidden="true" />
    </a>
  );

  const content = (
    <div className={landing ? 'card p-6 sm:p-8 grid gap-8 lg:grid-cols-2' : 'space-y-5'}>
      <div className="space-y-5 min-w-0">
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Ce que Magistra pour Windows apporte">
          {POINTS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex items-start gap-3">
              <span aria-hidden="true" className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                <Icon size={15} className="text-accent" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-mg-50">{title}</span>
                <span className="block text-xs text-mg-200 leading-relaxed">{text}</span>
              </span>
            </li>
          ))}
        </ul>
        <ol className="space-y-1.5" aria-label="Installation en trois étapes">
          {STEPS.map((step, i) => (
            <li key={step} className="flex items-start gap-2.5 text-sm text-mg-100">
              <span aria-hidden="true" className="w-5 h-5 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-[11px] font-semibold text-accent shrink-0 mt-px">
                {i + 1}
              </span>
              <span className="min-w-0">{step}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="space-y-4 min-w-0">
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">{button}</div>
        <ReleaseFacts state={release} queried={queried} />
        {/* Région présente dès l'affichage : l'apparition de « J’ai installé Magistra » est annoncée aux lecteurs
            d'écran (le focus reste sur le lien de téléchargement). */}
        <p role="status" className="sr-only">{downloaded ? AFTER_DOWNLOAD_ANNOUNCEMENT : ''}</p>
        {downloaded && <AfterDownload mode={mode} />}
      </div>
    </div>
  );

  if (!landing) return <div data-testid="windows-download">{content}</div>;
  return (
    <section id="magistra-windows" aria-labelledby="windows-title" className="py-16 sm:py-20 px-6" data-testid="windows-download">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10">
          <p className="text-xs uppercase tracking-widest text-accent mb-3">Application Windows</p>
          <h2 id="windows-title" className="text-2xl sm:text-3xl text-white" style={{ fontFamily: 'var(--font-display)' }}>
            Magistra pour <em className="text-accent not-italic">Windows</em>
          </h2>
          <p className="text-sm text-mg-200 mt-3 max-w-xl mx-auto leading-relaxed">
            L’intelligence artificielle de Magistra sur votre ordinateur, gratuite et sans compte. Depuis ce site,
            vous pourrez ensuite l’utiliser pour vos générations.
          </p>
        </div>
        {content}
      </div>
    </section>
  );
}
