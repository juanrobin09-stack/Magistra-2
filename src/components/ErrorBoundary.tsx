import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  hasError: boolean;
}

interface Props {
  children: ReactNode;
  /** Action supplémentaire à côté de « Recharger » et « Revenir à l'accueil » (AppErrorBoundary : « Refaire mon profil »). */
  extraAction?: ReactNode;
}

/** Dernier filet de sécurité : jamais d'écran blanc, jamais de trace technique affichée. */
export default class ErrorBoundary extends Component<Props, State> {
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
            {this.props.extraAction}
          </div>
        </div>
      </div>
    );
  }
}
