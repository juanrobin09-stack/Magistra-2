// Préchargement du processus principal, réservé aux tests depuis les sources.
// Ni ce fichier ni sa configuration ne font partie de l'application distribuée.
import { app, BrowserWindow, dialog, net, shell } from 'electron';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { UpdateProgress } from '../shared/ipc';

interface Config {
  profile: string;
  downloads: string;
  proof: string;
  routes: Record<string, string>;
}
export interface UpdateFlowProbe {
  confirmation: number;
  launchError: boolean;
  requests: string[];
  dialogs: { title?: string; buttons?: string[]; detail?: string }[];
  launches: { file: string; sha256: string; result?: string }[];
  progress: UpdateProgress[];
}

const config: Config = JSON.parse(readFileSync(process.env.MAGISTRA_UPDATE_FLOW_CONFIG!, 'utf8'));
const probe: UpdateFlowProbe = { confirmation: 1, launchError: false, requests: [], dialogs: [], launches: [], progress: [] };
(globalThis as unknown as { __updateFlow: UpdateFlowProbe }).__updateFlow = probe;
function save() { writeFileSync(config.proof, JSON.stringify(probe, null, 2)); }

// Aucune lecture du profil installé ; aucun enregistrement de protocole Windows.
app.setPath('userData', config.profile);
app.setPath('temp', config.downloads);
app.setAsDefaultProtocolClient = () => false;
// main.ts a d'abord capturé les options de développement qui isolent Ollama et le
// profil. Seul le contrôle « application installée » de l'updater est ensuite activé.
void app.whenReady().then(() => Object.defineProperty(app, 'isPackaged', { value: true }));

const nativeRequest = net.request.bind(net);
net.request = options => {
  const url = typeof options === 'string' ? options : options.url;
  const target = url && config.routes[url];
  if (!target) throw new Error(`Requête hors de la fixture de mise à jour : ${url}`);
  probe.requests.push(url!);
  save();
  // Le transport natif Chromium, les flux et les redirections restent réels.
  return nativeRequest({ ...(typeof options === 'string' ? {} : options), url: target });
};

dialog.showMessageBox = (async (...args: unknown[]) => {
  const options = args.at(-1) as { title?: string; buttons?: string[]; detail?: string };
  probe.dialogs.push({ title: options.title, buttons: options.buttons, detail: options.detail });
  save();
  return { response: probe.confirmation, checkboxChecked: false };
}) as typeof dialog.showMessageBox;

const nativeOpenPath = shell.openPath.bind(shell);
shell.openPath = async file => {
  const launch = { file, sha256: createHash('sha256').update(readFileSync(file)).digest('hex'), result: '' };
  probe.launches.push(launch);
  save();
  // La fixture distribue une copie de where.exe (sans arguments, inoffensif),
  // jamais un installateur NSIS : Windows lance réellement le fichier vérifié.
  launch.result = probe.launchError ? 'Échec Windows simulé' : await nativeOpenPath(file);
  // Les événements ont traversé le vrai preload et ont été reçus par la fenêtre.
  probe.progress = await BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('window.__updateEvents');
  save();
  return launch.result;
};
