// Site public de Magistra : présentation, guides enseignants, téléchargement Windows et pages légales.
//
// Aucune application dans le navigateur, aucune connexion, aucun compte : ni fournisseur d'exécution, ni service de
// connexion, ni connecteur local, ni découverte du mode (GET /api/mode). La seule requête du site est la recherche de la
// dernière version (GET /api/windows-release, faite par le panneau de téléchargement). Les adresses de
// l'application (/app, /app/…, /onboarding, /setup, /presentation) sont redirigées vers l'accueil par l'hébergeur ;
// les adresses inconnues affichent une vraie page introuvable, exclue de l'indexation.
// Les pages sont chargées avec le site (aucun chargement différé) : une version déployée pendant qu'une page est ouverte
// ne casse aucune navigation, et le site n'écrit rien dans le navigateur.

import { BrowserRouter } from 'react-router-dom';
import ErrorBoundary from '@/components/ErrorBoundary';
import SiteRoutes from './SiteRoutes';
import SiteMetadata from './SiteMetadata';

export default function SiteApp() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <SiteRoutes />
        <SiteMetadata />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
