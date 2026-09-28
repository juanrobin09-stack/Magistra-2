import { Link } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { getMatiereEmoji } from '@shared/catalog';
import type { GenerationSummary } from '@shared/types';
import { formatDate, niveauLabelFor, toolLabelFor } from './logic';

interface GenerationListItemProps {
  item: GenerationSummary;
  selected: boolean;
  /** Remplacer l'entrée d'historique du navigateur (un élément était déjà affiché). */
  replace: boolean;
  /** Ouvert depuis la liste : « Retour » revient en arrière dans l'historique du navigateur. */
  fromList: boolean;
  onOpen: (id: string) => void;
}

export default function GenerationListItem({ item, selected, replace, fromList, onOpen }: GenerationListItemProps) {
  return (
    <li>
      <Link
        to={`?id=${encodeURIComponent(item.id)}`}
        replace={replace}
        state={{ fromList }}
        aria-current={selected ? 'true' : undefined}
        onClick={() => onOpen(item.id)}
        className={`block w-full text-left p-3 rounded-lg transition-all border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
          selected ? 'bg-accent/5 border-accent/15' : 'border-transparent hover:bg-white/3'
        }`}
      >
        <div className="flex items-start gap-2.5">
          <span className="text-lg shrink-0" aria-hidden="true">{getMatiereEmoji(item.matiere)}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-mg-100 truncate">{item.sujet}</p>
            <p className="text-xs text-mg-300 mt-0.5 truncate">
              {toolLabelFor(item)} · {niveauLabelFor(item)}
              {item.discipline ? ` · ${item.discipline}` : ''}
            </p>
            <p className="text-xs text-mg-300 mt-0.5">
              <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
            </p>
          </div>
          {item.isFavorite && (
            <>
              <Heart size={12} className="text-accent fill-accent shrink-0 mt-1" aria-hidden="true" />
              <span className="sr-only">Favori</span>
            </>
          )}
        </div>
      </Link>
    </li>
  );
}
