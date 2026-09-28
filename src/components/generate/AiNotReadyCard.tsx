// IA non prête : carte claire au lieu d'un échec silencieux. La génération reste possible.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, RefreshCw, Settings, Wrench } from 'lucide-react';
import type { Capabilities } from '@shared/types';
import { getBridge } from '@/lib/runtime/local';
import type { RuntimeMode } from '@/lib/runtime/types';
import { FOCUS_RING } from './fieldUtils';

interface AiNotReadyCardProps {
  mode: RuntimeMode;
  caps: Capabilities | null;
  /** Échec de la vérification des capacités (message déjà traduit). */
  checkError: string | null;
  checking: boolean;
  onRecheck(): void;
}

export default function AiNotReadyCard({ mode, caps, checkError, checking, onRecheck }: AiNotReadyCardProps) {
  const [headline, setHeadline] = useState<string | null>(null);
  const notReady = caps !== null && caps.ready === false;

  // Application Windows : message précis (moteur non installé, arrêté, modèle absent…).
  useEffect(() => {
    if (mode !== 'local' || !notReady) return;
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    bridge.ai.status().then(
      s => {
        if (!cancelled) setHeadline(s.headline || null);
      },
      () => {
        // Statut illisible : le message générique ci-dessous suffit.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [mode, notReady, caps]);

  if (!notReady && !checkError) return null;

  let title: string;
  let detail: string;
  if (checkError && !caps) {
    title = "Impossible de vérifier l'état de l'intelligence artificielle";
    detail = checkError;
  } else if (mode === 'local') {
    title = "L'intelligence artificielle locale n'est pas prête";
    detail = headline
      ?? "Le moteur d'IA n'est pas installé ou pas démarré, ou le modèle choisi n'est pas encore téléchargé.";
  } else {
    title = "Le serveur d'IA est indisponible";
    detail = `Le serveur d'IA configuré par l'administrateur${caps?.engineLabel ? ` (${caps.engineLabel})` : ''} ne répond pas pour le moment.`;
  }

  return (
    <section role="status" aria-labelledby="gen-ai-title" className="p-4 sm:p-5 rounded-xl bg-warning/5 border border-warning/25">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="text-warning shrink-0 mt-0.5" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="gen-ai-title" className="text-sm font-semibold text-warning">{title}</h2>
          <p className="text-sm text-mg-100 mt-1">{detail}</p>
          <p className="text-xs text-mg-200 mt-2">
            Vous pouvez tout de même lancer la génération : le message d'erreur précis s'affichera.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            {mode === 'local' && (
              <Link to="/setup" className={`btn-primary text-xs py-2 px-3 ${FOCUS_RING}`}>
                <Wrench size={14} aria-hidden="true" /> Configurer l'intelligence artificielle
              </Link>
            )}
            <Link to="/app/settings" className={`btn-ghost text-xs py-2 px-3 ${FOCUS_RING}`}>
              <Settings size={14} aria-hidden="true" /> Réglages
            </Link>
            <button type="button" onClick={onRecheck} disabled={checking} className={`btn-ghost text-xs py-2 px-3 disabled:opacity-60 ${FOCUS_RING}`}>
              <RefreshCw size={14} aria-hidden="true" className={checking ? 'animate-spin' : ''} /> Vérifier à nouveau
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
