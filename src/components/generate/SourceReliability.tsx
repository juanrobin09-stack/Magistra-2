// Fiabilité des sources citées : combien de documents, de sources officielles, de publications scientifiques, d'articles
// Wikipédia (à recouper) et de pages web non vérifiées, du plus fiable au moins fiable.

import { BookOpenCheck, Building2, FileText, Globe, GraduationCap } from 'lucide-react';
import { reliabilitySummary, type ReliabilityTier } from '@shared/citations';
import type { SourceRef } from '@shared/types';

const ICONS: Record<ReliabilityTier, typeof Globe> = {
  document: FileText,
  official: Building2,
  scientific: GraduationCap,
  encyclopedic: BookOpenCheck,
  web: Globe,
};

/** Les sources à recouper ou non vérifiées ressortent (couleur d'avertissement) ; les autres restent sobres. */
const STYLES: Record<ReliabilityTier, string> = {
  document: 'badge-accent',
  official: 'badge-success',
  scientific: 'badge-success',
  encyclopedic: 'bg-warning/10 text-warning border border-warning/25',
  web: 'bg-warning/10 text-warning border border-warning/25',
};

export default function SourceReliability({ sources }: { sources: readonly SourceRef[] }) {
  const summary = reliabilitySummary(sources);
  if (summary.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5 mt-2" aria-label="Fiabilité des sources citées">
      {summary.map(({ tier, label, count }) => {
        const Icon = ICONS[tier];
        return (
          <li key={tier} className={`badge ${STYLES[tier]}`}>
            <Icon size={11} aria-hidden="true" /> {label} : {count}
          </li>
        );
      })}
    </ul>
  );
}
