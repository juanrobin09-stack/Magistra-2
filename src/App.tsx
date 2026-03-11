import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ClerkProvider, SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react';
import { dark } from '@clerk/themes';

import LandingPage from './pages/LandingPage';
import OnboardingPage from './pages/OnboardingPage';
import DashboardPage from './pages/DashboardPage';
import GeneratePage from './pages/GeneratePage';
import HistoryPage from './pages/HistoryPage';
import FavoritesPage from './pages/FavoritesPage';
import SettingsPage from './pages/SettingsPage';
import AppLayout from './components/layout/AppLayout';
import { isOnboardingDone } from './hooks/useTeacherProfile';

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut><RedirectToSignIn /></SignedOut>
    </>
  );
}

function AppEntry() {
  // Redirect to onboarding if not completed
  if (!isOnboardingDone()) {
    return <Navigate to="/onboarding" replace />;
  }
  return <AppLayout />;
}

const appRoutes = (
  <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/onboarding" element={<OnboardingPage />} />
    <Route path="/app" element={<AppEntry />}>
      <Route index element={<DashboardPage />} />
      <Route path="generate" element={<GeneratePage />} />
      <Route path="history" element={<HistoryPage />} />
      <Route path="favorites" element={<FavoritesPage />} />
      <Route path="settings" element={<SettingsPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/" />} />
  </Routes>
);

const protectedRoutes = (
  <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/onboarding" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />
    <Route path="/app" element={<ProtectedRoute><AppEntry /></ProtectedRoute>}>
      <Route index element={<DashboardPage />} />
      <Route path="generate" element={<GeneratePage />} />
      <Route path="history" element={<HistoryPage />} />
      <Route path="favorites" element={<FavoritesPage />} />
      <Route path="settings" element={<SettingsPage />} />
    </Route>
    <Route path="*" element={<Navigate to="/" />} />
  </Routes>
);

export default function App() {
  if (!CLERK_KEY) {
    return <BrowserRouter>{appRoutes}</BrowserRouter>;
  }

  return (
    <ClerkProvider
      publishableKey={CLERK_KEY}
      appearance={{
        baseTheme: dark,
        variables: {
          colorPrimary: '#c8b6ff',
          colorBackground: '#111118',
          colorInputBackground: '#1a1a24',
          colorInputText: '#d4d4e4',
          colorText: '#d4d4e4',
          colorTextSecondary: '#7a7a8e',
          borderRadius: '0.75rem',
          fontFamily: '"DM Sans", system-ui, sans-serif',
        },
        elements: {
          card: 'bg-mg-800 border border-white/10 shadow-2xl',
          headerTitle: 'font-display text-white',
          headerSubtitle: 'text-mg-300',
          socialButtonsBlockButton: 'bg-mg-700 border-white/10 text-mg-100 hover:bg-mg-600',
          formButtonPrimary: 'bg-gradient-to-r from-accent-dim to-accent text-mg-900 hover:opacity-90',
          footerActionLink: 'text-accent hover:text-accent-bright',
          identityPreview: 'bg-mg-700 border-white/10',
          formFieldInput: 'bg-mg-700 border-white/10 text-mg-100',
          formFieldLabel: 'text-mg-300',
        },
      }}
    >
      <BrowserRouter>{protectedRoutes}</BrowserRouter>
    </ClerkProvider>
  );
}
