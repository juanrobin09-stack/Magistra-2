// Mode démonstration : UNE voie vers la vraie IA pour l'enseignant — installer Magistra sur son ordinateur Windows, où
// l'IA fonctionne gratuitement, en privé, même sans Internet. Téléchargement direct de la dernière version stable quand
// /api/windows-release la donne (même requête, partagée, que la section « Magistra pour Windows » : le site public sans
// comptes garde son API), sa taille annoncée à côté (un clic télécharge le fichier), sinon la page des versions ; les
// trois étapes (avertissement SmartScreen compris) ; « Déjà installée ? Ouvrir Magistra » (magistra://open).
// Rien de technique à l'écran (ni commande, ni moteur, ni variable, ni service d'hébergement) : une seule ligne discrète
// renvoie l'administrateur du site vers le mode d'emploi. Aucun formulaire, rien n'est écrit dans une configuration.

import { useId } from 'react';
import { ExternalLink, Monitor } from 'lucide-react';
import { FOCUS_RING } from '@/components/generate/fieldUtils';
import { useWindowsRelease } from '@/components/localEngine/windowsRelease';
import { InstallerFacts, InstallSteps, OpenInstalledApp, WindowsDownloadLink } from '@/components/localEngine/WindowsInstall';
import { README_AI_SECTION_URL } from '@/lib/links';
import { detectMode, useOptionalRuntime } from '@/lib/runtime/context';

export default function ConnectRealAICard({ className = '' }: { className?: string }) {
  const runtime = useOptionalRuntime();
  const mode = runtime?.mode ?? detectMode();
  // L'application Windows n'affiche pas cette carte ; si c'était le cas, rien à demander : repli sur la page des versions.
  const release = useWindowsRelease(mode !== 'local');
  const factsId = useId();
  return (
    <div className={`rounded-xl border border-accent/15 bg-accent/5 p-4 sm:p-5 ${className}`} data-testid="connect-real-ai">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* Icône masquée sur téléphone : la carte y reste courte. */}
        <span aria-hidden="true" className="hidden sm:flex w-10 h-10 rounded-xl bg-accent/10 border border-accent/15 items-center justify-center shrink-0">
          <Monitor size={18} className="text-accent" />
        </span>
        <div className="min-w-0 flex-1 space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-mg-50">Passez à la vraie IA : installez Magistra sur votre ordinateur Windows.</p>
            <p className="text-sm text-mg-200">L’IA y fonctionne gratuitement, en privé, même sans Internet.</p>
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <WindowsDownloadLink release={release} className={`btn-primary text-sm py-2 px-4 ${FOCUS_RING}`} iconSize={15} describedBy={factsId} />
              <OpenInstalledApp />
            </div>
            <InstallerFacts release={release} id={factsId} />
          </div>
          <InstallSteps />
          <p className="text-xs text-mg-300">
            Vous administrez le site de l’établissement ?{' '}
            <a
              href={README_AI_SECTION_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1 text-accent hover:underline underline-offset-2 rounded ${FOCUS_RING}`}
            >
              Mode d’emploi <ExternalLink size={11} aria-hidden="true" />
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
