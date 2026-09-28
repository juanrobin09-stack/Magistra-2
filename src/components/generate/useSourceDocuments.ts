// Documents de l'enseignant pour une génération.
// Extraction 100 % locale (navigateur / application) : le fichier original n'est JAMAIS envoyé.
// Application Windows : si la préférence « keepDocuments » est active, le TEXTE extrait peut être
// conservé sur l'ordinateur pour être réutilisé ; sinon rien n'est stocké.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defaultMessage, toMagistraError } from '@shared/errors';
import type { LocalPreferences, StoredDocument } from '@shared/ipc';
import { describeDocument, DOCUMENT_LIMITS, extractFile, type ExtractedDocument } from '@/lib/documents';
import { fromIpcError, getBridge } from '@/lib/runtime/local';
import type { RuntimeMode } from '@/lib/runtime/types';

export type SourceDocStatus = 'analyzing' | 'ready' | 'error';

export interface SourceDoc {
  key: string;
  name: string;
  status: SourceDocStatus;
  /** « 128 pages », « 36 diapositives »… */
  description?: string;
  error?: string;
  warnings: string[];
  doc?: ExtractedDocument;
  /** Identifiant de la copie conservée sur cet ordinateur (application Windows). */
  storedId?: string;
  saving?: boolean;
  saveError?: string;
  /** Signature du fichier ajouté, pour éviter les doublons. */
  signature?: string;
}

export type StoredSummary = Omit<StoredDocument, 'units'>;

export interface UseSourceDocuments {
  docs: SourceDoc[];
  readyDocs: ExtractedDocument[];
  analyzing: boolean;
  maxDocuments: number;
  notice: string | null;
  clearNotice(): void;
  addFiles(files: FileList | File[]): void;
  remove(key: string): void;
  /** Application Windows uniquement. */
  canKeep: boolean;
  keep(key: string): void;
  stored: StoredSummary[];
  storedError: string | null;
  addStored(id: string): void;
  deleteStored(id: string): Promise<void>;
}

/**
 * Erreur de l'application Windows (« CODE|message ») : message précis quand il existe,
 * sinon un message propre à l'action sur les documents (et non « historique »).
 */
function ipcMessage(err: unknown, fallback: string): string {
  const e = fromIpcError(err);
  if (e.code === 'INTERNAL' || (e.code === 'STORAGE_ERROR' && e.message === defaultMessage('STORAGE_ERROR'))) return fallback;
  return e.message;
}

