// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { MagistraBridge, UpdateCheckResult } from '@shared/ipc';
import UpdateCheck from '@/components/UpdateCheck';
import { cleanup, click, render, flush } from './helpers';

afterEach(() => { cleanup(); localStorage.clear(); });
const available: UpdateCheckResult = { currentVersion: '2.0.6', latestVersion: '2.0.7', upToDate: false, url: 'https://github.com/juanrobin09-stack/Magistra-Downloads/releases/tag/v2.0.7',
  installer: { name: 'Magistra-Setup-2.0.7.exe', url: 'unused', checksumsUrl: 'unused', size: 1024 * 1024 } };
function fixture(result = available) {
  const app = { checkForUpdate: vi.fn(async () => result), installUpdate: vi.fn(async () => true), openExternal: vi.fn(), onUpdateProgress: vi.fn(() => () => {}) };
  return { app, bridge: { isElectron: true, app } as unknown as MagistraBridge };
}
it('signale une nouvelle version sans télécharger ; installation seulement après clic, sans URL fournie par la fenêtre', async () => {
  const { app, bridge } = fixture();
  const { container } = await render(<UpdateCheck bridge={bridge} notice />);
  await flush();
  expect(container.textContent).toContain('Magistra 2.0.7 est disponible');
  expect(app.installUpdate).not.toHaveBeenCalled();
  await click([...container.querySelectorAll('button')].find(b => b.textContent?.includes('Télécharger et installer'))!);
  expect(app.installUpdate).toHaveBeenCalledWith();
  expect(container.textContent).toContain('Installateur lancé');
});
it('préférence désactivée : aucun appel automatique ; la recherche manuelle fonctionne', async () => {
  localStorage.setItem('magistra_update_check_enabled', '0');
  const { app, bridge } = fixture();
  const { container } = await render(<><UpdateCheck bridge={bridge} notice /><UpdateCheck bridge={bridge} /></>);
  expect(app.checkForUpdate).not.toHaveBeenCalled();
  await click([...container.querySelectorAll('button')].find(b => b.textContent?.includes('Rechercher'))!);
  expect(app.checkForUpdate).toHaveBeenCalledOnce();
});
it('hors ligne : vérification automatique silencieuse, erreur manuelle claire', async () => {
  const { app, bridge } = fixture();
  app.checkForUpdate.mockRejectedValue(new Error('NETWORK_ERROR|Pas de connexion'));
  const { container } = await render(<><UpdateCheck bridge={bridge} notice /><UpdateCheck bridge={bridge} /></>);
  await flush();
  expect(container.textContent).not.toContain('Pas de connexion');
  await click(container.querySelector('button'));
  expect(container.textContent).toContain('Pas de connexion');
});
it('ancienne version du pont : lien de secours utilisable', async () => {
  const { bridge } = fixture();
  delete bridge.app.installUpdate;
  const { container } = await render(<UpdateCheck bridge={bridge} notice />);
  await flush();
  expect(container.textContent).toContain('Ouvrir la page de la nouvelle version');
});
