// Export des données du compte (droit d'accès et portabilité) : profil, historique complet, favoris.
// Tout se fait côté navigateur avec la couche d'accès habituelle (DataStore) : même comportement sur le site, en mode
// personnel, dans l'application Windows et en démonstration, sans nouvelle route serveur ni requête lourde unique.
// Le fichier ne contient que ce que l'enseignant voit dans l'application : jamais de jeton, de clé ni d'identifiant
// de session.

import { isMagistraError } from '@shared/errors';
import type { GenerationRecord, TeacherProfile } from '@shared/types';
import { downloadBlob } from '@/lib/export';
import type { DataStore } from '@/lib/runtime/types';

/** Taille des pages lues dans l'historique (même valeur que la liste de l'historique). */
const PAGE_SIZE = 30;
/** Fiches lues en parallèle : assez pour aller vite, peu pour ne pas surcharger le serveur. */
const CONCURRENCY = 3;
/** Garde-fou contre un curseur qui ne finirait jamais (30 × 2000 = 60 000 fiches). */
const MAX_PAGES = 2000;

export const EXPORT_ERROR_MESSAGE = "L'export n'a pas abouti. Vérifiez votre connexion puis réessayez.";

export interface AccountExport {
  application: 'Magistra';
  /** Version du format du fichier. */
  format: 1;
  exportedAt: string;
  profile: TeacherProfile | null;
  generations: GenerationRecord[];
  /** Fiches listées mais illisibles au moment de l'export (identifiant et titre), à retenter. */
  unreadable: Array<{ id: string; sujet: string }>;
}

export interface ExportProgress {
  done: number;
  total: number;
}

export class ExportCancelled extends Error {
  constructor() {
    super('Export annulé.');
    this.name = 'ExportCancelled';
  }
}

/** Recopie uniquement les champs connus d'une fiche : rien d'autre ne peut se glisser dans le fichier. */
function cleanRecord(record: GenerationRecord): GenerationRecord {
  return {
    id: record.id,
    createdAt: record.createdAt,
    type: record.type,
    niveau: record.niveau,
    matiere: record.matiere,
    ...(record.discipline !== undefined ? { discipline: record.discipline } : {}),
    sujet: record.sujet,
    contenu: record.contenu,
    isFavorite: record.isFavorite,
    sources: record.sources ?? [],
    params: record.params ?? {},
    ...(record.truncated !== undefined ? { truncated: record.truncated } : {}),
    ...(record.internetUsed !== undefined ? { internetUsed: record.internetUsed } : {}),
    ...(record.model !== undefined ? { model: record.model } : {}),
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ExportCancelled();
}

/**
 * Rassemble le profil et TOUTES les fiches (favorites comprises) : liste paginée, puis lecture de chaque fiche avec
 * peu de requêtes simultanées. Une fiche illisible est signalée dans `unreadable` sans faire échouer le reste ;
 * une erreur sur la liste ou le profil interrompt l'export (jamais d'export silencieusement incomplet).
 */
export async function collectAccountData(
  store: Pick<DataStore, 'getProfile' | 'listGenerations' | 'getGeneration'>,
  options: { signal?: AbortSignal; onProgress?: (progress: ExportProgress) => void; now?: () => Date } = {},
): Promise<AccountExport> {
  const { signal, onProgress } = options;
  throwIfAborted(signal);
  const profile = await store.getProfile();

  const summaries: Array<{ id: string; sujet: string }> = [];
  const seenIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    throwIfAborted(signal);
    const result = await store.listGenerations({ limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
    for (const item of result.items) {
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      summaries.push({ id: item.id, sujet: item.sujet });
    }
    onProgress?.({ done: 0, total: summaries.length });
    cursor = result.nextCursor;
    if (!cursor || seenCursors.has(cursor)) break;
    seenCursors.add(cursor);
  }

  const records: Array<GenerationRecord | undefined> = new Array(summaries.length);
  const unreadable: AccountExport['unreadable'] = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < summaries.length) {
      throwIfAborted(signal);
      const index = next++;
      try {
        records[index] = cleanRecord(await store.getGeneration(summaries[index].id));
      } catch (err) {
        // Une session expirée ou une panne réseau touche toutes les fiches : on s'arrête plutôt que d'en omettre des centaines.
        if (isMagistraError(err) && (err.code === 'UNAUTHENTICATED' || err.code === 'NETWORK_ERROR')) {
          next = summaries.length; // les autres lectures s'arrêtent aussi
          throw err;
        }
        unreadable.push(summaries[index]);
      }
      done++;
      onProgress?.({ done, total: summaries.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, summaries.length) }, worker));
  throwIfAborted(signal);

  return {
    application: 'Magistra',
    format: 1,
    exportedAt: (options.now?.() ?? new Date()).toISOString(),
    profile,
    generations: records.filter((r): r is GenerationRecord => r !== undefined),
    unreadable,
  };
}

/** Nom du fichier : magistra-mes-donnees-AAAA-MM-JJ.json */
export function accountExportFileName(date: Date = new Date()): string {
  return `magistra-mes-donnees-${date.toISOString().slice(0, 10)}.json`;
}

/** Collecte puis télécharge le fichier JSON. Renvoie l'export (pour afficher le nombre de fiches). */
export async function exportAccountData(
  store: Pick<DataStore, 'getProfile' | 'listGenerations' | 'getGeneration'>,
  options: { signal?: AbortSignal; onProgress?: (progress: ExportProgress) => void } = {},
): Promise<AccountExport> {
  const data = await collectAccountData(store, options);
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }), accountExportFileName());
  return data;
}
