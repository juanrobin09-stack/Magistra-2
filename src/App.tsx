import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ClerkFailed, ClerkLoaded, ClerkLoading, ClerkProvider, RedirectToSignIn, useAuth } from '@clerk/react';
import AppIntro from '@/components/AppIntro';
import ErrorBoundary from '@/components/ErrorBoundary';
import { AuthUnavailable, FullPageSpinner, ProfileGuard } from '@/components/guards';
import { PersonalAccessGate } from '@/components/PersonalAccess';
import ProfileCacheCleaner from '@/components/ProfileCacheCleaner';
import { useAIStatus } from '@/hooks/useAIStatus';
import { useRuntime } from '@/lib/runtime/context';
import { getRuntimeConfig, type RuntimeConfig } from '@/lib/runtime/mode';
import {
  DemoRuntimeProvider, LocalRuntimeProvider, PersonalRuntimeProvider, WebRuntimeProvider,
} from '@/lib/runtime/RuntimeProvider';
import type { RuntimeMode } from '@/lib/runtime/types';

// Chargement différé : la page d'accueil ne télécharge ni l'éditeur, ni l'export PDF, ni pdf.js.
const LandingPage = lazy(() => import('@/pages/LandingPage'));
const OnboardingPage = lazy(() => import('@/pages/OnboardingPage'));
const SetupPage = lazy(() => import('@/pages/SetupPage'));
const AppLayout = lazy(() => import('@/components/layout/AppLayout'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const GeneratePage = lazy(() => import('@/pages/GeneratePage'));
const HistoryPage = lazy(() => import('@/pages/HistoryPage'));
const FavoritesPage = lazy(() => import('@/pages/FavoritesPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const LegalPage = lazy(() => import('@/pages/LegalPage'));

function SignedInGate({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <FullPageSpinner label="Connexion…" />;
  if (!isSignedIn) return <RedirectToSignIn />;
  return <>{children}</>;
}

/** Site web : connexion obligatoire ; message explicite si le service de connexion ne se charge pas. */
function WebAuthGuard({ children }: { children: ReactNode }) {
  return (
    <>
      <ClerkLoading><FullPageSpinner label="Connexion…" /></ClerkLoading>
      <ClerkFailed><AuthUnavailable /></ClerkFailed>
      <ClerkLoaded><SignedInGate>{children}</SignedInGate></ClerkLoaded>
    </>
  );
}

/** Protection des pages de l'application selon le mode d'exécution. */
function Protected({ mode, children }: { mode: RuntimeMode; children: ReactNode }) {
  if (mode === 'web') return <WebAuthGuard>{children}</WebAuthGuard>;
  // Mode personnel : code d'accès affiché dans le terminal (aucun compte, aucun service de connexion en ligne).
  if (mode === 'personal') return <PersonalAccessGate>{children}</PersonalAccessGate>;
  return <>{children}</>;
}

/**
 * Application Windows, page d'ouverture : au premier lancement (aucun profil), la page d'accueil de Magistra — la même
 * que celle du site, adaptée à l'application — puis « Commencer » → création du profil ; ensuite, le tableau de bord.
 * Aucun assistant n'est imposé : l'IA s'active en un clic depuis le tableau de bord ou la page Générer.
 */
function LocalHome() {
  const { profile, profileStatus } = useRuntime();
  if (profileStatus === 'loading') return <FullPageSpinner />;
  // Profil illisible : ProfileGuard (espace) affiche la vraie cause et « Réessayer ».
  if (profile || profileStatus === 'error') return <Navigate to="/app" replace />;
  return <LandingPage />;
}

/**
 * Application Windows : reprise, au lancement, de l'activation de l'IA demandée lors d'une session précédente —
 * seulement une fois le profil chargé. Sans profil (premier lancement, données effacées), l'enseignant est sur la page
 * d'accueil ou la création du profil, sans barre latérale ni carte d'activation : plusieurs Go ne se téléchargent
 * jamais sans progression visible ni « Annuler » ; la reprise attend le tableau de bord.
 */
function ResumeAIActivation() {
  const ai = useAIStatus();
  const { profile, profileStatus } = useRuntime();
  const available = ai !== null && profileStatus === 'ready' && profile !== null;
  const resume = ai?.resumeActivation;
  useEffect(() => {
    if (available && resume) void resume();
  }, [available, resume]);
  return null;
}

function AppRoutes({ mode }: { mode: RuntimeMode }) {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/" element={mode === 'local' ? <LocalHome /> : <LandingPage />} />
        {/* Application Windows : la présentation de Magistra reste accessible (lien « Présentation » de la barre latérale). */}
        {mode === 'local' && <Route path="/presentation" element={<LandingPage />} />}
        {mode === 'local' && <Route path="/setup" element={<SetupPage />} />}
        {/* Pages légales : publiques (aucune connexion), dans tous les modes. */}
        <Route path="/mentions-legales" element={<LegalPage page="mentions" />} />
        <Route path="/confidentialite" element={<LegalPage page="confidentialite" />} />
        <Route path="/cgu" element={<LegalPage page="cgu" />} />
        <Route path="/onboarding" element={<Protected mode={mode}><OnboardingPage /></Protected>} />
        <Route
          path="/app"
          element={
            <Protected mode={mode}>
              <ProfileGuard>
                <AppLayout />
              </ProfileGuard>
            </Protected>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="generate" element={<GeneratePage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="favorites" element={<FavoritesPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

/**
 * `config` : mode découvert au démarrage (main.tsx, GET /api/mode). Par défaut : détection statique
 * (pont Electron, clé Clerk du build).
 */
export default function App({ config = getRuntimeConfig() }: { config?: RuntimeConfig }) {
  const { mode, clerkPublishableKey } = config;
  const routes = (
    <BrowserRouter>
      <AppRoutes mode={mode} />
    </BrowserRouter>
  );

  if (mode === 'local') {
    return (
      <ErrorBoundary>
        <LocalRuntimeProvider>
          {routes}
          <ResumeAIActivation />
          {/* Animation d'ouverture « Magistra », au-dessus de la première page (chargée en dessous pendant ce temps). */}
          <AppIntro />
        </LocalRuntimeProvider>
      </ErrorBoundary>
    );
  }

  if (mode === 'personal') {
    return (
      <ErrorBoundary>
        <PersonalRuntimeProvider>{routes}</PersonalRuntimeProvider>
      </ErrorBoundary>
    );
  }

  if (mode === 'demo' || !clerkPublishableKey) {
    return (
      <ErrorBoundary>
        <DemoRuntimeProvider>{routes}</DemoRuntimeProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <ClerkProvider
        publishableKey={clerkPublishableKey}
        appearance={{
          variables: {
            colorPrimary: '#c8b6ff',
            colorPrimaryForeground: '#0a0a0f',
            colorBackground: '#111118',
            colorForeground: '#d4d4e4',
            colorMutedForeground: '#a8a8be',
            colorInput: '#1a1a24',
            colorInputForeground: '#d4d4e4',
            colorNeutral: '#d4d4e4',
            borderRadius: '0.75rem',
            fontFamily: '"DM Sans", system-ui, sans-serif',
          },
        }}
      >
        {/* Déconnexion (UserButton ou bouton) : la copie hors ligne du profil est effacée du navigateur. */}
        <ProfileCacheCleaner />
        <WebRuntimeProvider>{routes}</WebRuntimeProvider>
      </ClerkProvider>
    </ErrorBoundary>
  );
}
