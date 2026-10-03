// Résultat d'une génération : texte streamé puis final, statut, avertissements, erreurs et actions.
// L'en-tête et les exports reposent sur l'INSTANTANÉ de la requête, pas sur le formulaire courant.

import { useEffect, useRef, useState, type Ref } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle, Check, Copy, Download, Eye, FileText, Globe, Loader2, Printer, RotateCcw, Scissors, Square, Star, TriangleAlert,
} from 'lucide-react';
import MarkdownView from '@/components/MarkdownView';
import { copyText, exportMarkdown, exportPdf, printDocument, type ExportDoc } from '@/lib/export';
import {
  buildExportDoc, exampleResultHeading, resultHeading, saveStatus, unwrapDocumentFence, type ResultHeading, type SaveStatus,
} from '@/lib/generation/result';
import { ABORTED_MESSAGE, type GenerationState } from '@/lib/generation/state';
import type { DataStore, RuntimeMode } from '@/lib/runtime/types';
import { getDemoExample } from '@shared/demo';
import type { GenerationRequest } from '@shared/types';
import { toMagistraError, type ErrorCode } from '@shared/errors';
import LoadingSkeleton from './LoadingSkeleton';
import { FOCUS_RING } from './fieldUtils';
import SourceReliability from './SourceReliability';
import SpeedDetails from './SpeedDetails';

interface ResultPanelProps {
  state: GenerationState;
  mode: RuntimeMode;
  store: DataStore;
  onStop(): void;
  onRestart(): void;
  containerRef?: Ref<HTMLElement>;
  /**
   * Exemple pré-rédigé (application Windows, IA pas encore prête, « Voir un exemple pré-rédigé ») : bandeau et libellé
   * « Exemple pré-rédigé — ce n'est pas l'IA », jamais enregistré ni présenté comme une génération.
   */
  example?: boolean;
}

const SETUP_CODES: ErrorCode[] = ['ENGINE_NOT_INSTALLED', 'ENGINE_NOT_RUNNING', 'ENGINE_OUTDATED', 'MODEL_NOT_INSTALLED', 'OUT_OF_MEMORY'];

export const EXAMPLE_TITLE = 'Exemple pré-rédigé — ce n’est pas l’IA';
const EXAMPLE_NOT_SAVED: SaveStatus = {
  saved: false,
  message: 'Exemple non enregistré',
  reason: 'l’historique ne contient que les contenus générés par l’IA.',
};

/** Étape « Chargement du modèle… » : le premier chargement peut être long sur un ordinateur sans carte graphique. */
export const LOADING_MODEL_HINT =
  'Le premier chargement du modèle peut prendre quelques minutes, surtout sur un ordinateur sans carte graphique.';

/**
 * Tableaux, code et formules défilent horizontalement au lieu d'élargir la page (390 px compris) :
 * MarkdownView entoure chaque tableau d'un conteneur `.table-wrap` ; les cellules gardent une largeur
 * lisible plutôt que d'être écrasées.
 */
const CONTENT_WRAPPER =
  'min-w-0 max-w-full [overflow-wrap:anywhere] [&_.table-wrap]:max-w-full [&_.table-wrap]:overflow-x-auto '
  + '[&_th]:min-w-[9rem] [&_td]:min-w-[9rem] [&_pre]:max-w-full [&_pre]:overflow-x-auto '
  + '[&_.math-display]:max-w-full [&_.math-display]:overflow-x-auto [&_.math-display]:overflow-y-hidden';

const ACTION_BTN = `btn-ghost text-xs py-2 px-3 border border-white/8 disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS_RING}`;

