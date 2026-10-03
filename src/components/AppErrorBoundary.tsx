import type { ReactNode } from 'react';
import ErrorBoundary from './ErrorBoundary';

/** Filet de sécurité de l'application : propose aussi de refaire le profil, cause la plus fréquente d'un profil illisible. */
export default function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      extraAction={
        <button
          type="button"
          className="btn-ghost text-sm py-2 px-5"
          onClick={() => {
            window.location.href = '/onboarding?edit=1';
          }}
        >
          Refaire mon profil
        </button>
      }
    >
      {children}
    </ErrorBoundary>
  );
}