function signatureOf(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

export function toStoredDocument(doc: ExtractedDocument, description: string, savedAt = new Date()): StoredDocument {
  return {
    id: doc.id,
    name: doc.name,
    kind: doc.kind,
    description,
    savedAt: savedAt.toISOString(),
    units: doc.units.map(u => ({ locator: { ...u.locator }, text: u.text })),
    chars: doc.stats.chars,
  };
}

export function fromStoredDocument(stored: StoredDocument): ExtractedDocument {
  return {
    id: stored.id,
    name: stored.name,
    kind: stored.kind,
    units: stored.units.map(u => ({ locator: { ...u.locator }, text: u.text })),
    stats: { chars: stored.chars },
    warnings: [],
  };
}

/** Préférences de l'application Windows (null ailleurs ou tant qu'elles ne sont pas chargées). */
export function useLocalPreferences(mode: RuntimeMode): LocalPreferences | null {
  const [prefs, setPrefs] = useState<LocalPreferences | null>(null);
  useEffect(() => {
    if (mode !== 'local') return;
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    bridge.prefs.get().then(
      p => {
        if (!cancelled) setPrefs(p);
      },
      () => {
        // Préférences illisibles : comportement par défaut (rien n'est conservé).
      },
    );
    return () => {
      cancelled = true;
    };
  }, [mode]);
  return prefs;
}

export function useSourceDocuments(mode: RuntimeMode, prefs: LocalPreferences | null): UseSourceDocuments {
  const [docs, setDocs] = useState<SourceDoc[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [stored, setStored] = useState<StoredSummary[]>([]);
  const [storedError, setStoredError] = useState<string | null>(null);
  const [storedVersion, setStoredVersion] = useState(0);
  const nextKey = useRef(0);
  const docsRef = useRef<SourceDoc[]>([]);
  const maxDocuments = DOCUMENT_LIMITS.maxDocuments;
  const canKeep = mode === 'local' && Boolean(prefs?.keepDocuments) && getBridge() !== null;

  useEffect(() => {
    docsRef.current = docs;
  }, [docs]);

  const update = useCallback((key: string, patch: Partial<SourceDoc>) => {
    setDocs(list => list.map(d => (d.key === key ? { ...d, ...patch } : d)));
  }, []);

  // Documents conservés sur l'ordinateur (uniquement si l'enseignant l'a choisi dans les réglages).
  useEffect(() => {
    if (!canKeep) return;
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    bridge.documents.list().then(
      list => {
        if (cancelled) return;
        setStored(list);
        setStoredError(null);
      },
      err => {
        if (!cancelled) setStoredError(ipcMessage(err, 'Impossible de lire la liste des documents conservés sur cet ordinateur.'));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [canKeep, storedVersion]);

  const addFiles = useCallback((input: FileList | File[]) => {
    const files = Array.from(input);
    if (files.length === 0) return;
    const current = docsRef.current;
    const signatures = new Set(current.filter(d => d.status !== 'error').map(d => d.signature).filter(Boolean));
    const messages: string[] = [];
    const accepted: File[] = [];
    for (const file of files) {
      const sig = signatureOf(file);
      if (signatures.has(sig)) {
        messages.push(`« ${file.name} » est déjà ajouté.`);
        continue;
      }
      signatures.add(sig);
      accepted.push(file);
    }
    const room = Math.max(0, maxDocuments - current.length);
    const kept = accepted.slice(0, room);
    const ignored = accepted.length - kept.length;
    if (ignored > 0) {
      messages.push(`${maxDocuments} documents maximum : ${ignored} fichier${ignored > 1 ? 's ont été ignorés' : ' a été ignoré'}.`);
    }
    setNotice(messages.length ? messages.join(' ') : null);
    if (kept.length === 0) return;

    const added: SourceDoc[] = kept.map(file => ({
      key: `doc-${++nextKey.current}`,
      name: file.name,
      status: 'analyzing',
      warnings: [],
      signature: signatureOf(file),
    }));
    docsRef.current = [...current, ...added];
    setDocs(list => [...list, ...added]);

    added.forEach((entry, i) => {
      const file = kept[i];
      Promise.resolve()
        .then(() => extractFile(file))
        .then(
          doc => {
            let description: string;
            try {
              description = describeDocument(doc);
            } catch {
              description = '';
            }
            update(entry.key, { status: 'ready', doc, description, warnings: doc.warnings ?? [] });
          },
          err => {
            update(entry.key, { status: 'error', error: toMagistraError(err, 'DOCUMENT_UNREADABLE').message });
          },
        );
    });
  }, [maxDocuments, update]);

  const remove = useCallback((key: string) => {
    docsRef.current = docsRef.current.filter(d => d.key !== key);
    setDocs(list => list.filter(d => d.key !== key));
    setNotice(null);
  }, []);

  const keep = useCallback((key: string) => {
    const bridge = getBridge();
    const entry = docsRef.current.find(d => d.key === key);
    if (!bridge || !entry?.doc || entry.storedId || entry.saving) return;
    update(key, { saving: true, saveError: undefined });
    const record = toStoredDocument(entry.doc, entry.description ?? '');
    bridge.documents.save(record).then(
      () => {
        update(key, { saving: false, storedId: record.id });
        setStoredVersion(v => v + 1);
      },
      err => update(key, { saving: false, saveError: ipcMessage(err, 'Impossible de conserver ce document sur cet ordinateur.') }),
    );
  }, [update]);

  const addStored = useCallback((id: string) => {
    const bridge = getBridge();
    if (!bridge) return;
    const current = docsRef.current;
    if (current.some(d => d.storedId === id || d.doc?.id === id)) return;
    if (current.length >= maxDocuments) {
      setNotice(`${maxDocuments} documents maximum : retirez un document avant d'en ajouter un autre.`);
      return;
    }
    const summary = stored.find(s => s.id === id);
    const key = `doc-${++nextKey.current}`;
    const entry: SourceDoc = { key, name: summary?.name ?? 'Document', status: 'analyzing', warnings: [], storedId: id };
    docsRef.current = [...current, entry];
    setDocs(list => [...list, entry]);
    bridge.documents.load(id).then(
      record => {
        if (!record) {
          update(key, { status: 'error', error: 'Ce document conservé est introuvable.' });
          return;
        }
        update(key, { status: 'ready', doc: fromStoredDocument(record), description: record.description, name: record.name });
      },
      err => update(key, { status: 'error', error: ipcMessage(err, 'Impossible de rouvrir ce document conservé.') }),
    );
  }, [maxDocuments, stored, update]);

  const deleteStored = useCallback(async (id: string) => {
    const bridge = getBridge();
    if (!bridge) return;
    try {
      await bridge.documents.delete(id);
      setDocs(list => list.map(d => (d.storedId === id ? { ...d, storedId: undefined } : d)));
      setStored(list => list.filter(s => s.id !== id));
      setStoredError(null);
    } catch (err) {
      setStoredError(ipcMessage(err, 'Impossible de supprimer ce document conservé.'));
    }
  }, []);

  const readyDocs = useMemo(
    () => docs.filter(d => d.status === 'ready' && d.doc).map(d => d.doc as ExtractedDocument),
    [docs],
  );

  return {
    docs,
    readyDocs,
    analyzing: docs.some(d => d.status === 'analyzing'),
    maxDocuments,
    notice,
    clearNotice: () => setNotice(null),
    addFiles,
    remove,
    canKeep,
    keep,
    stored: canKeep ? stored : [],
    storedError: canKeep ? storedError : null,
    addStored,
    deleteStored,
  };
}
