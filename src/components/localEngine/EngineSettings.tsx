// Réglages du site web, section « Intelligence artificielle » : ordre de priorité des moteurs (Magistra locale, serveur
// IA de l'établissement, fournisseur web configuré), choix du moteur de vos générations, connexion de Magistra locale.
//
// Passer au serveur en ligne demande TOUJOURS une confirmation qui nomme le prestataire (focus initial sur « Garder
// Magistra locale » : une frappe réflexe ne vaut jamais accord) ; revenir à Magistra locale est immédiat (rien ne
// quitte l'ordinateur). Aucune adresse, aucun port, aucun nom de moteur local à l'écran.
// Accessibilité : quand la déconnexion (ou son explication) fait disparaître le bouton utilisé, le focus va au titre
// « Magistra locale sur cet ordinateur » (ou revient au bouton « Déconnecter » après « Annuler »), jamais au début de
// la page.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Loader2, Unplug } from 'lucide-react';
import type { Capabilities } from '@shared/types';
import { FOCUS_RING } from '@/components/generate/fieldUtils';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { configuredProvider } from '@/lib/runtime/context';
import { serverProvider, serverProviderName, useEngineRoute } from './engineRoute';
import { runLocalAction, wasSearched } from './localActions';
import LocalEngineStatus, { type LocalEngineHandle } from './LocalEngineStatus';
import { PermissionExplainer } from './PermissionNotes';
import {
  DISCONNECT_BLOCKED_TEXT, DISCONNECT_LABEL, DISCONNECT_TEXT, LOCAL_BANNER_TEXT, LOCAL_CHOICE_LABEL, localEngineSummary, NOT_CONFIGURED_TEXT, REMOTE_CONFIRM_LABEL,
  REMOTE_CONFIRM_TITLE, remoteBannerText, remoteConfirmText, serverChoiceLabel,
} from './texts';

interface EngineSettingsProps {
  engine: LocalEngineHandle;
  /** Capacités du serveur en ligne quand elles sont connues (moteur « serveur » choisi), sinon null. */
  serverCaps: Capabilities | null;
  /** État détaillé de l'IA du serveur (cause, code), affiché quand le serveur en ligne est choisi. */
  serverDetails?: ReactNode;
}

function Row({ rank, title, value, used }: { rank: number; title: string; value: string; used: boolean }) {
  return (
    <li className="flex items-start gap-3">
      <span aria-hidden="true" className="w-6 h-6 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-xs font-semibold text-accent shrink-0">
        {rank}
      </span>
      <p className="min-w-0 text-sm text-mg-100 [overflow-wrap:anywhere]">
        <span className="sr-only">{rank}. </span>
        <span className="text-mg-50 font-medium">{title}</span> — {value}
        {used && <span className="ml-2 badge badge-success align-middle">utilisé pour vos générations</span>}
      </p>
    </li>
  );
}

