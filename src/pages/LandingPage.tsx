import { Link } from 'react-router-dom';
import { SignedIn, SignedOut, SignInButton } from '@clerk/clerk-react';
import {
  Sparkles, GraduationCap, ArrowRight
} from 'lucide-react';

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

function AuthNav() {
  if (!CLERK_KEY) {
    return (
      <Link to="/onboarding" className="btn-primary text-sm py-2 px-5">
        Commencer <ArrowRight size={14} />
      </Link>
    );
  }
  return (
    <>
      <SignedOut>
        <SignInButton mode="modal">
          <button className="btn-primary text-sm py-2 px-5">
            Commencer <ArrowRight size={14} />
          </button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <Link to="/app" className="btn-primary text-sm py-2 px-5">
          Mon espace <ArrowRight size={14} />
        </Link>
      </SignedIn>
    </>
  );
}

function AuthHero() {
  if (!CLERK_KEY) {
    return (
      <Link to="/onboarding" className="btn-primary text-base py-3 px-8">
        Commencer <ArrowRight size={16} />
      </Link>
    );
  }
  return (
    <>
      <SignedOut>
        <SignInButton mode="modal">
          <button className="btn-primary text-base py-3 px-8">
            Commencer <ArrowRight size={16} />
          </button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <Link to="/app" className="btn-primary text-base py-3 px-8">
          Accéder à Magistra <ArrowRight size={16} />
        </Link>
      </SignedIn>
    </>
  );
}

function AuthCTA() {
  if (!CLERK_KEY) {
    return (
      <Link to="/onboarding" className="btn-primary text-base py-3 px-8">
        Accéder à Magistra <ArrowRight size={16} />
      </Link>
    );
  }
  return (
    <>
      <SignedOut>
        <SignInButton mode="modal">
          <button className="btn-primary text-base py-3 px-8">
            Accéder à Magistra <ArrowRight size={16} />
          </button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <Link to="/app" className="btn-primary text-base py-3 px-8">
          Commencer maintenant <ArrowRight size={16} />
        </Link>
      </SignedIn>
    </>
  );
}

const FEATURES_CREATION = [
  { icon: '✦', title: 'Cours complets', desc: 'Entrez un sujet, un niveau, une durée. Magistra génère un cours structuré avec objectifs, déroulé minuté, trace écrite — prêt à imprimer.' },
  { icon: '◈', title: 'Exercices différenciés', desc: 'Séries progressives du facile au difficile, avec corrigé, barème, coup de pouce pour les élèves en difficulté et défi pour les avancés.' },
  { icon: '◎', title: 'Évaluations & barèmes', desc: 'Contrôles complets avec en-tête formel, barème point par point, corrigé détaillé et grille de compétences — alignés sur le BO.' },
  { icon: '⬡', title: 'Séquences pédagogiques', desc: 'Planification multi-séances avec problématique, déroulé, différenciation, évaluation formative et sommative intégrées.' },
  { icon: '◇', title: 'Fiches de préparation', desc: 'Déroulement minuté en tableau, objectifs, compétences, matériel, modalités — le format que chaque inspecteur attend.' },
  { icon: '📅', title: 'Progressions annuelles', desc: 'Planification de l\'année entière par période, conforme au programme officiel, avec repères de progressivité.' },
];

const FEATURES_OUTILS = [
  { icon: '💬', title: 'Appréciations de bulletins', desc: 'Fini les 180 appréciations à rédiger à la main. Choisissez le profil, Magistra propose — vous choisissez et personnalisez.' },
  { icon: '🎯', title: 'Différenciation automatique', desc: 'Un exercice → 3 versions : accompagnement renforcé (DYS, allophones), standard, et approfondissement (HPI). Mêmes compétences, chemins adaptés.' },
  { icon: '✉️', title: 'Courriers aux parents', desc: 'Comportement, absences, félicitations, réunion, incident, orientation — des courriers professionnels et bienveillants en 30 secondes.' },
  { icon: '📓', title: 'Cahier journal', desc: 'Journée complète détaillée avec horaires, matières, objectifs, déroulement — obligatoire en primaire, généré en un clic.' },
  { icon: '🔍', title: 'Corrigé annoté', desc: 'Collez le travail d\'un élève. Magistra analyse, identifie les erreurs, corrige, note et donne des conseils de progression.' },
];

