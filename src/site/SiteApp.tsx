// Site vitrine de Magistra : présentation, téléchargement de l'application Windows, pages légales. Rien d'autre.
//
// Aucune application dans le navigateur, aucune connexion, aucun compte : ni fournisseur d'exécution, ni service de
// connexion, ni connecteur local, ni découverte du mode (GET /api/mode). La seule requête du site est la recherche de la
// dernière version (GET /api/windows-release, faite par le panneau de téléchargement). Les adresses de
// l'application (/app, /app/…, /onboarding, /setup, /presentation) et toute adresse inconnue reviennent à l'accueil.
// Les pages sont chargées avec le site (aucun chargement différé) : une version déployée pendant qu'une page est ouverte
// ne casse aucune navigation, et le site n'écrit rien dans le navigateur.

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import ErrorBoundary from '@/components/ErrorBoundary';
import ShowcaseLegalPage from '@/pages/legal/ShowcaseLegal';
import SiteLanding from './SiteLanding';

export default function SiteApp() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<SiteLanding />} />
          <Route path="/mentions-legales" element={<ShowcaseLegalPage page="mentions" />} />
          <Route path="/confidentialite" element={<ShowcaseLegalPage page="confidentialite" />} />
          <Route path="/cgu" element={<ShowcaseLegalPage page="cgu" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
