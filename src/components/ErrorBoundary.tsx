import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  hasError: boolean;
}

/** Dernier filet de sécurité : jamais d'écran blanc, jamais de trace technique affichée. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[magistra] Erreur d’affichage', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div role="alert" className="min-h-screen flex items-center justify-center bg-mg-900 px-6">
        <div className="card max-w-md text-center p-8">
          <h1 className="text-2xl text-white mb-3" style={{ fontFamily: 'var(--font-display)' }}>
            Un problème d’affichage est survenu
          </h1>
          <p className="text-sm text-mg-200 mb-6">
            Vos données ne sont pas perdues. Rechargez la page pour continuer.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <button type="button" className="btn-primary text-sm py-2 px-5" onClick={() => window.location.reload()}>
              Recharger
            </button>
            <button
              type="button"
              className="btn-secondary text-sm py-2 px-5"
              onClick={() => {
                window.location.href = '/';
              }}
            >
              Revenir à l’accueil
            </button>
            <button
              type="button"
              className="btn-ghost text-sm py-2 px-5"
              onClick={() => {
                // Un profil illisible est la cause la plus fréquente : il peut être ressaisi.
                window.location.href = '/onboarding?edit=1';
              }}
            >
              Refaire mon profil
            </button>
          </div>
        </div>
      </div>
    );
  }
}
