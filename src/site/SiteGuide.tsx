import { Link } from 'react-router-dom';
import { getSiteGuide, type SiteGuideData } from '@shared/siteGuides';
import { AUTHOR_NAME, authorProfile } from '@shared/author';
import SitePageShell from './SitePageShell';

export default function SiteGuide({ guide }: { guide: SiteGuideData }) {
  const profile = authorProfile(import.meta.env as unknown as Record<string, unknown>);
  const related = guide.related.flatMap(path => {
    const item = getSiteGuide(path);
    return item ? [item] : [];
  });

  return (
    <SitePageShell>
      <main id="contenu" className="px-6 pt-12 pb-20 sm:pt-16 sm:pb-24">
        <div className="max-w-6xl mx-auto">
          <nav aria-label="Fil d’Ariane" className="text-sm text-mg-300 mb-10">
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <li><Link to="/" className="text-accent hover:underline underline-offset-4">Accueil</Link></li>
              <li aria-hidden="true">/</li>
              <li><Link to="/guides" className="text-accent hover:underline underline-offset-4">Guides enseignants</Link></li>
              <li aria-hidden="true">/</li>
              <li aria-current="page">{guide.heading}</li>
            </ol>
          </nav>

          <article>
            <header className="max-w-3xl mb-10 sm:mb-14">
              <p className="text-xs uppercase tracking-widest text-accent mb-4">{guide.category}</p>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl text-white leading-tight mb-6" style={{ fontFamily: 'var(--font-display)' }}>
                {guide.heading}
              </h1>
              <p className="text-base sm:text-lg text-mg-200 leading-relaxed">{guide.intro}</p>
              <p className="mt-5 text-sm text-mg-300">
                Un guide pour utiliser Magistra, créé par{' '}
                <a href={profile.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline underline-offset-4">
                  {AUTHOR_NAME}<span className="sr-only"> (s’ouvre dans un nouvel onglet)</span>
                </a>.
              </p>
            </header>

            <div className="grid lg:grid-cols-[minmax(0,1fr)_17rem] gap-10 lg:gap-16 items-start">
              <nav aria-label="Sommaire du guide" className="card p-5 lg:col-start-2 lg:row-start-1 lg:sticky lg:top-24">
                <h2 className="font-semibold text-white mb-4">Dans ce guide</h2>
                <ol className="space-y-3 text-sm leading-relaxed">
                  {guide.sections.map(section => (
                    <li key={section.id}>
                      <a href={`#${section.id}`} className="text-mg-200 hover:text-accent hover:underline underline-offset-4">{section.title}</a>
                    </li>
                  ))}
                  <li><a href="#questions" className="text-mg-200 hover:text-accent hover:underline underline-offset-4">Questions fréquentes</a></li>
                </ol>
              </nav>

              <div className="min-w-0 lg:col-start-1 lg:row-start-1 space-y-12">
                {guide.sections.map(section => (
                  <section key={section.id} aria-labelledby={section.id}>
                    <h2 id={section.id} className="scroll-mt-24 text-2xl sm:text-3xl text-white leading-tight mb-5" style={{ fontFamily: 'var(--font-display)' }}>
                      {section.title}
                    </h2>
                    <div className="space-y-4 text-mg-200 leading-relaxed">
                      {section.paragraphs?.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
                      {section.steps && (
                        <ol className="list-decimal pl-6 space-y-3 marker:text-accent">
                          {section.steps.map(step => <li key={step} className="pl-1">{step}</li>)}
                        </ol>
                      )}
                      {section.bullets && (
                        <ul className="list-disc pl-6 space-y-2 marker:text-accent">
                          {section.bullets.map(bullet => <li key={bullet} className="pl-1">{bullet}</li>)}
                        </ul>
                      )}
                      {section.example && (
                        <div className="rounded-xl border border-accent/20 bg-accent/5 p-5 sm:p-6">
                          <p className="text-xs uppercase tracking-widest text-accent mb-3">Exemple concret</p>
                          <p className="text-mg-100 leading-relaxed">{section.example}</p>
                        </div>
                      )}
                    </div>
                  </section>
                ))}

                <section aria-labelledby="questions">
                  <h2 id="questions" className="scroll-mt-24 text-2xl sm:text-3xl text-white mb-6" style={{ fontFamily: 'var(--font-display)' }}>Questions fréquentes</h2>
                  <div className="space-y-3">
                    {guide.faq.map(({ question, answer }) => (
                      <details key={question} className="card p-5">
                        <summary className="cursor-pointer font-medium text-white focus-visible:outline-2 focus-visible:outline-accent">{question}</summary>
                        <p className="mt-3 text-mg-200 leading-relaxed">{answer}</p>
                      </details>
                    ))}
                  </div>
                </section>

                <section className="card p-6 sm:p-8" aria-labelledby="passer-pratique">
                  <h2 id="passer-pratique" className="text-2xl text-white mb-3" style={{ fontFamily: 'var(--font-display)' }}>Passer à la pratique avec Magistra</h2>
                  <p className="text-mg-200 leading-relaxed mb-5">Application gratuite pour Windows 10 et 11 en 64 bits, sans compte Magistra. Choisissez une IA locale ou votre clé API personnelle, puis vérifiez vos premières préparations.</p>
                  <Link to="/#magistra-windows" className="btn-primary inline-flex">Découvrir Magistra pour Windows</Link>
                </section>
              </div>
            </div>
          </article>

          <section aria-labelledby="guides-related" className="mt-16 sm:mt-20 pt-10 border-t border-white/10">
            <h2 id="guides-related" className="text-2xl sm:text-3xl text-white mb-6" style={{ fontFamily: 'var(--font-display)' }}>Pour continuer votre préparation</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {related.map(item => (
                <Link key={item.path} to={item.path} className="card p-6 block hover:border-accent/40 transition-colors focus-visible:outline-2 focus-visible:outline-accent">
                  <p className="text-xs text-accent mb-3">{item.category}</p>
                  <h3 className="text-lg text-white leading-snug mb-3" style={{ fontFamily: 'var(--font-display)' }}>{item.heading}</h3>
                  <p className="text-sm text-mg-200 leading-relaxed">{item.description}</p>
                  <span className="inline-block text-sm text-accent mt-4">Lire le guide →</span>
                </Link>
              ))}
            </div>
            <Link to="/guides" className="inline-block text-accent hover:underline underline-offset-4 mt-6">Voir tous les guides pour enseignants →</Link>
          </section>
        </div>
      </main>
    </SitePageShell>
  );
}
