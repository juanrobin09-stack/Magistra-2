// Briques de formulaire accessibles (libellés associés, erreurs annoncées, choix avec aria-pressed).

import type { ReactNode } from 'react';
import { FOCUS_RING, LABEL_CLASS, fieldIds } from './fieldUtils';

interface FieldProps {
  id: string;
  label: ReactNode;
  optional?: boolean;
  hint?: ReactNode;
  error?: string | null;
  /** Élément non « labelable » (groupe de boutons) : le libellé devient un simple titre référencé par id. */
  asGroup?: boolean;
  children: ReactNode;
  className?: string;
}

/** Champ avec libellé associé (htmlFor/id), aide et message d'erreur reliés via aria-describedby. */
export function Field({ id, label, optional, hint, error, asGroup, children, className = '' }: FieldProps) {
  const ids = fieldIds(id);
  const labelContent = (
    <>
      {label}
      {optional && <span className="ml-1 normal-case tracking-normal font-normal text-mg-300">(facultatif)</span>}
    </>
  );
  return (
    <div className={className}>
      {asGroup ? (
        <p id={ids.label} className={LABEL_CLASS}>{labelContent}</p>
      ) : (
        <label id={ids.label} htmlFor={id} className={LABEL_CLASS}>{labelContent}</label>
      )}
      {children}
      {hint && <p id={ids.hint} className="text-xs text-mg-300 mt-1.5 leading-relaxed">{hint}</p>}
      {error && (
        <p id={ids.error} className="text-xs text-warning mt-1.5">
          {error}
        </p>
      )}
    </div>
  );
}

interface ChoiceButtonProps {
  pressed: boolean;
  onClick(): void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
}

/** Bouton de choix (bascule) : état annoncé par aria-pressed. */
export function ChoiceButton({ pressed, onClick, children, className = '', disabled, ariaLabel, title }: ChoiceButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg text-sm border transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS_RING} ${
        pressed
          ? 'bg-accent/10 text-white border-accent/40'
          : 'bg-mg-700 text-mg-200 border-white/5 hover:border-white/15 hover:text-mg-100'
      } ${className}`}
    >
      {children}
    </button>
  );
}
