import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Action destructrice : rôle « alertdialog », focus initial sur « Annuler », bouton rouge. */
  danger?: boolean;
  /**
   * Bouton qui reçoit le focus à l'ouverture (défaut : « Annuler » pour une action destructrice, sinon la
   * confirmation). « cancel » : accord qui engage (envoi à un tiers…) — une frappe réflexe d'Entrée ou d'Espace
   * n'y vaut jamais accord.
   */
  initialFocus?: 'confirm' | 'cancel';
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialogue de confirmation modal et accessible :
 * aria-modal, focus piégé, Échap = annuler, clic sur le fond = annuler,
 * focus rendu à l'élément déclencheur à la fermeture.
 */
export default function ConfirmDialog({
  open, title, message, confirmLabel, cancelLabel = 'Annuler', danger = false, initialFocus, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const messageId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusCancel = (initialFocus ?? (danger ? 'cancel' : 'confirm')) === 'cancel';
    (focusCancel ? cancelRef.current : confirmRef.current)?.focus();
    return () => {
      // Rend le focus au déclencheur s'il est toujours présent dans la page.
      if (trigger && trigger.isConnected) trigger.focus();
    };
  }, [open, danger, initialFocus]);

  if (!open || typeof document === 'undefined') return null;

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== 'Tab' || !panelRef.current) return;
    const focusables = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !panelRef.current.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-hidden="true" onClick={onCancel} />
      <div
        ref={panelRef}
        role={danger ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        className="relative w-full max-w-md card p-6 border-white/10 shadow-2xl shadow-black/60 animate-fade-in"
      >
        <div className="flex items-start gap-3 mb-5">
          {danger && (
            <div className="w-9 h-9 rounded-xl bg-danger/10 border border-danger/20 flex items-center justify-center shrink-0">
              <AlertTriangle size={17} className="text-danger" aria-hidden="true" />
            </div>
          )}
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg text-white mb-1.5" style={{ fontFamily: 'var(--font-display)' }}>
              {title}
            </h2>
            <p id={messageId} className="text-sm text-mg-200 leading-relaxed">
              {message}
            </p>
          </div>
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button ref={cancelRef} type="button" onClick={onCancel} className="btn-ghost justify-center text-sm py-2.5 px-4">
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={
              danger
                ? 'inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold bg-danger text-mg-900 hover:brightness-110 transition'
                : 'btn-primary justify-center text-sm py-2.5 px-5'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
