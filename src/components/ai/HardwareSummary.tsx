import { Monitor } from 'lucide-react';
import type { HardwareInfo, Recommendation } from '@shared/ai/models';
import { hardwareLines } from '@/lib/ai-ui/format';
import { WarningNote } from './Notices';

interface HardwareSummaryProps {
  hardware: HardwareInfo;
  recommendation: Recommendation;
  /** Faux quand le choix de la version suit immédiatement et redit déjà la recommandation (jamais deux fois). */
  withRecommendation?: boolean;
}

/** « Votre ordinateur » : mémoire, processeur, carte graphique, disque + recommandation. */
export default function HardwareSummary({ hardware, recommendation, withRecommendation = true }: HardwareSummaryProps) {
  return (
    <section aria-labelledby="hw-title" className="rounded-xl border border-white/8 bg-mg-700/40 p-4">
      <h3 id="hw-title" className="flex items-center gap-2 text-sm font-semibold text-white mb-3">
        <Monitor size={16} className="text-accent" aria-hidden="true" /> Votre ordinateur
      </h3>
      <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {hardwareLines(hardware).map(line => (
          <div key={line.label} className="contents">
            <dt className="text-mg-200">{line.label}</dt>
            <dd className="text-mg-50 mb-1 sm:mb-0 break-words">{line.value}</dd>
          </div>
        ))}
      </dl>
      {withRecommendation && <p className="mt-3 text-sm text-mg-50">{recommendation.summary}</p>}
      {withRecommendation && recommendation.warning && (
        <div className="mt-2">
          <WarningNote>{recommendation.warning}</WarningNote>
        </div>
      )}
    </section>
  );
}
