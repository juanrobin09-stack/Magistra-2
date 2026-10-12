import { Link } from 'react-router-dom';
import { SITE_GUIDES, type SiteGuideData } from '@shared/siteGuides';
import SitePageShell from './SitePageShell';

const CATEGORIES = [...new Set(SITE_GUIDES.map(guide => guide.category))];
const PREVIEW_PATHS = [
  '/guides/preparer-cours-ia',
  '/guides/exercices-td-ia',
  '/guides/examens-corriges-ia',
  '/guides/pdf-scannes-documents',
  '/guides/ia-locale-hors-ligne',
  '/guides/cles-api-ia',
];
const PREVIEW_GUIDES = PREVIEW_PATHS.flatMap(path => {
  const guide = SITE_GUIDES.find(item => item.path === path);
  return guide ? [guide] : [];
});

function GuideCards({ guides }: { guides: readonly SiteGuideData[] }) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {guides.map(guide => (
        <Link key={guide.path} to={guide.path} className="card p-6 block hover:border-accent/40 transition-colors focus-visible:outline-2 focus-visible:outline-accent">
          <p className="text-xs text-accent mb-3">{guide.category}</p>
          <h3 className="text-lg text-white leading-snug mb-3" style={{ fontFamily: 'var(--font-display)' }}>{guide.heading}</h3>
          <p className="text-sm text-mg-200 leading-relaxed">{guide.description}</p>
          <span className="inline-block text-sm text-accent mt-4">Lire le guide →</span>
        </Link>
      ))}
    </div>
  );
}

/** Aperçu éditorial intégré à l'accueil public, sans ajouter de bouton de téléchargement. */
export function SiteResourcesPreview() {
  return (
    <section className="py-16 sm:py-20 px-6" aria-labelledby="guides-preview-title">
      <div className="max-w-5xl mx-auto">
        <div className="max-w-3xl mb-8">
          <p className="text-xs uppercase tracking-widest text-accent mb-3">Conseils et méthodes</p>
          <h2 id="guides-preview-title" className="text-2xl sm:text-3xl text-white mb-4" style={{ fontFamily: 'var(--font-display)' }}>Des guides pour préparer avec l’IA</h2>
          <p className="text-mg-200 leading-relaxed">Des étapes concrètes pour travailler sur vos cours, varier les exercices, lire un PDF scanné et choisir le mode d’IA qui vous convient. Chaque guide explique aussi les vérifications à effectuer.</p>
        </div>
        <GuideCards guides={PREVIEW_GUIDES} />
        <Link to="/guides" className="inline-block text-accent hover:underline underline-offset-4 mt-6">Explorer tous les guides IA pour enseignants →</Link>
      </div>
    </section>
  );
}

export default function SiteResources() {
  return (
    <SitePageShell>
      <main id="contenu" className="px-6 pt-12 pb-20 sm:pt-16 sm:pb-24">
        <div className="max-w-6xl mx-auto">
          <nav aria-label="Fil d’Ariane" className="text-sm text-mg-300 mb-10">
            <ol className="flex flex-wrap items-center gap-2">
              <li><Link to="/" className="text-accent hover:underline underline-offset-4">Accueil</Link></li>
              <li aria-hidden="true">/</li>
              <li aria-current="page">Guides enseignants</li>
            </ol>
          </nav>
          <header className="max-w-3xl mb-10 sm:mb-14">
            <p className="text-xs uppercase tracking-widest text-accent mb-4">Ressources Magistra</p>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl text-white leading-tight mb-6" style={{ fontFamily: 'var(--font-display)' }}>Guides IA pour les enseignants</h1>
            <p className="text-base sm:text-lg text-mg-200 leading-relaxed">Préparer un cours, construire un TD, adapter un support ou organiser un semestre : partez d’un besoin concret. Ces guides proposent une méthode, des exemples de consignes et les contrôles nécessaires avant d’utiliser un contenu avec vos élèves ou étudiants.</p>
            <p className="text-mg-200 leading-relaxed mt-4">Vous trouverez aussi l’aide pour vos documents PDF, l’installation de Magistra sur Windows, les mises à jour et le choix entre IA locale et clé API personnelle.</p>
          </header>

          <nav aria-label="Thèmes des guides" className="card p-5 sm:p-6 mb-12">
            <h2 className="font-semibold text-white mb-4">Choisir votre besoin</h2>
            <ul className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
              {CATEGORIES.map((category, index) => (
                <li key={category}><a href={`#theme-${index + 1}`} className="text-accent hover:underline underline-offset-4">{category}</a></li>
              ))}
            </ul>
          </nav>

          <div className="space-y-12">
            {CATEGORIES.map((category, index) => (
              <section key={category} aria-labelledby={`theme-${index + 1}`}>
                <h2 id={`theme-${index + 1}`} className="scroll-mt-24 text-2xl sm:text-3xl text-white mb-6" style={{ fontFamily: 'var(--font-display)' }}>{category}</h2>
                <GuideCards guides={SITE_GUIDES.filter(guide => guide.category === category)} />
              </section>
            ))}
          </div>

          <section aria-labelledby="guides-start" className="card p-6 sm:p-8 mt-14">
            <h2 id="guides-start" className="text-2xl text-white mb-4" style={{ fontFamily: 'var(--font-display)' }}>Choisir une première préparation</h2>
            <p className="text-mg-200 leading-relaxed max-w-3xl mb-5">Commencez avec une notion que vous connaissez et un document court. Magistra est gratuit pour Windows 10 et 11 en 64 bits, sans compte Magistra. Les usages d’une API personnelle restent soumis aux frais et quotas du fournisseur choisi.</p>
            <Link to="/#magistra-windows" className="btn-primary inline-flex">Découvrir Magistra pour Windows</Link>
          </section>
        </div>
      </main>
    </SitePageShell>
  );
}
