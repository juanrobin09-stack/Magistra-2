// Canaux IPC du pont window.magistra (contrat : shared/ipc.ts).
//
// Chaque gestionnaire :
// 1. vérifie l'expéditeur (cadre principal de la fenêtre Magistra, origine app://magistra ou serveur de dev) → sinon FORBIDDEN ;
// 2. valide ses arguments (types, tailles, identifiants sûrs) ;
// 3. convertit toute erreur en « CODE|message en français » (décodé par fromIpcError côté fenêtre),
//    sans jamais transmettre de trace technique ni de secret.

import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { MagistraError, toMagistraError } from '../shared/errors.js';
import { IPC, type AppInfo, type UpdateCheckResult, type LocalPreferences } from '../shared/ipc.js';
import type { ConnectorAppStatus } from '../shared/localConnector.js';
import type { GenerationManager } from './generation.js';
import type { LocalStore } from './localStore.js';
import type { AIManager } from './ollamaSetup.js';
import { isSafeExternalUrl, isTrustedSender, type TrustedWindowLike } from './security.js';
import { UPDATE_CHECK_UNAVAILABLE_MESSAGE } from './updateCheck.js';
import {
  requireBoolean, requireClientId, requireId, sanitizeAIConfigUpdate, sanitizeEngineInstallOptions, sanitizeEngineStartOptions, sanitizeListQuery,
  sanitizePreferencesUpdate, sanitizeProfile, sanitizePullTarget, sanitizeStoredDocument,
} from './validate.js';

export interface IpcContext {
  getWindow: () => TrustedWindowLike | null;
  trustedOrigins: readonly string[];
  store: LocalStore;
  ai: AIManager;
  generation: GenerationManager;
  appInfo: () => AppInfo;
  /** Ouvre un lien http(s) dans le navigateur du système (déjà validé). */
  openExternal: (url: string) => Promise<void>;
  /** Recherche d'une nouvelle version (au clic de l'enseignant uniquement) ; absente : « vérification impossible ». */
  checkForUpdate?: () => Promise<UpdateCheckResult>;
  installUpdate?: () => Promise<boolean>;
  onAppReady: () => void;
  onAppActivity?: () => void;
  onPreferencesUpdated?: (prefs: LocalPreferences, update: Partial<LocalPreferences>) => Promise<void>;
  onDisableUsage?: () => Promise<void>;
  onClearUsage?: () => Promise<void>;
  /** Connecteur local (site web Magistra → IA de cet ordinateur) : réglages « Site web Magistra ». */
  connector: {
    status(): ConnectorAppStatus | Promise<ConnectorAppStatus>;
    revoke(clientId: string): Promise<ConnectorAppStatus>;
    setEnabled(enabled: boolean): Promise<ConnectorAppStatus>;
  };
}

/** Erreur transmise à la fenêtre : « CODE|message lisible », rien d'autre. */
export function toIpcError(err: unknown): Error {
  const e = toMagistraError(err);
  if (e.code === 'INTERNAL') {
    const cause = (e as { cause?: unknown }).cause ?? err;
    console.error('[magistra] Erreur interne :', cause);
  }
  return new Error(`${e.code}|${e.message}`);
}

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

/** Description courte de l'expéditeur pour le journal (aucune donnée personnelle). */
function describeSender(event: IpcMainEvent | IpcMainInvokeEvent): string {
  const frame = event.senderFrame;
  if (!frame) return 'cadre détruit ou en cours de navigation';
  let origin: string;
  try {
    origin = frame.url ? new URL(frame.url).protocol + '//' + new URL(frame.url).host : '(vide)';
  } catch {
    origin = '(invalide)';
  }
  return `origine ${origin}, ${frame.parent ? 'sous-cadre' : 'cadre principal'}`;
}

