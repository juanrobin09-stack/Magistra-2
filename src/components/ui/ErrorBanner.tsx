import { AlertCircle, RotateCw } from 'lucide-react';

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Désactive le bouton pendant une nouvelle tentative. */
  retrying?: boolean;
  className?: string;
}

/** Erreur visible et actionnable : jamais de spinner infini ni de liste vide trompeuse. */
export default function ErrorBanner({ message, onRetry, retryLabel = 'Réessayer', retrying = false, className = '' }: ErrorBannerProps) {
  return (
    <div role="alert" className={`flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-danger/25 bg-danger/5 px-4 py-3 ${className}`}>
      <div className="flex items-start gap-2.5 flex-1 min-w-0">
        <AlertCircle size={16} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-sm text-mg-100 leading-snug">{message}</p>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="btn-secondary text-xs py-1.5 px-3 self-start sm:self-auto shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RotateCw size={12} aria-hidden="true" className={retrying ? 'animate-spin' : ''} />
          {retryLabel}
        </button>
      )}
    </div>
  );
}
