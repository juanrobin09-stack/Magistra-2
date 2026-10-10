import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installAppUpdate, fetchUpdateAsset, type InstallUpdateDeps } from '../../electron/appUpdater';
import { checkForUpdate, RELEASES_API_URL } from '../../electron/updateCheck';

const name = 'Magistra-Setup-2.0.7.exe';
const base = 'https://github.com/juanrobin09-stack/Magistra-Downloads/releases/download/v2.0.7/';
const bytes = Buffer.from('simulated installer; never executed');
const hash = createHash('sha256').update(bytes).digest('hex');
const directories: string[] = [];
afterEach(async () => { for (const d of directories.splice(0)) await rm(d, { recursive: true, force: true }); });
async function fixture(options: { corrupt?: boolean; truncated?: boolean; sums?: string; target?: string } = {}) {
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'magistra-updater-test-'));
  directories.push(tempDirectory);
  const metadata = { tag_name: 'v2.0.7', html_url: 'https://github.com/juanrobin09-stack/Magistra-Downloads/releases/tag/v2.0.7', draft: false, prerelease: false,
    assets: [ { name, browser_download_url: options.target ?? base + name, size: bytes.length }, { name: 'SHA256SUMS.txt', browser_download_url: base + 'SHA256SUMS.txt' } ] };
  const fetch = vi.fn<InstallUpdateDeps['fetch']>(async input => {
    if (String(input) === RELEASES_API_URL) return Response.json(metadata);
    if (String(input).endsWith('SHA256SUMS.txt')) return new Response(options.sums ?? `${hash}  ${name}\n`);
    return new Response(options.truncated ? bytes.subarray(0, 4) : options.corrupt ? Buffer.alloc(bytes.length, 0) : bytes);
  });
  const deps: InstallUpdateDeps = { fetch, tempDirectory, currentVersion: '2.0.6', platform: 'win32', isPackaged: true,
    confirm: vi.fn(async () => true), launch: vi.fn(async file => { expect(await readFile(file)).toEqual(bytes); }), progress: vi.fn() };
  return { deps, fetch, metadata };
}

describe('installation de la mise à jour', () => {
  it('vérifie taille et SHA-256 puis lance uniquement le fichier local contrôlé', async () => {
    const { deps, fetch } = await fixture();
    await expect(installAppUpdate(deps)).resolves.toBe(true);
    expect(deps.confirm).toHaveBeenCalledOnce();
    expect(deps.launch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls.map(c => String(c[0]))).toEqual([RELEASES_API_URL, base + 'SHA256SUMS.txt', base + name]);
    expect(deps.progress).toHaveBeenCalledWith({ phase: 'verifying', percent: 100 });
  });
  it('annulation : aucun téléchargement ni exécution', async () => {
    const { deps, fetch } = await fixture();
    deps.confirm = vi.fn(async () => false);
    expect(await installAppUpdate(deps)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(deps.launch).not.toHaveBeenCalled();
  });
  it.each([{ corrupt: true }, { truncated: true }, { sums: 'invalid' }, { sums: `${hash}  ${name}\n${hash}  ${name}\n` }])('refuse un téléchargement invalide et nettoie les fichiers : %j', async options => {
    const { deps } = await fixture(options);
    await expect(installAppUpdate(deps)).rejects.toThrow();
    expect(deps.launch).not.toHaveBeenCalled();
    expect(await readdir(deps.tempDirectory)).toEqual([]);
  });
  it('aucune réinstallation si à jour ; pas d’exécution hors Windows ou en développement', async () => {
    const { deps } = await fixture();
    deps.currentVersion = '2.0.7';
    expect(await installAppUpdate(deps)).toBe(false);
    expect(deps.confirm).not.toHaveBeenCalled();
    await expect(installAppUpdate({ ...deps, platform: 'linux' })).rejects.toThrow();
    await expect(installAppUpdate({ ...deps, isPackaged: false })).rejects.toThrow();
    expect(deps.launch).not.toHaveBeenCalled();
  });
  it('refuse un installateur d’un autre dépôt, une taille excessive et les préversions', async () => {
    const { deps, metadata } = await fixture({ target: 'https://github.com/other/repo/releases/download/v2.0.7/' + name });
    expect((await checkForUpdate(deps)).installer).toBeUndefined();
    await expect(installAppUpdate(deps)).rejects.toThrow();
    metadata.assets[0].browser_download_url = base + name;
    metadata.assets[0].size = 1024 ** 3;
    expect((await checkForUpdate(deps)).installer).toBeUndefined();
    metadata.prerelease = true;
    await expect(checkForUpdate(deps)).rejects.toThrow();
    expect(deps.launch).not.toHaveBeenCalled();
  });
  it('redirections : CDN officiel accepté, HTTP, identifiants et hôtes arbitraires bloqués avant requête', async () => {
    for (const target of ['https://evil.example/file', 'http://github.com/file', 'https://u:p@github.com/file', 'https://github.com.evil.example/file', 'https://127.0.0.1/file']) {
      const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location: target } }));
      await expect(fetchUpdateAsset(fetch, base + name, AbortSignal.timeout(1000))).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(1);
    }
    const fetch = vi.fn(async (url: string | URL | Request) => String(url).startsWith('https://github.com/')
      ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/file?token=example' } })
      : new Response(bytes));
    expect((await fetchUpdateAsset(fetch, base + name, AbortSignal.timeout(1000))).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('échec de lancement : fichiers temporaires supprimés, erreur exploitable', async () => {
    const { deps } = await fixture();
    deps.launch = vi.fn(async () => { throw new Error('failed'); });
    await expect(installAppUpdate(deps)).rejects.toThrow('Windows n’a pas pu ouvrir l’installateur');
    expect(await readdir(deps.tempDirectory)).toEqual([]);
  });
  it('distingue un disque plein d’un téléchargement interrompu', async () => {
    const { deps } = await fixture();
    // Les métadonnées sont déjà nécessaires avant le téléchargement : conserver cet appel valide.
    const good = await fixture();
    deps.fetch = async (input, init) => String(input) === RELEASES_API_URL ? good.fetch(input, init) : Promise.reject(Object.assign(new Error('disk'), { code: 'ENOSPC' }));
    await expect(installAppUpdate(deps)).rejects.toThrow('Le disque est plein');
    const network = await fixture();
    network.deps.fetch = async (input, init) => String(input) === RELEASES_API_URL ? network.fetch(input, init) : Promise.reject(new Error('connection closed'));
    await expect(installAppUpdate(network.deps)).rejects.toThrow('Le téléchargement de la mise à jour a été interrompu');
  });
});