export function registerIpcHandlers(ctx: IpcContext): () => void {
  const channels: string[] = [];
  const trusted = (event: IpcMainEvent | IpcMainInvokeEvent) => isTrustedSender(event, ctx.getWindow(), ctx.trustedOrigins);

  const handle = (channel: string, fn: Handler) => {
    channels.push(channel);
    ipcMain.handle(channel, async (event, ...args) => {
      if (!trusted(event)) {
        console.warn(`[magistra] Appel IPC refusé (${channel}) : expéditeur non autorisé (${describeSender(event)}).`);
        throw toIpcError(new MagistraError('FORBIDDEN'));
      }
      try {
        return await fn(event, ...args);
      } catch (err) {
        throw toIpcError(err);
      }
    });
  };

  // ─── Application ──────────────────────────────────────────────────────────
  handle(IPC.appInfo, () => ctx.appInfo());
  handle(IPC.openExternal, async (_e, url) => {
    if (!isSafeExternalUrl(url)) return false;
    await ctx.openExternal(url);
    return true;
  });
  handle(IPC.appCheckUpdate, () => {
    if (!ctx.checkForUpdate) throw new MagistraError('NETWORK_ERROR', UPDATE_CHECK_UNAVAILABLE_MESSAGE);
    return ctx.checkForUpdate();
  });
  handle(IPC.appInstallUpdate, (_e, ...args) => {
    if (args.length || !ctx.installUpdate) throw new MagistraError('INVALID_REQUEST');
    return ctx.installUpdate();
  });
  const onReady = (event: IpcMainEvent) => {
    if (trusted(event)) ctx.onAppReady();
  };
  ipcMain.on(IPC.appReady, onReady);
  let lastActivity = 0;
  const onActivity = (event: IpcMainEvent, ...args: unknown[]) => {
    if (args.length || !trusted(event) || Date.now() - lastActivity < 30_000) return;
    lastActivity = Date.now();
    ctx.onAppActivity?.();
  };
  ipcMain.on(IPC.appActivity, onActivity);

  // ─── IA locale ────────────────────────────────────────────────────────────
  handle(IPC.aiStatus, () => ctx.ai.status());
  handle(IPC.aiRefresh, () => ctx.ai.refresh());
  // Installation, ou mise à jour d'un moteur trop ancien avec { update: true } (même canal, argument validé).
  handle(IPC.aiInstallEngine, (_e, options) => ctx.ai.installEngine(sanitizeEngineInstallOptions(options)));
  handle(IPC.aiCancelEngineInstall, () => ctx.ai.cancelEngineInstall());
  handle(IPC.aiOpenEngineDownload, () => ctx.ai.openEngineDownload());
  // Démarrage (cause probable en cas d'échec), ou relance avec le proxy du système avec { restart: true }.
  handle(IPC.aiStartEngine, (_e, options) => {
    const { restart } = sanitizeEngineStartOptions(options);
    return restart ? ctx.ai.restartEngine() : ctx.ai.startEngineOrExplain();
  });
  handle(IPC.aiPullModel, (_e, target) => ctx.ai.pullModel(sanitizePullTarget(target)));
  handle(IPC.aiCancelPull, () => ctx.ai.cancelPull());
  handle(IPC.aiSetConfig, (_e, update) => ctx.ai.setConfig(sanitizeAIConfigUpdate(update)));

  // ─── Génération ───────────────────────────────────────────────────────────
  handle(IPC.genCapabilities, () => ctx.generation.capabilities());
  handle(IPC.genStart, (_e, request) => ctx.generation.start(request));
  handle(IPC.genCancel, (_e, jobId) => ctx.generation.cancel(requireId(jobId, 'génération')));

  // ─── Historique ───────────────────────────────────────────────────────────
  let usagePreferenceRevision = 0;
  handle(IPC.dataList, (_e, query) => ctx.store.list(sanitizeListQuery(query)));
  handle(IPC.dataGet, (_e, id) => ctx.store.get(requireId(id)));
  handle(IPC.dataSetFavorite, (_e, id, value) => ctx.store.setFavorite(requireId(id), requireBoolean(value, 'favori')));
  handle(IPC.dataDelete, (_e, id) => ctx.store.delete(requireId(id)));
  handle(IPC.dataStats, () => ctx.store.stats());
  handle(IPC.dataClearAll, async () => {
    ++usagePreferenceRevision;
    await ctx.onClearUsage?.();
    await ctx.store.clearAll();
  });

  // ─── Profil et préférences ────────────────────────────────────────────────
  handle(IPC.profileGet, () => ctx.store.getProfile());
  handle(IPC.profileSet, (_e, profile) => ctx.store.setProfile(sanitizeProfile(profile)));
  handle(IPC.prefsGet, () => ctx.store.getPreferences());
  handle(IPC.prefsSet, async (_e, update) => {
    const patch = sanitizePreferencesUpdate(update);
    const usageChange = patch.usageStatsEnabled !== undefined || patch.usageStatsChoiceMade !== undefined;
    const revision = usageChange ? ++usagePreferenceRevision : usagePreferenceRevision;
    // Le retrait s'applique à la session immédiatement, même si le disque refuse l'écriture.
    if (patch.usageStatsEnabled === false || patch.usageStatsChoiceMade === false) await ctx.onDisableUsage?.();
    const prefs = await ctx.store.setPreferences(patch);
    // Un ancien accord en cours ne doit pas réactiver une participation retirée entre-temps.
    if (!usageChange || revision === usagePreferenceRevision) await ctx.onPreferencesUpdated?.(prefs, patch);
    return prefs;
  });

  // ─── Documents (texte extrait) ────────────────────────────────────────────
  handle(IPC.docsList, () => ctx.store.listDocuments());
  handle(IPC.docsLoad, (_e, id) => ctx.store.loadDocument(requireId(id, 'document')));
  handle(IPC.docsSave, async (_e, doc) => {
    await ctx.store.saveDocument(sanitizeStoredDocument(doc));
  });
  handle(IPC.docsDelete, (_e, id) => ctx.store.deleteDocument(requireId(id, 'document')));

  // ─── Connecteur local (navigateurs autorisés, activation) ─────────────────
  // Aucun secret ni aucune adresse dans l'état renvoyé (ConnectorAppStatus) ; l'évènement IPC.connectorChanged
  // est émis par le processus principal.
  handle(IPC.connectorStatus, () => ctx.connector.status());
  handle(IPC.connectorRevoke, (_e, clientId) => ctx.connector.revoke(requireClientId(clientId)));
  handle(IPC.connectorSetEnabled, (_e, enabled) => ctx.connector.setEnabled(requireBoolean(enabled, 'accès du site Magistra')));

  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel);
    ipcMain.removeListener(IPC.appReady, onReady);
    ipcMain.removeListener(IPC.appActivity, onActivity);
  };
}
