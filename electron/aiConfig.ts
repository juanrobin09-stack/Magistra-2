// Configuration de l'IA (ai-config.json) et protection de la clé API d'un serveur distant.
//
// - La clé n'est JAMAIS renvoyée à la fenêtre : seule l'information « hasApiKey » l'est.
// - Sur le disque, la clé est chiffrée par le système (safeStorage : DPAPI sous Windows, Trousseau sous macOS,
//   libsecret/kwallet sous Linux). Sans chiffrement sûr disponible, l'enregistrement de la clé est refusé.
// - Une clé est liée à l'origine du serveur : changer d'adresse de serveur sans ressaisir la clé l'efface
//   (elle ne peut jamais être envoyée à un autre serveur que celui pour lequel elle a été saisie).

import { promises as fsp } from 'node:fs';
import { CUSTOM_OLLAMA_MODEL_CONTEXT, DEFAULT_TIER, getTier, type TierId } from '../shared/ai/models.js';
import { DEFAULT_OLLAMA_URL } from '../shared/ai/ollama.js';
import { MagistraError } from '../shared/errors.js';
import type { AIConfigPublic, AIConfigUpdate } from '../shared/ipc.js';
import { corruptStamp, readJsonFile, writeJsonAtomic } from './jsonFile.js';
import { isLoopbackHost, originOf } from './security.js';
import { isHttpUrl, isTierId, isValidModelName } from './validate.js';

export interface SecretCipher {
  /** Vrai si un chiffrement réellement protégé par le système est disponible. */
  isAvailable(): boolean;
  encrypt(plain: string): string;
  decrypt(encrypted: string): string;
}

interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
  getSelectedStorageBackend?: () => string;
}

/** Chiffrement via safeStorage d'Electron. Sous Linux, le mode « basic_text » (clé fixe) est refusé. */
export function safeStorageCipher(safeStorage: SafeStorageLike, platform: NodeJS.Platform = process.platform): SecretCipher {
  return {
    isAvailable() {
      try {
        if (!safeStorage.isEncryptionAvailable()) return false;
        if (platform === 'linux' && safeStorage.getSelectedStorageBackend) {
          const backend = safeStorage.getSelectedStorageBackend();
          if (backend === 'basic_text' || backend === 'unknown') return false;
        }
        return true;
      } catch {
        return false;
      }
    },
    encrypt(plain) {
      return safeStorage.encryptString(plain).toString('base64');
    },
    decrypt(encrypted) {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    },
  };
}

export interface StoredRemote {
  kind: 'openai-compatible' | 'ollama';
  baseUrl: string;
  model: string;
  label?: string;
  /** Clé chiffrée (base64), jamais en clair. */
  apiKeyEnc?: string;
}

export interface StoredAIConfig {
  version: 1;
  mode: 'local' | 'remote';
  tier: TierId;
  /** Vrai quand l'enseignant a choisi le niveau lui-même (sinon : niveau recommandé pour la machine). */
  tierChosen: boolean;
  customModel?: string;
  ollamaUrl: string;
  remote?: StoredRemote;
}

function parseStored(raw: unknown, defaults: StoredAIConfig): StoredAIConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const cfg: StoredAIConfig = { ...defaults };
  if (r.mode === 'local' || r.mode === 'remote') cfg.mode = r.mode;
  if (isTierId(r.tier)) cfg.tier = r.tier;
  cfg.tierChosen = r.tierChosen === true;
  if (isValidModelName(r.customModel)) cfg.customModel = r.customModel;
  if (typeof r.ollamaUrl === 'string' && isHttpUrl(r.ollamaUrl)) cfg.ollamaUrl = r.ollamaUrl;
  const rem = r.remote as Record<string, unknown> | undefined;
  if (rem && typeof rem === 'object' && (rem.kind === 'openai-compatible' || rem.kind === 'ollama')
    && typeof rem.baseUrl === 'string' && isHttpUrl(rem.baseUrl) && isValidModelName(rem.model)) {
    cfg.remote = {
      kind: rem.kind,
      baseUrl: rem.baseUrl,
      model: rem.model,
      ...(typeof rem.label === 'string' && rem.label ? { label: rem.label.slice(0, 100) } : {}),
      ...(typeof rem.apiKeyEnc === 'string' && /^[A-Za-z0-9+/=]{4,8192}$/.test(rem.apiKeyEnc) ? { apiKeyEnc: rem.apiKeyEnc } : {}),
    };
  }
  if (cfg.mode === 'remote' && !cfg.remote) cfg.mode = 'local';
  return cfg;
}

