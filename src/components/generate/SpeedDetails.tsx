// Vitesse d'une génération faite par le moteur de cet ordinateur : durée, puis détails repliés (chargement du modèle,
// lecture de la demande, rédaction, carte graphique ou processeur). Affichage de la session seulement : rien n'est
// enregistré dans l'historique ni envoyé ailleurs. Sans mesures du moteur (serveur distant, exemple, ancienne
// application), le composant n'affiche rien.

import { Gauge } from 'lucide-react';
import { speedView } from '@/lib/generation/speed';
import type { GenerationMetrics } from '@shared/types';
import { FOCUS_RING } from './fieldUtils';

interface SpeedDetailsProps {
  metrics?: GenerationMetrics;
}

export default function SpeedDetails({ metrics }: SpeedDetailsProps) {
  const view = speedView(metrics);
  if (!view) return null;
  return (
    <div className="mt-4 text-xs text-mg-200" data-testid="speed-details">
      {(view.headline || view.firstWord) && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Gauge size={13} className="shrink-0 text-mg-300" aria-hidden="true" />
          {view.headline && <span>{view.headline}</span>}
          {view.headline && view.firstWord && <span aria-hidden="true">·</span>}
          {view.firstWord && <span>{view.firstWord}</span>}
        </p>
      )}
      {(view.rows.length > 0 || view.explanation) && (
        <details className="group mt-2 rounded-xl border border-white/8 bg-white/[0.02]">
          <summary className={`cursor-pointer list-none px-3 py-2 rounded-xl [&::-webkit-details-marker]:hidden ${FOCUS_RING}`}>
            <span className="text-accent group-open:hidden" aria-hidden="true">▸</span>
            <span className="text-accent hidden group-open:inline" aria-hidden="true">▾</span> Détails de vitesse
          </summary>
          <div className="px-3 pb-3 space-y-2">
            {view.rows.length > 0 && (
              <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
                {view.rows.map(row => (
                  <div key={row.label} className="contents">
                    <dt className="text-mg-300">{row.label}</dt>
                    <dd className="min-w-0 text-mg-100 [overflow-wrap:anywhere] mb-1 sm:mb-0">{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {view.explanation && <p className="text-mg-200 leading-relaxed">{view.explanation}</p>}
          </div>
        </details>
      )}
    </div>
  );
}
