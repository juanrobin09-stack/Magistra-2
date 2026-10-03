// Explication « une fenêtre Ollama peut s'ouvrir : fermez-la » (application Windows), affichée aux moments où elle est
// vraie : avant le clic sur « Activer l'IA », pendant le téléchargement, l'installation et le démarrage du moteur, puis
// une fois le moteur installé (la fenêtre a pu rester ouverte). Quand l'enseignant lance lui-même l'installateur (page
// officielle), la note distingue l'installateur, à terminer d'abord, et la fenêtre de l'application, à fermer ensuite.
// Les textes sont uniques (localEngine/texts.ts) ; la décision d'afficher la note (Windows, installation sur cet
// ordinateur) est engineWindowMayOpen (lib/ai-ui/activation.ts).
// Une simple note dans la page (role="note") : toujours là tant que l'étape dure, lue avec le reste par les lecteurs
// d'écran ; ni message qui disparaît, ni focus déplacé, ni blocage de l'interface.

import { Info } from 'lucide-react';
import { ENGINE_WINDOW_DONE_NOTE, ENGINE_WINDOW_MANUAL_NOTE, ENGINE_WINDOW_NOTE } from '@/components/localEngine/texts';

/**
 * « install » : avant et pendant l'installation (ou la mise à jour) du moteur par Magistra ; « manual » : installateur
 * lancé par l'enseignant depuis la page officielle ; « done » : moteur installé, la fenêtre a pu rester ouverte.
 */
export type EngineWindowMoment = 'install' | 'manual' | 'done';

const NOTES: Record<EngineWindowMoment, string> = {
  install: ENGINE_WINDOW_NOTE,
  manual: ENGINE_WINDOW_MANUAL_NOTE,
  done: ENGINE_WINDOW_DONE_NOTE,
};

export default function EngineWindowNote({ moment, className = '' }: { moment: EngineWindowMoment; className?: string }) {
  return (
    <p
      role="note"
      data-testid="engine-window-note"
      data-moment={moment}
      className={`flex items-start gap-2 rounded-xl border border-white/10 bg-mg-700/40 px-3 py-2 text-sm text-mg-100 ${className}`.trim()}
    >
      <Info size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
      <span>{NOTES[moment]}</span>
    </p>
  );
}
