// IA non prête : carte claire au lieu d'un échec silencieux, avec la VRAIE cause (message et code à
// transmettre). La génération reste possible. IA prête mais état non vérifié : simple avertissement.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Info, RefreshCw, Settings, Wrench } from 'lucide-react';
import type { Capabilities } from '@shared/types';
import { serverAIView } from '@/lib/ai-ui/server';
import { getBridge } from '@/lib/runtime/local';
import { usesServerApi, type RuntimeMode } from '@/lib/runtime/types';
import AdminContactLine from '@/components/ai/AdminContactLine';
import { FOCUS_RING } from './fieldUtils';

interface AiNotReadyCardProps {
  mode: RuntimeMode;
  caps: Capabilities | null;
  /** Échec de la vérification des capacités (message déjà traduit). */
  checkError: string | null;
  checking: boolean;
  onRecheck(): void;
  /** Contact de l'administrateur du site (GET /api/mode), s'il est configuré. */
  adminContact?: string;
}

export default function AiNotReadyCard({ mode, caps, checkError, checking, onRecheck, adminContact }: AiNotReadyCardProps) {
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

  const server = usesServerApi(mode);

  // IA prête, mais avertissement non bloquant (état non vérifié…) : la génération reste possible.
  if (!notReady && !checkError) {
    if (!server || !caps?.aiWarning) return null;
    const view = serverAIView(caps, { mode });
    const text = view.state === 'unverified' ? view.detail : view.warning;
    if (!text) return null;
    return (
      <p role="note" className="flex items-start gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/8 text-xs text-mg-200">
        <Info size={14} className="text-accent shrink-0 mt-0.5" aria-hidden="true" />
        <span>{text}</span>
      </p>
    );
  }

  let title: string;
  let detail: string;
  let code: string | undefined;
  let advice: string | undefined;
  const unverified = Boolean(checkError && !caps);
  if (checkError && !caps) {
    title = "Impossible de vérifier l'état de l'intelligence artificielle";
    detail = checkError;
  } else if (mode === 'local') {
    title = "L'intelligence artificielle locale n'est pas prête";
    detail = headline
      ?? caps?.notReady?.message
      ?? "Le moteur d'IA n'est pas installé ou pas démarré, ou le modèle choisi n'est pas encore téléchargé.";
  } else if (server) {
    const view = serverAIView(caps, { mode, checkError });
    title = view.title;
    detail = view.detail ?? '';
    code = view.code;
    advice = view.advice;
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
          <p className="text-sm text-mg-100 mt-1 [overflow-wrap:anywhere]">{detail}</p>
          {advice && <p className="text-xs text-mg-200 mt-2">{advice}</p>}
          {code && (
            <p className="text-xs text-mg-200 mt-1">
              {mode === 'personal' ? 'Code d’erreur' : 'Code à transmettre à l’administrateur'} :{' '}
              <span className="font-mono text-mg-50">{code}</span>
            </p>
          )}
          {server && mode === 'web' && <AdminContactLine contact={adminContact} className="text-xs text-mg-200 mt-1" />}
          {code !== 'AI_NOT_CONFIGURED' && (
            <p className="text-xs text-mg-200 mt-2">
              {unverified && server
                // Prestataire non vérifié : l'encadré « Confidentialité » dit à qui les textes seront transmis.
                ? "Vous pouvez tout de même lancer la génération : vos textes seront transmis comme indiqué dans l'encadré « Confidentialité » ci-dessous, et le message d'erreur précis s'affichera."
                : "Vous pouvez tout de même lancer la génération : le message d'erreur précis s'affichera."}
            </p>
          )}
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
