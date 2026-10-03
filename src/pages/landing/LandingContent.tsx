// Contenu de la page d'accueil, commun à l'application (LandingPage : « Commencer », mode démonstration, personnel,
// web) et au site vitrine (SiteLanding : « Télécharger pour Windows »).
//
// Ce fichier n'importe ni service de connexion, ni connecteur local, ni état de l'IA, ni fournisseur d'exécution : tout
// ce qui en dépend arrive par props (boutons d'accès, note du héros, section de téléchargement). Le site vitrine n'embarque
// donc rien de l'application (scripts/verify-site.mjs le contrôle sur le build).

import type { ReactNode } from 'react';
import { ArrowRight, GraduationCap } from 'lucide-react';
import AuthorCredit from '@/components/AuthorCredit';
import LegalLinks from '@/components/LegalLinks';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { FEATURES_CREATION, FEATURES_OUTILS, FEATURES_PLUS, STATS, STEPS } from './content';

interface LandingContentProps {
  /** Bouton de la barre de navigation (accès à l'application, ou « Télécharger »). */
  navAction: ReactNode;
  /** Bouton principal du héros ; « Découvrir FutureAI » le suit. */
  heroAction: ReactNode;
  /** Phrase sous les boutons du héros (état de l'application, mode, lien de téléchargement…). */
  heroNote?: ReactNode;
  /** Section « Magistra pour Windows » (téléchargement), absente de l'application Windows, déjà installée. */
  windowsSection?: ReactNode;
  /** Bouton de l'appel à l'action final. */
  finalAction: ReactNode;
  /** Les cartes qui mènent au téléchargement affichent leur lien « Télécharger pour Windows ». */
  windowsLinks?: boolean;
}

