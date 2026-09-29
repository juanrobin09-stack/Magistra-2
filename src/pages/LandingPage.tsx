import { Link } from 'react-router-dom';
import { ClerkFailed, ClerkLoading, Show, SignInButton } from '@clerk/react';
import { ArrowRight, Download, GraduationCap, Sparkles } from 'lucide-react';
import { ALL_MATIERES, ALL_TYPES } from '@shared/catalog';
import { ALL_NIVEAUX } from '@shared/levels';
import { useCapabilities } from '@/hooks/useAIStatus';
import { WINDOWS_DOWNLOAD_URL } from '@/lib/links';
import { detectMode, useOptionalRuntime } from '@/lib/runtime/context';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

// Chiffres réels, calculés à partir du référentiel (jamais saisis à la main).
const NB_NIVEAUX = ALL_NIVEAUX.length;
const NB_MATIERES = ALL_MATIERES.filter(m => m.value !== 'autre').length;
const NB_OUTILS = ALL_TYPES.length;

type CtaSize = 'nav' | 'hero';

const CTA_CLASS: Record<CtaSize, string> = {
  nav: 'btn-primary text-sm py-2 px-5',
  hero: 'btn-primary text-base py-3 px-8',
};

/**
 * Bouton d'accès à l'application :
 * - web : connexion (fenêtre Clerk) si déconnecté, « Mon espace » si connecté, « Réessayer » si le
 *   service de connexion n'a pas pu être chargé ;
 * - démonstration / Windows : l'espace si un profil existe, sinon la création du profil ;
 * - mode personnel : l'application (le code d'accès est demandé s'il manque, puis le profil).
 */
function AccessButton({ size, signedOutLabel = 'Commencer' }: { size: CtaSize; signedOutLabel?: string }) {
  const runtime = useOptionalRuntime();
  const mode = runtime?.mode ?? detectMode();
  const icon = <ArrowRight size={size === 'nav' ? 14 : 16} aria-hidden="true" />;

  if (mode === 'web') {
    return (
      <>
        <ClerkLoading>
          <span className={`${CTA_CLASS[size]} opacity-60 cursor-wait`} aria-busy="true">
            Connexion… {icon}
          </span>
        </ClerkLoading>
        <ClerkFailed>
          <button
            type="button"
            className={CTA_CLASS[size]}
            onClick={() => window.location.reload()}
            title="Le service de connexion n'a pas pu être chargé. Vérifiez votre connexion Internet."
          >
            {size === 'nav' ? 'Réessayer la connexion' : 'Connexion indisponible — réessayer'}
          </button>
        </ClerkFailed>
        <Show when="signed-out">
          <SignInButton mode="modal">
            <button type="button" className={CTA_CLASS[size]}>
              {signedOutLabel} {icon}
            </button>
          </SignInButton>
        </Show>
        <Show when="signed-in">
          <Link to="/app" className={CTA_CLASS[size]}>
            Mon espace {icon}
          </Link>
        </Show>
      </>
    );
  }

  const hasProfile = Boolean(runtime?.profile);
  return (
    <Link to={hasProfile || mode === 'local' || mode === 'personal' ? '/app' : '/onboarding'} className={CTA_CLASS[size]}>
      {hasProfile ? 'Mon espace' : signedOutLabel} {icon}
    </Link>
  );
}

const FEATURES_CREATION = [
  { icon: '✦', title: 'Cours', desc: 'Entrez un sujet, un niveau, une durée : Magistra propose un cours structuré (objectifs, plan, déroulé, trace écrite — ou CM problématisé dans le supérieur).' },
  { icon: '◈', title: 'Exercices et TD', desc: 'Séries progressives avec éléments de correction ; versions différenciées quand vous le demandez.' },
  { icon: '◎', title: 'Évaluations et examens', desc: 'Sujet, corrigé et barème ou grille d’évaluation, à vérifier avant de les donner à vos élèves ou étudiants.' },
  { icon: '⬡', title: 'Séquences et plans de module', desc: 'Organisation multi-séances, ou d’une UE en CM, TD et TP, avec objectifs, activités et modalités d’évaluation.' },
  { icon: '◇', title: 'Fiches de séance', desc: 'Déroulé minuté, objectifs, matériel et modalités de travail, prêts à être ajustés à votre classe.' },
  { icon: '📅', title: 'Progressions et syllabus', desc: 'Planification annuelle ou semestrielle, à ajuster à votre programme, à votre maquette et à votre calendrier.' },
];

