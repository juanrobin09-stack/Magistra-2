// Mode démonstration : comment brancher une VRAIE intelligence artificielle, en langage simple.
// Carte statique et discrète (repliée par défaut) : aucun formulaire, rien n'est écrit dans une configuration.

import type { ReactNode } from 'react';
import { ChevronRight, Download, ExternalLink, Laptop, Monitor, Server } from 'lucide-react';
import { OLLAMA_DOWNLOAD_URL, README_AI_SECTION_URL, WINDOWS_DOWNLOAD_URL } from '@/lib/links';

function Anchor({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-accent hover:underline underline-offset-2 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      {children}
    </a>
  );
}

function Path({ icon: Icon, title, children }: { icon: typeof Monitor; title: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center shrink-0" aria-hidden="true">
        <Icon size={14} className="text-accent" />
      </span>
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-semibold text-mg-50">{title}</p>
        <div className="text-xs text-mg-200 leading-relaxed space-y-1">{children}</div>
      </div>
    </li>
  );
}

export default function ConnectRealAICard({ className = '' }: { className?: string }) {
  return (
    <details className={`group rounded-xl border border-accent/15 bg-accent/5 ${className}`} data-testid="connect-real-ai">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm text-mg-100 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} className="text-accent shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
        <span>
          <strong className="text-accent font-semibold">Brancher une vraie IA</strong>
          <span className="text-mg-200"> — trois solutions gratuites</span>
        </span>
      </summary>
      <div className="px-4 pb-4 space-y-4">
        <p className="text-xs text-mg-200 leading-relaxed">
          Ici, les contenus sont des exemples pré-rédigés. Pour qu’une intelligence artificielle rédige vraiment à partir
          de vos demandes, choisissez l’une de ces solutions :
        </p>
        <ol className="space-y-3.5">
          <Path icon={Monitor} title="1. L’application Windows">
            <p>
              L’IA fonctionne directement sur votre ordinateur, gratuitement, sans compte : vos documents restent chez vous.
            </p>
            <p>
              <Anchor href={WINDOWS_DOWNLOAD_URL}>
                <Download size={12} aria-hidden="true" /> Télécharger pour Windows
              </Anchor>
            </p>
          </Path>
          <Path icon={Laptop} title="2. Sur votre ordinateur, avec le code de Magistra">
            <p>
              Installez <Anchor href={OLLAMA_DOWNLOAD_URL}>Ollama <ExternalLink size={11} aria-hidden="true" /></Anchor> (gratuit),
              puis lancez <span className="font-mono text-mg-100">npm run dev</span> dans le dossier de Magistra : le mode
              personnel s’active, sans compte, et l’IA est détectée automatiquement.
            </p>
          </Path>
          <Path icon={Server} title="3. Pour l’administrateur du site en ligne">
            <p>
              Côté IA, une seule variable suffit : <span className="font-mono text-mg-100">AI_PRESET=ovhcloud</span> (gratuit,
              sans clé). Les demandes sont alors envoyées à OVHcloud, en France, et l’application l’annonce aux enseignants.
            </p>
            <p>
              Le site doit aussi avoir ses comptes enseignants (Clerk), sans lesquels il reste en démonstration, et sa base
              de données (Supabase), sans laquelle il affiche une erreur de configuration.
            </p>
            <p>
              <Anchor href={README_AI_SECTION_URL}>
                Mode d’emploi <ExternalLink size={11} aria-hidden="true" />
              </Anchor>
            </p>
          </Path>
        </ol>
      </div>
    </details>
  );
}
