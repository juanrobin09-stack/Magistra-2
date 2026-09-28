// Page « Générer » : 11 outils, formulaire propre à chaque outil, sources (documents + recherche),
// confidentialité honnête, génération en flux avec arrêt / reprise.
// Mise en page : sélecteur d'outils en haut (onglets défilants) sous `lg`, barre latérale au-dessus.

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Loader2, Settings2, Sparkles } from 'lucide-react';
import { getToolInfo, type TypeContenu } from '@shared/catalog';
import { toMagistraError } from '@shared/errors';
import type { NiveauScolaire } from '@shared/levels';
import { modeUsesDocuments, type DocumentPassage, type ResearchMode } from '@shared/types';
import AiNotReadyCard from '@/components/generate/AiNotReadyCard';
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
  describeResearchOptions, effectiveResearchMode, privacyNotes, researchHints,
} from '@/lib/generation/research';
import { formFromRecord, type ReusableRecord } from '@/lib/generation/reuse';
import { useRuntime } from '@/lib/runtime/context';

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
  const caps = capabilities.caps;
  const prefs = useLocalPreferences(mode);
  const sources = useSourceDocuments(mode, prefs);
  const generation = useGeneration(client);
  const resultRef = useRef<HTMLElement>(null);

  const tool = getToolInfo(form.type, form.niveau);
  const problems = useMemo(() => validateForm(form), [form]);

  // Recherche : préférence locale par défaut, sinon « Mes documents uniquement » (fonctionne hors ligne).
  const researchOptions = useMemo(() => describeResearchOptions(caps, mode, form.niveau), [caps, mode, form.niveau]);
  const researchMode = effectiveResearchMode(chosenMode ?? prefs?.defaultResearchMode ?? 'documents', researchOptions);
  const hints = researchHints(researchMode, sources.docs.filter(d => d.status !== 'error').length, form.niveau, researchOptions, mode);
  const privacy = privacyNotes(caps, researchMode);

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

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // La touche Entrée ne relance jamais une génération en cours.
    if (generation.isRunning) return;
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
    generation.start(buildGenerationRequest(form, form.type, profile, passages, researchMode));
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
          <AiNotReadyCard
            mode={mode}
            caps={caps}
            checkError={capabilities.error}
            checking={capabilities.loading}
            onRecheck={capabilities.refresh}
          />

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

            <SourcesPanel sources={sources} mode={mode} keepPreference={prefs ? prefs.keepDocuments : null}>
              <ResearchModePicker options={researchOptions} value={researchMode} onChange={setChosenMode} hints={hints} />
            </SourcesPanel>

            <PrivacyNotice notes={privacy} />

            <div>
              <button
                type="submit"
                disabled={running}
                className={`btn-primary w-full py-3.5 text-sm font-semibold justify-center ${FOCUS_RING}`}
              >
                {running
                  ? <><Loader2 size={17} className="animate-spin" aria-hidden="true" /> Génération en cours…</>
                  : <><Sparkles size={17} aria-hidden="true" /> Générer : {tool.label}</>}
              </button>
              <p id="gen-submit-status" role="status" aria-live="polite" className="mt-2 text-xs text-warning min-h-[1rem]">
                {submitNotice ?? (sources.analyzing ? 'Analyse des documents en cours…' : '')}
              </p>
            </div>
          </form>
        </div>

        <ResultPanel
          state={generation.state}
          mode={mode}
          store={store}
          onStop={generation.stop}
          onRestart={generation.restart}
          containerRef={resultRef}
        />
      </div>
    </div>
  );
}
