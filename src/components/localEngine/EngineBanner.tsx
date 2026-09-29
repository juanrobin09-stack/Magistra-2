// Page Générer (site web) : QUI traitera la prochaine génération, dit avant de cliquer. Magistra locale → « IA locale » ;
// serveur en ligne → le prestataire est nommé (« serveur distant »). Changement de moteur : jamais silencieux, toujours
// affiché ici (et annoncé aux lecteurs d'écran).

import { Link } from 'react-router-dom';
import { Cpu, Loader2, Send } from 'lucide-react';
import { FOCUS_RING } from '@/components/generate/fieldUtils';
import type { EngineRoute } from '@/lib/runtime/hybrid';
import { LOCAL_AVAILABLE_TEXT, LOCAL_BANNER_TEXT, remoteBannerText, ROUTE_CHECKING_TEXT, USE_LOCAL_LABEL } from './texts';

interface EngineBannerProps {
  /** null : moteur pas encore connu (appairage en cours de vérification). */
  route: EngineRoute | null;
  /** Destinataire des textes quand le serveur en ligne génère. */
  providerName: string;
  /** Rappel discret : Magistra locale est connectée et prête alors que le serveur en ligne est choisi. */
  localAvailable: boolean;
  onUseLocal(): void;
}

export default function EngineBanner({ route, providerName, localAvailable, onUseLocal }: EngineBannerProps) {
  const local = route === 'local-connector';
  const frame = local ? 'bg-success/5 border-success/20' : route === 'server' ? 'bg-accent/5 border-accent/20' : 'bg-white/[0.03] border-white/10';
  const Icon = route === null ? Loader2 : local ? Cpu : Send;
  return (
    <div className="space-y-2">
      <div
        role="status"
        aria-live="polite"
        aria-label="Moteur de génération"
        data-testid="engine-banner"
        className={`flex flex-wrap items-start gap-x-3 gap-y-1.5 p-3.5 rounded-xl border ${frame}`}
      >
        <Icon size={16} className={`shrink-0 mt-0.5 ${local ? 'text-success' : 'text-accent'} ${route === null ? 'animate-spin' : ''}`} aria-hidden="true" />
        <p className="flex-1 min-w-[12rem] text-sm text-mg-50 [overflow-wrap:anywhere]">
          {route === null ? ROUTE_CHECKING_TEXT : local ? LOCAL_BANNER_TEXT : remoteBannerText(providerName)}
        </p>
        <Link to="/app/settings" className={`text-xs text-accent hover:underline underline-offset-2 rounded self-center ${FOCUS_RING}`}>
          Changer de moteur
        </Link>
      </div>
      {localAvailable && route === 'server' && (
        <div role="note" className="flex flex-wrap items-center gap-2 px-3.5 py-2 rounded-xl border border-white/8 bg-white/[0.02]">
          <Cpu size={14} className="text-success shrink-0" aria-hidden="true" />
          <p className="flex-1 min-w-[10rem] text-xs text-mg-200">{LOCAL_AVAILABLE_TEXT}</p>
          <button type="button" onClick={onUseLocal} className={`btn-ghost text-xs py-1.5 px-3 text-accent ${FOCUS_RING}`}>
            {USE_LOCAL_LABEL}
          </button>
        </div>
      )}
    </div>
  );
}
