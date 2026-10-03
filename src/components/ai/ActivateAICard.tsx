// « Activez l'IA de Magistra sur cet ordinateur » (application Windows) : UNE carte, UN bouton [Activer l'IA] qui
// annonce la taille totale du téléchargement (moteur + modèle recommandé pour CET ordinateur) et une durée indicative,
// puis une progression unique (étape, %, reste), [Annuler], erreurs précises existantes et [Réessayer] (pour le
// modèle : [Reprendre le téléchargement], qui repart du point atteint).
// L'enchaînement (installEngine → startEngine → installTier) est fait par useAIStatus().activate() : la carte peut être
// démontée (navigation libre) sans rien interrompre. Choix du modèle, serveur distant, adresse du moteur : « Options
// avancées » (page de l'IA). Aucun téléchargement sans le clic ; aucun nom technique imposé à l'enseignant.
// Textes honnêtes : après un arrêt sur erreur, la demande reste mémorisée — la carte le dit (reprise au prochain
// lancement) et propose « Ne pas reprendre » ; modèle personnalisé ou moteur réglé sur un autre ordinateur (options
// avancées) : pas d'activation en un clic, la vraie cause à la place (jamais « sur cet ordinateur » à tort).
// Accessibilité : une région aria-live toujours présente annonce le lancement, l'interruption et la fin ; quand la
// carte change sous le doigt de l'enseignant (le bouton utilisé disparaît), son titre reçoit le focus au lieu de le
// laisser repartir au début de la page.
// Fenêtre d'Ollama (Windows, là où Magistra installe le moteur) : l'installateur officiel lance Ollama à la fin, qui
// peut ouvrir sa fenêtre. Une note (EngineWindowNote) l'explique avant le clic, pendant l'installation du moteur, puis
// quand il est installé (la fenêtre a pu rester ouverte) ; jamais pour un simple démarrage du moteur, ni hors Windows.
// Page officielle (l'enseignant lance lui-même l'installateur) : la note lui dit de terminer d'abord l'installateur.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2, Circle, Eye, ExternalLink, Info, Loader2, RefreshCw, SlidersHorizontal, Sparkles, X,
} from 'lucide-react';
import type { AIStatus } from '@shared/ipc';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { FOCUS_RING } from '@/components/generate/fieldUtils';
import { useAIStatus, type AIActivation, type AIController } from '@/hooks/useAIStatus';
import {
  activationBlocker, activationPlan, activationProgress, activationSizeDetail, activationSizeText, engineSelfUpdatable,
  engineWindowMayOpen, missingDiskGB, planFromProgress, type ActivationBlocker, type ActivationPlan,
} from '@/lib/ai-ui/activation';
import { downloadDurationText, formatGB } from '@/lib/ai-ui/format';
import { isEngineBusy, isModelPulling } from '@/lib/ai-ui/progress';
import { engineHostIfRemote, engineManagedByAdminText, networkHint } from '@/lib/ai-ui/status';
import EngineWindowNote from './EngineWindowNote';
import { ErrorBox, WarningNote } from './Notices';
import ProgressBar from './ProgressBar';

export type ActivateAIVariant = 'dashboard' | 'generate' | 'setup';

interface ActivateAICardProps {
  /** « dashboard » : tableau de bord ; « generate » : page Générer (avec l'exemple) ; « setup » : page de l'IA, réglages. */
  variant: ActivateAIVariant;
  /** Page Générer : affiche un exemple pré-rédigé (même moteur d'exemples que la démonstration du site). */
  onShowExample?: () => void;
  /** Exemple en cours d'affichage (bouton désactivé). */
  exampleRunning?: boolean;
  /** Génération réelle en cours : exemple indisponible. */
  exampleDisabled?: boolean;
}

export const ACTIVATE_TITLE = 'Activez l’IA de Magistra sur cet ordinateur';
export const ACTIVATE_LABEL = 'Activer l’IA';

