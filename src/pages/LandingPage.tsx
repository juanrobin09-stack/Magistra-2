import { Link } from 'react-router-dom';
import { ClerkFailed, ClerkLoading, Show, SignInButton } from '@clerk/react';
import { ArrowRight, Download } from 'lucide-react';
import WindowsDownloadSection from '@/components/localEngine/WindowsDownloadSection';
import { useAIStatus, useCapabilities } from '@/hooks/useAIStatus';
import { detectMode, useOptionalRuntime } from '@/lib/runtime/context';
import { CTA_CLASS, WINDOWS_SECTION_HREF, type CtaSize } from './landing/content';
import LandingContent from './landing/LandingContent';

// Page d'accueil de l'application (Windows, démonstration, mode personnel, site avec comptes) : le contenu est celui du
// site vitrine (landing/LandingContent.tsx) ; ce fichier y ajoute l'accès à l'application et ce qui dépend du mode.

/**
 * Bouton d'accès à l'application :
 * - web : connexion (fenêtre Clerk) si déconnecté, « Mon espace » si connecté, « Réessayer » si le
 *   service de connexion n'a pas pu être chargé ;
 * - démonstration / Windows : l'espace si un profil existe, sinon la création du profil ;
 * - mode personnel : l'application (le code d'accès est demandé s'il manque, puis le profil).
 */
function AccessButton({ size, signedOutLabel = 'Commencer' }: { size: CtaSize; signedOutLabel?: string }) {
  const runtime = useOptionalRuntime();
  const mode = runtime?.mode ?? detectMode();
  const icon = <ArrowRight size={size === 'nav' ? 14 : 16} aria-hidden="true" />;

  if (mode === 'web') {
    return (
      <>
        <ClerkLoading>
          <span className={`${CTA_CLASS[size]} opacity-60 cursor-wait`} aria-busy="true">
            Connexion… {icon}
          </span>
        </ClerkLoading>
        <ClerkFailed>
          <button
            type="button"
            className={CTA_CLASS[size]}
            onClick={() => window.location.reload()}
            title="Le service de connexion n'a pas pu être chargé. Vérifiez votre connexion Internet."
          >
            {size === 'nav' ? 'Réessayer la connexion' : 'Connexion indisponible — réessayer'}
          </button>
        </ClerkFailed>
        <Show when="signed-out">
          <SignInButton mode="modal">
            <button type="button" className={CTA_CLASS[size]}>
              {signedOutLabel} {icon}
            </button>
          </SignInButton>
        </Show>
        <Show when="signed-in">
          <Link to="/app" className={CTA_CLASS[size]}>
            Mon espace {icon}
          </Link>
        </Show>
      </>
    );
  }

  const hasProfile = Boolean(runtime?.profile);
  return (
    <Link to={hasProfile || mode === 'local' || mode === 'personal' ? '/app' : '/onboarding'} className={CTA_CLASS[size]}>
      {hasProfile ? 'Mon espace' : signedOutLabel} {icon}
    </Link>
  );
}

/**
 * Mode personnel : ce qui arrive réellement aux textes, selon l'IA branchée sur le serveur de ce poste
 * (fiche prestataire de /api/status). Sans code d'accès, message générique.
 */
function PersonalNote() {
  const runtime = useOptionalRuntime();
  const caps = useCapabilities({ enabled: runtime?.mode === 'personal' });
  const message = caps.capabilities?.privacy.message;
  return (
    <p className="text-xs text-mg-300 mt-6 max-w-md mx-auto" role="note">
      Mode personnel : Magistra fonctionne avec le serveur démarré sur cet ordinateur, sans compte.
      {message ? ` ${message}` : ' L’intelligence artificielle utilisée est indiquée dans l’application (Générer, Réglages).'}
    </p>
  );
}

export default function LandingPage() {
  const runtime = useOptionalRuntime();
  const mode = runtime?.mode ?? detectMode();
  const isDemo = mode === 'demo';
  // Application Windows : même page d'accueil, sans connexion ni téléchargement (l'application est déjà installée).
  const isLocal = mode === 'local';
  // Application Windows : IA de cet ordinateur déjà prête ? (null ailleurs : aucun pont, aucune vérification)
  const localAIReady = useAIStatus()?.status?.ready === true;

  const heroNote = (
    <>
      {isLocal ? (
        <p className="mt-4 text-sm text-mg-200 max-w-md mx-auto">
          {localAIReady
            ? 'Magistra est installée sur cet ordinateur : son IA y fonctionne, gratuitement, même sans Internet.'
            : 'Magistra est installée sur cet ordinateur : l’IA s’active en un clic depuis votre tableau de bord, puis fonctionne ici, gratuitement, même sans Internet.'}
        </p>
      ) : (
        <p className="mt-4 text-sm">
          <a href={WINDOWS_SECTION_HREF} className="inline-flex items-center gap-1.5 text-accent hover:underline underline-offset-4">
            <Download size={14} aria-hidden="true" /> Télécharger pour Windows
          </a>
          <span className="text-mg-300"> · IA locale gratuite, sans compte</span>
        </p>
      )}

      {isDemo && (
        <p className="text-xs text-mg-300 mt-6 max-w-md mx-auto" role="note">
          Vous êtes sur la démonstration : les contenus sont des exemples pré-rédigés, aucune IA n’est utilisée,
          et vos données restent dans ce navigateur.
        </p>
      )}
      {mode === 'personal' && <PersonalNote />}
    </>
  );

  return (
    <LandingContent
      navAction={<AccessButton size="nav" />}
      heroAction={<AccessButton size="hero" />}
      heroNote={heroNote}
      windowsSection={isLocal ? undefined : <WindowsDownloadSection variant="landing" mode={mode} />}
      finalAction={<AccessButton size="hero" signedOutLabel="Accéder à Magistra" />}
      windowsLinks={!isLocal}
    />
  );
}