export default function LandingContent({
  navAction, heroAction, heroNote, windowsSection, finalAction, windowsLinks = true,
}: LandingContentProps) {
  useDocumentTitle(null);

  return (
    <div className="min-h-screen bg-mg-900 overflow-x-hidden">
      {/* Navigation */}
      <nav aria-label="Navigation du site" className="fixed top-0 w-full z-50 bg-mg-900/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-dim to-accent flex items-center justify-center">
              <GraduationCap size={18} className="text-mg-900" aria-hidden="true" />
            </div>
            <span className="text-lg font-semibold tracking-tight text-white" style={{ fontFamily: 'var(--font-display)' }}>
              Magistra<span className="text-gold">.</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            {navAction}
          </div>
        </div>
      </nav>

      <main>
        {/* Hero */}
        <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 px-6">
          <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[600px] max-w-full h-[400px] bg-accent/5 rounded-full blur-[120px] pointer-events-none" aria-hidden="true" />

          <div className="max-w-3xl mx-auto text-center relative z-10">
            <AuthorCredit variant="badge" />

            <h1 className="text-4xl sm:text-5xl lg:text-6xl text-white leading-[1.15] mb-6" style={{ fontFamily: 'var(--font-display)' }}>
              L'IA qui prépare{' '}
              <br className="hidden sm:block" />
              vos cours <em className="text-accent not-italic">avec</em> vous
            </h1>

            <p className="text-mg-200 text-base sm:text-lg max-w-xl mx-auto mb-8 leading-relaxed">
              Magistra est un assistant pédagogique open source pour les enseignants, de la maternelle au doctorat,
              avec un accent sur le supérieur. Préparez cours, TD, examens et syllabus à partir de vos propres documents,
              avec des sources vérifiables — des brouillons solides, à relire et adapter.
            </p>

            <div className="flex flex-col sm:flex-row sm:flex-wrap items-center justify-center gap-3">
              {heroAction}
              <a href="https://futurai.space" target="_blank" rel="noopener noreferrer" className="btn-secondary text-base py-3 px-6">
                Découvrir FutureAI
              </a>
            </div>
            {heroNote}
          </div>
        </section>

        {/* Chiffres */}
        <section className="py-16 sm:py-20 px-6" aria-labelledby="constat-title">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-12">
              <p className="text-xs uppercase tracking-widest text-accent mb-3">Le constat</p>
              <h2 id="constat-title" className="text-2xl sm:text-3xl text-white" style={{ fontFamily: 'var(--font-display)' }}>
                Les élèves utilisent l'IA. Les profs{' '}
                <em className="text-accent not-italic">préparent</em> encore à la main.
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {STATS.map(stat => (
                <div key={stat.value} className="card p-6 text-center">
                  <p className="text-3xl font-bold text-accent mb-3" style={{ fontFamily: 'var(--font-display)' }}>
                    {stat.value}
                  </p>
                  <p className="text-sm text-mg-200 leading-relaxed">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="glow-line max-w-xl mx-auto" aria-hidden="true" />

        {/* Fonctionnalités — création */}
        <section className="py-16 sm:py-20 px-6" aria-labelledby="creation-title">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-12">
              <p className="text-xs uppercase tracking-widest text-accent mb-3">Contenu pédagogique</p>
              <h2 id="creation-title" className="text-2xl sm:text-3xl text-white" style={{ fontFamily: 'var(--font-display)' }}>
                Tout ce dont un enseignant a besoin,{' '}
                <em className="text-accent not-italic">enfin</em> réuni
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {FEATURES_CREATION.map(f => (
                <div key={f.title} className="card p-6 group">
                  <span className="text-2xl text-accent block mb-3 group-hover:scale-110 transition-transform" aria-hidden="true">{f.icon}</span>
                  <h3 className="text-sm font-semibold text-white mb-2">{f.title}</h3>
                  <p className="text-sm text-mg-200 leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Fonctionnalités — outils */}
        <section className="py-10 sm:py-14 px-6" aria-labelledby="outils-title">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-10">
              <p className="text-xs uppercase tracking-widest text-accent mb-3">Outils enseignant</p>
              <h2 id="outils-title" className="text-2xl sm:text-3xl text-white" style={{ fontFamily: 'var(--font-display)' }}>
                Les tâches chronophages,{' '}
                <em className="text-accent not-italic">allégées</em>
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {FEATURES_OUTILS.map(f => (
                <div key={f.title} className="card p-6 group">
                  <span className="text-2xl block mb-3 group-hover:scale-110 transition-transform" aria-hidden="true">{f.icon}</span>
                  <h3 className="text-sm font-semibold text-white mb-2">{f.title}</h3>
                  <p className="text-sm text-mg-200 leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="glow-line max-w-xl mx-auto" aria-hidden="true" />

        {/* Engagements */}
        <section className="py-10 sm:py-14 px-6" aria-labelledby="plus-title">
          <div className="max-w-5xl mx-auto">
            <h2 id="plus-title" className="sr-only">Nos engagements</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {FEATURES_PLUS.map(f => (
                <div key={f.title} className="card p-6 text-center group">
                  <span className="text-2xl text-accent block mb-3 mx-auto group-hover:scale-110 transition-transform" aria-hidden="true">{f.icon}</span>
                  <h3 className="text-sm font-semibold text-white mb-2">{f.title}</h3>
                  <p className="text-sm text-mg-200 leading-relaxed">{f.desc}</p>
                  {f.link && windowsLinks && (
                    <a
                      href={f.link.href}
                      {...(f.link.href.startsWith('#') ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                      className="mt-3 inline-flex items-center gap-1 text-sm text-accent hover:underline underline-offset-4"
                    >
                      {f.link.label} <ArrowRight size={13} aria-hidden="true" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="glow-line max-w-xl mx-auto" aria-hidden="true" />

        {/* Magistra pour Windows : dernière version publiée, étapes, IA locale (section publique ; absente de
            l'application, déjà installée) */}
        {windowsSection && (
          <>
            {windowsSection}

            <div className="glow-line max-w-xl mx-auto" aria-hidden="true" />
          </>
        )}

        {/* Étapes */}
        <section className="py-16 sm:py-20 px-6" aria-labelledby="steps-title">
          <div className="max-w-3xl mx-auto">
            <div className="text-center mb-12">
              <h2 id="steps-title" className="text-2xl sm:text-3xl text-white" style={{ fontFamily: 'var(--font-display)' }}>
                Simple comme <em className="text-accent not-italic">bonjour</em>
              </h2>
            </div>

            <ol className="space-y-6">
              {STEPS.map((step, i) => (
                <li key={step.num} className="flex gap-5">
                  <div className="shrink-0">
                    <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
                      <span className="text-accent font-semibold text-sm">{step.num}</span>
                    </div>
                    {i < STEPS.length - 1 && <div className="w-px h-8 bg-accent/10 mx-auto mt-2" aria-hidden="true" />}
                  </div>
                  <div className="pb-4">
                    <h3 className="text-base font-semibold text-white mb-1">{step.title}</h3>
                    <p className="text-sm text-mg-200 leading-relaxed">{step.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <div className="glow-line max-w-xl mx-auto" aria-hidden="true" />

        {/* Auteur */}
        <AuthorCredit variant="section" />

        <div className="glow-line max-w-xl mx-auto" aria-hidden="true" />

        {/* Écosystème FutureAI */}
        <section className="py-16 sm:py-20 px-6" aria-labelledby="futurai-title">
          <div className="max-w-3xl mx-auto text-center">
            <p className="text-xs uppercase tracking-widest text-accent mb-3">L'écosystème FutureAI</p>
            <h2 id="futurai-title" className="text-2xl sm:text-3xl text-white mb-4" style={{ fontFamily: 'var(--font-display)' }}>
              Magistra fait partie d'un <em className="text-accent not-italic">mouvement</em>
            </h2>
            <p className="text-sm text-mg-200 leading-relaxed max-w-xl mx-auto mb-6">
              FutureAI co-construit des outils d’IA open source avec des communautés du monde entier. Notre mission :
              rendre l’intelligence artificielle utile, accessible et éthique — éducation, santé, agriculture —
              en France comme dans les pays en développement.
            </p>
            <a href="https://futurai.space" target="_blank" rel="noopener noreferrer" className="btn-secondary inline-flex">
              Découvrir FutureAI <ArrowRight size={14} aria-hidden="true" />
            </a>
          </div>
        </section>

        {/* Appel à l'action */}
        <section className="py-16 sm:py-20 px-6" aria-labelledby="cta-title">
          <div className="max-w-2xl mx-auto text-center">
            <div className="card p-8 sm:p-12 border-accent/10 bg-gradient-to-b from-mg-800 to-mg-900 relative overflow-hidden">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[200px] bg-accent/5 rounded-full blur-[80px] pointer-events-none" aria-hidden="true" />
              <div className="relative z-10">
                <h2 id="cta-title" className="text-2xl sm:text-3xl text-white mb-3" style={{ fontFamily: 'var(--font-display)' }}>
                  Prêt à gagner du <em className="text-accent not-italic">temps</em> ?
                </h2>
                <p className="text-sm text-mg-200 mb-6 max-w-md mx-auto">
                  Un outil open source et non lucratif, conçu pour simplifier le quotidien des enseignants.
                </p>
                {finalAction}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Pied de page */}
      <footer className="border-t border-white/5 py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-mg-200" style={{ fontFamily: 'var(--font-display)' }}>
              Magistra<span className="text-gold">.</span>
            </span>
          </div>
          <p className="text-xs text-mg-300 text-center">
            <AuthorCredit variant="footer" />
          </p>
          <nav aria-label="Informations légales" className="text-xs text-mg-300 text-center">
            <LegalLinks />
          </nav>
        </div>
      </footer>
    </div>
  );
}
