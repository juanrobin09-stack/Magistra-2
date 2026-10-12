import { useEffect, type ReactNode } from 'react';
import { GraduationCap, Download } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import AuthorCredit from '@/components/AuthorCredit';
import LegalLinks from '@/components/LegalLinks';

/** Navigation commune aux guides publics ; aucun état ou service de l'application. */
export default function SitePageShell({ children }: { children: ReactNode }) {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) { window.scrollTo(0, 0); return; }
    try { document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView(); }
    catch { /* Une ancre mal encodée ne doit pas empêcher la lecture du guide. */ }
  }, [pathname, hash]);
  return (
    <div className="min-h-screen bg-mg-900 text-mg-200 overflow-x-hidden">
      <a href="#contenu" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-mg-800 focus:text-white focus:px-4 focus:py-3">Aller au contenu</a>
      <header className="border-b border-white/10 bg-mg-900/95">
        <nav aria-label="Navigation du site" className="max-w-6xl mx-auto px-5 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <Link to="/" aria-label="Magistra, accueil" className="inline-flex items-center gap-2.5 text-lg font-semibold text-white">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-dim to-accent flex items-center justify-center"><GraduationCap size={18} className="text-mg-900" aria-hidden="true" /></span>
            Magistra<span className="text-gold -ml-2">.</span>
          </Link>
          <div className="flex items-center gap-4 sm:gap-6 text-sm">
            <Link to="/guides" aria-current={pathname === '/guides' ? 'page' : undefined} className="text-accent hover:underline underline-offset-4">Guides enseignants</Link>
            <a href="/#magistra-windows" className="btn-primary text-sm py-2 px-3 sm:px-4"><Download size={14} aria-hidden="true" /> Télécharger</a>
          </div>
        </nav>
      </header>
      {children}
      <footer className="border-t border-white/10 px-6 py-8 mt-12">
        <div className="max-w-5xl mx-auto flex flex-col items-start sm:items-center gap-5 text-sm">
          <nav aria-label="Découvrir Magistra" className="flex flex-wrap gap-5">
            <Link to="/" className="text-accent hover:underline underline-offset-4">Assistant IA Magistra</Link>
            <Link to="/guides" className="text-accent hover:underline underline-offset-4">Tous les guides enseignants</Link>
            <a href="/#magistra-windows" className="text-accent hover:underline underline-offset-4">Installation pour Windows</a>
          </nav>
          <p className="text-xs text-mg-300"><AuthorCredit variant="footer" /></p>
          <nav aria-label="Informations légales" className="text-xs text-mg-300"><LegalLinks /></nav>
        </div>
      </footer>
    </div>
  );
}