/** Libellé de l'exemple (page Générer) : jamais présenté comme une génération. */
export const SHOW_EXAMPLE_LABEL = 'Voir un exemple pré-rédigé';

/**
 * Recours après l'échec de l'installation automatique du moteur : le libellé exact que citent les messages du
 * processus principal (« Utilisez « Ouvrir la page officielle d’installation » »), comme la page de l'IA.
 */
export const OFFICIAL_PAGE_LABEL = 'Ouvrir la page officielle d’installation';

/** Installation en cours dans le processus principal (activation, ou téléchargement lancé ailleurs puis rechargé). */
function installing(ai: AIController): boolean {
  return ai.activation.state === 'running'
    || ai.pending.engine || isEngineBusy(ai.progress.engine) || ai.progress.engine?.stage === 'waiting'
    // Téléchargement annulé pendant sa préparation : rien ne part, la carte redevient aussitôt la proposition.
    || (ai.pending.model && ai.progress.model?.stage !== 'cancelled') || isModelPulling(ai.progress.model);
}

type CardView =
  | { kind: 'none' }
  | { kind: 'ready' }
  | { kind: 'progress' }
  | { kind: 'blocked'; blocker: ActivationBlocker }
  | { kind: 'offer'; plan: ActivationPlan; engineUpdate: boolean };

/** Ce que la carte affiche pour l'état courant (la même décision pour le rendu et pour le focus). */
function cardView(ai: AIController | null, variant: ActivateAIVariant): CardView {
  const status = ai?.status;
  if (!ai || !status) return { kind: 'none' };
  const activation = ai.activation;
  if (status.ready && activation.state !== 'running') {
    return activation.state === 'done' && variant !== 'setup' ? { kind: 'ready' } : { kind: 'none' };
  }
  if (status.config.mode === 'remote') return { kind: 'none' };
  if (installing(ai)) return { kind: 'progress' };
  const blocker = activationBlocker(status);
  if (blocker) return { kind: 'blocked', blocker };
  // Modèle refusé par le registre faute d'un moteur assez récent : la reprise commence par la mise à jour du moteur
  // (sa taille est alors comprise dans le total annoncé) ; « Réessayer » seul échouerait de nouveau.
  const engineUpdate = activation.state === 'error' && activation.step === 'model'
    && activation.error?.code === 'ENGINE_OUTDATED' && engineSelfUpdatable(status);
  const plan = activationPlan(status, { engineUpdate });
  return plan ? { kind: 'offer', plan, engineUpdate } : { kind: 'none' };
}

/** Annonce (lecteurs d'écran) d'un changement d'état de l'activation ; l'erreur, elle, est une alerte (ErrorBox). */
function announcementFor(state: AIActivation['state'], resumed: boolean): string {
  switch (state) {
    case 'running':
      return resumed
        ? 'Reprise de l’activation de l’IA.'
        : 'Activation de l’IA lancée : Magistra installe et prépare tout. Vous pouvez continuer à utiliser Magistra.';
    case 'cancelled':
      return 'Activation interrompue. Rien ne reprendra sans votre clic.';
    case 'done':
      return 'L’IA de Magistra est prête.';
    default:
      return '';
  }
}

/** Suivi du focus de la carte : actions de l'enseignant et focus à l'intérieur (la cible est passée à part). */
interface CardFocus {
  /** Enveloppe une action de l'enseignant qui va changer la carte (le bouton utilisé va disparaître). */
  act(fn: () => void): () => void;
  onFocus(): void;
  onBlur(e: FocusEvent<HTMLElement>): void;
}

/**
 * Focus rendu à la carte quand elle change (« Activer l'IA » → progression, « Annuler » → « Activation interrompue »,
 * fin du téléchargement…) : le bouton qui avait le focus disparaît avec la carte qui le portait. Le titre de la
 * nouvelle carte (`target`) le reçoit, une seule fois, seulement s'il a été perdu (jamais volé à un autre élément de
 * la page), et seulement après une action de l'enseignant ou s'il était dans la carte — comme la ligne d'état de
 * Magistra locale (LocalEngineStatus).
 */
