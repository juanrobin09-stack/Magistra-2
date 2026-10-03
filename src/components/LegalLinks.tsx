// Liens vers les trois pages légales (pied de page de l'accueil, Réglages, assistant d'accueil). Fichier séparé de la
// page elle-même : l'accueil n'embarque pas les textes légaux (chargés à la demande, voir App.tsx).

import { Link } from 'react-router-dom';
import { LEGAL_PATHS, LEGAL_TITLES, type LegalPageKind } from '@/lib/legal';

const ORDER: LegalPageKind[] = ['mentions', 'confidentialite', 'cgu'];

/** `newTab` : les pages s'ouvrent dans un nouvel onglet (depuis un formulaire en cours de saisie, dont l'état serait perdu). */
export default function LegalLinks({ className, newTab = false }: { className?: string; newTab?: boolean }) {
  return (
    <span className={className}>
      {ORDER.map((kind, i) => (
        <span key={kind}>
          {i > 0 && ' · '}
          <Link
            to={LEGAL_PATHS[kind]}
            {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className="text-accent hover:underline underline-offset-2"
          >
            {LEGAL_TITLES[kind]}
            {newTab && <span className="sr-only"> (s'ouvre dans un nouvel onglet)</span>}
          </Link>
        </span>
      ))}
    </span>
  );
}
