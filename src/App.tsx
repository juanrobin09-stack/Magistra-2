import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ClerkFailed, ClerkLoaded, ClerkLoading, ClerkProvider, RedirectToSignIn, useAuth } from '@clerk/react';
import ErrorBoundary from '@/components/ErrorBoundary';
import { AuthUnavailable, FullPageSpinner, ProfileGuard, LocalSetupGuard } from '@/components/guards';
import { PersonalAccessGate } from '@/components/PersonalAccess';
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

function AppRoutes({ mode }: { mode: RuntimeMode }) {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/" element={mode === 'local' ? <Navigate to="/app" replace /> : <LandingPage />} />
        {mode === 'local' && <Route path="/setup" element={<SetupPage />} />}
        <Route path="/onboarding" element={<Protected mode={mode}><OnboardingPage /></Protected>} />
        <Route
          path="/app"
          element={
            <Protected mode={mode}>
              <LocalSetupGuard enabled={mode === 'local'}>
                <ProfileGuard>
                  <AppLayout />
                </ProfileGuard>
              </LocalSetupGuard>
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
        <LocalRuntimeProvider>{routes}</LocalRuntimeProvider>
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
        <WebRuntimeProvider>{routes}</WebRuntimeProvider>
      </ClerkProvider>
    </ErrorBoundary>
  );
}
