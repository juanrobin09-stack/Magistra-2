// Processus principal de Magistra (application Windows, également fonctionnelle sous macOS et Linux).
//
// Architecture : React (fenêtre) ⇄ IPC sécurisé (preload) ⇄ processus principal ⇄ { données locales, Ollama }.
// Aucun serveur HTTP local : l'interface est servie par le protocole app:// directement depuis app.asar.
// La fenêtre a sa propre session (partition « magistra-ui ») où tout accès réseau est bloqué ; le processus
// principal, lui, accède au réseau par la session par défaut (net.fetch).

import {
  app, BrowserWindow, dialog, Menu, net, protocol, safeStorage, session, shell, type MenuItemConstructorOptions, type Session,
} from 'electron';
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, promises as fsp, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchPublicPage } from '../server/safeFetch.js';
import type { FetchLike } from '../shared/ai/provider.js';
import { IPC, type AIProgressEvent, type UpdateCheckResult } from '../shared/ipc.js';
import { AIConfigStore, safeStorageCipher } from './aiConfig.js';
import { GenerationManager } from './generation.js';
import { detectHardware, freeDiskBytes, ollamaModelsDir, systemHardwareDeps } from './hardware.js';
import { registerIpcHandlers } from './ipc.js';
import { LocalStore } from './localStore.js';
import { AIManager } from './ollamaSetup.js';
import { createAppProtocolHandler } from './protocol.js';
import { devOptionsFrom } from './devOptions.js';
import { APP_SCHEME, APP_URL, isSafeExternalUrl, isTrustedUrl, trustedOrigins } from './security.js';
import { SmokeTest } from './smoke.js';
import { checkForUpdate } from './updateCheck.js';
import { configureWindowSession, denyAllPermissions, WINDOW_PARTITION } from './windowSession.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_ID = 'com.futureai.magistra';
const BACKGROUND = '#0a0a0f';

// ─── Options de lancement ───────────────────────────────────────────────────

/** Options de développement et de test : toutes ignorées dans l'application installée (voir devOptions.ts). */
const devOptions = devOptionsFrom(app.isPackaged, process.argv, process.env);
const smokeOptions = devOptions.smoke;
let smoke: SmokeTest | null = null;
let smokeUserData: string | null = null;

/** Serveur Vite (développement uniquement ; jamais dans l'application installée). */
const devServerUrl = devOptions.devServerUrl;
const origins = trustedOrigins(devServerUrl);

// Dossier de données séparé pour le test de démarrage (et surcharge possible en développement).
if (devOptions.userDataDir) {
  app.setPath('userData', devOptions.userDataDir);
} else if (smokeOptions) {
  smokeUserData = mkdtempSync(path.join(os.tmpdir(), 'magistra-smoke-'));
  app.setPath('userData', smokeUserData);
} else if (process.platform === 'linux') {
  // Versions sans « productName » : dossier « magistra » en minuscules. Windows et macOS ignorent la casse des noms
  // de dossiers ; sous Linux, l'ancien dossier est conservé s'il existe, pour ne perdre aucune donnée.
  const legacy = path.join(app.getPath('appData'), 'magistra');
  if (existsSync(legacy) && !existsSync(app.getPath('userData'))) app.setPath('userData', legacy);
}

// ─── Erreurs fatales : jamais de processus fantôme sans fenêtre ────────────

let mainWindow: BrowserWindow | null = null;
let startupDone = false;
let quitting = false;

function shortMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.split('\n')[0].slice(0, 300);
}

function fatal(err: unknown, what = 'démarrer'): void {
  console.error('[magistra] Erreur fatale :', err);
  if (smoke) {
    smoke.fail(`Erreur fatale : ${shortMessage(err)}`);
    return;
  }
  if (quitting) return;
  quitting = true;
  try {
    dialog.showErrorBox(
      'Magistra',
      `Magistra n'a pas pu ${what} et doit se fermer.\n\nRelancez l'application. Si le problème persiste, réinstallez Magistra.\n\nDétail : ${shortMessage(err)}`,
    );
  } catch {
    /* boîte de dialogue impossible : on quitte quand même */
  }
  app.exit(1);
}

