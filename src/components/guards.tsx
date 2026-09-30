import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useRuntime } from '@/lib/runtime/context';
import { PersonalAccessScreen } from './PersonalAccess';

// Chargé seulement sur le site web (dépend de Clerk, absent de l'application Windows et de la démo).
const WebSignOutButton = lazy(() => import('./WebSignOutButton'));

export function FullPageSpinner({ label = 'Chargement…' }: { label?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-mg-900" role="status" aria-live="polite">
      <div className="flex items-center gap-3 text-mg-200 text-sm">
        <Loader2 size={20} className="animate-spin text-accent" aria-hidden="true" />
        {label}
      </div>
    </div>
  );
}

/**
 * Site web : le service de connexion n'a pas pu être chargé (hors ligne, bloqueur de contenu, panne).
 * Sans ce repli, la page resterait indéfiniment sur « Connexion… ».
 */
export function AuthUnavailable() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-mg-900 px-6" role="alert">
      <div className="card max-w-md text-center p-8">
        <p className="text-white mb-2 font-semibold">Le service de connexion est indisponible.</p>
        <p className="text-sm text-mg-200 mb-5">
          Vérifiez votre connexion Internet (ou désactivez le bloqueur de contenu pour ce site), puis réessayez.
        </p>
        <button type="button" className="btn-primary text-sm py-2 px-5" onClick={() => window.location.reload()}>
          Réessayer
        </button>
      </div>
    </div>
  );
}

/** Exige un profil enseignant (sinon : onboarding). Le profil appartient au compte / à l'ordinateur courant. */
export function ProfileGuard({ children }: { children: ReactNode }) {
  const { mode, profile, profileStatus, profileError, reloadProfile } = useRuntime();
  if (profileStatus === 'loading') return <FullPageSpinner label="Chargement de votre profil…" />;
  if (profileStatus === 'error') {
    // Mode personnel : code d'accès absent ou refusé → écran de saisie du code (pas de « session expirée »).
    if (mode === 'personal' && profileError?.code === 'UNAUTHENTICATED') return <PersonalAccessScreen rejected />;
    // Cause réelle (session expirée, serveur indisponible, stockage illisible…), sans détail technique.
    const sessionExpired = profileError?.code === 'UNAUTHENTICATED' || profileError?.code === 'FORBIDDEN';
    const detail = profileError && profileError.code !== 'INTERNAL' ? profileError.message : 'Réessayez dans quelques instants.';
    return (
      <div className="min-h-screen flex items-center justify-center bg-mg-900 px-6" role="alert">
        <div className="card max-w-md text-center p-8">
          <p className="text-white mb-2 font-semibold">Impossible de charger votre profil.</p>
          <p className="text-sm text-mg-200 mb-5">{detail}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className="btn-primary text-sm py-2 px-5" onClick={() => void reloadProfile()}>
              Réessayer
            </button>
            {mode === 'web' && (
              <Suspense fallback={null}>
                <WebSignOutButton label={sessionExpired ? 'Se reconnecter' : 'Se déconnecter'} />
              </Suspense>
            )}
          </div>
        </div>
      </div>
    );
  }
  if (!profile) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}
