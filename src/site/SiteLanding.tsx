// Page d'accueil du site vitrine : la présentation de Magistra (landing/LandingContent.tsx) et le téléchargement de
// l'application Windows. Aucun accès à une application dans le navigateur : les boutons mènent à la section « Magistra
// pour Windows » de la page (ancre #magistra-windows), où se trouve le téléchargement lui-même.
// Trois entrées de téléchargement seulement : le bouton de la barre de navigation, celui du héros et la section elle-même
// (ni lien dans une carte, ni appel à l'action final : le même bouton cinq fois de suite n'aide pas).
// Aucun fournisseur d'exécution, aucun service de connexion, aucun connecteur local : la seule requête de la page est
// la recherche de la dernière version (GET /api/windows-release, WindowsDownloadPanel).

import { useEffect } from 'react';
import { Download } from 'lucide-react';
import { Link } from 'react-router-dom';
import WindowsDownloadPanel from '@/components/localEngine/WindowsDownloadPanel';
import { CTA_CLASS, WINDOWS_SECTION_HREF } from '@/pages/landing/content';
import LandingContent from '@/pages/landing/LandingContent';
import SiteFaq from './SiteFaq';
import { SiteResourcesPreview } from './SiteResources';

/** Ouverture directe d'une ancre (« /#magistra-windows ») : la page n'existe qu'après son rendu, le navigateur ne peut pas y défiler seul. */
function scrollToHash(): void {
  let id = window.location.hash.slice(1);
  try {
    id = decodeURIComponent(id);
  } catch {
    return;
  }
  if (id) document.getElementById(id)?.scrollIntoView();
}

export default function SiteLanding() {
  useEffect(scrollToHash, []);
  return (
    <LandingContent
      navAction={
        <>
          <Link to="/guides" className="text-sm text-accent hover:underline underline-offset-4">Guides</Link>
          <a href={WINDOWS_SECTION_HREF} className={CTA_CLASS.nav}>
            <Download size={14} aria-hidden="true" /> Télécharger
          </a>
        </>
      }
      heroAction={
        <a href={WINDOWS_SECTION_HREF} className={CTA_CLASS.hero}>
          <Download size={16} aria-hidden="true" /> Télécharger pour Windows
        </a>
      }
      heroNote={
        <p className="mt-4 text-sm text-mg-200 max-w-md mx-auto">
          Application gratuite pour Windows 10 et 11, sans compte. Utilisez l’IA locale hors ligne après activation,
          ou votre clé API OpenAI, Mistral, Gemini ou Anthropic avec une connexion Internet.
        </p>
      }
      windowsSection={<WindowsDownloadPanel variant="landing" mode="showcase" />}
      windowsLinks={false}
      resources={<SiteResourcesPreview />}
      questions={<SiteFaq />}
    />
  );
}
