// Squelette de chargement visible avant le premier morceau de texte.
// Classes Tailwind STATIQUES (jamais `h-${n}` construit dynamiquement, que Tailwind ne génère pas).

const LINES = [
  'h-6 w-3/4',
  'h-4 w-full',
  'h-4 w-11/12',
  'h-4 w-2/3',
  'h-5 w-1/2 mt-6',
  'h-4 w-full',
  'h-4 w-5/6',
];

export default function LoadingSkeleton({ label = 'Préparation du contenu…' }: { label?: string }) {
  return (
    <div className="space-y-3" data-testid="generation-skeleton">
      <span className="sr-only">{label}</span>
      {LINES.map((cls, i) => (
        <div key={i} aria-hidden="true" className={`rounded animate-shimmer ${cls}`} />
      ))}
    </div>
  );
}
