// « Développer une séance » : sous le plan d'une séquence demandée avec « Commencer par le plan » (résultat de la
// génération, ou contenu ouvert depuis l'Historique), la liste des séances lues dans le tableau du plan. Chaque bouton
// ouvre l'outil « fiche de préparation » PRÉREMPLI : rien n'est généré, l'enseignant relit et modifie avant de lancer.
// Plan sans tableau lisible : rien n'est affiché (ni erreur, ni liste vide).

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ListChecks } from 'lucide-react';
import {
  buildDevelopPrefill, readPlan, sessionLabel, type PlanOrigin,
} from '@/lib/generation/plan';
import type { ReuseState } from '@/lib/generation/reuse';
import { FOCUS_RING } from './fieldUtils';

interface DevelopSessionsProps {
  /** Texte Markdown du plan, tel qu'affiché. */
  content: string;
  /** La demande de séquence qui a produit ce plan. */
  origin: PlanOrigin;
  /** Nombre de séances demandé, s'il l'a été. */
  requested?: number;
}

export default function DevelopSessions({ content, origin, requested }: DevelopSessionsProps) {
  const navigate = useNavigate();
  const plan = useMemo(() => readPlan(content, requested), [content, requested]);
  if (!plan) return null;

  const develop = (index: number) => {
    const prefill = buildDevelopPrefill(origin, plan, index);
    if (!prefill) return;
    // Le formulaire voyage dans l'état du routeur (jamais dans l'adresse : taille, historique du navigateur).
    const state: ReuseState = { reuse: prefill.reuse, reuseNotice: prefill.reuseNotice };
    navigate('/app/generate?type=fiche_prep', { state });
  };

  return (
    <section aria-labelledby="plan-develop-title" className="mt-6 rounded-xl border border-accent/15 bg-accent/[0.03] p-4 sm:p-5">
      <h3 id="plan-develop-title" className="flex items-center gap-2 text-sm font-semibold text-white">
        <ListChecks size={15} className="text-accent" aria-hidden="true" />
        Développer une séance
      </h3>
      <p className="mt-1 text-xs text-mg-200 leading-relaxed">
        Choisissez une séance : la fiche de préparation s’ouvre déjà remplie avec le plan (objectifs, ligne du plan, séances voisines).
        Vous la relisez et la modifiez avant de générer : rien n’est généré automatiquement.
      </p>
      <ul className="mt-3 divide-y divide-white/5">
        {plan.sessions.map((session, index) => {
          const label = sessionLabel(session);
          const name = `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
          return (
            <li key={session.numero} className="flex items-center justify-between gap-3 py-2">
              <p className="min-w-0 text-sm text-mg-100 [overflow-wrap:anywhere]">
                <span className="font-medium text-white">{name}</span>
                {session.titre && <span className="text-mg-200"> : {session.titre}</span>}
              </p>
              <button
                type="button"
                onClick={() => develop(index)}
                aria-label={`Développer la ${label}${session.titre ? ` : ${session.titre}` : ''}`}
                className={`btn-secondary shrink-0 text-xs py-1.5 px-3 ${FOCUS_RING}`}
              >
                Développer <ArrowRight size={13} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
