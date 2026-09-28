// Lecture / écriture fiables de fichiers JSON locaux.
// - écriture atomique : fichier temporaire + fsync + rename (jamais de fichier à moitié écrit) ;
// - écritures sérialisées par fichier (deux enregistrements rapprochés ne s'entremêlent pas) ;
// - fichier illisible : renommé en « .corrupt-<date> » puis valeur par défaut, sans toucher aux autres fichiers.

import { randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

const queues = new Map<string, Promise<unknown>>();

/** Exécute `task` après les opérations déjà en attente sur la même clé (verrou simple en mémoire). */
export function withFileLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.then(() => undefined, () => undefined);
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** rename avec nouvelles tentatives : sous Windows, un antivirus peut verrouiller brièvement le fichier. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  const delays = [20, 50, 100, 200, 400, 800];
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= delays.length || !(code === 'EPERM' || code === 'EACCES' || code === 'EBUSY')) throw err;
      await sleep(delays[attempt]);
    }
  }
}

export function corruptStamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

/** Écrit un contenu de façon atomique (le fichier cible est soit l'ancien, soit le nouveau, jamais un mélange). */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    const handle = await fsp.open(tmp, 'w', 0o600);
    try {
      await handle.writeFile(data, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithRetry(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  // Sérialisation d'abord : une valeur invalide ne touche jamais au fichier existant.
  const data = `${JSON.stringify(value, null, 2)}\n`;
  await withFileLock(file, () => writeFileAtomic(file, data));
}

export type ReadJsonResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'missing' }
  | { status: 'corrupt'; movedTo?: string };

/**
 * Lit un fichier JSON. Un fichier illisible (JSON invalide ou refusé par `validate`) est mis de côté
 * sous le nom « <fichier>.corrupt-<date> » pour pouvoir être examiné, et n'est jamais écrasé en silence.
 */
export async function readJsonFile<T>(file: string, validate: (raw: unknown) => T | null): Promise<ReadJsonResult<T>> {
  let text: string;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
    throw err;
  }
  let value: T | null;
  try {
    value = validate(JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text));
  } catch {
    value = null;
  }
  if (value !== null) return { status: 'ok', value };
  const movedTo = `${file}.corrupt-${corruptStamp()}`;
  try {
    await renameWithRetry(file, movedTo);
    return { status: 'corrupt', movedTo };
  } catch {
    return { status: 'corrupt' };
  }
}

/** Supprime les fichiers temporaires laissés par une écriture interrompue (coupure de courant…). */
export async function cleanupTempFiles(dir: string): Promise<void> {
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return;
  }
  await Promise.all(names.filter(n => n.endsWith('.tmp')).map(n => fsp.rm(path.join(dir, n), { force: true }).catch(() => undefined)));
}
