// Pièces communes des pages légales : lien externe, valeur ou marque « à compléter », contact, avis « projet de texte »
// et cadre de la page (en-tête, navigation, avis). Utilisées par les textes de l'application et du site avec comptes
// (LegalPage.tsx) comme par ceux du site vitrine (ShowcaseLegal.tsx), qui n'embarque donc aucun autre texte légal.

import type { MouseEvent, ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, GraduationCap } from 'lucide-react';
import LegalLinks from '@/components/LegalLinks';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import {
  emailOf, LEGAL_ENV_NAMES, LEGAL_LABELS, LEGAL_TITLES, relevantFields, type LegalField, type LegalInfo, type LegalPageKind,
} from '@/lib/legal';
import { getBridge } from '@/lib/runtime/local';
import type { PageMode } from '@/lib/runtime/types';

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

/** Valeur renseignée, ou marque « à compléter » bien visible (jamais un blanc silencieux). */
export function Field({ info, name }: { info: LegalInfo; name: LegalField }) {
  const value = info[name];
  if (value) return <>{value}</>;
  return (
    <mark
      className="rounded bg-warning/15 px-1.5 py-0.5 font-semibold text-warning"
      data-legal-todo={name}
    >
      [à compléter : {LEGAL_LABELS[name].toLowerCase()}]
    </mark>
  );
}

export function ContactField({ info }: { info: LegalInfo }) {
  const { contact } = info;
  const email = emailOf(contact);
  if (!contact || !email) return <Field info={info} name="contact" />;
  // Seule l'adresse e-mail devient un lien ; le reste du texte (« Service X, … ») est affiché tel quel.
  const at = contact.indexOf(email);
  return (
    <>
      {contact.slice(0, at)}
      <a href={`mailto:${email}`}>{email}</a>
      {contact.slice(at + email.length)}
    </>
  );
}

function DraftNotice({ info, fields }: { info: LegalInfo; fields: LegalField[] }) {
  const missing = fields.filter(field => info.missing.includes(field));
  // Textes validés et complets : plus d'avis. Validés mais incomplets : la liste seule, sans la phrase « projet de texte ».
  if (info.validated && missing.length === 0) return null;
  return (
    <div role="note" className="mb-8 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-mg-50">
      {!info.validated && (
        <>
          <p className="flex items-start gap-2 font-semibold text-warning">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>Projet de texte, à faire valider avant mise en ligne</span>
          </p>
          <p className="mt-1.5">
            Ce texte a été rédigé à partir du fonctionnement réel de Magistra. Il s'agit d'un modèle de départ : il doit
            être relu et validé par l'éditeur du site (et, au besoin, par un conseil juridique) avant d'être considéré
            comme définitif.
          </p>
        </>
      )}
      {missing.length > 0 && (
        <div className={info.validated ? undefined : 'mt-2'} data-legal-missing>
          <p className="font-semibold">Informations à compléter par l'éditeur du site :</p>
          <ul className="mt-1 list-disc pl-5">
            {missing.map(field => (
              <li key={field}>
                {LEGAL_LABELS[field]} — variable de build <code>{LEGAL_ENV_NAMES[field]}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Cadre d'une page légale : en-tête, liens vers les trois pages, avis « à compléter » (selon `mode`), puis le texte. */
export function LegalShell({ page, info, mode, children }: { page: LegalPageKind; info: LegalInfo; mode: PageMode; children: ReactNode }) {
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
        <DraftNotice info={info} fields={relevantFields(page, mode)} />
        <div className="prose-content">{children}</div>
      </main>
    </div>
  );
}
