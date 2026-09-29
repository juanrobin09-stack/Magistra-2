// Tableau de bord du site web (enseignant connecté) : Magistra locale, l'intelligence artificielle de CET ordinateur
// par l'application Windows. Tous les états du contrôleur, avec les textes de l'enseignant ; jamais d'adresse, de
// port ni de nom de moteur à l'écran : l'enseignant ouvre Magistra et clique, rien d'autre.
// « Utiliser l'IA locale » disparaît une fois le choix fait : le focus va alors au titre de la carte (jamais perdu).

import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Cpu, Settings } from 'lucide-react';
import { FOCUS_RING } from '@/components/generate/fieldUtils';
import { useEngineRoute } from './engineRoute';
import LocalEngineStatus, { type LocalEngineHandle } from './LocalEngineStatus';
import { USE_LOCAL_LABEL } from './texts';

export default function LocalEngineCard({ engine }: { engine: LocalEngineHandle }) {
  const { state } = engine;
  const { route, setChoice } = useEngineRoute(state);
  const ready = state.kind === 'connected' && Boolean(state.status?.engine.ready && state.status.engine.local);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusTitle = useRef(false);
  useEffect(() => {
    if (!focusTitle.current || route !== 'local-connector') return;
    focusTitle.current = false;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) titleRef.current?.focus({ preventScroll: true });
  }, [route]);

  return (
    <section aria-labelledby="local-engine-title" className="card p-5 sm:p-6" data-testid="local-engine-card">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div aria-hidden="true" className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/15 flex items-center justify-center shrink-0">
          <Cpu size={18} className="text-accent" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2
              id="local-engine-title"
              ref={titleRef}
              tabIndex={-1}
              className="text-sm font-semibold text-white rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              Magistra locale
            </h2>
            <Link to="/app/settings" className={`inline-flex items-center gap-1 text-xs text-mg-200 hover:text-accent rounded ${FOCUS_RING}`}>
              <Settings size={12} aria-hidden="true" /> Réglages de l’IA
            </Link>
          </div>
          <LocalEngineStatus engine={engine} idPrefix="card" installSteps />
          {ready && route === 'server' && (
            <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
              <p className="text-sm text-mg-200 flex-1 min-w-[12rem]">
                Vos générations utilisent actuellement le serveur en ligne.
              </p>
              <button
                type="button"
                onClick={() => {
                  focusTitle.current = true;
                  setChoice('local');
                }}
                className={`btn-secondary text-sm py-2 px-4 ${FOCUS_RING}`}
              >
                {USE_LOCAL_LABEL}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
