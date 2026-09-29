// Page « Générer » : 11 outils, formulaire propre à chaque outil, sources (documents + recherche),
// confidentialité honnête, génération en flux avec arrêt / reprise.
// Mise en page : sélecteur d'outils en haut (onglets défilants) sous `lg`, barre latérale au-dessus.
//
// Site web : la génération est faite par Magistra locale (IA de l'ordinateur de l'enseignant, via l'application
// Windows) OU par le serveur en ligne, selon le choix de l'enseignant. Le bandeau dit TOUJOURS lequel avant l'envoi ;
// Magistra locale non prête → panneau dédié, jamais de bascule silencieuse vers le serveur (seul un choix confirmé
// de l'enseignant y mène). Les capacités affichées sont toujours celles du moteur qui traitera la génération ; elles
// sont relues quand le choix ou l'état de Magistra locale change, et le moteur est revérifié juste avant l'envoi.

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Info, Loader2, Settings2, Sparkles } from 'lucide-react';
import { getToolInfo, type TypeContenu } from '@shared/catalog';
import { toMagistraError } from '@shared/errors';
import type { NiveauScolaire } from '@shared/levels';
import {
  modeUsesDocuments, type DocumentPassage, type GenerationRequest, type ResearchMode,
} from '@shared/types';
import ConnectRealAICard from '@/components/ai/ConnectRealAICard';
import AiNotReadyCard from '@/components/generate/AiNotReadyCard';
import EngineBanner from '@/components/localEngine/EngineBanner';
import { engineStateKey, serverProviderName, useEngineRoute, useRouteCapsHeal } from '@/components/localEngine/engineRoute';
import LocalEngineNotReadyPanel from '@/components/localEngine/LocalEngineNotReadyPanel';
import { localEngineMessage, SEARCHING_TEXT } from '@/components/localEngine/texts';
import GenerateFormFields from '@/components/generate/GenerateFormFields';
import PrivacyNotice from '@/components/generate/PrivacyNotice';
import ResearchModePicker from '@/components/generate/ResearchModePicker';
import ResultPanel from '@/components/generate/ResultPanel';
import SourcesPanel from '@/components/generate/SourcesPanel';
import ToolPicker from '@/components/generate/ToolPicker';
import { useLocalPreferences, useSourceDocuments } from '@/components/generate/useSourceDocuments';
import { FOCUS_RING } from '@/components/generate/fieldUtils';
import { useCapabilities, useGeneration } from '@/hooks/useGeneration';
import { selectPassages } from '@/lib/documents';
import {
  buildGenerationRequest, buildPassageQuery, createInitialForm, DEFAULT_DOCUMENT_BUDGET, validateForm, withNiveau,
  type GenerateForm,
} from '@/lib/generation/request';
import {
  describeResearchOptions, effectiveResearchMode, modeUsesNetwork, NETWORK_PRIVACY_NOTE, privacyNotes, providerAnnounced,
  researchHints,
} from '@/lib/generation/research';
import { formFromRecord, type ReusableRecord } from '@/lib/generation/reuse';
import { useLocalEngine } from '@/lib/localConnector/controller';
import { adminContact, configuredProvider, useRuntime } from '@/lib/runtime/context';
import { HybridGenerationClient, type EngineRoute } from '@/lib/runtime/hybrid';
import { usesServerApi } from '@/lib/runtime/types';

/** Magistra locale attend l'accord du navigateur : la génération ne doit pas faire apparaître sa demande sans explication. */
export const LOCAL_PERMISSION_NOTICE =
  'Autorisez d’abord votre navigateur à joindre Magistra : bouton « Rechercher Magistra… » ci-dessus.';
export const LOCAL_PAIRING_NOTICE = 'Terminez d’abord la connexion de Magistra locale (confirmation dans l’application Magistra).';
/**
 * Autorisation du navigateur encore à demander, dans un autre état que « Autorisation du navigateur nécessaire » : la
 * génération ne doit pas faire apparaître sa demande sans explication (les boutons de Magistra locale l'expliquent).
 */
export const LOCAL_PERMISSION_FIRST_NOTICE =
  'Autorisez d’abord votre navigateur à joindre Magistra : utilisez les boutons de Magistra locale ci-dessus, puis acceptez sa demande.';
