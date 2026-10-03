import { useEffect, useState, type RefObject } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, Copy, FileDown, FileText, Globe, Heart, Loader2, Printer, Quote, RotateCcw, Trash2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { tierForModel } from '@shared/ai/models';
import { getMatiereEmoji, getMatiereLabel, isTypeContenu } from '@shared/catalog';
import type { GenerationRecord } from '@shared/types';
import MarkdownView from '@/components/MarkdownView';
import SourceReliability from '@/components/generate/SourceReliability';
import ErrorBanner from '@/components/ui/ErrorBanner';
import { copyText, exportMarkdown, exportPdf, printDocument } from '@/lib/export';
import DevelopSessions from '@/components/generate/DevelopSessions';
import { planOriginFromRecord } from '@/lib/generation/plan';
import { describeRecordParams, isPlanFirst, type ReusableRecord } from '@/lib/generation/reuse';
import { errorMessage, exportDocFor, formatDate, niveauLabelFor, toolLabelFor } from './logic';
import type { RecordState } from './useGenerationRecord';

interface GenerationDetailProps {
  state: RecordState;
  favoritePending: boolean;
  deleting: boolean;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onToggleFavorite: (record: GenerationRecord) => void;
  onRequestDelete: (record: GenerationRecord) => void;
  onBack: () => void;
  onRetry: () => void;
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

type ExportKind = 'md' | 'pdf' | 'print';

const iconButton =
  'btn-ghost p-2 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50';

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="lg:hidden btn-ghost text-xs mb-2 -ml-2" onClick={onBack}>
      <ArrowLeft size={13} aria-hidden="true" /> Retour à la liste
    </button>
  );
}

