// Pièces communes des pages légales : lien externe, contact, hébergeur et cadre de la page (en-tête, navigation).
// Utilisées par les textes de l'application et du site avec comptes (LegalPage.tsx) comme par ceux du site vitrine
// (ShowcaseLegal.tsx), qui n'embarque donc aucun autre texte légal.

import type { MouseEvent, ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, GraduationCap } from 'lucide-react';
import ContactLink from '@/components/ContactLink';
import LegalLinks from '@/components/LegalLinks';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { findHostUrl, LEGAL_TITLES, type LegalInfo, type LegalPageKind } from '@/lib/legal';
import { safeExternalUrl } from '@/lib/links';
import { getBridge } from '@/lib/runtime/local';

/** Lien externe : dans l'application Windows, il s'ouvre dans le navigateur du système (pont existant). */
export function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={event => {
        const bridge = getBridge();
        if (!bridge) return;
        event.preventDefault();
        try {
          void bridge.app.openExternal(href).catch(() => undefined);
        } catch {
          // Pont indisponible : le lien reste visible.
        }
      }}
    >
      {children}
    </a>
  );
}

/** Contact de l'éditeur : l'adresse e-mail est un lien « mailto: ». */
export function ContactField({ info }: { info: LegalInfo }) {
  return <ContactLink contact={info.contact} />;
}

/**
 * Hébergeur du site : l'adresse https qu'il porte (« Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723,
 * États-Unis (https://vercel.com) ») est un lien ; la ponctuation qui la suit dans la phrase n'en fait pas partie.
 */
export function HostField({ info }: { info: LegalInfo }) {
  const found = findHostUrl(info.host);
  const href = found ? safeExternalUrl(found.url) : null;
  if (!found || !href) return <>{info.host}</>;
  return (
    <>
      {info.host.slice(0, found.index)}
      <Ext href={href}>{found.url}</Ext>
      {info.host.slice(found.index + found.url.length)}
    </>
  );
}

/** Cadre d'une page légale : en-tête, liens vers les trois pages, puis le texte. */
export function LegalShell({ page, children }: { page: LegalPageKind; children: ReactNode }) {
  useDocumentTitle(LEGAL_TITLES[page]);
  const navigate = useNavigate();
  // La première entrée de l'historique porte la clé « default » : sinon l'utilisateur vient d'une page de l'application.
  const cameFromApp = useLocation().key !== 'default';
  /** « Retour » ramène à la page d'origine (Réglages, assistant d'accueil…) ; arrivé directement sur la page : à l'accueil. */
  const goBack = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!cameFromApp || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(-1);
  };
  return (
    <div className="min-h-screen bg-mg-900">
      <header className="border-b border-white/5">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2.5 text-white" aria-label="Magistra, retour à l'accueil">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-dim to-accent flex items-center justify-center">
              <GraduationCap size={18} className="text-mg-900" aria-hidden="true" />
            </span>
            <span className="text-lg font-semibold tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
              Magistra<span className="text-gold">.</span>
            </span>
          </Link>
          <Link to="/" onClick={goBack} className="inline-flex items-center gap-1.5 text-sm text-mg-200 hover:text-white">
            <ArrowLeft size={14} aria-hidden="true" /> Retour
          </Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-10">
        <nav aria-label="Pages légales" className="mb-6 text-sm text-mg-200">
          <LegalLinks />
        </nav>
        <div className="prose-content">{children}</div>
      </main>
    </div>
  );
}
