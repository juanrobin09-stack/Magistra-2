// Page Générer (site web), Magistra locale choisie mais pas prête : la cause précise, les actions utiles (ouvrir
// Magistra, réessayer, connecter…) et le passage au serveur en ligne SEULEMENT après une confirmation explicite qui
// nomme le prestataire (focus initial sur « Rester sur Magistra locale »). Aucune bascule automatique vers un tiers.

import { useState } from 'react';
import { AlertTriangle, Send } from 'lucide-react';
import type { AINotice } from '@shared/types';
import { FOCUS_RING } from '@/components/generate/fieldUtils';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import LocalEngineStatus, { type LocalEngineHandle } from './LocalEngineStatus';
import {
  APP_CLOSED_DETAIL, LOCAL_NOT_READY_TITLE, localEngineMessage, REMOTE_CONFIRM_LABEL, REMOTE_CONFIRM_TITLE, remoteConfirmText, USE_SERVER_LABEL,
} from './texts';

interface LocalEngineNotReadyPanelProps {
  engine: LocalEngineHandle;
  /** Cause donnée par les capacités de Magistra locale (Capabilities.notReady). */
  cause: AINotice | undefined;
  /** Prestataire du serveur en ligne (confirmation). */
  providerName: string;
  /** Appelé après la confirmation explicite de l'enseignant. */
  onUseServer(): void;
}

export default function LocalEngineNotReadyPanel({ engine, cause, providerName, onUseServer }: LocalEngineNotReadyPanelProps) {
  const [confirming, setConfirming] = useState(false);
  // Recherche lancée depuis ce panneau (« Ouvrir Magistra », « Réessayer »…) : le panneau reste affiché (focus et
  // explications gardés) et la ligne « Recherche… » de l'état remplace la cause, qui date d'avant la recherche.
  const searching = engine.state.kind === 'checking' || engine.state.kind === 'idle';
  const causeText = cause && !searching ? localEngineMessage(cause.code, cause.message) : undefined;

  return (
    <section aria-labelledby="gen-local-title" data-testid="local-not-ready" className="p-4 sm:p-5 rounded-xl bg-warning/5 border border-warning/25">
      <div className="flex items-start gap-3">
        <AlertTriangle size={18} className="text-warning shrink-0 mt-0.5" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h2 id="gen-local-title" className="text-sm font-semibold text-warning">{LOCAL_NOT_READY_TITLE}</h2>
            {causeText && <p className="text-sm text-mg-100 mt-1 [overflow-wrap:anywhere]">{causeText}</p>}
          </div>
          {/* « Ouvrez Magistra » est déjà dit par la cause ; l'indication sur l'accès du site (réglage de l'application)
              reste affichée : le site ne distingue pas une application fermée d'un accès désactivé. */}
          <LocalEngineStatus engine={engine} headline={false} omit={causeText ? [causeText, APP_CLOSED_DETAIL] : []} idPrefix="gen" />
          <div className="border-t border-white/5 pt-3">
            <button type="button" onClick={() => setConfirming(true)} className={`btn-ghost text-sm py-2 px-3 ${FOCUS_RING}`}>
              <Send size={15} aria-hidden="true" /> {USE_SERVER_LABEL}
            </button>
            <p className="text-xs text-mg-200 mt-1">
              Ou attendez que Magistra locale soit prête : rien n’est envoyé au serveur en ligne sans votre accord.
            </p>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        title={REMOTE_CONFIRM_TITLE}
        message={remoteConfirmText(providerName)}
        confirmLabel={REMOTE_CONFIRM_LABEL}
        cancelLabel="Rester sur Magistra locale"
        initialFocus="cancel"
        onConfirm={() => {
          setConfirming(false);
          onUseServer();
        }}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