process.on('uncaughtException', err => fatal(err, 'continuer'));
process.on('unhandledRejection', reason => {
  if (!startupDone || !mainWindow || mainWindow.isDestroyed()) fatal(reason);
  else console.error('[magistra] Promesse rejetée non gérée :', reason);
});

// ─── Protocole app:// (avant « ready ») ────────────────────────────────────

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);
// Bac à sable pour tous les processus d'affichage. Exception : lancement explicite avec --no-sandbox
// (conteneurs Linux en root, CI) où Chromium refuse de combiner les deux ; la fenêtre garde sandbox: true.
if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox();

function distDirectory(): string {
  return devOptions.distDir ?? path.join(app.getAppPath(), 'dist');
}

function iconPath(): string | undefined {
  const candidate = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(app.getAppPath(), 'build', 'icon.png');
  return existsSync(candidate) ? candidate : undefined;
}

// ─── Réseau ─────────────────────────────────────────────────────────────────

const localFetch: FetchLike = (input, init) => fetch(input, init);
/** Accès Internet par la pile réseau de Chromium : respecte le proxy de l'établissement. */
const internetFetch: FetchLike = (input, init) => net.fetch(input, init);

// ─── Menu en français ───────────────────────────────────────────────────────

function buildMenu(): Menu {
  const isMac = process.platform === 'darwin';
  const view: MenuItemConstructorOptions[] = [
    { role: 'reload', label: 'Recharger' },
    { type: 'separator' },
    { role: 'resetZoom', label: 'Taille réelle' },
    { role: 'zoomIn', label: 'Zoom avant' },
    { role: 'zoomOut', label: 'Zoom arrière' },
    { type: 'separator' },
    { role: 'togglefullscreen', label: 'Plein écran' },
  ];
  if (!app.isPackaged) view.push({ type: 'separator' }, { role: 'toggleDevTools', label: 'Outils de développement' });
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    { label: 'Fichier', submenu: [isMac ? { role: 'close', label: 'Fermer la fenêtre' } : { role: 'quit', label: 'Quitter' }] },
    {
      label: 'Édition',
      submenu: [
        { role: 'undo', label: 'Annuler' },
        { role: 'redo', label: 'Rétablir' },
        { type: 'separator' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { role: 'pasteAndMatchStyle', label: 'Coller sans mise en forme' },
        { type: 'separator' },
        { role: 'selectAll', label: 'Tout sélectionner' },
      ],
    },
    { label: 'Affichage', submenu: view },
  ];
  return Menu.buildFromTemplate(template);
}

// ─── Sessions : permissions, téléchargements, requêtes ─────────────────────

/** Session de la fenêtre (partition dédiée, voir windowSession.ts) ; créée au démarrage. */
let windowSession: Session | null = null;

function openExternalSafely(url: string): void {
  if (isSafeExternalUrl(url) && !isTrustedUrl(url, origins)) {
    shell.openExternal(url).catch(err => console.warn('[magistra] Ouverture du lien impossible :', err));
  }
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });
});

// ─── Fenêtre ────────────────────────────────────────────────────────────────

let services: { onAppReady: () => void } | null = null;
let rendererCrashes = 0;
/**
 * Appelé quand la page affichée est remplacée (rechargement, redémarrage de l'affichage) : l'ancienne page
 * suivait peut-être une génération ; plus personne ne peut l'afficher ni l'arrêter, elle est donc interrompue
 * (sinon la suivante serait refusée — « génération déjà en cours » — pendant parfois plusieurs minutes).
 */
let onDocumentReplaced: (() => void) | null = null;

