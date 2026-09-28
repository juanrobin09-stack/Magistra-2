// Confidentialité : ce qui est vrai pour le mode d'exécution et la recherche choisie.

import { ShieldCheck } from 'lucide-react';
import type { PrivacyNotes } from '@/lib/generation/research';

export default function PrivacyNotice({ notes }: { notes: PrivacyNotes }) {
  if (!notes.message && !notes.network && !notes.local) return null;
  return (
    <div role="note" aria-label="Confidentialité" className="flex items-start gap-3 p-4 rounded-xl bg-mg-800/60 border border-white/6">
      <ShieldCheck size={16} className="text-accent shrink-0 mt-0.5" aria-hidden="true" />
      <div className="space-y-1.5 text-xs text-mg-200 leading-relaxed min-w-0">
        {notes.message && <p>{notes.message}</p>}
        {notes.local && <p className="text-success">{notes.local}</p>}
        {notes.network && <p>{notes.network}</p>}
      </div>
    </div>
  );
}