const FEATURES_OUTILS = [
  { icon: '💬', title: 'Appréciations et commentaires', desc: 'Choisissez un profil et un nombre d’appréciations : Magistra propose des formulations variées, à copier puis personnaliser dans votre logiciel de vie scolaire.' },
  { icon: '🎯', title: 'Différenciation', desc: 'Un exercice décliné selon les profils que vous cochez : accompagnement renforcé, standard, approfondissement. Mêmes objectifs, chemins adaptés.' },
  { icon: '✉️', title: 'Courriers aux familles et aux étudiants', desc: 'Absences, félicitations, réunion, orientation… des brouillons clairs et bienveillants, à relire avant envoi.' },
  { icon: '📓', title: 'Cahier journal et planning', desc: 'Journée de classe ou d’enseignement détaillée : horaires, disciplines, objectifs et déroulement.' },
  { icon: '🔍', title: 'Corrigé annoté', desc: 'Collez un travail d’élève ou une copie : Magistra repère les erreurs et propose une correction commentée. Avec l’IA locale, la copie reste sur votre ordinateur.' },
];

const FEATURES_PLUS: { icon: string; title: string; desc: string; link?: { href: string; label: string } }[] = [
  { icon: '🏫', title: 'De la maternelle au doctorat', desc: `${NB_NIVEAUX} niveaux et ${NB_MATIERES} matières, avec un accent sur le supérieur : CM, TD, examens, syllabus, vocabulaire universitaire.` },
  {
    icon: '💻',
    title: 'IA locale gratuite sur Windows',
    desc: 'L’application Windows fait tourner un modèle open weights sur votre ordinateur (Ollama) : vos documents restent sur votre ordinateur.',
    link: { href: WINDOWS_DOWNLOAD_URL, label: 'Télécharger pour Windows' },
  },
  { icon: '🏛️', title: 'Sur le web, une IA annoncée clairement', desc: 'Sur le site, Magistra utilise le serveur d’IA compatible OpenAI configuré par votre établissement ou un service en ligne choisi par l’administrateur : l’application indique toujours à qui vos textes sont envoyés.' },
  { icon: '📚', title: 'Sources vérifiables', desc: 'Vos documents (PDF, Word, PowerPoint…), HAL, Crossref et le web : les citations renvoient aux sources réellement utilisées.' },
  { icon: '◉', title: 'Open source, licence MIT', desc: 'Code public et auditable, projet non lucratif : pas d’abonnement, pas de quota commercial.' },
  { icon: '✧', title: 'À relire et adapter', desc: 'Magistra propose des brouillons structurés ; vous restez l’auteur. Relisez et vérifiez, puis copiez ou exportez (Markdown, PDF) pour adapter le texte dans votre traitement de texte. Besoin d’un autre angle ? Précisez vos consignes et relancez.' },
];

const STEPS = [
  { num: '1', title: 'Créez votre profil', desc: 'Niveaux, matière, discipline : Magistra adapte le vocabulaire et les exigences à votre contexte. Votre profil reste propre à votre compte ou à votre ordinateur.' },
  { num: '2', title: 'Choisissez un outil et vos sources', desc: `${NB_OUTILS} outils : cours, TD, examens, syllabus, appréciations, différenciation, courriers… Ajoutez vos documents ou activez la recherche HAL, Crossref ou web.` },
  { num: '3', title: 'Relisez, exportez, adaptez', desc: 'Magistra rédige un brouillon structuré qui cite ses sources. Vous le relisez, le copiez ou l’exportez en Markdown ou en PDF, puis l’adaptez dans votre traitement de texte.' },
];

