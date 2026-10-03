import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Polices auto-hébergées : aucune requête vers un service tiers.
import '@fontsource/dm-sans/300.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/400-italic.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/dm-sans/700.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '../index.css';
import SiteApp from './SiteApp';

// Site vitrine : démarrage direct. Ni découverte du mode d'exécution, ni pont de l'application Windows, ni code d'accès.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SiteApp />
  </StrictMode>,
);