export default function ResultPanel({ state, mode, store, onStop, onRestart, containerRef, example = false }: ResultPanelProps) {
  const req = state.request;
  if (state.phase === 'idle' || !req) return null;

  // Exemple : son propre sujet et son niveau (à l'écran et dans les exports), jamais ceux de la demande.
  const heading = example ? exampleResultHeading(req, getDemoExample(req)) : resultHeading(req);
  const running = state.phase === 'running';
  const result = state.result;
  // Document entier entouré d'un bloc « ```markdown » par le modèle : affiché (et copié, exporté) comme un document.
  const text = unwrapDocumentFence(state.text);
  const visibleWarnings = state.warnings.filter(w => w.code !== 'STORAGE_ERROR');
  const save = result ? (example ? EXAMPLE_NOT_SAVED : saveStatus(result, state.warnings, mode)) : null;
  const internetUsed = result ? result.internetUsed : state.internetUsed;

  return (
    <section ref={containerRef} aria-labelledby="gen-result-title" className="mt-10 scroll-mt-4 animate-fade-in">
      <div className="glow-line mb-8" />

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg" aria-hidden="true">{heading.emoji}</span>
            <h2 id="gen-result-title" className="min-w-0 text-xl text-white [overflow-wrap:anywhere]" style={{ fontFamily: 'var(--font-display)' }}>
              {heading.toolLabel}
            </h2>
          </div>
          <p className="text-xs text-mg-200 [overflow-wrap:anywhere]">
            {heading.niveauLabel} · {heading.matiereLabel}
            {heading.subject && ` · ${heading.subject}`}
          </p>
          {(example || internetUsed || result?.truncated) && (
            <div className="flex flex-wrap gap-2 mt-2">
              {example && (
                <span className="badge bg-warning/10 text-warning border border-warning/25">
                  <Eye size={12} aria-hidden="true" /> Exemple pré-rédigé
                </span>
              )}
              {internetUsed && (
                <span className="badge badge-accent"><Globe size={12} aria-hidden="true" /> Internet utilisé</span>
              )}
              {result?.truncated && (
                <span className="badge bg-warning/10 text-warning border border-warning/20">
                  <Scissors size={12} aria-hidden="true" /> Contenu tronqué
                </span>
              )}
            </div>
          )}
          {result && !example && <SourceReliability sources={result.sources} />}
        </div>
        {/* « Arrêter » et « Recommencer » occupent la même place : le second clic d'un double-clic
            (e.detail > 1) est ignoré pour ne pas déclencher aussitôt l'action inverse. */}
        <div className="flex flex-wrap gap-2 shrink-0">
          {running ? (
            <button type="button" onClick={e => { if (e.detail <= 1) onStop(); }} className={`btn-secondary text-xs py-2 px-3 ${FOCUS_RING}`}>
              <Square size={13} aria-hidden="true" /> Arrêter
            </button>
          ) : (
            <button type="button" onClick={e => { if (e.detail <= 1) onRestart(); }} className={`btn-secondary text-xs py-2 px-3 ${FOCUS_RING}`}>
              <RotateCcw size={13} aria-hidden="true" /> Recommencer
            </button>
          )}
        </div>
      </div>

      {example && (
        <div role="note" aria-label="Exemple pré-rédigé" className="mb-4 flex items-start gap-3 p-4 rounded-xl bg-warning/10 border border-warning/30">
          <Eye size={18} className="text-warning shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-warning">{EXAMPLE_TITLE}</p>
            <p className="text-mg-100 mt-0.5">
              Ce texte fixe montre à quoi ressemble un contenu Magistra : il ne tient compte ni de votre sujet, ni de vos
              paramètres, ni de vos documents. Activez l’IA pour générer un contenu adapté à votre demande.
            </p>
          </div>
        </div>
      )}

      {/* Statut (annoncé aux lecteurs d'écran) */}
      <div role="status" aria-live="polite" className="min-h-[1.25rem] mb-3 text-sm">
        {running && (
          <p className="flex items-center gap-2 text-mg-200">
            <Loader2 size={15} className="animate-spin text-accent shrink-0" aria-hidden="true" />
            <span>{state.status ?? 'Préparation de la génération…'}</span>
          </p>
        )}
        {running && state.stage === 'loading_model' && <p className="mt-1 text-xs text-mg-200">{LOADING_MODEL_HINT}</p>}
        {/* Fin de génération annoncée aux lecteurs d'écran (l'état visuel est affiché plus bas). */}
        {state.phase === 'done' && save && (
          <p className="sr-only">
            {save.saved ? 'Génération terminée, contenu enregistré.' : example ? 'Exemple affiché, non enregistré.' : 'Génération terminée, contenu non enregistré.'}
          </p>
        )}
        {state.phase === 'aborted' && (
          <p className="text-mg-100">
            {ABORTED_MESSAGE}
            {text ? ' Le texte déjà produit est conservé ci-dessous.' : ''}
          </p>
        )}
      </div>

      {state.phase === 'error' && state.error && (
        <div role="alert" className="mb-4 p-4 rounded-xl bg-danger/5 border border-danger/25">
          <p className="text-sm text-danger flex items-start gap-2">
            <AlertCircle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
            <span>{state.error.message}</span>
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            {state.error.retryable && (
              <button type="button" onClick={onRestart} className={`btn-secondary text-xs py-2 px-3 ${FOCUS_RING}`}>
                <RotateCcw size={13} aria-hidden="true" /> Réessayer
              </button>
            )}
            {mode === 'local' && SETUP_CODES.includes(state.error.code) && (
              <Link to="/setup" className={`btn-ghost text-xs py-2 px-3 ${FOCUS_RING}`}>
                Configurer l'intelligence artificielle
              </Link>
            )}
          </div>
        </div>
      )}

      {visibleWarnings.length > 0 && (
        <ul className="mb-4 space-y-2" aria-label="Avertissements">
          {visibleWarnings.map(w => (
            <li key={`${w.code}-${w.message}`} className="flex items-start gap-2 p-3 rounded-lg bg-warning/5 border border-warning/15 text-xs text-warning">
              <TriangleAlert size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
              <span>{w.message}</span>
            </li>
          ))}
        </ul>
      )}

      {(running || text) && (
        <div className="card p-4 sm:p-6 lg:p-8" aria-busy={running}>
          {running && !text ? (
            <LoadingSkeleton label={state.status ?? 'Préparation du contenu…'} />
          ) : (
            <div className={CONTENT_WRAPPER}>
              <MarkdownView content={text} />
            </div>
          )}
        </div>
      )}

      {!running && text && (
        <ResultActions key={state.runId} request={req} heading={heading} content={text} resultId={result?.id} store={store} />
      )}

      {save && (
        <div className="mt-4 text-xs" role="status">
          {save.saved ? (
            <p className="text-success flex flex-wrap items-center gap-x-2 gap-y-1">
              <Check size={12} aria-hidden="true" /> {save.message}
              {result?.id && (
                <Link to={`/app/history?id=${encodeURIComponent(result.id)}`} className={`text-accent hover:underline rounded ${FOCUS_RING}`}>
                  Voir dans l'historique
                </Link>
              )}
            </p>
          ) : (
            <p className="text-warning">
              <span className="font-semibold">{save.message}</span>
              {save.reason && <span className="text-mg-200"> — {save.reason}</span>}
            </p>
          )}
        </div>
      )}

      {/* Vitesse : moteur de cet ordinateur seulement, jamais pour un exemple pré-rédigé. */}
      {!running && !example && result && <SpeedDetails metrics={result.metrics} />}
    </section>
  );
}