function useCardFocus(key: string): { focus: CardFocus; target: (el: HTMLElement | null) => void } {
  const targetRef = useRef<HTMLElement | null>(null);
  const acted = useRef(false);
  const inside = useRef(false);
  useEffect(() => {
    if (!acted.current && !inside.current) return;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    acted.current = false;
    inside.current = false;
    targetRef.current?.focus({ preventScroll: true });
  }, [key]);
  const target = useCallback((el: HTMLElement | null) => {
    targetRef.current = el;
  }, []);
  const act = useCallback((fn: () => void) => () => {
    acted.current = true;
    fn();
  }, []);
  const onFocus = useCallback(() => {
    inside.current = true;
  }, []);
  const onBlur = useCallback((e: FocusEvent<HTMLElement>) => {
    // Focus parti vers un autre élément de la page ; un bouton retiré de la page (relatedTarget nul) ne compte pas.
    const next = e.relatedTarget;
    if (next instanceof Node && !e.currentTarget.contains(next)) inside.current = false;
  }, []);
  const focus = useMemo(() => ({ act, onFocus, onBlur }), [act, onFocus, onBlur]);
  return { focus, target };
}

/**
 * Carte d'activation de l'IA ; rien quand l'IA est prête (sauf le message de fin d'une activation), quand Magistra
 * utilise un serveur IA distant, ou avant la première vérification.
 */
