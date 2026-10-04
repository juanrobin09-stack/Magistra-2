import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { UserButton } from '@clerk/react';
import { GraduationCap, Heart, History, LayoutDashboard, Menu, Settings, Sparkles, X } from 'lucide-react';
import { isTypeContenu, type TypeContenu } from '@shared/catalog';
import { isNiveau, type NiveauScolaire } from '@shared/levels';
import AIStatusBadge from '@/components/ai/AIStatusBadge';
import { AppUpdateNotice } from '@/components/UpdateCheck';
import SidebarTools from '@/components/layout/SidebarTools';
import { isDrawerLayout, WIDE_LAYOUT_QUERY, type AppShell } from '@/components/layout/shell';
import { appPageTitle, useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useRuntime } from '@/lib/runtime/context';

const NAV_ITEMS = [
  { path: '/app', label: 'Tableau de bord', icon: LayoutDashboard, exact: true },
  { path: '/app/generate', label: 'Générer', icon: Sparkles },
  { path: '/app/history', label: 'Historique', icon: History },
  { path: '/app/favorites', label: 'Favoris', icon: Heart },
  { path: '/app/settings', label: 'Réglages', icon: Settings },
];

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';
const SIDEBAR_ID = 'app-sidebar';
/** « Outils pédagogiques » ouvert ou fermé, retenu sur cet appareil (fermé par défaut). */
const TOOLS_OPEN_KEY = 'magistra_sidebar_tools_open';