// ─── Actions ────────────────────────────────────────────────────────────────

interface ResultActionsProps {
  request: GenerationRequest;
  /** En-tête affiché (titre des exports) : celui de l'exemple pour un exemple pré-rédigé. */
  heading: ResultHeading;
  content: string;
  resultId?: string;
  store: DataStore;
}

function ResultActions({ request, heading, content, resultId, store }: ResultActionsProps) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const doc = (): ExportDoc => buildExportDoc(request, content, undefined, heading);

  const onCopy = async () => {
    let ok: boolean;
    try {
      ok = await copyText(content);
    } catch {
      ok = false;
    }
    setCopy(ok ? 'copied' : 'failed');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopy('idle'), ok ? 2000 : 5000);
  };

  const run = async (fn: () => unknown, fallback: string) => {
    setExportError(null);
    try {
      await fn();
    } catch (err) {
      const e = toMagistraError(err);
      setExportError(e.code === 'INTERNAL' ? fallback : e.message);
    }
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Actions sur le contenu">
        <button type="button" onClick={() => void onCopy()} className={ACTION_BTN}>
          {copy === 'copied' ? <Check size={14} className="text-success" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copy === 'copied' ? 'Copié' : 'Copier'}
        </button>
        <button type="button" onClick={() => void run(() => exportMarkdown(doc()), "L'export Markdown a échoué.")} className={ACTION_BTN}>
          <FileText size={14} aria-hidden="true" /> Markdown
        </button>
        <button
          type="button"
          disabled={pdfBusy}
          onClick={() => {
            setPdfBusy(true);
            void run(() => exportPdf(doc()), "L'export PDF a échoué.").finally(() => setPdfBusy(false));
          }}
          className={ACTION_BTN}
        >
          {pdfBusy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
          {pdfBusy ? 'PDF…' : 'PDF'}
        </button>
        <button type="button" onClick={() => void run(() => printDocument(doc()), "L'impression a échoué.")} className={ACTION_BTN}>
          <Printer size={14} aria-hidden="true" /> Imprimer
        </button>
        {resultId && <FavoriteButton key={resultId} id={resultId} store={store} />}
      </div>
      <div aria-live="polite" className="mt-2 text-xs">
        {copy === 'copied' && <span className="sr-only">Contenu copié dans le presse-papiers.</span>}
        {copy === 'failed' && <p className="text-warning">Impossible de copier automatiquement : sélectionnez le texte puis copiez-le manuellement.</p>}
        {exportError && <p className="text-warning" role="alert">{exportError}</p>}
      </div>
    </div>
  );
}

function FavoriteButton({ id, store }: { id: string; store: DataStore }) {
  const [favorite, setFavorite] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !favorite;
    setFavorite(next); // bascule optimiste
    setPending(true);
    setError(null);
    try {
      await store.setFavorite(id, next);
    } catch (err) {
      setFavorite(!next); // retour arrière
      setError(`Favori non modifié : ${toMagistraError(err, 'STORAGE_ERROR').message}`);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        aria-pressed={favorite}
        disabled={pending}
        onClick={() => void toggle()}
        title={favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
        className={`${ACTION_BTN} ${favorite ? 'text-warning' : ''}`}
      >
        <Star size={14} aria-hidden="true" className={favorite ? 'fill-current' : ''} />
        Favori
      </button>
      {error && <p className="basis-full text-xs text-warning" role="alert">{error}</p>}
    </>
  );
}
