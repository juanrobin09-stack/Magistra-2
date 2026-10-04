// Download only after an explicit click. Metadata and checksums come from the official
// release; no renderer-provided URL, path or command can reach the installer.
import { createHash } from 'node:crypto';
import { mkdtemp, open, rm } from 'node:fs/promises';
import path from 'node:path';
import type { FetchLike } from '../shared/ai/provider.js';
import { MagistraError } from '../shared/errors.js';
import type { UpdateProgress } from '../shared/ipc.js';
import { checkForUpdate, type UpdateCheckDeps } from './updateCheck.js';

const MAX_INSTALLER_BYTES = 512 * 1024 * 1024;
const MAX_SUMS_BYTES = 128 * 1024;
const DOWNLOAD_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const failure = (message: string) => new MagistraError('NETWORK_ERROR', message);

/** Validate every redirect before requesting it (HTTPS, known GitHub download hosts). */
export async function fetchUpdateAsset(fetch: FetchLike, initial: string, signal: AbortSignal): Promise<Response> {
  let url = new URL(initial);
  for (let hop = 0; hop <= 5; hop++) {
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !DOWNLOAD_HOSTS.has(url.hostname)) {
      throw failure('Adresse de téléchargement non autorisée.');
    }
    const res = await fetch(url.href, { redirect: 'manual', signal });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      const next = res.headers.get('location');
      if (!next || hop === 5) throw failure('Redirection de téléchargement invalide.');
      url = new URL(next, url);
      continue;
    }
    if (!res.ok || !res.body) throw failure('Téléchargement indisponible. Réessayez plus tard.');
    return res;
  }
  throw failure('Téléchargement indisponible.');
}

async function* readChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export interface InstallUpdateDeps extends UpdateCheckDeps {
  platform: string;
  isPackaged: boolean;
  tempDirectory: string;
  confirm(): Promise<boolean>;
  launch(file: string): Promise<void>;
  progress(event: UpdateProgress): void;
}

/** Returns false for cancellation or no available version. A launched installer is retained in OS temp. */
export async function installAppUpdate(deps: InstallUpdateDeps): Promise<boolean> {
  if (deps.platform !== 'win32' || !deps.isPackaged) {
    throw failure('L’installation intégrée est disponible dans l’application Windows installée.');
  }
  const release = await checkForUpdate(deps);
  if (release.upToDate) return false;
  if (!release.installer) throw failure('L’installateur vérifié de cette version n’est pas encore disponible. Réessayez plus tard.');
  if (!(await deps.confirm())) return false;
  const installer = release.installer;
  const signal = AbortSignal.timeout(15 * 60 * 1000);
  let directory: string | undefined;
  let launched = false;
  try {
    deps.progress({ phase: 'downloading', percent: 0 });
    const sumsResponse = await fetchUpdateAsset(deps.fetch, installer.checksumsUrl, signal);
    const chunks: Uint8Array[] = [];
    let sumsSize = 0;
    for await (const chunk of readChunks(sumsResponse.body!)) {
      sumsSize += chunk.length;
      if (sumsSize > MAX_SUMS_BYTES) throw failure('Fichier de vérification trop volumineux.');
      chunks.push(chunk);
    }
    const entries = Buffer.concat(chunks).toString('utf8').split(/\r?\n/)
      .map(line => /^([a-fA-F0-9]{64})[ \t]+\*?(.+)$/.exec(line))
      .filter(entry => entry?.[2] === installer.name);
    if (entries.length !== 1) throw failure('Empreinte officielle introuvable : installation annulée.');
    const expected = entries[0]![1].toLowerCase();
    if (installer.size <= 0 || installer.size > MAX_INSTALLER_BYTES) throw failure('Taille de l’installateur invalide.');
    directory = await mkdtemp(path.join(deps.tempDirectory, 'magistra-update-'));
    const filePath = path.join(directory, installer.name);
    const file = await open(filePath, 'wx', 0o600);
    let received = 0;
    let lastPercent = -1;
    const hash = createHash('sha256');
    try {
      const response = await fetchUpdateAsset(deps.fetch, installer.url, signal);
      const declared = Number(response.headers.get('content-length'));
      if (declared > MAX_INSTALLER_BYTES || (declared > 0 && declared !== installer.size)) {
        await response.body?.cancel();
        throw failure('Taille du téléchargement inattendue.');
      }
      for await (const chunk of readChunks(response.body!)) {
        received += chunk.length;
        if (received > installer.size || received > MAX_INSTALLER_BYTES) throw failure('Téléchargement trop volumineux.');
        hash.update(chunk);
        // A file write may be partial; finish the entire chunk before reading more network data.
        let offset = 0;
        while (offset < chunk.length) {
          const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset);
          if (!bytesWritten) throw failure('Écriture de la mise à jour impossible.');
          offset += bytesWritten;
        }
        const percent = Math.floor(received * 100 / installer.size);
        if (percent !== lastPercent) {
          lastPercent = percent;
          deps.progress({ phase: 'downloading', percent });
        }
      }
      deps.progress({ phase: 'verifying', percent: 100 });
      if (received !== installer.size || hash.digest('hex') !== expected) {
        throw failure('Fichier incomplet ou empreinte incorrecte : installation annulée. Réessayez.');
      }
      await file.sync();
    } finally {
      await file.close();
    }
    deps.progress({ phase: 'installing', percent: 100 });
    await deps.launch(filePath);
    launched = true;
    return true;
  } catch (error) {
    deps.progress({ phase: 'idle', percent: 0 });
    if (error instanceof MagistraError) throw error;
    throw failure('Mise à jour interrompue. Vérifiez votre connexion et l’espace disque, puis réessayez.');
  } finally {
    if (directory && !launched) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
