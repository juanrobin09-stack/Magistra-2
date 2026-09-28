import { CheckCircle2, Circle, HelpCircle, Loader2, XCircle } from 'lucide-react';
import { checkStateText, type SetupCheck } from '@/lib/ai-ui/status';

interface SetupChecklistProps {
  /** Vérifications connues ; null pendant la première vérification. */
  checks: SetupCheck[] | null;
  /** Nombre de vérifications déjà affichées (les suivantes apparaissent « en cours »). */
  revealed: number;
}

const PLACEHOLDERS = ['Moteur IA installé', 'Moteur IA en marche', "Modèles d'IA disponibles", 'Modèle recommandé installé'];

/** Avancement des vérifications automatiques de l'ordinateur. */
export default function SetupChecklist({ checks, revealed }: SetupChecklistProps) {
  const items: SetupCheck[] = checks ?? PLACEHOLDERS.map((label, i) => ({ id: `p${i}`, label, state: 'waiting' }));
  const done = checks !== null && revealed >= items.length;
  return (
    <div className="card">
      <h2 className="text-base font-semibold text-white mb-1">Vérification de votre ordinateur</h2>
      <p className="text-sm text-mg-200 mb-4" role="status" aria-live="polite">
        {done ? 'Vérification terminée.' : 'Magistra vérifie automatiquement ce qui est déjà installé…'}
      </p>
      <ul className="space-y-2.5">
        {items.map((item, i) => {
          const pending = checks === null || i >= revealed;
          return (
            <li key={item.id} className="flex items-start gap-3 text-sm">
              <span className="mt-0.5 shrink-0" aria-hidden="true">
                {pending ? (
                  <Loader2 size={18} className="animate-spin text-accent" />
                ) : item.state === 'ok' ? (
                  <CheckCircle2 size={18} className="text-success" />
                ) : item.state === 'missing' ? (
                  <XCircle size={18} className="text-warning" />
                ) : item.state === 'unknown' ? (
                  <HelpCircle size={18} className="text-warning" />
                ) : (
                  <Circle size={18} className="text-mg-300" />
                )}
              </span>
              <span className="flex-1">
                <span className={pending || item.state === 'waiting' ? 'text-mg-200' : 'text-mg-50'}>{item.label}</span>
                {!pending && item.detail && <span className="text-mg-200"> — {item.detail}</span>}
                <span className="sr-only"> : {pending ? 'vérification en cours' : checkStateText(item.state)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
