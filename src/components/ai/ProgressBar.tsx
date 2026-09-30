interface ProgressBarProps {
  /** Pourcentage 0–100, ou null si la progression est inconnue (barre animée). */
  percent: number | null;
  /** Nom accessible de la barre (« Téléchargement du moteur IA »). */
  label: string;
  /** Valeur lue par les lecteurs d'écran (« 120 Mo sur 850 Mo »). */
  valueText?: string;
}

/** Barre de progression accessible (role="progressbar", aria-valuenow). */
export default function ProgressBar({ percent, label, valueText }: ProgressBarProps) {
  const known = percent !== null;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? percent : undefined}
      aria-valuetext={valueText ?? (known ? `${percent} %` : 'En cours')}
      className="h-2.5 w-full rounded-full bg-mg-700 overflow-hidden border border-white/5"
    >
      {known ? (
        <div
          key="determinate"
          className="h-full rounded-full bg-gradient-to-r from-accent-dim to-accent transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(2, percent)}%` }}
        />
      ) : (
        <div key="indeterminate" className="h-full w-full rounded-full bg-accent/35 animate-pulse" />
      )}
    </div>
  );
}
