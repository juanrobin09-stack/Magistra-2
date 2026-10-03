import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
// Polices auto-hébergées : aucune requête vers un service tiers.
import '@fontsource/dm-sans/latin-300.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-400-italic.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '../index.css';
import SiteApp from './SiteApp';

// Site vitrine : démarrage direct. Ni découverte du mode d'exécution, ni pont de l'application Windows, ni code d'accès.
const container = document.getElementById('root')!;
const app = (
  <StrictMode>
    <SiteApp />
  </StrictMode>
);
// Le build publie le contenu complet ; en développement, le gabarit conserve son squelette.
const canonicalPath = new URL(document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '/', window.location.origin).pathname;
const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
if (container.querySelector('main') && (canonicalPath === currentPath || canonicalPath === '/404')) hydrateRoot(container, app);
else createRoot(container).render(app);
