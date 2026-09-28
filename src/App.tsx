import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ClerkFailed, ClerkLoaded, ClerkLoading, ClerkProvider, RedirectToSignIn, useAuth } from '@clerk/react';
import ErrorBoundary from '@/components/ErrorBoundary';
import { AuthUnavailable, FullPageSpinner, ProfileGuard, LocalSetupGuard } from '@/components/guards';
import { CLERK_PUBLISHABLE_KEY, detectMode } from '@/lib/runtime/context';
import { DemoRuntimeProvider, LocalRuntimeProvider, WebRuntimeProvider } from '@/lib/runtime/RuntimeProvider';

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

const mode = detectMode();

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
function Protected({ children }: { children: ReactNode }) {
  if (mode === 'web') return <WebAuthGuard>{children}</WebAuthGuard>;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
      <Routes>
        <Route path="/" element={mode === 'local' ? <Navigate to="/app" replace /> : <LandingPage />} />
        {mode === 'local' && <Route path="/setup" element={<SetupPage />} />}
        <Route path="/onboarding" element={<Protected><OnboardingPage /></Protected>} />
        <Route
          path="/app"
          element={
            <Protected>
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

export default function App() {
  const routes = (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );

  if (mode === 'local') {
    return (
      <ErrorBoundary>
        <LocalRuntimeProvider>{routes}</LocalRuntimeProvider>
      </ErrorBoundary>
    );
  }

  if (mode === 'demo' || !CLERK_PUBLISHABLE_KEY) {
    return (
      <ErrorBoundary>
        <DemoRuntimeProvider>{routes}</DemoRuntimeProvider>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <ClerkProvider
        publishableKey={CLERK_PUBLISHABLE_KEY}
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