const FEATURES_PLUS = [
  { icon: '🏫', title: 'TPS à Doctorat', desc: 'De la Toute Petite Section de maternelle au Master 2. 30 niveaux, 40+ matières, programmes 2026 intégrés.' },
  { icon: '◉', title: 'Open-source & RGPD', desc: 'Vos données n\'appartiennent qu\'à vous. Code public, auditable. Aucune donnée élève collectée. Hébergement EU possible.' },
  { icon: '✧', title: 'Disponible partout', desc: 'France, Europe, pays francophones. Export PDF et Markdown. L\'éducation n\'a pas de frontières.' },
];

const STEPS = [
  { num: '1', title: 'Créez votre profil', desc: 'Personnalisez votre espace : établissement, niveaux, matière. Magistra s\'adapte à votre contexte.' },
  { num: '2', title: 'Choisissez votre outil', desc: '11 outils à disposition : cours, exercices, évaluations, appréciations, différenciation, courriers... Tout ce dont un enseignant a besoin.' },
  { num: '3', title: 'Magistra génère en secondes', desc: 'Contenu structuré, conforme au programme officiel, prêt à l\'emploi. Retouchez si besoin, exportez en PDF, enseignez.' },
];

const STATS = [
  { value: '11', label: 'Outils pédagogiques intégrés : cours, exercices, évaluations, séquences, fiches de prep, progressions, appréciations, différenciation, courriers, cahier journal, corrigés.' },
  { value: '8h+', label: 'C\'est le temps moyen passé chaque semaine par un enseignant à la seule préparation des cours, hors classe. Magistra réduit ça à quelques minutes.' },
  { value: '100%', label: 'Open-source. Code public, auditable, hébergeable soi-même. Aucune donnée élève collectée. Construit par des enseignants, pour des enseignants.' },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-mg-900 overflow-x-hidden">
      {/* Nav */}
      <nav className="fixed top-0 w-full z-50 bg-mg-900/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent-dim to-accent flex items-center justify-center">
              <GraduationCap size={18} className="text-mg-900" />
            </div>
            <span className="text-lg font-semibold tracking-tight text-white" style={{ fontFamily: 'var(--font-display)' }}>
              Magistra<span className="text-accent">.</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <AuthNav />
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 px-6">
        {/* Glow */}
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-accent/5 rounded-full blur-[120px] pointer-events-none" />

        <div className="max-w-3xl mx-auto text-center relative z-10">
          <div className="badge badge-accent mb-6 mx-auto">
            <Sparkles size={12} /> Un projet FutureAI
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl text-white leading-[1.15] mb-6" style={{ fontFamily: 'var(--font-display)' }}>
            L'IA qui prépare{' '}
            <br className="hidden sm:block" />
            vos cours à votre{' '}
            <em className="text-accent not-italic">place</em>
          </h1>

          <p className="text-mg-300 text-base sm:text-lg max-w-xl mx-auto mb-8 leading-relaxed">
            Magistra est l'assistant IA open-source conçu pour les enseignants. Générez des cours, des exercices
            et des évaluations en quelques secondes — adaptés à vos élèves, à votre programme, à votre style.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <AuthHero />
            <a href="https://futurai.space" target="_blank" className="btn-secondary text-base py-3 px-6">
              Découvrir FutureAI
            </a>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-16 sm:py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs uppercase tracking-widest text-accent mb-3">Le constat</p>
            <h2 className="text-2xl sm:text-3xl text-white" style={{ fontFamily: 'var(--font-display)' }}>
              Les élèves utilisent l'IA. Les profs{' '}
              <em className="text-accent not-italic">préparent</em> encore à la main.
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {STATS.map((stat, i) => (
              <div key={i} className="card p-6 text-center">
                <p className="text-3xl font-bold text-accent mb-3" style={{ fontFamily: 'var(--font-display)' }}>
                  {stat.value}
                </p>
                <p className="text-sm text-mg-300 leading-relaxed">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="glow-line max-w-xl mx-auto" />

      {/* Features — Creation */}
      <section className="py-16 sm:py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs uppercase tracking-widest text-accent mb-3">Contenu pédagogique</p>
            <h2 className="text-2xl sm:text-3xl text-white" style={{ fontFamily: 'var(--font-display)' }}>
              Tout ce dont un enseignant a besoin,{' '}
              <em className="text-accent not-italic">enfin</em> réuni
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES_CREATION.map((f, i) => (
              <div key={i} className="card p-6 group">
                <span className="text-2xl text-accent block mb-3 group-hover:scale-110 transition-transform">{f.icon}</span>
                <h3 className="text-sm font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-mg-300 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features — Outils */}
      <section className="py-10 sm:py-14 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <p className="text-xs uppercase tracking-widest text-accent mb-3">Outils enseignant</p>
            <h2 className="text-2xl sm:text-3xl text-white" style={{ fontFamily: 'var(--font-display)' }}>
              Les tâches chronophages,{' '}
              <em className="text-accent not-italic">automatisées</em>
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES_OUTILS.map((f, i) => (
              <div key={i} className="card p-6 group">
                <span className="text-2xl block mb-3 group-hover:scale-110 transition-transform">{f.icon}</span>
                <h3 className="text-sm font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-mg-300 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="glow-line max-w-xl mx-auto" />

      {/* Plus */}
      <section className="py-10 sm:py-14 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {FEATURES_PLUS.map((f, i) => (
              <div key={i} className="card p-6 text-center group">
                <span className="text-2xl text-accent block mb-3 mx-auto group-hover:scale-110 transition-transform">{f.icon}</span>
                <h3 className="text-sm font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-mg-300 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="glow-line max-w-xl mx-auto" />

      {/* Steps */}
      <section className="py-16 sm:py-20 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl text-white" style={{ fontFamily: 'var(--font-display)' }}>
              Simple comme <em className="text-accent not-italic">bonjour</em>
            </h2>
          </div>

          <div className="space-y-6">
            {STEPS.map((step, i) => (
              <div key={i} className="flex gap-5">
                <div className="shrink-0">
                  <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center">
                    <span className="text-accent font-semibold text-sm">{step.num}</span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className="w-px h-8 bg-accent/10 mx-auto mt-2" />
                  )}
                </div>
                <div className="pb-4">
                  <h3 className="text-base font-semibold text-white mb-1">{step.title}</h3>
                  <p className="text-sm text-mg-300 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="glow-line max-w-xl mx-auto" />

      {/* FutureAI ecosystem */}
      <section className="py-16 sm:py-20 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-xs uppercase tracking-widest text-accent mb-3">L'écosystème FutureAI</p>
          <h2 className="text-2xl sm:text-3xl text-white mb-4" style={{ fontFamily: 'var(--font-display)' }}>
            Magistra fait partie d'un <em className="text-accent not-italic">mouvement</em>
          </h2>
          <p className="text-sm text-mg-300 leading-relaxed max-w-xl mx-auto mb-6">
            FutureAI est une plateforme open-source qui co-construit des outils IA avec des communautés
            du monde entier. Notre mission : rendre l'intelligence artificielle utile, accessible et
            éthique — éducation, santé, agriculture — en France comme dans les pays en développement.
          </p>
          <a href="https://futurai.space" target="_blank" className="btn-secondary inline-flex">
            Découvrir FutureAI <ArrowRight size={14} />
          </a>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 sm:py-20 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <div className="card p-8 sm:p-12 border-accent/10 bg-gradient-to-b from-mg-800 to-mg-900 relative overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[200px] bg-accent/5 rounded-full blur-[80px] pointer-events-none" />
            <div className="relative z-10">
              <h2 className="text-2xl sm:text-3xl text-white mb-3" style={{ fontFamily: 'var(--font-display)' }}>
                Prêt à gagner du <em className="text-accent not-italic">temps</em> ?
              </h2>
              <p className="text-sm text-mg-300 mb-6 max-w-md mx-auto">
                Un outil open-source construit par des enseignants, pour des enseignants.
              </p>
              <AuthCTA />
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-mg-400" style={{ fontFamily: 'var(--font-display)' }}>
              Magistra<span className="text-accent">.</span>
            </span>
          </div>
          <p className="text-xs text-mg-500">
            Un projet{' '}
            <a href="https://futurai.space" target="_blank" className="text-accent hover:underline">FutureAI</a>
            {' '}· Bordeaux, France · 2026
          </p>
        </div>
      </footer>
    </div>
  );
}
