// Sources de recherche : 4 modes, avec ce qui est réellement disponible ici.

import { Globe, GraduationCap, FolderOpen, Layers } from 'lucide-react';
import type { ResearchMode } from '@shared/types';
import { DOCUMENTS_IGNORED_NOTE, type ResearchHints, type ResearchOption } from '@/lib/generation/research';
import { FOCUS_RING } from './fieldUtils';

interface ResearchModePickerProps {
  options: ResearchOption[];
  value: ResearchMode;
  onChange(mode: ResearchMode): void;
  hints: ResearchHints;
}

const ICONS: Record<ResearchMode, typeof Globe> = {
  documents: FolderOpen,
  academic: GraduationCap,
  internet: Globe,
  documents_internet: Layers,
};

export default function ResearchModePicker({ options, value, onChange, hints }: ResearchModePickerProps) {
  return (
    <div className="mt-6 pt-5 border-t border-white/6">
      <h3 id="gen-research-title" className="text-xs font-semibold text-mg-200 uppercase tracking-widest mb-3">
        Sources de recherche
      </h3>
      <div role="group" aria-labelledby="gen-research-title" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {options.map(o => {
          const Icon = ICONS[o.value];
          const active = o.value === value;
          const showNote = Boolean(o.note && (active || !o.available));
          const noteId = showNote ? `gen-research-note-${o.value}` : undefined;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              aria-describedby={noteId}
              disabled={!o.available}
              onClick={() => onChange(o.value)}
              className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-colors disabled:cursor-not-allowed ${FOCUS_RING} ${
                active
                  ? 'bg-accent/10 border-accent/50 ring-1 ring-accent/30'
                  : o.available
                    ? 'bg-mg-700 border-white/5 hover:border-white/15'
                    : 'bg-mg-900/40 border-white/5 opacity-70'
              }`}
            >
              <Icon size={16} aria-hidden="true" className={`mt-0.5 shrink-0 ${active ? 'text-accent' : 'text-mg-200'}`} />
              <span className="min-w-0">
                <span className={`block text-sm font-medium ${active ? 'text-white' : 'text-mg-100'}`}>{o.label}</span>
                <span className="block text-xs text-mg-200 leading-snug mt-0.5">{o.description}</span>
                {showNote && (
                  <span id={noteId} className={`block text-xs leading-snug mt-1 ${o.available ? 'text-accent-bright' : 'text-warning'}`}>
                    {o.note}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div aria-live="polite" className="space-y-2 mt-3">
        {hints.documentsIgnored && (
          <p className="text-xs text-warning">{DOCUMENTS_IGNORED_NOTE}</p>
        )}
        {hints.suggestAcademic && (
          <p className="text-xs text-mg-200 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Sans document, appuyez le contenu sur des publications vérifiables :</span>
            <button
              type="button"
              onClick={() => onChange('academic')}
              className={`text-accent hover:underline rounded ${FOCUS_RING}`}
            >
              choisir « Sources académiques »
            </button>
          </p>
        )}
        {hints.modelOnly && !hints.suggestAcademic && (
          <p className="text-xs text-mg-300">
            Sans document ni recherche, Magistra s'appuie uniquement sur les connaissances du modèle : vérifiez les faits avant diffusion.
          </p>
        )}
      </div>
    </div>
  );
}
