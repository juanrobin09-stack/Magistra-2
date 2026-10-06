// Section « Sources » : documents de l'enseignant (analyse locale) + réutilisation des documents conservés.

import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Check, FileText, HardDrive, Loader2, Trash2, Upload, X } from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { ACCEPT } from '@/lib/documents';
import type { RuntimeMode } from '@/lib/runtime/types';
import { FOCUS_RING } from './fieldUtils';
import type { SourceDoc, UseSourceDocuments } from './useSourceDocuments';

interface SourcesPanelProps {
  sources: UseSourceDocuments;
  mode: RuntimeMode;
  /** Préférence « conserver les documents » (application Windows) ; null ailleurs. */
  keepPreference: boolean | null;
  /** Prestataire tiers (service d'IA en ligne) qui reçoit les passages, s'il y en a un : il est nommé. */
  aiRecipient?: string;
  /** Destinataire pas encore connu (vérification du service d'IA en cours ou en échec) : annonce prudente. */
  aiRecipientUnknown?: boolean;
  /** Emplacement du sélecteur de recherche. */
  children?: ReactNode;
}

/** ACCEPT peut être une chaîne (« .pdf,.docx… ») ou une liste d'extensions. */
const ACCEPT_ATTR: string = [ACCEPT].flat().join(',');

function where(mode: RuntimeMode): string {
  if (mode === 'local') return 'sur cet ordinateur';
  return 'dans votre navigateur';
}

function DocStatus({ doc }: { doc: SourceDoc }) {
  if (doc.status === 'analyzing') {
    return (
      <span className="inline-flex items-center gap-1.5 text-mg-200">
        <Loader2 size={12} className="animate-spin" aria-hidden="true" /> {doc.progress ?? 'Analyse en cours…'}
      </span>
    );
  }
  if (doc.status === 'error') return <span className="text-warning">{doc.error ?? 'Document impossible à lire.'}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      <span className="text-success inline-flex items-center gap-1"><Check size={12} aria-hidden="true" /> Analysé</span>
      {doc.description && <span className="text-mg-200">· {doc.description}</span>}
    </span>
  );
}

