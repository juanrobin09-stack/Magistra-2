import type { TierId } from '@shared/ai/models';
import type { TierStatus } from '@shared/ipc';
import { formatGB } from '@/lib/ai-ui/format';
import { fitBadge, toneBadgeClass } from '@/lib/ai-ui/status';

interface TierPickerProps {
  tiers: TierStatus[];
  selected: TierId;
  onSelect(id: TierId): void;
  /** Niveau réellement utilisé aujourd'hui (réglages), s'il est installé. */
  currentTier?: TierId | null;
  disabled?: boolean;
  /** Nom du groupe de boutons radio (unique sur la page). */
  name?: string;
}

const NOTE_COLOR: Record<TierStatus['fit'], string> = {
  recommended: 'text-mg-100',
  ok: 'text-mg-200',
  slow: 'text-warning',
  not_recommended: 'text-danger',
};

/**
 * Les trois versions de l'IA présentées sans nom technique : Magistra Léger / Standard / Qualité.
 * Chaque carte indique la taille du téléchargement et l'adéquation à l'ordinateur.
 */
export default function TierPicker({ tiers, selected, onSelect, currentTier, disabled, name = 'magistra-tier' }: TierPickerProps) {
  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="sr-only">Choix de la version de l'intelligence artificielle</legend>
      {tiers.map(tier => {
        const checked = tier.id === selected;
        const badge = fitBadge(tier.fit);
        const id = `${name}-${tier.id}`;
        return (
          <label
            key={tier.id}
            htmlFor={id}
            data-tier={tier.id}
            className={`flex gap-3 rounded-xl border p-4 transition-colors ${
              disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'
            } ${checked ? 'border-accent/50 bg-accent/5' : 'border-white/8 bg-mg-800 hover:border-accent/25'}`}
          >
            <input
              id={id}
              type="radio"
              name={name}
              value={tier.id}
              checked={checked}
              onChange={() => onSelect(tier.id)}
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
              aria-describedby={`${id}-desc`}
            />
            <span className="flex-1 min-w-0">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-white">{tier.label}</span>
                <span className={toneBadgeClass(badge.tone)}>{badge.label}</span>
                {tier.installed && <span className="badge badge-success">Installé</span>}
                {currentTier === tier.id && <span className="badge badge-accent">Utilisé actuellement</span>}
              </span>
              <span id={`${id}-desc`} className="block">
                <span className="block text-sm text-mg-100 mt-1.5">{tier.description}</span>
                <span className="block text-xs text-mg-200 mt-2">
                  {tier.installed ? `Déjà installé (${formatGB(tier.downloadGB)})` : `Téléchargement : ${formatGB(tier.downloadGB)}`}
                </span>
                {tier.note && <span className={`block text-xs mt-1 ${NOTE_COLOR[tier.fit]}`}>{tier.note}</span>}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