export class AIConfigStore {
  readonly file: string;
  private readonly cipher: SecretCipher;
  private readonly defaults: StoredAIConfig;
  private config: StoredAIConfig;
  private existed = false;
  /** Vrai tant qu'un fichier existant n'a pas pu être lu : il ne doit pas être écrasé par les réglages par défaut. */
  private unreadable = false;
  private recovery: Promise<void> | null = null;

  constructor(file: string, cipher: SecretCipher, options: { ollamaUrl?: string } = {}) {
    this.file = file;
    this.cipher = cipher;
    this.defaults = {
      version: 1,
      mode: 'local',
      tier: DEFAULT_TIER,
      tierChosen: false,
      ollamaUrl: options.ollamaUrl && isHttpUrl(options.ollamaUrl) ? options.ollamaUrl : DEFAULT_OLLAMA_URL,
    };
    this.config = { ...this.defaults };
  }

  async load(): Promise<void> {
    let result: Awaited<ReturnType<typeof readJsonFile<StoredAIConfig>>>;
    try {
      result = await readJsonFile(this.file, raw => parseStored(raw, this.defaults));
    } catch (err) {
      // Fichier verrouillé ou refusé (antivirus, droits : EBUSY, EPERM…) : jamais d'échec au démarrage ; réglages par
      // défaut en mémoire. Le fichier n'est pas touché ici ; avant la première écriture, il est relu ou sauvegardé.
      console.warn(`[magistra] Configuration IA impossible à lire (${(err as NodeJS.ErrnoException).code ?? 'erreur'}) : réglages par défaut pour cette session.`);
      this.existed = true;
      this.unreadable = true;
      this.config = { ...this.defaults };
      return;
    }
    if (result.status === 'corrupt') console.warn(`[magistra] Configuration IA illisible mise de côté : ${result.movedTo ?? this.file}`);
    this.existed = result.status === 'ok';
    this.config = result.status === 'ok' ? result.value : { ...this.defaults };
  }

  /**
   * Avant d'écrire par-dessus un fichier que le démarrage n'a pas pu lire : on le relit (redevenu lisible, son contenu
   * est adopté au lieu des réglages par défaut) ; sinon on en garde une copie « .unreadable-<date> », au mieux.
   */
  private settleUnreadable(): Promise<void> {
    if (!this.unreadable) return Promise.resolve();
    this.recovery ??= this.recoverUnreadable().finally(() => {
      this.recovery = null;
    });
    return this.recovery;
  }

  private async recoverUnreadable(): Promise<void> {
    let result: Awaited<ReturnType<typeof readJsonFile<StoredAIConfig>>> | undefined;
    try {
      result = await readJsonFile(this.file, raw => parseStored(raw, this.defaults));
    } catch {
      result = undefined;
    }
    if (result?.status === 'ok') {
      this.config = result.value;
      this.existed = true;
    } else if (result?.status !== 'missing' && !(result?.status === 'corrupt' && result.movedTo)) {
      // Ni relu, ni mis de côté : sans copie de l'original, rien n'est écrit (le fichier reste, l'enseignant peut réessayer).
      const copy = `${this.file}.unreadable-${corruptStamp()}`;
      try {
        await fsp.copyFile(this.file, copy);
        console.warn(`[magistra] Configuration IA illisible conservée avant d'être remplacée : ${copy}`);
      } catch (err) {
        throw new MagistraError('STORAGE_ERROR', "Impossible d'enregistrer la configuration de l'IA.", { cause: err });
      }
    }
    this.unreadable = false;
  }

  /** Vrai tant qu'aucune configuration n'a été enregistrée (premier démarrage). */
  get isFirstRun(): boolean {
    return !this.existed;
  }

  get(): StoredAIConfig {
    return { ...this.config, ...(this.config.remote ? { remote: { ...this.config.remote } } : {}) };
  }

  /** Vue publique : aucune clé, seulement « hasApiKey ». */
  publicConfig(): AIConfigPublic {
    const c = this.config;
    const pub: AIConfigPublic = { mode: c.mode, tier: c.tier, ollamaUrl: c.ollamaUrl };
    if (c.customModel) pub.customModel = c.customModel;
    if (c.remote) {
      pub.remote = {
        kind: c.remote.kind,
        baseUrl: c.remote.baseUrl,
        model: c.remote.model,
        hasApiKey: !!c.remote.apiKeyEnc,
        ...(c.remote.label ? { label: c.remote.label } : {}),
      };
    }
    return pub;
  }