export default function EngineSettings({ engine, serverCaps, serverDetails }: EngineSettingsProps) {
  const { state, controller } = engine;
  const { route, choice, setChoice } = useEngineRoute(state);
  const groupName = useId();
  const [askRemote, setAskRemote] = useState(false);
  const [askDisconnect, setAskDisconnect] = useState(false);
  const [explainDisconnect, setExplainDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const localHeadingRef = useRef<HTMLHeadingElement>(null);
  const disconnectRef = useRef<HTMLButtonElement>(null);
  /** Où rendre le focus quand le bouton utilisé a disparu (une seule fois, seulement s'il a été perdu). */
  const focusAfter = useRef<'heading' | 'disconnect' | null>(null);
  useEffect(() => {
    const target = focusAfter.current;
    if (!target || disconnecting) return;
    const element = target === 'heading' ? localHeadingRef.current : disconnectRef.current;
    if (!element) return;
    focusAfter.current = null;
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected) element.focus({ preventScroll: true });
  }, [disconnecting, explainDisconnect, state.paired]);

  const provider = serverProvider(serverCaps, configuredProvider());
  const providerName = serverProviderName(serverCaps, configuredProvider());
  const establishment = provider && !provider.thirdParty ? provider.label : null;
  const webProvider = provider?.thirdParty ? provider.label : null;

  async function disconnect() {
    focusAfter.current = 'heading';
    setExplainDisconnect(false);
    setDisconnecting(true);
    try {
      await runLocalAction(controller, 'disconnect');
    } finally {
      setDisconnecting(false);
    }
  }

  const canDisconnect = state.paired && state.kind !== 'pairing';

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-white mb-2">Ordre de priorité</h3>
        <ol className="space-y-2">
          <Row rank={1} title="Magistra locale" value={localEngineSummary(state, wasSearched(controller))} used={route === 'local-connector'} />
          <Row rank={2} title="Serveur IA de l’établissement" value={establishment ?? NOT_CONFIGURED_TEXT} used={route === 'server' && establishment !== null} />
          <Row rank={3} title="Fournisseur web configuré" value={webProvider ?? NOT_CONFIGURED_TEXT} used={route === 'server' && webProvider !== null} />
        </ol>
      </div>

      <fieldset className="space-y-2 border-t border-white/5 pt-4">
        <legend className="text-sm font-semibold text-white mb-2">Moteur de vos générations</legend>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="radio"
            name={groupName}
            value="local"
            checked={choice === 'local'}
            onChange={() => setChoice('local')}
            className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
          />
          <span>
            <span className="block text-sm text-mg-50">{LOCAL_CHOICE_LABEL}</span>
            <span className="block text-xs text-mg-200">
              L’intelligence artificielle de cet ordinateur, par l’application Magistra : les extraits de vos documents
              ne quittent pas cet ordinateur ; le résultat et les paramètres de la demande (sujet, consignes, contenu à
              adapter, noms des documents) sont enregistrés dans votre historique en ligne.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="radio"
            name={groupName}
            value="server"
            checked={choice === 'server'}
            onChange={() => setAskRemote(true)}
            className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
          />
          <span>
            <span className="block text-sm text-mg-50 [overflow-wrap:anywhere]">{serverChoiceLabel(providerName)}</span>
            <span className="block text-xs text-mg-200">
              Sans installation (Mac, Linux, ordinateur de l’établissement) : vos demandes et les extraits de vos
              documents sont envoyés au serveur en ligne.
            </span>
          </span>
        </label>
        <p role="status" aria-live="polite" className="text-sm text-mg-100 pt-1 [overflow-wrap:anywhere]">
          {route === 'local-connector' ? LOCAL_BANNER_TEXT : route === 'server' ? remoteBannerText(providerName) : ''}
        </p>
      </fieldset>

      {route === 'server' && serverDetails && <div className="border-t border-white/5 pt-4">{serverDetails}</div>}

      <div className="border-t border-white/5 pt-4 space-y-3">
        <h3 ref={localHeadingRef} tabIndex={-1} className="text-sm font-semibold text-white rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
          Magistra locale sur cet ordinateur
        </h3>
        <LocalEngineStatus engine={engine} idPrefix="settings" />
        {canDisconnect && !explainDisconnect && (
          <button
            ref={disconnectRef}
            type="button"
            onClick={() => setAskDisconnect(true)}
            disabled={disconnecting}
            className={`btn-ghost text-sm py-2 px-3 disabled:opacity-60 ${FOCUS_RING}`}
          >
            {disconnecting ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Unplug size={15} aria-hidden="true" />}
            {disconnecting ? 'Déconnexion…' : DISCONNECT_LABEL}
          </button>
        )}
        {explainDisconnect && (
          <PermissionExplainer
            onContinue={() => void disconnect()}
            onCancel={() => {
              focusAfter.current = 'disconnect';
              setExplainDisconnect(false);
            }}
            autoFocus
          />
        )}
      </div>

      <ConfirmDialog
        open={askRemote}
        title={REMOTE_CONFIRM_TITLE}
        message={remoteConfirmText(providerName)}
        confirmLabel={REMOTE_CONFIRM_LABEL}
        cancelLabel="Garder Magistra locale"
        initialFocus="cancel"
        onConfirm={() => {
          setAskRemote(false);
          setChoice('server');
        }}
        onCancel={() => setAskRemote(false)}
      />
      <ConfirmDialog
        open={askDisconnect}
        title="Déconnecter Magistra locale ?"
        message={state.permission === 'denied' ? DISCONNECT_BLOCKED_TEXT : DISCONNECT_TEXT}
        confirmLabel="Déconnecter"
        danger
        onConfirm={() => {
          setAskDisconnect(false);
          if (state.permission === 'prompt') setExplainDisconnect(true);
          else void disconnect();
        }}
        onCancel={() => setAskDisconnect(false)}
      />
    </div>
  );
}