function createWindow(): BrowserWindow {
  // Jamais de fenêtre dans la session par défaut (celle du réseau du processus principal).
  if (!windowSession) throw new Error('session de la fenêtre non initialisée');
  const win = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Magistra',
    backgroundColor: BACKGROUND,
    icon: iconPath(),
    webPreferences: {
      // Session dédiée : réseau bloqué, protocole app://, permissions (jamais la session par défaut de net.fetch).
      session: windowSession,
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  mainWindow = win;
  const wc = win.webContents;

  // Navigation : seule l'origine de l'application ; les liens http(s) s'ouvrent dans le navigateur du système.
  wc.on('will-navigate', event => {
    if (isTrustedUrl(event.url, origins)) return;
    event.preventDefault();
    openExternalSafely(event.url);
  });
  wc.on('will-frame-navigate', event => {
    if (event.isMainFrame || isTrustedUrl(event.url, origins) || event.url === 'about:blank' || event.url === 'about:srcdoc') return;
    event.preventDefault();
  });
  wc.on('will-redirect', event => {
    if (!isTrustedUrl(event.url, origins)) event.preventDefault();
  });
  wc.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });

  let shown = false;
  const show = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    win.show();
    win.focus();
    startupDone = true;
  };
  win.once('ready-to-show', show);
  // Filet de sécurité : la fenêtre apparaît même si « ready-to-show » n'arrive pas (pilote graphique capricieux).
  setTimeout(show, 10_000).unref();

  // Nouveau document dans la fenêtre (navigation validée : Ctrl+R, rechargement automatique…).
  // Les navigations refusées (liens externes) et les changements de route de l'application n'en sont pas.
  wc.on('did-navigate', () => onDocumentReplaced?.());

  wc.on('render-process-gone', (_e, details) => {
    console.error('[magistra] Processus d’affichage arrêté :', details.reason);
    onDocumentReplaced?.();
    if (smoke || details.reason === 'clean-exit' || win.isDestroyed()) return;
    if (++rendererCrashes <= 3) wc.reload();
    else fatal(new Error(`affichage arrêté (${details.reason})`), 'afficher son interface');
  });
  wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (isMainFrame && code !== -3) console.error(`[magistra] Chargement impossible (${code} ${description}) : ${url}`);
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  smoke?.attach(win);
  const target = devServerUrl ?? APP_URL;
  win.loadURL(target).catch(err => {
    if ((err as { code?: string })?.code === 'ERR_ABORTED') return;
    fatal(err, 'afficher son interface');
  });
  return win;
}