export default function ActivateAICard({ variant, onShowExample, exampleRunning = false, exampleDisabled = false }: ActivateAICardProps) {
  const ai = useAIStatus();
  const status = ai?.status ?? null;
  const waitingManual = Boolean(ai && ai.activation.state !== 'running' && (ai.manualInstall || ai.progress.engine?.stage === 'waiting'));
  const refresh = ai?.refresh;
  const view = cardView(ai, variant);
  const activationState = ai?.activation.state ?? 'idle';
  const { focus, target } = useCardFocus(`${view.kind}|${activationState}`);

  // Annonce du dernier changement d'état de l'activation (jamais à l'arrivée sur la page).
  const [seenState, setSeenState] = useState(activationState);
  const [announcement, setAnnouncement] = useState('');
  if (seenState !== activationState) {
    setSeenState(activationState);
    setAnnouncement(announcementFor(activationState, ai?.activation.resumed === true));
  }

  // Installation depuis la page officielle lancée hors activation : nouvelle vérification régulière.
  useEffect(() => {
    if (!waitingManual || !refresh) return;
    const id = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => window.clearInterval(id);
  }, [waitingManual, refresh]);

  if (!ai || !status || view.kind === 'none') return null;
  const example = onShowExample ? <ExampleButton onClick={onShowExample} running={exampleRunning} disabled={exampleDisabled} /> : null;
  let content: ReactNode;
  switch (view.kind) {
    case 'ready':
      content = <ReadyNote ai={ai} status={status} variant={variant} focus={focus} target={target} />;
      break;
    case 'progress':
      content = <ActivationProgressCard ai={ai} status={status} variant={variant} example={example} focus={focus} target={target} />;
      break;
    case 'blocked':
      content = <BlockedCard status={status} blocker={view.blocker} variant={variant} focus={focus} target={target} />;
      break;
    case 'offer':
      content = (
        <ActivationOffer ai={ai} status={status} plan={view.plan} engineUpdate={view.engineUpdate} variant={variant} example={example} focus={focus} target={target} />
      );
      break;
  }
  return (
    <>
      {content}
      {/* Toujours présente pendant que la carte change (jamais insérée déjà remplie) : ses changements sont annoncés. */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="activate-ai-announcement">
        {announcement}
      </p>
    </>
  );
}

function ExampleButton({ onClick, running, disabled }: { onClick(): void; running: boolean; disabled: boolean }) {
  return (
    <button type="button" className={`btn-secondary text-sm py-2.5 px-4 disabled:opacity-50 ${FOCUS_RING}`} onClick={onClick} disabled={running || disabled}>
      {running ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
      {SHOW_EXAMPLE_LABEL}
    </button>
  );
}

/** Cadre commun : carte mise en avant (dégradé discret, halo), titre h2 (cible du focus quand la carte change). */
/** Élément qui reçoit le focus quand la carte change (titre, message de fin). */
type FocusTarget = (el: HTMLElement | null) => void;

function Frame({ titleId, title, icon, focus, target, testId = 'activate-ai', children }: {
  titleId: string; title: string; icon: ReactNode; focus: CardFocus; target: FocusTarget; testId?: string; children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={titleId}
      data-testid={testId}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      className="card p-5 sm:p-6 border-accent/20 bg-gradient-to-br from-mg-800 to-mg-900 relative overflow-hidden"
    >
      <div className="absolute -top-16 -right-10 w-64 h-40 bg-accent/10 rounded-full blur-[70px] pointer-events-none" aria-hidden="true" />
      <div className="relative flex flex-col sm:flex-row sm:items-start gap-4">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-accent-dim to-accent flex items-center justify-center shrink-0" aria-hidden="true">
          {icon}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <h2
            id={titleId}
            ref={target}
            tabIndex={-1}
            className="text-xl sm:text-2xl text-white leading-tight rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {title}
          </h2>
          {children}
        </div>
      </div>
    </section>
  );
}

function AdvancedLink({ variant }: { variant: ActivateAIVariant }) {
  if (variant === 'setup') return null;
  return (
    <p className="text-xs">
      <Link to="/setup" className={`inline-flex items-center gap-1.5 text-mg-200 hover:text-accent rounded ${FOCUS_RING}`}>
        <SlidersHorizontal size={12} aria-hidden="true" /> Options avancées : autre version de l’IA, serveur IA de l’établissement…
      </Link>
    </p>
  );
}

// ─── Proposition (avant le clic, après une annulation ou une erreur) ────────

function errorTitle(step: 'engine' | 'model' | null, code: string): string {
  if (step === 'model' && code === 'ENGINE_OUTDATED') return 'Le moteur IA doit d’abord être mis à jour.';
  if (step === 'engine') return 'L’installation du moteur IA n’a pas abouti.';
  if (step === 'model') return 'Le téléchargement du modèle d’IA n’a pas abouti.';
  return 'L’activation de l’IA n’a pas abouti.';
}

function ActivationOffer({ ai, status, plan, engineUpdate, variant, example, focus, target }: {
  ai: AIController; status: AIStatus; plan: ActivationPlan; engineUpdate: boolean; variant: ActivateAIVariant; example: ReactNode;
  focus: CardFocus; target: FocusTarget;
}) {
  const titleId = useId();
  const sizeId = useId();
  const [confirming, setConfirming] = useState(false);
  const activation = ai.activation;
  // Arrêt sur erreur : la demande reste mémorisée (reprise au prochain lancement de Magistra) — la carte le dit.
  const requested = activation.state === 'error';
  // Arrêt à l'étape du moteur, mais le moteur fonctionne désormais (installé depuis sa page officielle, démarré
  // ailleurs) : l'ancienne erreur n'est plus vraie — jamais « L'installation n'a pas abouti » sur un moteur en marche.
  const engineNowRunning = requested && activation.step === 'engine' && status.engine.state === 'running' && !status.engine.outdated;
  const error = requested && !engineNowRunning ? activation.error : undefined;
  const cancelled = activation.state === 'cancelled';
  // Téléchargement du modèle arrêté par une erreur (réseau, proxy, disque…) : il repart là où il s'est arrêté, sous le
  // même nom que dans les réglages et que le message du processus principal pour le proxy d'établissement (« En
  // cliquant sur « Reprendre le téléchargement », vous autorisez Magistra à relancer le moteur IA avec le proxy »).
  const modelResume = Boolean(error) && activation.step === 'model' && error?.code !== 'ENGINE_OUTDATED';
  // Ce message annonce déjà la relance avec le proxy : les conseils génériques pour le réseau le contrediraient.
  const proxyRestart = modelResume && status.engine.proxyRestart === true;
  const hint = error && !proxyRestart ? networkHint(error.code, error.message, activation.step === 'engine' ? 'engine' : 'model') : null;
  const missing = missingDiskGB(plan, status.hardware.freeDiskGB);
  const duration = downloadDurationText(plan.totalMB);
  const detail = activationSizeDetail(plan);
  const admin = plan.engine === 'admin';
  const buttonLabel = engineUpdate
    ? 'Mettre à jour le moteur IA et reprendre'
    : modelResume ? 'Reprendre le téléchargement' : error ? 'Réessayer' : cancelled || requested ? 'Reprendre l’activation' : ACTIVATE_LABEL;
  const launch = focus.act(() => void ai.activate(engineUpdate ? { engineUpdate: true } : undefined));

  const start = () => {
    if (plan.tierNotRecommended && plan.modelMB > 0) setConfirming(true);
    else launch();
  };

  return (
    <Frame titleId={titleId} title={ACTIVATE_TITLE} icon={<Sparkles size={20} className="text-mg-900" />} focus={focus} target={target}>
      <p className="text-sm text-mg-100 leading-relaxed">
        Un seul clic : Magistra installe et prépare tout, puis l’IA fonctionne ici, gratuitement et en privé, même sans
        Internet. Vos documents et vos contenus restent sur cet ordinateur.
      </p>

      {cancelled && (
        <p className="text-sm text-mg-50">
          Activation interrompue. Vous pouvez la reprendre : ce qui a déjà été téléchargé est conservé.
        </p>
      )}
      {engineNowRunning && (
        <p className="text-sm text-mg-50">
          Le moteur IA fonctionne maintenant : reprenez l’activation pour
          {plan.modelMB > 0 ? ` télécharger ${plan.tierLabel}.` : ' la terminer.'}
        </p>
      )}
      {error && (
        <ErrorBox title={errorTitle(activation.step, error.code)} message={error.message}>
          {hint && <p className="mt-2 text-mg-200">{hint}</p>}
          {activation.step === 'model' && error.code === 'ENGINE_OUTDATED' && status.engine.managedByAdmin && (
            <p className="mt-2 text-mg-200">{engineManagedByAdminText(status)}</p>
          )}
          {activation.step === 'engine' && status.engineDownload.platformSupported && error.code !== 'ENGINE_OUTDATED' && (
            // Recours DANS l'activation : Magistra ouvre la page, attend la détection du moteur, puis télécharge le
            // modèle toute seule (taille annoncée ci-dessous) — jamais une attente à part, qui laisserait ensuite
            // l'ancienne erreur affichée et aucun modèle téléchargé.
            <button
              type="button"
              className={`btn-ghost text-xs py-1.5 px-2.5 mt-2 ${FOCUS_RING}`}
              onClick={focus.act(() => void ai.activate({ manualEngine: true }))}
              aria-describedby={admin ? undefined : sizeId}
            >
              <ExternalLink size={13} aria-hidden="true" /> {OFFICIAL_PAGE_LABEL}
            </button>
          )}
        </ErrorBox>
      )}
      {status.recommendation.warning && <WarningNote>{status.recommendation.warning}</WarningNote>}
      {missing !== null && (
        <WarningNote>
          Espace disque insuffisant : libérez au moins {formatGB(missing)} avant d’activer l’IA
          ({formatGB(plan.requiredDiskGB)} nécessaires).
        </WarningNote>
      )}

      {admin ? (
        !error && (
          <p className="text-sm text-mg-100">
            Le moteur IA de cet ordinateur est trop ancien et a été installé par le service informatique : demandez-lui
            de le mettre à jour.
          </p>
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button type="button" className={`btn-primary text-sm py-2.5 px-5 ${FOCUS_RING}`} onClick={start} aria-describedby={sizeId}>
              {error ? <RefreshCw size={16} aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />} {buttonLabel}
            </button>
            {example}
          </div>
          <div id={sizeId} className="space-y-1">
            <p className="text-sm text-mg-50" data-testid="activate-ai-size">
              {activationSizeText(plan)}
              {detail && <span className="text-mg-200"> ({detail})</span>}
            </p>
            {duration && <p className="text-xs text-mg-200">Durée indicative : {duration}.</p>}
            {plan.engine === 'manual' && (
              <p className="text-xs text-mg-200">
                Sur ce système, le moteur IA s’installe depuis sa page officielle : Magistra l’ouvre, attend la fin de
                l’installation, puis poursuit toute seule.
              </p>
            )}
            {engineWindowMayOpen(status, plan.engine) && (
              <EngineWindowNote moment="install" className="mt-2" />
            )}
            <p className="text-xs text-mg-200">
              {/* Demande mémorisée (arrêt sur erreur) : « rien avant votre clic » serait faux — voir plus bas. */}
              {!requested && 'Rien n’est téléchargé avant votre clic. '}
              Magistra reste utilisable pendant l’installation, et la reprend toute seule si vous la fermez.
            </p>
          </div>
        </>
      )}
      {requested && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="activate-ai-requested">
          <p className="text-xs text-mg-200">
            Votre demande reste enregistrée : sans nouveau clic, Magistra reprendra l’activation à sa prochaine ouverture.
          </p>
          <button type="button" className={`btn-ghost text-xs py-1.5 px-2.5 ${FOCUS_RING}`} onClick={focus.act(() => void ai.forgetActivation())}>
            <X size={13} aria-hidden="true" /> Ne pas reprendre
          </button>
        </div>
      )}
      {variant === 'generate' && example && (
        <p className="text-xs text-mg-200">
          En attendant, l’exemple pré-rédigé montre à quoi ressemble un contenu Magistra : ce n’est pas l’IA, et il
          ne tient pas compte de votre demande.
        </p>
      )}
      <AdvancedLink variant={variant} />

      <ConfirmDialog
        open={confirming}
        title="Version déconseillée sur cet ordinateur"
        message={`${plan.tierLabel} risque d’être très lent ou de ralentir fortement votre ordinateur. Voulez-vous l’installer quand même ?`}
        confirmLabel="Installer quand même"
        cancelLabel="Annuler"
        danger
        onConfirm={() => {
          setConfirming(false);
          launch();
        }}
        onCancel={() => setConfirming(false)}
      />
    </Frame>
  );
}

// ─── Activation sans objet ici (options avancées) ───────────────────────────

/**
 * Modèle personnalisé ou moteur réglé sur un autre ordinateur : l'activation en un clic remplacerait le choix de
 * l'enseignant, ou ne pourrait rien faire ici. La vraie cause, où vont les données, et le chemin des options avancées.
 */
function BlockedCard({ status, blocker, variant, focus, target }: {
  status: AIStatus; blocker: ActivationBlocker; variant: ActivateAIVariant; focus: CardFocus; target: FocusTarget;
}) {
  const titleId = useId();
  const host = engineHostIfRemote(status.engine.url);
  return (
    <Frame
      titleId={titleId}
      title="L’intelligence artificielle n’est pas prête"
      icon={<Info size={20} className="text-mg-900" />}
      focus={focus}
      target={target}
      testId="activate-ai-blocked"
    >
      <p className="text-sm text-mg-50 [overflow-wrap:anywhere]">{status.headline}.</p>
      {blocker === 'remote-engine' ? (
        <p className="text-sm text-mg-100 leading-relaxed [overflow-wrap:anywhere]">
          Magistra est réglée pour utiliser le moteur IA d’un autre ordinateur (« {host} ») : rien ne s’installe sur cet
          ordinateur, et les données de génération sont transmises à cette machine.{' '}
          {status.engine.state === 'running'
            ? 'Installez-y une version de l’IA, ou revenez au moteur IA de cet ordinateur (options avancées).'
            : 'Vérifiez qu’elle est allumée et joignable, ou revenez au moteur IA de cet ordinateur (options avancées).'}
        </p>
      ) : (
        <p className="text-sm text-mg-100 leading-relaxed [overflow-wrap:anywhere]">
          Un modèle personnalisé a été choisi dans les options avancées ({status.config.customModel}) : Magistra ne le
          remplace pas d’elle-même. Pour utiliser une version préparée par Magistra, choisissez « Aucun » comme modèle
          personnalisé dans les options avancées ; l’activation en un clic vous sera alors proposée.
        </p>
      )}
      {variant !== 'setup' && (
        <p className="text-sm">
          <Link to="/setup" className={`inline-flex items-center gap-1.5 text-accent hover:underline underline-offset-2 rounded ${FOCUS_RING}`}>
            <SlidersHorizontal size={14} aria-hidden="true" /> Ouvrir la page de l’IA (options avancées)
          </Link>
        </p>
      )}
    </Frame>
  );
}

// ─── Progression ────────────────────────────────────────────────────────────

function ActivationProgressCard({ ai, status, variant, example, focus, target }: {
  ai: AIController; status: AIStatus; variant: ActivateAIVariant; example: ReactNode; focus: CardFocus; target: FocusTarget;
}) {
  const titleId = useId();
  const activation = ai.activation;
  const running = activation.state === 'running';
  // Opération lancée ailleurs (page de l'IA, réglages) ou fenêtre rechargée : l'étape visible, déduite de la
  // progression — l'étape « modèle » seulement si une activation le téléchargera ensuite.
  const plan = running && activation.plan
    ? activation.plan
    : planFromProgress(ai.progress, status.tiers, { manual: ai.manualInstall, activation: running, modelPending: ai.pending.model });
  const step = running ? activation.step : null;
  const view = activationProgress(plan, step, ai.progress);
  const engineStage = ai.progress.engine?.stage;
  // L'installateur du moteur ne s'interrompt pas en cours de route (comme dans l'installation classique).
  const canCancel = !(step === 'engine' && engineStage === 'install');
  const title = activation.resumed && running ? 'Reprise de l’activation de l’IA' : 'Activation de l’IA de Magistra';
  const transfer = [view.transferText, view.remainingText].filter(Boolean).join(' · ');
  const valueText = [view.percent !== null ? `${view.percent} %` : null, transfer || null].filter(Boolean).join(', ');
  // Attente du moteur installé depuis sa page officielle : la page peut être rouverte (onglet fermé, reprise au lancement).
  const manualWait = plan.engine === 'manual' && view.current === 0;
  // Fenêtre d'Ollama : pendant l'étape du moteur (téléchargement, installation, démarrage) elle peut s'ouvrir ; ensuite
  // (étape du modèle) elle a pu rester ouverte. Page officielle : l'installateur lancé par l'enseignant se termine d'abord.
  const windowMoment = engineWindowMayOpen(status, plan.engine)
    ? (view.steps[view.current]?.id === 'model' ? 'done' : plan.engine === 'manual' ? 'manual' : 'install')
    : null;

  return (
    <Frame titleId={titleId} title={title} icon={<Loader2 size={20} className="text-mg-900 animate-spin" />} focus={focus} target={target}>
      {activation.resumed && running && (
        <p className="text-sm text-mg-200">Magistra reprend l’installation que vous aviez lancée : ce qui a déjà été téléchargé est conservé.</p>
      )}
      {view.steps.length > 1 && (
        <ol className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm" aria-label="Étapes de l’activation">
          {view.steps.map((s, i) => {
            const done = i < view.current;
            const current = i === view.current;
            return (
              <li key={s.id} className={`flex items-center gap-1.5 ${current ? 'text-white font-medium' : done ? 'text-mg-100' : 'text-mg-300'}`}>
                {done ? <CheckCircle2 size={15} className="text-success" aria-hidden="true" /> : current
                  ? <Loader2 size={15} className="text-accent animate-spin" aria-hidden="true" />
                  : <Circle size={15} aria-hidden="true" />}
                <span>
                  <span className="sr-only">Étape {i + 1} sur {view.steps.length}{done ? ' (terminée)' : current ? ' (en cours)' : ''} : </span>
                  {s.label}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="text-sm text-mg-50" role="status" aria-live="polite">
        {view.steps.length > 1 && <span className="text-mg-200">Étape {view.current + 1} sur {view.steps.length} · </span>}
        {view.stageText}
      </p>
      <ProgressBar percent={view.percent} label="Activation de l’IA" valueText={valueText || undefined} />
      {valueText && (
        <p className="text-sm text-mg-200">
          {view.percent !== null && <span className="font-semibold text-mg-50">{view.percent} %</span>}
          {view.percent !== null && transfer && ' · '}
          {transfer}
        </p>
      )}
      {windowMoment && <EngineWindowNote moment={windowMoment} />}
      <p className="text-xs text-mg-200">
        Vous pouvez continuer à utiliser Magistra pendant ce temps.
        {/* Seule une activation est mémorisée (préférence aiSetupRequested) : jamais promis pour une autre opération. */}
        {running && ' Si vous fermez Magistra, l’activation reprendra à sa prochaine ouverture, là où elle s’était arrêtée.'}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {canCancel && (
          <button type="button" className={`btn-secondary text-sm py-2 px-4 ${FOCUS_RING}`} onClick={focus.act(() => void ai.cancelActivation())}>
            <X size={15} aria-hidden="true" /> Annuler
          </button>
        )}
        {manualWait && (
          <button type="button" className={`btn-ghost text-sm py-2 px-3 ${FOCUS_RING}`} onClick={() => void ai.openEngineDownload()}>
            <ExternalLink size={14} aria-hidden="true" /> {OFFICIAL_PAGE_LABEL}
          </button>
        )}
        {example}
      </div>
      <AdvancedLink variant={variant} />
    </Frame>
  );
}

// ─── Fin ────────────────────────────────────────────────────────────────────

function ReadyNote({ ai, status, variant, focus, target }: {
  ai: AIController; status: AIStatus; variant: ActivateAIVariant; focus: CardFocus; target: FocusTarget;
}) {
  // Moteur réglé entre-temps sur un autre ordinateur : les contenus y sont générés, jamais « sur cet ordinateur ».
  const host = engineHostIfRemote(status.engine.url);
  return (
    <div
      ref={target}
      tabIndex={-1}
      onFocus={focus.onFocus}
      onBlur={focus.onBlur}
      className="flex flex-wrap items-center gap-3 rounded-xl border border-success/25 bg-success/5 px-4 py-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      data-testid="activate-ai-ready"
    >
      <CheckCircle2 size={18} className="text-success shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-mg-50">
          <strong className="text-success font-semibold">L’IA de Magistra est prête.</strong>{' '}
          {host
            ? `${status.activeLabel} génère désormais vos contenus sur le serveur « ${host} ».`
            : `${status.activeLabel} génère désormais vos contenus sur cet ordinateur.`}
        </p>
        {engineWindowMayOpen(status, ai.activation.plan?.engine ?? null) && <EngineWindowNote moment="done" />}
      </div>
      {variant === 'dashboard' && (
        <Link to="/app/generate" className={`btn-primary text-xs py-2 px-3 ${FOCUS_RING}`}>
          <Sparkles size={13} aria-hidden="true" /> Générer un contenu
        </Link>
      )}
      <button type="button" className={`btn-ghost p-1.5 ${FOCUS_RING}`} onClick={ai.dismissActivation} aria-label="Fermer le message">
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
