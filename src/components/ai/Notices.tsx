import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

/** Erreur claire, annoncée aux lecteurs d'écran (role="alert"). */
export function ErrorBox({ title, message, children }: { title: string; message?: string; children?: ReactNode }) {
  return (
    <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold text-danger">
        <AlertTriangle size={16} aria-hidden="true" /> {title}
      </p>
      {message && <p className="mt-1 text-mg-50">{message}</p>}
      {children}
    </div>
  );
}

/** Avertissement non bloquant. */
export function WarningNote({ children }: { children: ReactNode }) {
  return (
    <p role="note" className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** Confirmation d'une action réussie (role="status"). */
export function SuccessNote({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-success">
      <CheckCircle2 size={16} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