// ─── Démarrage ──────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
  Menu.setApplicationMenu(buildMenu());

  let appProtocolHandler: ((request: Request) => Promise<Response>) | undefined;
  if (!devServerUrl) {
    const distDir = distDirectory();
    if (!existsSync(path.join(distDir, 'index.html'))) {
      throw new Error(`fichiers de l'interface introuvables (${distDir})`);
    }
    appProtocolHandler = createAppProtocolHandler(distDir);
  }
  // La session par défaut ne sert qu'au réseau du processus principal (net.fetch) : aucune page ne l'utilise.
  denyAllPermissions(session.defaultSession);
  windowSession = session.fromPartition(WINDOW_PARTITION);
  configureWindowSession(windowSession, { origins, devServerUrl, appProtocolHandler });

  const userData = app.getPath('userData');
  const store = new LocalStore(userData);
  await store.init();

  const config = new AIConfigStore(path.join(userData, 'ai-config.json'), safeStorageCipher(safeStorage), { ollamaUrl: devOptions.ollamaUrl });
  await config.load();

  const sendToWindow = (channel: string, payload: unknown): boolean => {
    const win = mainWindow;
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return false;
    win.webContents.send(channel, payload);
    return true;
  };

  const modelsDir = ollamaModelsDir();
  const ai = new AIManager({
    config,
    localFetch,
    netFetch: internetFetch,
    platform: process.platform,
    env: process.env,
    homedir: os.homedir(),
    tmpdir: os.tmpdir(),
    fileExists: async p => {
      try {
        await fsp.stat(p);
        return true;
      } catch {
        return false;
      }
    },
    spawnDetached: (file, args, env) => {
      const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true, env });
      child.on('error', err => console.warn('[magistra] Lancement impossible :', file, err.message));
      child.unref();
    },
    // L'installateur lance Ollama à la fin : il reçoit l'environnement préparé (proxy du système en HTTPS_PROXY).
    runInstaller: (file, args, signal, env) =>
      new Promise<number>((resolve, reject) => {
        const child = spawn(file, args, { windowsHide: true, stdio: 'ignore', ...(env ? { env } : {}) });
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error('délai d’installation dépassé'));
        }, 15 * 60_000);
        // Annulation : on cesse d'attendre, mais on n'interrompt pas un installateur en cours (état incohérent).
        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error('annulé'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        child.on('error', err => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          reject(err);
        });
        child.on('exit', code => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          resolve(code ?? 1);
        });
      }),
    openExternal: url => shell.openExternal(url),
    detectHardware: () => detectHardware({ ...systemHardwareDeps(() => app.getGPUInfo('complete')), modelsDir }),
    freeDiskBytes,
    modelsDir,
    emit: (event: AIProgressEvent) => {
      sendToWindow(IPC.aiProgress, event);
    },
    // Proxy du système (celui que suit net.fetch) : transmis à Ollama, qui ne lit que HTTPS_PROXY. Jamais journalisé.
    resolveProxy: url => session.defaultSession.resolveProxy(url),
    // Relance du moteur (Windows) : arrêt de « ollama app.exe » et ollama.exe, comme le fait l'installateur officiel.
    ...(process.platform === 'win32'
      ? {
        killProcesses: async (names: readonly string[]) => {
          for (const name of names) {
            await new Promise<void>(resolve => {
              // Code de sortie non nul si le processus n'existe pas : sans importance, l'arrêt est vérifié ensuite.
              execFile('taskkill', ['/f', '/t', '/im', name], { windowsHide: true, timeout: 10_000 }, () => resolve());
            });
          }
        },
      }
      : {}),
  });

  const generation = new GenerationManager({
    store,
    resolveProvider: (signal, onStatus) => ai.resolveProvider(signal, onStatus),
    describeActive: () => ai.describeActive(),
    send: payload => sendToWindow(IPC.genEvent, payload),
    fetch: internetFetch,
    fetchPage: fetchPublicPage,
  });

  services = {
    onAppReady: () => {
      if (smoke) void smoke.onAppReady();
    },
  };
  onDocumentReplaced = () => generation.cancelAll();

  // Une seule vérification de version à la fois (clics répétés : même réponse).
  let updateCheck: Promise<UpdateCheckResult> | null = null;

  registerIpcHandlers({
    getWindow: () => mainWindow,
    trustedOrigins: origins,
    store,
    ai,
    generation,
    appInfo: () => ({
      version: app.getVersion(),
      platform: process.platform,
      userDataPath: app.getPath('userData'),
      isPackaged: app.isPackaged,
    }),
    openExternal: url => shell.openExternal(url),
    checkForUpdate: () =>
      (updateCheck ??= checkForUpdate({ fetch: internetFetch, currentVersion: app.getVersion() }).finally(() => {
        updateCheck = null;
      })),
    onAppReady: () => services?.onAppReady(),
  });

  app.on('before-quit', () => {
    quitting = true;
    generation.cancelAll();
    ai.dispose();
  });

  createWindow();

  // Détection matérielle en arrière-plan : l'assistant de configuration s'affiche ensuite sans attente.
  ai.getHardware().catch(err => console.warn('[magistra] Détection matérielle impossible :', err));
  // Moteur IA installé mais arrêté : démarrage automatique, sans bloquer l'interface.
  if (!smoke) {
    ai.autoStart().catch(err => console.warn('[magistra] Démarrage automatique du moteur IA impossible :', err));
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Une autre fenêtre Magistra est déjà ouverte : elle sera mise au premier plan.
  app.quit();
} else {
  if (smokeOptions) {
    smoke = new SmokeTest(smokeOptions, code => {
      if (smokeUserData) {
        try {
          rmSync(smokeUserData, { recursive: true, force: true });
        } catch {
          /* nettoyage facultatif */
        }
      }
      app.exit(code);
    });
  }

  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    } else if (app.isReady() && services) {
      createWindow();
    }
  });

  app.on('activate', () => {
    if (services && BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.whenReady().then(start).catch(err => fatal(err));
}
