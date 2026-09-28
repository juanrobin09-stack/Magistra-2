import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import type { ToastState } from './useToast';

interface ToastProps {
  toast: ToastState | null;
  onDismiss: () => void;
}

const DURATION: Record<ToastState['tone'], number> = { success: 3500, info: 4500, error: 8000 };

/**
 * Notification éphémère (en bas de l'écran).
 * Les erreurs sont annoncées immédiatement (role="alert"), les confirmations poliment (role="status").
 */
export default function Toast({ toast, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onDismiss, DURATION[toast.tone]);
    return () => window.clearTimeout(timer);
  }, [toast, onDismiss]);

  const card = toast && (
    <div
      key={toast.id}
      className={`pointer-events-auto flex items-start gap-3 max-w-sm rounded-xl border px-4 py-3 shadow-2xl shadow-black/50 bg-mg-700 animate-fade-in ${
        toast.tone === 'error' ? 'border-danger/30' : toast.tone === 'success' ? 'border-success/25' : 'border-accent/20'
      }`}
    >
      {toast.tone === 'error' ? (
        <AlertCircle size={17} className="text-danger shrink-0 mt-0.5" aria-hidden="true" />
      ) : toast.tone === 'success' ? (
        <CheckCircle2 size={17} className="text-success shrink-0 mt-0.5" aria-hidden="true" />
      ) : (
        <Info size={17} className="text-accent shrink-0 mt-0.5" aria-hidden="true" />
      )}
      <p className="text-sm text-mg-100 leading-snug flex-1">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Fermer la notification"
        className="text-mg-300 hover:text-white transition-colors shrink-0 -mr-1 p-0.5 rounded"
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );

  // Les régions live existent en permanence pour que les lecteurs d'écran annoncent les nouveaux messages.
  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 z-[90] flex justify-center sm:justify-end pointer-events-none">
      <div role="status" aria-live="polite">{toast && toast.tone !== 'error' ? card : null}</div>
      <div role="alert">{toast && toast.tone === 'error' ? card : null}</div>
    </div>
  );
}
