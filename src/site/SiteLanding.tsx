// Page d'accueil du site vitrine : la présentation de Magistra (landing/LandingContent.tsx) et le téléchargement de
// l'application Windows. Aucun accès à une application dans le navigateur : les boutons mènent à la section « Magistra
// pour Windows » de la page (ancre #magistra-windows), où se trouve le téléchargement lui-même.
// Aucun fournisseur d'exécution, aucun service de connexion, aucun connecteur local : la seule requête de la page est
// la recherche de la dernière version (GET /api/windows-release, WindowsDownloadPanel).

import { Download } from 'lucide-react';
import WindowsDownloadPanel from '@/components/localEngine/WindowsDownloadPanel';
import { CTA_CLASS, WINDOWS_SECTION_HREF } from '@/pages/landing/content';
import LandingContent from '@/pages/landing/LandingContent';

export default function SiteLanding() {
  return (
    <LandingContent
      navAction={
        <a href={WINDOWS_SECTION_HREF} className={CTA_CLASS.nav}>
          <Download size={14} aria-hidden="true" /> Télécharger
        </a>
      }
      heroAction={
        <a href={WINDOWS_SECTION_HREF} className={CTA_CLASS.hero}>
          <Download size={16} aria-hidden="true" /> Télécharger pour Windows
        </a>
      }
      heroNote={
        <p className="mt-4 text-sm text-mg-200 max-w-md mx-auto">
          Application gratuite pour Windows 10 et 11, sans compte : l’IA fonctionne sur votre ordinateur, même sans Internet.
        </p>
      }
      windowsSection={<WindowsDownloadPanel variant="landing" mode="showcase" />}
      finalAction={
        <a href={WINDOWS_SECTION_HREF} className={CTA_CLASS.hero}>
          <Download size={16} aria-hidden="true" /> Télécharger pour Windows
        </a>
      }
    />
  );
}