  /** Modèle réellement utilisé en mode local et son libellé. */
  activeLocalModel(): { model: string; label: string; contextTokens: number; tier: TierId; custom: boolean } {
    const tier = getTier(this.config.tier);
    if (this.config.customModel) {
      return { model: this.config.customModel, label: this.config.customModel, contextTokens: CUSTOM_OLLAMA_MODEL_CONTEXT, tier: tier.id, custom: true };
    }
    return { model: tier.model, label: tier.label, contextTokens: tier.contextTokens, tier: tier.id, custom: false };
  }

  /** Clé déchiffrée, uniquement dans le processus principal (création du fournisseur distant). */
  getApiKey(): string | undefined {
    const enc = this.config.remote?.apiKeyEnc;
    if (!enc) return undefined;
    try {
      return this.cipher.decrypt(enc);
    } catch {
      throw new MagistraError('AI_AUTH_FAILED', 'La clé API enregistrée ne peut plus être lue sur cet ordinateur : saisissez-la de nouveau dans les réglages.');
    }
  }

  private async persist(next: StoredAIConfig): Promise<void> {
    try {
      await writeJsonAtomic(this.file, next);
    } catch (err) {
      throw new MagistraError('STORAGE_ERROR', "Impossible d'enregistrer la configuration de l'IA.", { cause: err });
    }
    this.config = next;
    this.existed = true;
  }

  /**
   * Au premier démarrage uniquement, retient le niveau recommandé pour la machine.
   * Ensuite le niveau ne change plus tout seul (un modèle installé ne doit pas devenir « inactif » par surprise).
   */
  async applyRecommendedTier(tier: TierId): Promise<void> {
    if (this.existed || this.config.tierChosen) return;
    await this.persist({ ...this.config, tier });
  }

  /**
   * Niveau retenu automatiquement (jamais choisi par l'enseignant) mais non installé, alors qu'un autre niveau l'est :
   * Magistra passe au niveau installé. Ce choix reste automatique (tierChosen inchangé) : l'enseignant peut passer à
   * un autre niveau ensuite, et un niveau qu'il a lui-même choisi n'est jamais remplacé.
   */
  async adoptInstalledTier(tier: TierId): Promise<boolean> {
    await this.settleUnreadable();
    const c = this.config;
    if (c.tierChosen || c.customModel || c.mode !== 'local' || c.tier === tier) return false;
    await this.persist({ ...c, tier });
    return true;
  }

  async update(update: AIConfigUpdate): Promise<AIConfigPublic> {
    await this.settleUnreadable();
    const next = this.get();
    if (update.tier) {
      next.tier = update.tier;
      next.tierChosen = true;
    }
    if (update.customModel !== undefined) {
      if (update.customModel === null) delete next.customModel;
      else next.customModel = update.customModel;
    }
    if (update.ollamaUrl !== undefined) next.ollamaUrl = update.ollamaUrl;

    if (update.remote === null) {
      delete next.remote;
    } else if (update.remote) {
      const r = update.remote;
      const previous = this.config.remote;
      const sameServer = !!previous && originOf(previous.baseUrl) === originOf(r.baseUrl);
      let apiKeyEnc: string | undefined;
      if (r.apiKey === undefined) {
        apiKeyEnc = sameServer ? previous?.apiKeyEnc : undefined;
      } else if (r.apiKey === '') {
        apiKeyEnc = undefined;
      } else {
        const u = new URL(r.baseUrl);
        if (u.protocol !== 'https:' && !isLoopbackHost(u.hostname)) {
          throw new MagistraError('INVALID_REQUEST', 'Par sécurité, une clé API ne peut être utilisée qu’avec une adresse en https://.');
        }
        if (!this.cipher.isAvailable()) {
          throw new MagistraError('STORAGE_ERROR', 'Le chiffrement sécurisé du système n’est pas disponible sur cet ordinateur : la clé API ne peut pas être enregistrée. Utilisez un serveur sans clé ou l’IA locale.');
        }
        try {
          apiKeyEnc = this.cipher.encrypt(r.apiKey);
        } catch (err) {
          throw new MagistraError('STORAGE_ERROR', 'Impossible de chiffrer la clé API sur cet ordinateur.', { cause: err });
        }
      }
      next.remote = {
        kind: r.kind,
        baseUrl: r.baseUrl,
        model: r.model,
        ...(r.label ? { label: r.label } : {}),
        ...(apiKeyEnc ? { apiKeyEnc } : {}),
      };
    }

    if (update.mode) next.mode = update.mode;
    if (next.mode === 'remote' && !next.remote) {
      if (update.mode === 'remote') throw new MagistraError('INVALID_REQUEST', 'Configurez d’abord le serveur d’IA distant (adresse et modèle).');
      next.mode = 'local';
    }
    await this.persist(next);
    return this.publicConfig();
  }
}
