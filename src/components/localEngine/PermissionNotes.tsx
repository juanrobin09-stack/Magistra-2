// Autorisation « applications de cet appareil » du navigateur : l'expliquer AVANT que le navigateur ne la demande,
// et dire comment l'accorder quand elle a été refusée. Jamais de contournement : c'est l'enseignant qui décide.

import { useEffect, useId, useRef } from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { FOCUS_RING } from '@/components/generate/fieldUtils';
import {
  CANCEL_LABEL, CONTINUE_LABEL, PERMISSION_DENIED_INTRO, PERMISSION_DENIED_STEPS, PERMISSION_EXPLANATION,
} from './texts';

interface PermissionExplainerProps {
  /** Bouton principal (« Continuer », « Rechercher Magistra… »). */
  actionLabel?: string;
  onContinue(): void;
  /** Absent : pas de bouton « Annuler » (l'explication est l'état lui-même). */
  onCancel?(): void;
  /** Place le focus sur le bouton principal à l'affichage (explication apparue après un clic). */
  autoFocus?: boolean;
}

/**
 * Explication montrée avant la demande d'autorisation du navigateur. Elle DÉCRIT le groupe et le bouton principal
 * (aria-describedby) : un lecteur d'écran la lit quand le focus arrive sur « Continuer », avant la demande.
 */
export function PermissionExplainer({ actionLabel = CONTINUE_LABEL, onContinue, onCancel, autoFocus = false }: PermissionExplainerProps) {
  const continueRef = useRef<HTMLButtonElement>(null);
  const explanationId = useId();
  useEffect(() => {
    if (autoFocus) continueRef.current?.focus();
  }, [autoFocus]);
  return (
    <div role="group" aria-label="Autorisation du navigateur" aria-describedby={explanationId} className="rounded-xl border border-accent/20 bg-accent/5 p-3.5 space-y-3">
      <p className="flex items-start gap-2 text-sm text-mg-100 leading-relaxed">
        <ShieldCheck size={16} className="text-accent shrink-0 mt-0.5" aria-hidden="true" />
        <span id={explanationId}>{PERMISSION_EXPLANATION}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <button ref={continueRef} type="button" onClick={onContinue} aria-describedby={explanationId} className={`btn-primary text-sm py-2 px-4 ${FOCUS_RING}`}>
          {actionLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={`btn-ghost text-sm py-2 px-3 ${FOCUS_RING}`}>
            {CANCEL_LABEL}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Autorisation refusée : où la rétablir, sans jargon (aucune adresse, aucun réglage technique). Le titre (« Votre
 * navigateur bloque… ») est la ligne d'état qui précède.
 */
export function PermissionDeniedHelp() {
  return (
    <div className="rounded-xl border border-warning/25 bg-warning/5 p-3.5 text-sm text-mg-100 space-y-1.5">
      <p className="flex items-start gap-2 font-medium text-mg-50">
        <ShieldAlert size={16} className="text-warning shrink-0 mt-0.5" aria-hidden="true" />
        <span>{PERMISSION_DENIED_INTRO}</span>
      </p>
      <ol className="list-decimal pl-5 space-y-0.5 text-mg-200">
        {PERMISSION_DENIED_STEPS.map(step => <li key={step}>{step}</li>)}
      </ol>
      <p className="text-xs text-mg-200">
        Cette autorisation permet uniquement à ce site de dialoguer avec l’application Magistra installée sur cet ordinateur.
      </p>
    </div>
  );
}