export default function SourcesPanel({ sources, mode, keepPreference, aiRecipient, aiRecipientUnknown, children }: SourcesPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [toDelete, setToDelete] = useState<{ id: string; name: string } | null>(null);
  const full = sources.docs.length >= sources.maxDocuments;
  const inUse = new Set(sources.docs.map(d => d.storedId).filter(Boolean));

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer?.files?.length) sources.addFiles(e.dataTransfer.files);
  };

  return (
    <section aria-labelledby="gen-sources-title" className="card p-5 sm:p-6">
      <h2 id="gen-sources-title" className="text-lg text-white mb-1" style={{ fontFamily: 'var(--font-display)' }}>
        Sources
      </h2>
      <p className="text-sm text-mg-200 mb-4 leading-relaxed">
        Ajoutez vos cours, articles ou supports : Magistra s'appuie d'abord sur eux et cite les pages ou diapositives utilisées.
      </p>

      <div
        onDragOver={e => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-xl border border-dashed p-4 sm:p-5 text-center transition-colors ${
          dragging ? 'border-accent bg-accent/5' : 'border-white/15 bg-mg-900/30'
        }`}
      >
        <Upload size={20} className="mx-auto mb-2 text-accent" aria-hidden="true" />
        <p className="text-sm text-mg-200 mb-3 hidden sm:block">Glissez vos fichiers ici, ou</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={full}
          className={`btn-secondary text-sm py-2 px-4 disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS_RING}`}
        >
          <FileText size={15} aria-hidden="true" /> Ajouter des documents
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={e => {
            if (e.target.files?.length) sources.addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <p className="text-xs text-mg-300 mt-3 leading-relaxed">
          PDF, DOCX, PPTX, TXT, MD — jusqu'à {sources.maxDocuments} documents. L'analyse se fait {where(mode)} : le fichier
          original n'est jamais envoyé, seuls les passages utiles sont transmis{aiRecipient
            ? ` à « ${aiRecipient} »`
            : aiRecipientUnknown ? ` au service d'IA ${mode === 'personal' ? 'de votre serveur Magistra' : "configuré par l'administrateur"}` : ''} au
          moment de générer.
          {' '}Les PDF scannés sont lus par reconnaissance de texte sur cet appareil.
        </p>
      </div>

      {sources.notice && (
        <p role="status" className="mt-3 text-xs text-warning flex items-start gap-2">
          <span className="flex-1">{sources.notice}</span>
          <button type="button" onClick={sources.clearNotice} aria-label="Masquer ce message" className={`text-mg-200 hover:text-white rounded ${FOCUS_RING}`}>
            <X size={14} aria-hidden="true" />
          </button>
        </p>
      )}

      {sources.docs.length > 0 && (
        <ul className="mt-4 space-y-2" aria-label="Documents ajoutés">
          {sources.docs.map(doc => (
            <li key={doc.key} className="flex items-start gap-3 p-3 rounded-lg bg-mg-700/60 border border-white/5">
              <FileText size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-mg-100 font-medium [overflow-wrap:anywhere]">{doc.name}</p>
                <p className="text-xs mt-0.5" aria-live="polite"><DocStatus doc={doc} /></p>
                {doc.warnings.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {doc.warnings.map(w => <li key={w} className="text-xs text-warning">{w}</li>)}
                  </ul>
                )}
                {sources.canKeep && doc.status === 'ready' && (
                  <div className="mt-2">
                    {doc.storedId ? (
                      <span className="text-xs text-mg-200 inline-flex items-center gap-1">
                        <HardDrive size={12} aria-hidden="true" /> Conservé sur cet ordinateur
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => sources.keep(doc.key)}
                        disabled={doc.saving}
                        className={`text-xs text-accent hover:underline inline-flex items-center gap-1 rounded disabled:opacity-60 ${FOCUS_RING}`}
                      >
                        <HardDrive size={12} aria-hidden="true" />
                        {doc.saving ? 'Enregistrement…' : 'Conserver sur cet ordinateur'}
                      </button>
                    )}
                    {doc.saveError && <p className="text-xs text-warning mt-1" role="alert">{doc.saveError}</p>}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => sources.remove(doc.key)}
                aria-label={`Retirer ${doc.name}`}
                title="Retirer"
                className={`shrink-0 p-1.5 rounded-lg text-mg-200 hover:text-white hover:bg-white/5 ${FOCUS_RING}`}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {sources.canKeep && (sources.stored.length > 0 || sources.storedError) && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold text-mg-200 uppercase tracking-widest mb-2">Conservés sur cet ordinateur</h3>
          {sources.storedError && <p className="text-xs text-warning mb-2" role="alert">{sources.storedError}</p>}
          <ul className="space-y-2">
            {sources.stored.map(s => {
              const used = inUse.has(s.id);
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-mg-900/40 border border-white/5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-mg-100 [overflow-wrap:anywhere]">{s.name}</p>
                    <p className="text-xs text-mg-300">
                      {s.description}
                      {s.savedAt && ` · conservé le ${new Date(s.savedAt).toLocaleDateString('fr-FR')}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => sources.addStored(s.id)}
                    disabled={used || full}
                    className={`btn-ghost text-xs py-1.5 px-3 disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS_RING}`}
                  >
                    {used ? 'Utilisé' : 'Utiliser'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setToDelete({ id: s.id, name: s.name })}
                    aria-label={`Supprimer ${s.name} de cet ordinateur`}
                    title="Supprimer de cet ordinateur"
                    className={`p-1.5 rounded-lg text-mg-200 hover:text-danger hover:bg-danger/10 ${FOCUS_RING}`}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {mode === 'local' && keepPreference === false && (
        <p className="mt-3 text-xs text-mg-300 leading-relaxed">
          Rien n'est conservé : les documents sont oubliés quand vous quittez cette page. Pour les réutiliser, activez la
          conservation des documents dans les Réglages.
        </p>
      )}
      {mode === 'demo' && sources.docs.length > 0 && (
        <p className="mt-3 text-xs text-mg-200 leading-relaxed">
          Mode démonstration : vos documents sont analysés dans ce navigateur, mais l'exemple affiché ne les utilise pas.
        </p>
      )}

      {children}

      <ConfirmDialog
        open={toDelete !== null}
        title="Supprimer ce document conservé ?"
        message={toDelete ? `« ${toDelete.name} » sera supprimé de cet ordinateur. Les contenus déjà générés ne sont pas modifiés.` : ''}
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        danger
        onConfirm={() => {
          const target = toDelete;
          setToDelete(null);
          if (target) void sources.deleteStored(target.id);
        }}
        onCancel={() => setToDelete(null)}
      />
    </section>
  );
}
