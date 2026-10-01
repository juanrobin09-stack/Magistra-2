// Liens vers les trois pages légales (pied de page de l'accueil, Réglages). Fichier séparé de la page elle-même :
// l'accueil n'embarque pas les textes légaux (chargés à la demande, voir App.tsx).

import { Link } from 'react-router-dom';
import { LEGAL_PATHS, LEGAL_TITLES, type LegalPageKind } from '@/lib/legal';

const ORDER: LegalPageKind[] = ['mentions', 'confidentialite', 'cgu'];

export default function LegalLinks({ className }: { className?: string }) {
  return (
    <span className={className}>
      {ORDER.map((kind, i) => (
        <span key={kind}>
          {i > 0 && ' · '}
          <Link to={LEGAL_PATHS[kind]} className="text-accent hover:underline underline-offset-2">{LEGAL_TITLES[kind]}</Link>
        </span>
      ))}
    </span>
  );
}
