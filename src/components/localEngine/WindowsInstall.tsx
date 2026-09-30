// Pièces communes du téléchargement de Magistra pour Windows, partagées par la section « Magistra pour Windows »
// (accueil, réglages) et la carte du mode démonstration, pour que tous les endroits où l'on télécharge disent la même
// chose : le bouton (installateur de la dernière version stable : sous son nom exact quand /api/windows-release le
// donne, sinon sous son nom fixe ; toujours un fichier, jamais une page GitHub ; inactif tant qu'aucune version n'est
// publiée), les trois étapes d'installation (avertissement SmartScreen compris) et « Déjà
// installée ? Ouvrir Magistra » (magistra://open), la taille de l'installateur annoncée à côté du bouton (un clic
// télécharge le fichier). Aucun chargement ici : la version vient de useWindowsRelease (une seule requête par visite,
// windowsRelease.ts).

import { Download, Monitor } from 'lucide-react';
import { OPEN_APP_URL } from '@shared/localConnector';
import { FOCUS_RING } from '@/components/generate/fieldUtils';
import {
  ACTIVATE_AI_NOTE, ALREADY_INSTALLED_TEXT, DOWNLOAD_WINDOWS_LABEL, INSTALL_STEPS, INSTALL_STEPS_LABEL, NOT_PUBLISHED_TEXT,
  OPEN_APP_LABEL,
} from './texts';
import { formatSize, installerUrl, WINDOWS_REQUIREMENTS_TEXT, type WindowsReleaseState } from './windowsRelease';

interface WindowsDownloadLinkProps {
  release: WindowsReleaseState;
  /** Classes du bouton (btn-primary, btn-secondary… et leur taille). */
  className: string;
  iconSize?: number;
  /** Clic sur le lien (téléchargement de l'installateur). */
  onClick?: () => void;
  /** Identifiant du texte qui décrit le téléchargement (taille de l'installateur : InstallerFacts). */
  describedBy?: string;
}

/**
 * « Télécharger Magistra pour Windows ». Version en cours de recherche : bouton inactif (jamais un lien qui changerait
 * sous le doigt) ; aucune version publiée : bouton inactif, la raison est dite à côté (InstallerFacts) ; sinon :
 * l'installateur lui-même (le navigateur télécharge le fichier, la page reste affichée).
 */
export function WindowsDownloadLink({ release, className, iconSize = 16, onClick, describedBy }: WindowsDownloadLinkProps) {
  const icon = <Download size={iconSize} aria-hidden="true" />;
  const href = installerUrl(release);
  if (!href) {
    const loading = release.status === 'loading';
    return (
      <span
        className={`${className} opacity-60 ${loading ? 'cursor-wait' : 'cursor-not-allowed'}`}
        aria-busy={loading || undefined}
        aria-disabled="true"
        aria-describedby={loading ? undefined : describedBy}
        data-testid="windows-download-unavailable"
      >
        {icon} {DOWNLOAD_WINDOWS_LABEL}
      </span>
    );
  }
  return (
    <a href={href} rel="noopener noreferrer" className={className} onClick={onClick} aria-describedby={describedBy}>
      {icon} {DOWNLOAD_WINDOWS_LABEL}
    </a>
  );
}

/**
 * À côté du bouton : ce que le clic télécharge — « Installateur : 85 Mo · version 2.0.0 · Windows 10 ou 11 (64 bits) »
 * (le lien direct télécharge le fichier aussitôt, jamais sans sa taille quand elle est connue) ; version exacte
 * inconnue : la configuration requise seule ; aucune version publiée : pourquoi le bouton est inactif. Rien pendant la
 * recherche de la version.
 */
export function InstallerFacts({ release, id }: { release: WindowsReleaseState; id?: string }) {
  if (release.status === 'loading') return null;
  const text = release.status === 'ready'
    ? `Installateur : ${formatSize(release.release.sizeBytes)} · version ${release.release.version} · ${release.release.requirements}`
    : release.status === 'none' ? NOT_PUBLISHED_TEXT : WINDOWS_REQUIREMENTS_TEXT;
  return <p id={id} className="text-xs text-mg-200" data-testid="windows-installer-facts">{text}</p>;
}

/**
 * Les trois étapes (télécharger ; ouvrir, avec la réponse à SmartScreen ; installation sans droits d'administrateur
 * qui ouvre Magistra), puis ce qui suit : l'IA s'active dans l'application, taille annoncée avant.
 */
export function InstallSteps() {
  return (
    <div className="space-y-2">
      <ol className="space-y-1.5" aria-label={INSTALL_STEPS_LABEL}>
        {INSTALL_STEPS.map((step, i) => (
          <li key={step} className="flex items-start gap-2.5 text-sm text-mg-100">
            <span
              aria-hidden="true"
              className="w-5 h-5 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-[11px] font-semibold text-accent shrink-0 mt-px"
            >
              {i + 1}
            </span>
            <span className="min-w-0">{step}</span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-mg-200 leading-relaxed">{ACTIVATE_AI_NOTE}</p>
    </div>
  );
}

/**
 * « Déjà installée ? Ouvrir Magistra » : magistra://open, enregistré par l'installateur, ouvre l'application (ou la
 * met au premier plan) sans rien demander d'autre ; le navigateur demande lui-même s'il peut l'ouvrir.
 */
export function OpenInstalledApp() {
  return (
    <p className="text-sm text-mg-200" data-testid="open-installed-app">
      {ALREADY_INSTALLED_TEXT}{' '}
      <a href={OPEN_APP_URL} className={`inline-flex items-center gap-1 text-accent hover:underline underline-offset-2 rounded ${FOCUS_RING}`}>
        <Monitor size={13} aria-hidden="true" /> {OPEN_APP_LABEL}
      </a>
    </p>
  );
}