const STATS = [
  { value: String(NB_OUTILS), label: 'Outils pédagogiques : cours, exercices et TD, évaluations, séquences, fiches de séance, progressions, appréciations, différenciation, courriers, cahier journal, corrigés.' },
  { value: String(NB_NIVEAUX), label: `Niveaux, de la Toute Petite Section au doctorat, et ${NB_MATIERES} matières. Dans le supérieur, les outils parlent CM, TD, examens et syllabus.` },
  { value: 'MIT', label: 'Open source sous licence MIT : code public et auditable, projet non lucratif. Les contenus produits sont à relire et adapter par l’enseignant.' },
];

/**
 * Mode personnel : ce qui arrive réellement aux textes, selon l'IA branchée sur le serveur de ce poste
 * (fiche prestataire de /api/status). Sans code d'accès, message générique.
 */
function PersonalNote() {
  const runtime = useOptionalRuntime();
  const caps = useCapabilities({ enabled: runtime?.mode === 'personal' });
  const message = caps.capabilities?.privacy.message;
  return (
    <p className="text-xs text-mg-300 mt-6 max-w-md mx-auto" role="note">
      Mode personnel : Magistra fonctionne avec le serveur démarré sur cet ordinateur, sans compte.
      {message ? ` ${message}` : ' L’intelligence artificielle utilisée est indiquée dans l’application (Générer, Réglages).'}
    </p>
  );
}

export default function LandingPage() {
  useDocumentTitle(null);
  const runtime = useOptionalRuntime();
  const mode = runtime?.mode ?? detectMode();
  const isDemo = mode === 'demo';

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
              Magistra<span className="text-accent">.</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <AccessButton size="nav" />
          </div>
        </div>
      </nav>

      <main>
        {/* Hero */}
        <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 px-6">
          <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[600px] max-w-full h-[400px] bg-accent/5 rounded-full blur-[120px] pointer-events-none" aria-hidden="true" />

          <div className="max-w-3xl mx-auto text-center relative z-10">
            <div className="badge badge-accent mb-6 mx-auto">
              <Sparkles size={12} aria-hidden="true" /> Un projet FutureAI · open source
            </div>

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
              <AccessButton size="hero" />
              <a href="https://futurai.space" target="_blank" rel="noopener noreferrer" className="btn-secondary text-base py-3 px-6">
                Découvrir FutureAI
              </a>
            </div>
            <p className="mt-4 text-sm">
              <a
                href={WINDOWS_DOWNLOAD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-accent hover:underline underline-offset-4"
              >
                <Download size={14} aria-hidden="true" /> Télécharger pour Windows
              </a>
              <span className="text-mg-300"> · IA locale gratuite, sans compte</span>
            </p>

            {isDemo && (
              <p className="text-xs text-mg-300 mt-6 max-w-md mx-auto" role="note">
                Vous êtes sur la démonstration : les contenus sont des exemples pré-rédigés, aucune IA n’est utilisée,
                et vos données restent dans ce navigateur.
              </p>
            )}
            {mode === 'personal' && <PersonalNote />}
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
                  {f.link && (
                    <a
                      href={f.link.href}
                      target="_blank"
                      rel="noopener noreferrer"
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
                <AccessButton size="hero" signedOutLabel="Accéder à Magistra" />
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
              Magistra<span className="text-accent">.</span>
            </span>
          </div>
          <p className="text-xs text-mg-300 text-center">
            Un projet{' '}
            <a href="https://futurai.space" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">FutureAI</a>
            {' '}· Bordeaux, France · Logiciel libre sous licence MIT
          </p>
        </div>
      </footer>
    </div>
  );
}
