// Confidentialité : ce qui est vrai pour le mode d'exécution, l'IA réellement utilisée et la recherche choisie.

import { ExternalLink, ShieldCheck, Send } from 'lucide-react';
import type { PrivacyNotes } from '@/lib/generation/research';

export default function PrivacyNotice({ notes }: { notes: PrivacyNotes }) {
  if (!notes.message && !notes.network && !notes.local) return null;
  // Prestataire tiers : annonce mise en avant (les textes quittent le serveur Magistra).
  const Icon = notes.thirdParty ? Send : ShieldCheck;
  const frame = notes.thirdParty ? 'bg-accent/5 border-accent/20' : 'bg-mg-800/60 border-white/6';
  return (
    <div role="note" aria-label="Confidentialité" className={`flex items-start gap-3 p-4 rounded-xl border ${frame}`}>
      <Icon size={16} className="text-accent shrink-0 mt-0.5" aria-hidden="true" />
      <div className="space-y-1.5 text-xs text-mg-200 leading-relaxed min-w-0">
        {notes.message && <p className={notes.thirdParty ? 'text-mg-50' : undefined}>{notes.message}</p>}
        {notes.providerUrl && (
          <p>
            <a
              href={notes.providerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-accent hover:underline underline-offset-2"
            >
              Engagements annoncés par le prestataire <ExternalLink size={11} aria-hidden="true" />
            </a>
          </p>
        )}
        {notes.local && <p className="text-success">{notes.local}</p>}
        {notes.network && <p>{notes.network}</p>}
      </div>
    </div>
  );
}