export default function GenerationDetail({
  state, favoritePending, deleting, headingRef, onToggleFavorite, onRequestDelete, onBack, onRetry, notify,
}: GenerationDetailProps) {
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (state.status === 'loading') {
    return (
      <div className="flex-1 flex flex-col">
        <div className="px-5 pt-4">
          <BackButton onBack={onBack} />
        </div>
        <div className="flex-1 flex items-center justify-center" role="status">
          <Loader2 size={22} className="animate-spin text-accent" aria-hidden="true" />
          <span className="ml-2.5 text-sm text-mg-200">Chargement du contenu…</span>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex-1 p-5 sm:p-8">
        <BackButton onBack={onBack} />
        {state.notFound ? (
          <div className="card p-6 text-center max-w-md" role="alert">
            <p className="text-sm text-mg-100 mb-1 font-medium">Ce contenu est introuvable.</p>
            <p className="text-sm text-mg-300 mb-4">Il a peut-être été supprimé, ou il appartient à un autre compte.</p>
            <button type="button" className="btn-secondary text-xs py-2 px-4" onClick={onBack}>
              Retour à la liste
            </button>
          </div>
        ) : (
          <ErrorBanner message={`Impossible d’afficher ce contenu. ${state.error}`} onRetry={onRetry} />
        )}
      </div>
    );
  }

  const record = state.record;
  const doc = exportDocFor(record);
  // Même contenu que l'export (document entier entouré d'un bloc « ```markdown » par le modèle : retiré).
  const content = doc.content;
  const busy = exporting !== null;

  const handleCopy = async () => {
    let ok: boolean;
    try {
      ok = await copyText(content);
    } catch {
      ok = false;
    }
    if (ok) setCopied(true);
    else notify('Copie impossible : votre navigateur a refusé l’accès au presse-papiers.', 'error');
  };

  const runExport = async (kind: ExportKind) => {
    if (busy) return;
    setExporting(kind);
    try {
      if (kind === 'md') await exportMarkdown(doc);
      else if (kind === 'pdf') await exportPdf(doc);
      else await printDocument(doc);
    } catch (err) {
      const label = kind === 'md' ? 'Export Markdown' : kind === 'pdf' ? 'Export PDF' : 'Impression';
      notify(`${label} impossible : ${errorMessage(err)}`, 'error');
    } finally {
      setExporting(null);
    }
  };

  const sourcesCount = record.sources?.length ?? 0;
  const paramRows = describeRecordParams(record);
  // Nom Magistra du modèle (Léger, Standard, Qualité) ; le nom technique reste dans les options avancées.
  const modelLabel = record.model ? tierForModel(record.model)?.label : undefined;
  const reuse = () => {
    // Seuls les paramètres de la demande sont transmis (pas le contenu généré).
    const request: ReusableRecord = {
      type: record.type, niveau: record.niveau, matiere: record.matiere, discipline: record.discipline, sujet: record.sujet, params: record.params,
    };
    // L'outil dans l'adresse : la barre latérale le signale, comme pour tout outil ouvert depuis le menu.
    navigate(isTypeContenu(record.type) ? `/app/generate?type=${record.type}` : '/app/generate', { state: { reuse: request } });
  };
  // Démonstration : exemple pré-rédigé, jamais présenté comme produit par une IA.
  const isDemo = record.params?.demo === true;

  return (
    <>
      <div className="px-5 py-4 border-b border-white/5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <BackButton onBack={onBack} />
          <div className="flex items-start gap-2.5">
            <span className="text-xl shrink-0 leading-tight" aria-hidden="true">{getMatiereEmoji(record.matiere)}</span>
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="min-w-0 text-lg text-white leading-snug focus:outline-none [overflow-wrap:anywhere]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {record.sujet}
            </h2>
          </div>
          <p className="text-xs text-mg-200 mt-1 [overflow-wrap:anywhere]">
            {toolLabelFor(record)} · {niveauLabelFor(record)} · {getMatiereLabel(record.matiere)}
            {record.discipline ? ` · ${record.discipline}` : ''}
          </p>
          <p className="text-xs text-mg-300 mt-0.5">
            <time dateTime={record.createdAt}>{formatDate(record.createdAt, true)}</time>
          </p>
          {(record.internetUsed || sourcesCount > 0) && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {record.internetUsed && (
                <span className="badge badge-accent">
                  <Globe size={11} aria-hidden="true" /> Internet utilisé
                </span>
              )}
              {sourcesCount > 0 && (
                <span className="badge badge-success">
                  <Quote size={11} aria-hidden="true" /> {sourcesCount} source{sourcesCount > 1 ? 's' : ''} citée{sourcesCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}
          <SourceReliability sources={record.sources ?? []} />
        </div>

        <div className="flex items-center gap-0.5 shrink-0 -ml-2 sm:ml-0" role="group" aria-label="Actions sur ce contenu">
          <button
            type="button"
            onClick={() => onToggleFavorite(record)}
            disabled={favoritePending || deleting}
            aria-pressed={record.isFavorite}
            aria-label="Favori"
            title={record.isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
            className={iconButton}
          >
            <Heart size={16} aria-hidden="true" className={record.isFavorite ? 'text-accent fill-accent' : ''} />
          </button>
          <button type="button" onClick={() => void handleCopy()} aria-label={copied ? 'Contenu copié' : 'Copier le contenu'} title="Copier" className={iconButton}>
            {copied ? <Check size={16} className="text-success" aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={() => void runExport('md')}
            disabled={busy}
            aria-label="Exporter en Markdown"
            title="Exporter en Markdown (.md)"
            className={iconButton}
          >
            {exporting === 'md' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={() => void runExport('pdf')}
            disabled={busy}
            aria-label="Exporter en PDF"
            title="Exporter en PDF"
            className={iconButton}
          >
            {exporting === 'pdf' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <FileDown size={16} aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={() => void runExport('print')}
            disabled={busy}
            aria-label="Imprimer"
            title="Imprimer"
            className={iconButton}
          >
            <Printer size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onRequestDelete(record)}
            disabled={deleting}
            aria-label="Supprimer ce contenu"
            title="Supprimer"
            className={`${iconButton} text-danger/80 hover:text-danger`}
          >
            {deleting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
          </button>
          <span className="sr-only" role="status">{copied ? 'Contenu copié dans le presse-papiers.' : ''}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 sm:p-8">
        {record.truncated && (
          <div role="note" className="flex items-start gap-2.5 rounded-xl border border-warning/25 bg-warning/5 px-4 py-3 mb-5 max-w-3xl">
            <AlertTriangle size={15} className="text-warning shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-mg-100">
              Contenu tronqué : la longueur maximale a été atteinte, la fin peut manquer. Relisez-le avant usage ou relancez une génération plus courte.
            </p>
          </div>
        )}
        <div className="max-w-3xl mb-6 space-y-3">
          {paramRows.length > 0 && (
            <details className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3">
              <summary className="cursor-pointer text-sm text-mg-100">Paramètres de la demande</summary>
              <dl className="mt-3 grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
                {paramRows.map(row => (
                  <div key={row.label} className="contents">
                    <dt className="text-mg-200">{row.label}</dt>
                    <dd className="min-w-0 text-mg-50 whitespace-pre-line [overflow-wrap:anywhere] mb-1 sm:mb-0">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          <button type="button" onClick={reuse} className="btn-secondary text-xs py-2 px-3">
            <RotateCcw size={13} aria-hidden="true" /> Reprendre cette demande
          </button>
        </div>
        <MarkdownView content={content} className="max-w-3xl" />
        {/* Plan seul (« Commencer par le plan ») : les séances à développer ; tableau illisible : rien. Jamais pour un exemple
            pré-rédigé de la démonstration (son plan est fixe, sans rapport avec le sujet enregistré). */}
        {isPlanFirst(record) && !isDemo && (
          <div className="max-w-3xl">
            <DevelopSessions
              key={record.id}
              content={content}
              origin={planOriginFromRecord(record)}
              requested={typeof record.params?.nombreSeances === 'number' ? record.params.nombreSeances : undefined}
              planId={record.id}
            />
          </div>
        )}
        <p className="text-xs text-mg-300 mt-8 pt-4 border-t border-white/5 max-w-3xl">
          {isDemo
            ? 'Exemple pré-rédigé de la démonstration : aucune IA n’a été utilisée.'
            : <>Contenu produit par IA : à relire, vérifier et adapter avant usage.{modelLabel ? ` Modèle : ${modelLabel}.` : ''}</>}
        </p>
      </div>
    </>
  );
}
