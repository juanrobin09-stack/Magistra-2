import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Polices auto-hébergées : aucune requête vers un service tiers, fonctionnement hors ligne.
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
import './index.css';
import App from './App';
import { getBridge } from '@/lib/runtime/local';

const container = document.getElementById('root')!;

/**
 * Signale à l'application Windows que l'interface est affichée (test de démarrage automatisé) :
 * dès que React a inséré le premier rendu dans #root, puis après l'affichage de l'image suivante.
 */
const observer = new MutationObserver(() => {
  observer.disconnect();
  requestAnimationFrame(() => {
    try {
      getBridge()?.app.ready();
    } catch {
      // Pont absent ou ancien : sans conséquence pour l'utilisateur.
    }
  });
});
observer.observe(container, { childList: true });

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