function readToolsOpen(): boolean {
  try {
    return localStorage.getItem(TOOLS_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function saveToolsOpen(open: boolean): void {
  try {
    localStorage.setItem(TOOLS_OPEN_KEY, open ? '1' : '0');
  } catch {
    // Stockage indisponible : l'état n'est simplement pas retenu.
  }
}

/** Outil affiché par la page Générer (paramètre ?type=, « cours » par défaut), null ailleurs. */
function generateTool(pathname: string, search: string): TypeContenu | null {
  if (pathname !== '/app/generate' && pathname !== '/app/generate/') return null;
  const type = new URLSearchParams(search).get('type');
  return isTypeContenu(type) ? type : 'cours';
}

export default function AppLayout() {
  const location = useLocation();
  const { mode, profile } = useRuntime();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(readToolsOpen);
  const toolsToggleRef = useRef<HTMLButtonElement>(null);
  /** Demandes « Changer d'outil » : chacune est servie une fois (focus sur l'outil en cours), liste déjà ouverte ou non. */
  const [toolFocusRequest, setToolFocusRequest] = useState(0);
  /** Élément qui a ouvert le tiroir par « Changer d'outil »… : il retrouve le focus si le tiroir est refermé sans choix. */
  const returnFocusRef = useRef<HTMLElement | null>(null);
  /** Niveau du formulaire de la page Générer (libellés des outils), null ailleurs. */
  const [toolNiveau, setToolNiveau] = useState<NiveauScolaire | null>(null);
  const activeTool = generateTool(location.pathname, location.search);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const previousPath = useRef(location.pathname);

  useDocumentTitle(appPageTitle(location.pathname));

  // Changement de vue : le focus passe au contenu principal (sinon il reste sur un lien du menu
  // et le lecteur d'écran n'annonce rien). Pas au premier affichage.
  useEffect(() => {
    if (previousPath.current === location.pathname) return;
    previousPath.current = location.pathname;
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  const isActive = (path: string, exact?: boolean) =>
    exact ? location.pathname === path || location.pathname === `${path}/` : location.pathname.startsWith(path);

  /**
   * Ferme le tiroir mobile ; `restoreFocus` rend le focus à ce qui l'a ouvert : le bouton de la page (« Changer
   * d'outil », « Voir les 11 outils »), sinon le bouton « Menu ».
   */
  const closeSidebar = useCallback((restoreFocus: boolean) => {
    setSidebarOpen(false);
    const opener = returnFocusRef.current;
    returnFocusRef.current = null;
    if (!restoreFocus) return;
    if (opener?.isConnected) opener.focus();
    if (document.activeElement !== opener) menuButtonRef.current?.focus();
  }, []);

  /**
   * Lien de la barre latérale (menu, outils). Tiroir ouvert (mobile) : il se ferme et le focus passe au contenu
   * principal, jamais laissé sur un lien masqué avec le tiroir, même quand seule l'adresse ?type= change (la page
   * Générer le donne ensuite à son titre, qui annonce le nouvel outil).
   */
  const leaveSidebar = useCallback(() => {
    if (sidebarOpen) mainRef.current?.focus({ preventScroll: true });
    closeSidebar(false);
  }, [sidebarOpen, closeSidebar]);

  // Tiroir ouvert (mobile) : focus sur « Fermer », Échap pour fermer, focus piégé dans le tiroir.
  useEffect(() => {
    if (!sidebarOpen) return;
    closeButtonRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSidebar(true);
        return;
      }
      if (e.key !== 'Tab' || !sidebarRef.current) return;
      const focusables = Array.from(sidebarRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null || el === document.activeElement);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !sidebarRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !sidebarRef.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen, closeSidebar]);

  // Tiroir ouvert puis fenêtre élargie (tablette tournée…) : la barre latérale redevient fixe, le tiroir se ferme
  // (sinon le focus resterait piégé dans la barre latérale).
  useEffect(() => {
    if (!sidebarOpen || typeof window.matchMedia !== 'function') return;
    const wide = window.matchMedia(WIDE_LAYOUT_QUERY);
    const onChange = () => {
      if (wide.matches) closeSidebar(false);
    };
    wide.addEventListener?.('change', onChange);
    return () => wide.removeEventListener?.('change', onChange);
  }, [sidebarOpen, closeSidebar]);

  const toggleTools = useCallback(() => {
    setToolsOpen(open => {
      saveToolsOpen(!open);
      return !open;
    });
  }, []);

  // « Changer d'outil » (page Générer), « Voir les 11 outils » (tableau de bord) : la liste des outils s'ouvre (et le
  // tiroir, en mise en page étroite), focus sur l'outil en cours. Liste déjà ouverte (état retenu) : le focus y va quand
  // même (compteur de demandes, jamais une demande laissée en attente qui déplacerait le focus plus tard).
  const openTools = useCallback(() => {
    setToolsOpen(true);
    saveToolsOpen(true);
    if (isDrawerLayout()) {
      const active = document.activeElement;
      returnFocusRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
      setSidebarOpen(true);
    }
    setToolFocusRequest(n => n + 1);
  }, []);

  useEffect(() => {
    if (toolFocusRequest === 0) return;
    // Après le focus donné à « Fermer » par l'ouverture du tiroir (effet ci-dessus) et l'affichage de la liste.
    const id = requestAnimationFrame(() => {
      const target = sidebarRef.current?.querySelector<HTMLElement>('[data-tool][aria-current]') ?? toolsToggleRef.current;
      target?.focus();
      target?.scrollIntoView?.({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(id);
  }, [toolFocusRequest]);

  const shell = useMemo<AppShell>(() => ({ openTools, setToolNiveau }), [openTools]);
  // Libellés des outils : niveau du formulaire sur la page Générer (comme son titre), sinon premier niveau du profil.
  const toolsNiveau = (activeTool && toolNiveau) || profile?.niveaux?.find(isNiveau);

  const showUserButton = mode === 'web';

  return (
    <div className="flex h-screen bg-mg-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[200] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-accent focus:text-mg-900 focus:font-semibold"
      >
        Aller au contenu
      </a>

      {/* Fond du tiroir mobile : un clic à l'extérieur le ferme */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" aria-hidden="true" onClick={() => closeSidebar(true)} />
      )}

      {/* Barre latérale (tiroir sur mobile).
          À l'ouverture, seule la position est animée : le tiroir devient visible immédiatement, si bien que
          « Fermer » peut recevoir le focus. À la fermeture, il reste visible le temps de glisser hors de l'écran. */}
      <aside
        id={SIDEBAR_ID}
        ref={sidebarRef}
        aria-label="Barre latérale"
        className={`
          fixed lg:static inset-y-0 left-0 z-50
          w-[260px] bg-mg-800 border-r border-white/5
          flex flex-col
          duration-300
          ${sidebarOpen ? 'transition-transform translate-x-0 visible' : 'transition-[transform,translate,visibility] -translate-x-full invisible lg:visible lg:translate-x-0'}
        `}
      >
        {/* Logo */}
        <div className="px-6 py-5 flex items-center justify-between">
          <Link to="/app" className="flex items-center gap-2.5 group" onClick={leaveSidebar}>
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-dim to-accent flex items-center justify-center">
              <GraduationCap size={18} className="text-mg-900" aria-hidden="true" />
            </div>
            <span className="text-lg font-semibold tracking-tight text-white" style={{ fontFamily: 'var(--font-display)' }}>
              Magistra<span className="text-gold">.</span>
            </span>
          </Link>
          <button
            ref={closeButtonRef}
            type="button"
            // transition-colors : la visibilité héritée du tiroir ne doit pas être animée (focus immédiat).
            className="lg:hidden btn-ghost p-1 transition-colors"
            onClick={() => closeSidebar(true)}
            aria-label="Fermer le menu"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="glow-line mx-4" />

        {/* Navigation */}
        <nav aria-label="Navigation principale" className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map(item => {
            const active = isActive(item.path, item.exact);
            // « Générer » sur la page Générer : l'outil en cours est gardé, sans nouvelle entrée d'historique (la page
            // réinscrirait l'outil dans l'adresse, et « Précédent » semblerait alors ne rien faire).
            const stay = item.path === '/app/generate' && activeTool !== null;
            return (
              <Link
                key={item.path}
                to={stay ? `/app/generate?type=${activeTool}` : item.path}
                replace={stay}
                onClick={leaveSidebar}
                aria-current={active ? 'page' : undefined}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                  transition-all duration-200
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50
                  ${active
                    ? 'bg-accent/10 text-accent border border-accent/15'
                    : 'text-mg-200 hover:text-mg-50 hover:bg-white/3 border border-transparent'
                  }
                `}
              >
                <item.icon size={18} className={active ? 'text-accent' : ''} aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
          <SidebarTools
            ref={toolsToggleRef}
            open={toolsOpen}
            onToggle={toggleTools}
            activeType={activeTool}
            niveau={toolsNiveau}
            onNavigate={leaveSidebar}
          />
        </nav>

        {/* Bas de la barre latérale */}
        <div className="px-4 py-4 border-t border-white/5 space-y-3">
          <AIStatusBadge />
          <div className="flex items-center gap-3 px-2">
            {showUserButton && (
              <UserButton
                appearance={{
                  elements: {
                    avatarBox: 'w-8 h-8',
                    userButtonPopoverCard: 'bg-mg-800 border-white/10',
                  },
                }}
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-mg-300 truncate">
                Un projet{' '}
                <a href="https://futurai.space" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                  FutureAI
                </a>
                {/* Application Windows : la page d'accueil de Magistra reste accessible (le site entier est dans l'application). */}
                {mode === 'local' && (
                  <>
                    {' · '}
                    <Link to="/presentation" onClick={leaveSidebar} className="text-mg-200 hover:text-accent hover:underline">
                      Présentation
                    </Link>
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Contenu principal */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* En-tête mobile */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-mg-800/80 backdrop-blur-xl border-b border-white/5">
          <button
            ref={menuButtonRef}
            type="button"
            className="btn-ghost p-2"
            onClick={() => {
              returnFocusRef.current = null;
              setSidebarOpen(true);
            }}
            aria-label="Ouvrir le menu"
            aria-expanded={sidebarOpen}
            aria-controls={SIDEBAR_ID}
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <span className="text-sm font-semibold text-white" style={{ fontFamily: 'var(--font-display)' }}>
            Magistra<span className="text-gold">.</span>
          </span>
          {showUserButton ? <UserButton appearance={{ elements: { avatarBox: 'w-7 h-7' } }} /> : <span className="w-9" aria-hidden="true" />}
        </header>

        {/* « relative » : les éléments positionnés en absolu des pages (champs de fichier « sr-only »…) restent dans
            cette zone défilante ; sinon ils allongeaient le document, qui défilait tout entier (barre latérale
            comprise) quand un résultat était amené à l'écran. */}
        <main ref={mainRef} id="main-content" tabIndex={-1} aria-label={appPageTitle(location.pathname)} className="relative flex-1 overflow-y-auto focus:outline-none">
          {mode === 'local' && <AppUpdateNotice />}
          <Outlet context={shell} />
        </main>
      </div>
    </div>
  );
}
