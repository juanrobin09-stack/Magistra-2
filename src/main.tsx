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
import { discoverRuntimeConfig, getRuntimeConfig, setRuntimeConfig, type RuntimeConfig } from '@/lib/runtime/mode';
import { captureAccessFromUrl } from '@/lib/runtime/personal';

const container = document.getElementById('root')!;

/**
 * Nouvelle version déployée pendant que la page est ouverte : un fichier de l'ancienne version (nom à empreinte) n'existe
 * plus et le chargement d'une page échoue. Un seul rechargement automatique (drapeau de session, effacé après 10 s de
 * fonctionnement normal) ; au-delà, l'erreur est affichée normalement : jamais de boucle de rechargement.
 */
window.addEventListener('vite:preloadError', event => {
  event.preventDefault();
  try {
    if (sessionStorage.getItem('magistra_preload_reload')) return;
    sessionStorage.setItem('magistra_preload_reload', '1');
  } catch {
    return;
  }
  window.location.reload();
});
window.setTimeout(() => {
  try {
    sessionStorage.removeItem('magistra_preload_reload');
  } catch {
    // Stockage indisponible : sans conséquence.
  }
}, 10_000);

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

/**
 * Démarrage : le mode (Windows, site avec comptes, mode personnel, démonstration) est découvert à
 * l'exécution (GET /api/mode, 3 s au plus) et non figé au build.
 */
async function start(): Promise<void> {
  // Mode personnel : le code d'accès du lien affiché dans le terminal (#acces=…) est mémorisé puis
  // effacé de l'adresse AVANT tout rendu (ni l'historique, ni un favori, ni une redirection ne le gardent).
  if (!getBridge()) captureAccessFromUrl();
  let config: RuntimeConfig;
  try {
    config = await discoverRuntimeConfig();
  } catch {
    // Découverte impossible (cas imprévu) : comportement historique (pont Electron, clé du build, démonstration).
    config = getRuntimeConfig();
  }
  setRuntimeConfig(config);
  createRoot(container).render(
    <StrictMode>
      <App config={config} />
    </StrictMode>,
  );
}

void start();
