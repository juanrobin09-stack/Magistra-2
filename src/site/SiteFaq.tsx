import { SITE_FAQ } from '@shared/siteSeo';

export default function SiteFaq() {
  return (
    <section className="py-16 sm:py-20 px-6" aria-labelledby="faq-title">
      <div className="max-w-3xl mx-auto">
        <h2 id="faq-title" className="text-2xl sm:text-3xl text-white mb-8" style={{ fontFamily: 'var(--font-display)' }}>
          Vos questions sur Magistra
        </h2>
        <div className="space-y-3">
          {SITE_FAQ.map(({ question, answer }) => (
            <details key={question} className="card p-5">
              <summary className="cursor-pointer font-medium text-white focus-visible:outline-2 focus-visible:outline-accent">{question}</summary>
              <p className="mt-3 text-sm text-mg-200 leading-relaxed">{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
