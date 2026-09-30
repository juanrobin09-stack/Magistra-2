// Briques de formulaire accessibles (libellés associés, erreurs annoncées, choix avec aria-pressed).

import { Fragment, type ReactNode } from 'react';
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
  /** Alignement du texte (à gauche par défaut) : jamais dans `className`, où deux alignements se contrediraient. */
  align?: 'left' | 'center';
}

/** Bouton de choix (bascule) : état annoncé par aria-pressed. */
export function ChoiceButton({ pressed, onClick, children, className = '', disabled, ariaLabel, title, align = 'left' }: ChoiceButtonProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg text-sm border transition-all ${align === 'center' ? 'text-center' : 'text-left'} disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS_RING} ${
        pressed
          ? 'bg-accent/10 text-white border-accent/40'
          : 'bg-mg-700 text-mg-200 border-white/5 hover:border-white/15 hover:text-mg-100'
      } ${className}`}
    >
      {children}
    </button>
  );
}

export interface ChipOption<T extends string | number> {
  value: T;
  label: string;
  /** Info-bulle (description courte du choix). */
  title?: string;
}

interface ChipGroupProps<T extends string | number> {
  id: string;
  label: ReactNode;
  options: readonly ChipOption<T>[];
  /** Choix unique : la valeur choisie. */
  value?: T;
  onChange?(value: T): void;
  /** Choix multiple : les valeurs cochées (chaque puce bascule). */
  values?: readonly T[];
  onToggle?(value: T): void;
  hint?: ReactNode;
  className?: string;
  /** Légende pleine largeur insérée avant cette option (ex. « Formats généraux » après ceux de la discipline). */
  captionBefore?: { value: T; text: string };
}

/**
 * Groupe de puces (role="group", titre relié) : un choix unique (`value`/`onChange`) ou multiple (`values`/`onToggle`).
 * Chaque puce annonce son état par aria-pressed ; l'info-bulle décrit le choix.
 */
export function ChipGroup<T extends string | number>({ id, label, options, value, onChange, values, onToggle, hint, className = '', captionBefore }: ChipGroupProps<T>) {
  const ids = fieldIds(id);
  return (
    <div role="group" aria-labelledby={ids.label} aria-describedby={hint ? ids.hint : undefined} className={className}>
      <p id={ids.label} className={LABEL_CLASS}>{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map(option => {
          const pressed = values ? values.includes(option.value) : value === option.value;
          return (
            <Fragment key={String(option.value)}>
              {captionBefore && captionBefore.value === option.value && (
                <span className="basis-full mt-1.5 text-[11px] font-medium text-mg-300">{captionBefore.text}</span>
              )}
              <ChoiceButton
                pressed={pressed}
                onClick={() => (values ? onToggle?.(option.value) : onChange?.(option.value))}
                title={option.title}
                className="px-2.5 py-1.5 text-[13px] leading-snug"
              >
                {option.label}
              </ChoiceButton>
            </Fragment>
          );
        })}
      </div>
      {hint && <p id={ids.hint} className="text-xs text-mg-300 mt-1.5 leading-relaxed">{hint}</p>}
    </div>
  );
}