export const ENGINE_CHANGED_NOTICE =
  'Le moteur de génération vient de changer : vérifiez le bandeau en haut de la page, puis relancez la génération.';

const FIELD_IDS: Record<string, string> = {
  sujet: 'gen-sujet',
  discipline: 'gen-discipline',
  nombreAppreciations: 'gen-nombre',
  contenuSource: 'gen-contenu',
  texteEleve: 'gen-copie',
  objectifs: 'gen-objectifs',
  consignes: 'gen-consignes',
};

export default function GeneratePage() {
  const { mode, client, store, profile } = useRuntime();
  const [searchParams] = useSearchParams();
  // « Reprendre cette demande » (historique) : formulaire prérempli avec les paramètres enregistrés.
  const location = useLocation();
  const [reused] = useState(() => {
    const reuse = (location.state as { reuse?: ReusableRecord } | null)?.reuse;
    return reuse ? formFromRecord(reuse, profile) : null;
  });
  const [form, setForm] = useState<GenerateForm>(() =>
    reused?.form ?? createInitialForm(profile, { type: searchParams.get('type'), sujet: searchParams.get('sujet') }),
  );
  const [showErrors, setShowErrors] = useState(false);
  const [submitNotice, setSubmitNotice] = useState<string | null>(null);
  const [chosenMode, setChosenMode] = useState<ResearchMode | null>(reused?.researchMode ?? null);

  const capabilities = useCapabilities(client);
  const reloadCaps = capabilities.refresh;
  const prefs = useLocalPreferences(mode);
  const sources = useSourceDocuments(mode, prefs);
  const generation = useGeneration(client);
  const resultRef = useRef<HTMLElement>(null);

  const tool = getToolInfo(form.type, form.niveau);
  const problems = useMemo(() => validateForm(form), [form]);

  // Site web : Magistra locale ou serveur en ligne (client hybride + contrôleur de Magistra locale) ; sinon null.
  const localEngine = useLocalEngine();
  const hybrid = localEngine && client instanceof HybridGenerationClient ? client : null;
  const engine = hybrid ? localEngine : null;
  const engineRoute = useEngineRoute(engine?.state ?? null);
  const setEngineChoice = engineRoute.setChoice;
  const route = engine ? engineRoute.route : null;
  const localRoute = route === 'local-connector';
  const localState = engine?.state ?? null;
  const localController = engine?.controller ?? null;
  // Capacités du moteur qui traitera RÉELLEMENT la prochaine génération (jamais celles de l'autre moteur).
  const caps = engine ? (capabilities.caps?.route === route ? capabilities.caps : null) : capabilities.caps;

  // Recherche : préférence enregistrée par défaut, sinon « Mes documents uniquement ». Magistra locale : sources de
  // l'application (réglées dans l'application Windows) ; pas encore prête : rien n'est promis ni retiré.
  const researchCaps = localRoute && caps && !caps.ready ? null : caps;
  const researchOptions = useMemo(
    () => describeResearchOptions(researchCaps, mode, form.niveau, route),
    [researchCaps, mode, form.niveau, route],
  );
  const researchMode = effectiveResearchMode(chosenMode ?? prefs?.defaultResearchMode ?? 'documents', researchOptions);
  const hints = researchHints(researchMode, sources.docs.filter(d => d.status !== 'error').length, form.niveau, researchOptions, mode);
  // Destinataire des textes : fiche de /api/status, sinon celle annoncée au démarrage par /api/mode, sinon annonce
  // prudente. Pendant la première vérification, sans prestataire annoncé, la génération attend (quelques secondes).
  const fallbackProvider = configuredProvider();
  // Site web : moteur choisi (Magistra locale ou serveur en ligne), connu avant ses capacités.
  const privacyContext = { runtimeMode: mode, fallbackProvider, route };
  // Moteur pas encore connu : aucune annonce (ni locale ni distante) tant qu'il n'est pas vérifié ; l'envoi attend.
  const privacy = engine && route === null
    ? { message: null, network: modeUsesNetwork(researchMode) ? NETWORK_PRIVACY_NOTE : null, local: null }
    : privacyNotes(caps, researchMode, privacyContext);
  const serverVerifying = !providerAnnounced(caps, privacyContext) && capabilities.loading;
  // Moteur encore inconnu, ou capacités de Magistra locale pas encore lues : la génération attend (quelques instants).
  const verifying = engine ? route === null || (localRoute ? caps === null : serverVerifying) : serverVerifying;
  const aiRecipient = localRoute || (engine && route === null)
    ? undefined
    : caps?.providerInfo?.thirdParty
      ? caps.providerInfo.label
      : !caps && fallbackProvider?.thirdParty ? fallbackProvider.label : undefined;
  const providerName = serverProviderName(route === 'server' ? caps : null, fallbackProvider);
  const localReady = localState?.kind === 'connected' && Boolean(localState.status?.engine.ready && localState.status.engine.local);
  // Magistra locale choisie mais en attente d'une action (autorisation du navigateur, appairage, recherche) : l'envoi
  // ferait apparaître une demande du navigateur sans explication, ou échouerait à coup sûr.
  const localBlocked = !localRoute || !localState ? null
    : localState.kind === 'needs-permission' ? LOCAL_PERMISSION_NOTICE
      : localState.kind === 'pairing' ? LOCAL_PAIRING_NOTICE
        : localState.kind === 'checking' || localState.kind === 'idle' ? SEARCHING_TEXT
          // Appairé, autorisation toujours à demander (« application fermée » après une demande restée sans réponse…) :
          // l'envoi (preuve GET /v1/status) ferait apparaître la demande du navigateur sans explication.
          : localState.paired && localState.permission === 'prompt' ? LOCAL_PERMISSION_FIRST_NOTICE : null;

  // Capacités relues quand le moteur choisi ou l'état de Magistra locale (utilisée) change. Moteur inconnu → connu :
  // les capacités lues au montage sont déjà celles de ce moteur (même règle de choix), rien à relire.
  const capsKey = engine ? `${route ?? ''}|${localRoute && localState ? engineStateKey(localState) : ''}` : '';
  const capsKeyRef = useRef(capsKey);
  useEffect(() => {
    const previous = capsKeyRef.current;
    if (previous === capsKey) return;
    capsKeyRef.current = capsKey;
    if (previous.startsWith('|')) return;
    reloadCaps();
  }, [capsKey, reloadCaps]);

  useRouteCapsHeal(localController, route, capabilities.caps, capabilities.loading, reloadCaps);

  // Passage au serveur en ligne confirmé depuis le panneau « Magistra locale n'est pas prête » : le panneau (et le
  // bouton qui avait le focus) disparaît ; le focus va au bandeau du moteur, qui annonce le nouveau moteur (jamais
  // perdu au début de la page).
  const bannerRef = useRef<HTMLDivElement>(null);
  const focusBannerOnRoute = useRef<EngineRoute | null>(null);
  useEffect(() => {
    if (focusBannerOnRoute.current === null || focusBannerOnRoute.current !== route) return;
    focusBannerOnRoute.current = null;
    bannerRef.current?.focus({ preventScroll: true });
  }, [route]);

  // Le résultat apparaît sous le formulaire : on l'amène à l'écran à chaque nouvelle génération.
  const runId = generation.state.runId;
  useEffect(() => {
    if (runId > 0) resultRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [runId]);

  const update = (patch: Partial<GenerateForm>) => {
    setForm(f => ({ ...f, ...patch }));
    setSubmitNotice(null);
  };
  const changeTool = (type: TypeContenu) => {
    setForm(f => ({ ...f, type }));
    setShowErrors(false);
    setSubmitNotice(null);
  };
  const changeNiveau = (niveau: NiveauScolaire) => {
    setForm(f => withNiveau(f, niveau, profile));
    setSubmitNotice(null);
  };

  /**
   * Site web : le moteur réel (même lecture que la génération) est revérifié juste avant l'envoi ; s'il diffère du
   * bandeau, rien n'est envoyé et l'enseignant est prévenu (jamais d'envoi vers un moteur qui n'a pas été annoncé).
   */
  const routeCheck = useRef(false);
  const startGeneration = (request: GenerationRequest) => {
    if (!hybrid || !localController) {
      generation.start(request);
      return;
    }
    if (routeCheck.current) return;
    routeCheck.current = true;
    const announced = route;
    void hybrid.route().then(
      actual => {
        routeCheck.current = false;
        if (actual !== announced) {
          setSubmitNotice(ENGINE_CHANGED_NOTICE);
          void localController.refresh();
          reloadCaps();
          return;
        }
        generation.start(request);
      },
      () => {
        // Lecture impossible (cas imprévu) : rien n'est envoyé sans moteur vérifié.
        routeCheck.current = false;
        setSubmitNotice(ENGINE_CHANGED_NOTICE);
        reloadCaps();
      },
    );
  };

  /**
   * Garde-fous communs à l'envoi et à la relance : destinataire des textes vérifié, et Magistra locale qui n'attend
   * aucune action de l'enseignant (autorisation du navigateur expliquée d'abord, appairage, recherche). Faux : rien
   * n'est envoyé, la raison est affichée sous le bouton.
   */
  const readyToSend = (): boolean => {
    // Destinataire des textes pas encore annoncé : on attend la vérification (la touche Entrée contourne le bouton).
    if (verifying) {
      setSubmitNotice(localRoute
        ? 'Vérification de Magistra locale en cours : la génération sera possible dans quelques secondes.'
        : "Vérification du service d'IA en cours : la génération sera possible dans quelques secondes.");
      return false;
    }
    if (localBlocked) {
      setSubmitNotice(localBlocked);
      return false;
    }
    return true;
  };

  /** « Recommencer » / « Réessayer » : mêmes garde-fous que l'envoi, moteur réel revérifié (startGeneration). */
  const restartGeneration = () => {
    const request = generation.state.request;
    if (!request || generation.isRunning || !readyToSend()) return;
    setSubmitNotice(null);
    startGeneration(request);
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // La touche Entrée ne relance jamais une génération en cours.
    if (generation.isRunning) return;
    if (!readyToSend()) return;
    if (problems.length > 0) {
      setShowErrors(true);
      setSubmitNotice(problems[0].message);
      const id = FIELD_IDS[problems[0].field];
      if (id) document.getElementById(id)?.focus();
      return;
    }
    if (sources.analyzing) {
      setSubmitNotice("Attendez la fin de l'analyse des documents (ou retirez le document en cours d'analyse).");
      return;
    }
    let passages: DocumentPassage[] | undefined;
    try {
      passages = modeUsesDocuments(researchMode) && sources.readyDocs.length > 0
        ? selectPassages(sources.readyDocs, buildPassageQuery(form, form.type), {
          budgetChars: caps?.maxDocumentChars ?? DEFAULT_DOCUMENT_BUDGET,
        })
        : undefined;
    } catch (err) {
      setSubmitNotice(toMagistraError(err, 'DOCUMENT_UNREADABLE').message);
      return;
    }
    setShowErrors(false);
    setSubmitNotice(null);
    startGeneration(buildGenerationRequest(form, form.type, profile, passages, researchMode));
  };

  const running = generation.isRunning;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 py-6 lg:py-8 lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-8 xl:gap-10">
      <ToolPicker value={form.type} niveau={form.niveau} onChange={changeTool} />

      <div className="min-w-0 max-w-3xl">
        {/* En-tête */}
        <header className="mb-6">
          <div className="badge badge-accent mb-3">
            <Sparkles size={12} aria-hidden="true" /> Génération IA
          </div>
          <h1 className="text-2xl sm:text-3xl text-white" style={{ fontFamily: 'var(--font-display)' }}>
            {profile?.displayName
              ? <>{profile.displayName}, que souhaitez-vous <em className="text-accent not-italic">créer</em> ?</>
              : <>Que souhaitez-vous <em className="text-accent not-italic">créer</em> ?</>}
          </h1>
        </header>

        {reused && (
          <div role="note" className="mb-6 p-4 rounded-xl bg-white/[0.03] border border-white/10 text-sm text-mg-100">
            <p className="text-white font-medium">Demande reprise depuis l’historique : vérifiez les paramètres avant de générer.</p>
            {reused.notes.length > 0 && (
              <ul className="mt-1.5 list-disc pl-5 space-y-0.5 text-mg-200 [overflow-wrap:anywhere]">
                {reused.notes.map(note => <li key={note}>{note}</li>)}
              </ul>
            )}
          </div>
        )}

        {/* Outil choisi */}
        <div className="mb-6 flex items-center gap-3.5 p-4 rounded-xl bg-accent/5 border border-accent/15">
          <div aria-hidden="true" className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/15 flex items-center justify-center text-xl shrink-0 select-none">
            {tool.icon}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white leading-tight">{tool.label}</p>
            <p className="text-xs text-mg-200 mt-0.5 leading-relaxed">{tool.description}</p>
          </div>
        </div>

        <div className="space-y-6">
          {engine && (
            <EngineBanner
              route={route}
              providerName={providerName}
              localAvailable={localReady}
              onUseLocal={() => {
                // Le rappel (et son bouton, qui avait le focus) disparaît : le focus va au bandeau du moteur.
                focusBannerOnRoute.current = 'local-connector';
                setEngineChoice('local');
              }}
              focusRef={bannerRef}
            />
          )}

          {engine && localRoute ? (
            caps && !caps.ready && localState && localState.kind !== 'idle' && localState.kind !== 'checking' ? (
              <LocalEngineNotReadyPanel
                engine={engine}
                cause={caps.notReady}
                providerName={providerName}
                onUseServer={() => {
                  focusBannerOnRoute.current = 'server';
                  setEngineChoice('server');
                }}
              />
            ) : caps?.ready && caps.aiWarning ? (
              <p role="note" className="flex items-start gap-2 p-3 rounded-xl bg-white/[0.03] border border-white/8 text-xs text-mg-200">
                <Info size={14} className="text-accent shrink-0 mt-0.5" aria-hidden="true" />
                <span>{localEngineMessage(caps.aiWarning.code, caps.aiWarning.message)}</span>
              </p>
            ) : null
          ) : (
            <AiNotReadyCard
              mode={mode}
              caps={caps}
              checkError={engine && route === null ? null : capabilities.error}
              checking={capabilities.loading}
              onRecheck={capabilities.refresh}
              adminContact={adminContact()}
            />
          )}

          {mode === 'demo' && <ConnectRealAICard />}

          <form onSubmit={handleSubmit} noValidate aria-label="Demande de génération" className="space-y-6">
            <section aria-labelledby="gen-params-title" className="card p-5 sm:p-6">
              <div className="flex items-center gap-2 mb-5 pb-4 border-b border-white/6">
                <Settings2 size={14} className="text-mg-200" aria-hidden="true" />
                <h2 id="gen-params-title" className="text-xs font-semibold text-mg-200 uppercase tracking-widest">
                  Paramètres de génération
                </h2>
              </div>
              <GenerateFormFields
                form={form}
                onChange={update}
                onNiveauChange={changeNiveau}
                problems={problems}
                showErrors={showErrors}
              />
            </section>

            <SourcesPanel
              sources={sources}
              mode={mode}
              keepPreference={prefs ? prefs.keepDocuments : null}
              aiRecipient={aiRecipient}
              aiRecipientUnknown={usesServerApi(mode) && !caps && !aiRecipient && !localRoute && !(engine && route === null)}
            >
              <ResearchModePicker options={researchOptions} value={researchMode} onChange={setChosenMode} hints={hints} />
            </SourcesPanel>

            <PrivacyNotice notes={privacy} />

            <div>
              <button
                type="submit"
                disabled={running || verifying || localBlocked !== null}
                className={`btn-primary w-full py-3.5 text-sm font-semibold justify-center ${FOCUS_RING}`}
              >
                {running
                  ? <><Loader2 size={17} className="animate-spin" aria-hidden="true" /> Génération en cours…</>
                  : verifying
                    ? <><Loader2 size={17} className="animate-spin" aria-hidden="true" /> {localRoute ? 'Vérification de Magistra locale…' : "Vérification du service d'IA…"}</>
                    : <><Sparkles size={17} aria-hidden="true" /> Générer : {tool.label}</>}
              </button>
              <p id="gen-submit-status" role="status" aria-live="polite" className="mt-2 text-xs text-warning min-h-[1rem]">
                {submitNotice ?? localBlocked ?? (sources.analyzing ? 'Analyse des documents en cours…' : '')}
              </p>
            </div>
          </form>
        </div>

        <ResultPanel
          state={generation.state}
          mode={mode}
          store={store}
          onStop={generation.stop}
          onRestart={restartGeneration}
          containerRef={resultRef}
        />
      </div>
    </div>
  );
}
