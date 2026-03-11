import { useState } from 'react';
import { Link, useLocation, Outlet } from 'react-router-dom';
import { SignedIn, UserButton } from '@clerk/clerk-react';

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
import {
  Sparkles, History, Settings, LayoutDashboard,
  Menu, X, Heart, GraduationCap
} from 'lucide-react';

const NAV_ITEMS = [
  { path: '/app', label: 'Tableau de bord', icon: LayoutDashboard, exact: true },
  { path: '/app/generate', label: 'Générer', icon: Sparkles },
  { path: '/app/history', label: 'Historique', icon: History },
  { path: '/app/favorites', label: 'Favoris', icon: Heart },
  { path: '/app/settings', label: 'Réglages', icon: Settings },
];

export default function AppLayout() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isActive = (path: string, exact?: boolean) =>
    exact ? location.pathname === path : location.pathname.startsWith(path);

  return (
    <div className="flex h-screen bg-mg-900">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50
        w-[260px] bg-mg-800 border-r border-white/5
        flex flex-col
        transition-transform duration-300
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Logo */}
        <div className="px-6 py-5 flex items-center justify-between">
          <Link to="/app" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-dim to-accent flex items-center justify-center">
              <GraduationCap size={18} className="text-mg-900" />
            </div>
            <span className="text-lg font-semibold tracking-tight text-white" style={{ fontFamily: 'var(--font-display)' }}>
              Magistra<span className="text-accent">.</span>
            </span>
          </Link>
          <button className="lg:hidden btn-ghost p-1" onClick={() => setSidebarOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <div className="glow-line mx-4" />

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map(item => {
            const active = isActive(item.path, item.exact);
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                  transition-all duration-200
                  ${active
                    ? 'bg-accent/10 text-accent border border-accent/15'
                    : 'text-mg-300 hover:text-mg-100 hover:bg-white/3 border border-transparent'
                  }
                `}
              >
                <item.icon size={18} className={active ? 'text-accent' : ''} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom */}
        <div className="px-4 py-4 border-t border-white/5">
          <div className="flex items-center gap-3 px-2">
            {CLERK_KEY && (
              <SignedIn>
                <UserButton
                  appearance={{
                    elements: {
                      avatarBox: 'w-8 h-8',
                      userButtonPopoverCard: 'bg-mg-800 border-white/10',
                    },
                  }}
                />
              </SignedIn>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-mg-300 truncate">Un projet FutureAI</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-mg-800/80 backdrop-blur-xl border-b border-white/5">
          <button className="btn-ghost p-2" onClick={() => setSidebarOpen(true)}>
            <Menu size={20} />
          </button>
          <span className="text-sm font-semibold" style={{ fontFamily: 'var(--font-display)' }}>
            Magistra<span className="text-accent">.</span>
          </span>
          {CLERK_KEY && (
            <SignedIn>
              <UserButton appearance={{ elements: { avatarBox: 'w-7 h-7' } }} />
            </SignedIn>
          )}
        </header>

        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
