// Attribution de l'auteur, sous trois formes : le badge du héros de la page d'accueil (le nom est lisible dès le premier
// écran), la section « Qui est derrière Magistra ? » (courte présentation et lien vers le profil professionnel) et le
// pied de page. FutureAI reste nommé : le visiteur comprend qui porte le projet et dans quel cadre.
//
// Rien n'est inventé : la présentation dit seulement ce que le dépôt établit (conçu et développé par Juan Robin, dans le
// cadre du projet FutureAI ; gratuit, IA qui reste sur l'ordinateur). Le lien de profil vient de authorProfile
// (https seulement, repli sur le profil LinkedIn) ; il s'ouvre dans un nouvel onglet — dans l'application Windows, le
// gestionnaire d'ouverture d'Electron l'envoie au navigateur du système.

import { Sparkles } from 'lucide-react';
import { AUTHOR_CREDIT, AUTHOR_NAME, authorProfile, type AuthorProfile } from '@shared/author';

export type AuthorCreditVariant = 'badge' | 'section' | 'footer';

interface AuthorCreditProps {
  variant: AuthorCreditVariant;
  /** Profil à afficher ; par défaut, celui du build (VITE_AUTHOR_PROFILE_URL). */
  profile?: AuthorProfile;
  /** Pied de page : ajoute le lien vers le profil (Réglages de l'application). */
  showProfile?: boolean;
}

const FUTUREAI_URL = 'https://futurai.space';

/** Lien externe dans une phrase : nouvel onglet ; `hint` l'annonce aux lecteurs d'écran (liens de profil). */
function ExternalLink({ href, children, hint = false }: { href: string; children: string; hint?: boolean }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline underline-offset-4">
      {children}
      {hint && <span className="sr-only"> (s’ouvre dans un nouvel onglet)</span>}
    </a>
  );
}

export default function AuthorCredit({ variant, profile = authorProfile(import.meta.env as unknown as Record<string, unknown>), showProfile = false }: AuthorCreditProps) {
  if (variant === 'badge') {
    return (
      <p className="badge badge-accent mb-6 mx-auto max-w-full text-center flex-wrap justify-center text-sm px-4 py-1.5" data-testid="author-credit">
        <Sparkles size={14} aria-hidden="true" />
        <strong className="font-semibold text-accent-bright">{AUTHOR_CREDIT}</strong>
        <span>· un projet FutureAI</span>
      </p>
    );
  }

  if (variant === 'footer') {
    return (
      <span data-testid="author-credit">
        {AUTHOR_CREDIT} · Un projet <ExternalLink href={FUTUREAI_URL}>FutureAI</ExternalLink> · Bordeaux, France · Application gratuite
        {showProfile && (
          <>
            {' · '}
            <ExternalLink href={profile.url} hint>{profile.label}</ExternalLink>
          </>
        )}
      </span>
    );
  }

  return (
    <section className="py-16 sm:py-20 px-6" aria-labelledby="author-title" data-testid="author-credit">
      <div className="max-w-3xl mx-auto text-center">
        <p className="text-xs uppercase tracking-widest text-accent mb-3">L’auteur</p>
        <h2 id="author-title" className="text-2xl sm:text-3xl text-white mb-4" style={{ fontFamily: 'var(--font-display)' }}>
          Qui est derrière <em className="text-accent not-italic">Magistra</em> ?
        </h2>
        <p className="text-sm sm:text-base text-mg-200 leading-relaxed max-w-xl mx-auto mb-6">
          Magistra est conçu et développé par <strong className="font-semibold text-white">{AUTHOR_NAME}</strong>, dans le cadre du projet{' '}
          <ExternalLink href={FUTUREAI_URL}>FutureAI</ExternalLink> : un assistant gratuit qui allège la préparation
          des enseignants, avec une IA qui reste sur leur ordinateur.
        </p>
        <a href={profile.url} target="_blank" rel="noopener noreferrer" className="btn-secondary inline-flex">
          {profile.label}
          <span className="sr-only"> de {AUTHOR_NAME} (s’ouvre dans un nouvel onglet)</span>
        </a>
      </div>
    </section>
  );
}
