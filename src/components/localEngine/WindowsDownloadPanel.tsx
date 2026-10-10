// « Magistra pour Windows » : le panneau de téléchargement, sans aucune dépendance au connecteur local (WindowsDownload
// Section.tsx y ajoute « J'ai installé Magistra » [Détecter maintenant] pour les modes où le site peut se connecter à
// l'application). Le site vitrine n'importe que ce fichier : ni connecteur, ni requête vers l'ordinateur de l'enseignant.
//
// Contenu : dernière version STABLE publiée (GET /api/windows-release) avec sa version, sa taille, sa date et son
// empreinte SHA-256 ; les trois étapes très courtes (avertissement SmartScreen compris) et « Déjà installée ? Ouvrir
// Magistra », communes avec la carte du mode démonstration (WindowsInstall.tsx) ; ce que l'application apporte. Aucune
// version n'est écrite en dur : sans réponse du serveur, le bouton télécharge l'installateur de la dernière version
// stable sous son nom fixe ; tant qu'aucune version n'est publiée, il est inactif et le dit — jamais un renvoi vers
// une page GitHub.

import { useState, type ReactNode } from 'react';
import { Check, Copy, Cpu, ExternalLink, KeyRound, ShieldCheck, WifiOff, type LucideIcon } from 'lucide-react';
import { FOCUS_RING } from '@/components/generate/fieldUtils';
import type { PageMode } from '@/lib/runtime/types';
import { NOT_PUBLISHED_TEXT } from './windowsTexts';
import { formatDate, formatSize, useWindowsRelease, WINDOWS_REQUIREMENTS_TEXT, type WindowsReleaseState } from './windowsRelease';
import { InstallSteps, OpenInstalledApp, WindowsDownloadLink } from './WindowsInstall';

const POINTS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Cpu, title: 'IA locale', text: 'L’intelligence artificielle fonctionne directement sur votre ordinateur.' },
  { icon: KeyRound, title: 'Aucune clé API', text: 'Rien à configurer : Magistra installe et prépare l’IA elle-même, après votre accord.' },
  {
    icon: WifiOff,
    title: 'Fonctionne hors connexion',
    text: 'Une fois l’IA activée, l’application fonctionne sans Internet.',
  },
  { icon: ShieldCheck, title: 'Confidentialité locale', text: 'Dans l’application, vos documents et vos générations restent sur votre ordinateur.' },
];

/** Annonce (lecteurs d'écran) après le clic sur « Télécharger », sur le site vitrine (rien à connecter). */
const SHOWCASE_DOWNLOAD_ANNOUNCEMENT = 'Téléchargement lancé. Suivez les trois étapes d’installation indiquées sur cette page.';

/** Ce que le panneau ajoute après le clic sur « Télécharger » (modes où le site peut se connecter à l'application). */
export interface AfterDownloadSlot {
  /** Annonce aux lecteurs d'écran (région « status » présente dès l'affichage). */
  announcement: string;
  render: () => ReactNode;
}

interface WindowsDownloadPanelProps {
  /** « landing » : section publique autonome (titre h2) ; « settings » : contenu d'une section des réglages. */
  variant: 'landing' | 'settings';
  /**
   * Mode d'affichage : la version est demandée au serveur du site (site vitrine, web, mode personnel, démonstration —
   * le site public sans comptes garde son API) ; jamais dans l'application Windows, déjà installée.
   */
  mode: PageMode;
  afterDownload?: AfterDownloadSlot;
  /** Phrase ajoutée au texte d'introduction de la section publique (fournie par l'appelant, jamais par le panneau). */
  introExtra?: string;
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

function ReleaseFacts({ state, queried }: { state: WindowsReleaseState; queried: boolean }) {
  if (state.status === 'loading') {
    return <p className="text-xs text-mg-200" role="status">Recherche de la dernière version…</p>;
  }
  if (state.status === 'none') {
    return (
      <div className="space-y-1 text-xs text-mg-200" data-testid="windows-not-published">
        <p role="note" className="text-sm text-mg-100">{NOT_PUBLISHED_TEXT}</p>
        <p>{WINDOWS_REQUIREMENTS_TEXT}</p>
      </div>
    );
  }
  if (state.status === 'direct') {
    return (
      <div className="space-y-1 text-xs text-mg-200">
        {queried && (
          <p role="note">
            Les détails de la dernière version (taille, date, empreinte) ne sont pas disponibles pour le moment : le bouton
            télécharge quand même la dernière version publiée.
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

export default function WindowsDownloadPanel({ variant, mode, afterDownload, introExtra }: WindowsDownloadPanelProps) {
  const queried = mode !== 'local';
  const showcase = mode === 'showcase';
  const release = useWindowsRelease(queried);
  const [downloaded, setDownloaded] = useState(false);
  const landing = variant === 'landing';
  // Accueil de l'application : « btn-primary » reste réservé au bouton d'accès à l'application. Site vitrine : le
  // téléchargement est l'action principale de la page.
  const buttonClass = `${landing && !showcase ? 'btn-secondary' : 'btn-primary'} text-sm py-2.5 px-5 justify-center ${FOCUS_RING}`;
  const announcement = afterDownload?.announcement ?? SHOWCASE_DOWNLOAD_ANNOUNCEMENT;

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
        <InstallSteps />
      </div>
      <div className="space-y-4 min-w-0">
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
          <WindowsDownloadLink release={release} className={buttonClass} onClick={() => setDownloaded(true)} />
        </div>
        {showcase && <aside aria-label="Mise à jour des anciennes versions" className="rounded-xl border border-accent/30 bg-accent/10 p-4 space-y-2 text-sm text-mg-100">
          <p className="font-semibold text-mg-50">Une mise à jour bloque dans Magistra ?</p>
          <p>Les versions 2.0.7 à 2.0.9 passent par la page de la nouvelle version pour cette mise à jour. Cliquez sur « Télécharger Magistra pour Windows » ci-dessus, puis ouvrez le fichier téléchargé.</p>
          <p>Enregistrez votre travail et fermez Magistra avant l’installation. Vos documents, réglages, clés API et modèles sont conservés. Cette étape est nécessaire une fois ; la version corrigée permet ensuite de télécharger et installer les mises à jour depuis l’application.</p>
        </aside>}
        <OpenInstalledApp />
        <ReleaseFacts state={release} queried={queried} />
        {/* Région présente dès l'affichage : l'apparition de la suite (« J’ai installé Magistra ») est annoncée aux
            lecteurs d'écran (le focus reste sur le lien de téléchargement). */}
        <p role="status" className="sr-only">{downloaded ? announcement : ''}</p>
        {downloaded && afterDownload?.render()}
      </div>
    </div>
  );

  if (!landing) return <div data-testid="windows-download">{content}</div>;
  return (
    // Cible des liens « Télécharger pour Windows » de l'accueil (#magistra-windows) : marge sous la barre fixe.
    <section id="magistra-windows" aria-labelledby="windows-title" className="py-16 sm:py-20 px-6 scroll-mt-16" data-testid="windows-download">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10">
          <p className="text-xs uppercase tracking-widest text-accent mb-3">Application Windows</p>
          <h2 id="windows-title" className="text-2xl sm:text-3xl text-white" style={{ fontFamily: 'var(--font-display)' }}>
            Magistra pour <em className="text-accent not-italic">Windows</em>
          </h2>
          <p className="text-sm text-mg-200 mt-3 max-w-xl mx-auto leading-relaxed">
            L’intelligence artificielle de Magistra sur votre ordinateur : gratuite, sans compte, même sans Internet.
            {introExtra}
          </p>
        </div>
        {content}
      </div>
    </section>
  );
}
