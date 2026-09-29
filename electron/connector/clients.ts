// Navigateurs autorisés à utiliser le connecteur local, et réglage « Permettre au site Magistra d'utiliser l'IA de
// cet ordinateur » : fichier <userData>/local-connector.json. Module PUR Node (aucun import d'Electron).
//
// - Chaque autorisation = { clientId, origine du site, navigateur, dates, clé HMAC de 32 octets }. La clé n'est JAMAIS
//   écrite en clair : sur le disque, seule sa forme chiffrée par le système (SecretCipher : safeStorage, DPAPI sous
//   Windows) est enregistrée. Chiffrement indisponible (Linux sans trousseau…) : l'autorisation reste en MÉMOIRE
//   seulement (persistent: false) et disparaît à la fermeture de l'application.
// - Une clé illisible au démarrage (profil Windows changé, fichier copié d'un autre ordinateur) est abandonnée : le
//   navigateur concerné recevra CONNECTOR_UNPAIRED (sans marque de retrait : il garde son appairage et propose de
//   reconnecter Magistra locale).
// - Entrées chiffrées lues alors que le chiffrement est momentanément indisponible : conservées telles quelles sur le
//   disque (toujours chiffrées), sans être utilisables pendant cette session.
// - Au plus CONNECTOR_LIMITS.maxClients navigateurs : au-delà, le plus anciennement appairé est retiré (évincé).
// - Retrait ou éviction : la MARQUE DE RETRAIT du navigateur, HMAC(clé, canonicalRevoked(clientId)), est calculée
//   avant l'effacement de la clé et conservée (MAX_REVOKED_MARKS au plus, dans le même fichier : elle ne permet de
//   rien signer). Le serveur la joint à ses 401 pour ce navigateur : le site sait alors que CETTE application l'a
//   retiré, et non une autre application Magistra (autre session Windows) qui ne le connaît pas.
// - Écritures atomiques et sérialisées (electron/jsonFile.ts) ; fichier illisible mis de côté (« .corrupt-<date> »).

import { MagistraError } from '../../shared/errors.js';
import {
  CONNECTOR_FORMATS, CONNECTOR_LIMITS, isWellFormedOrigin, originLabel, type ConnectorClientInfo,
} from '../../shared/localConnector.js';
import type { SecretCipher } from '../aiConfig.js';
import { readJsonFile, writeJsonAtomic } from '../jsonFile.js';
import { hasControlChars } from '../security.js';
import { fromBase64Url, randomToken, revokedMark, toBase64Url } from './crypto.js';

/** Longueur de la clé HMAC d'un navigateur (octets). */
const KEY_BYTES = 32;
/** Date de dernière utilisation : réécrite sur le disque au plus toutes les heures (pas une écriture par requête). */
const LAST_USED_PERSIST_MS = 60 * 60_000;
const ENC_RE = /^[A-Za-z0-9+/=]{4,8192}$/;
const MAX_BROWSER_LABEL = 60;
/** Marques de retrait conservées au plus (les plus anciennes sont oubliées d'abord). */
export const MAX_REVOKED_MARKS = 50;

interface StoredClient {
  clientId: string;
  origin: string;
  browser: string;
  pairedAt: string;
  lastUsedAt?: string;
  /** Clé HMAC chiffrée par le système (jamais la clé en clair). */
  keyEnc: string;
}

/** Navigateur retiré : sa marque de retrait (aucun secret : elle ne permet de rien signer). */
interface RevokedMark {
  clientId: string;
  origin: string;
  mark: string;
  revokedAt: string;
}

interface StoredConnectorFile {
  version: 1;
  enabled: boolean;
  clients: StoredClient[];
  /** Absent dans les fichiers des versions précédentes. */
  revoked?: RevokedMark[];
}

interface ClientEntry {
  clientId: string;
  origin: string;
  browser: string;
  pairedAt: string;
  lastUsedAt?: string;
  key: Buffer;
  /** Forme chiffrée enregistrée ; absente : autorisation en mémoire seulement (chiffrement indisponible). */
  keyEnc?: string;
  /** Date de dernière utilisation telle qu'enregistrée sur le disque. */
  persistedLastUsedAt?: string;
}

/** Navigateur autorisé, tel qu'utilisé par le serveur pour vérifier une requête signée. */
export interface ConnectorClientKey {
  readonly clientId: string;
  readonly origin: string;
  /** Clé HMAC-SHA-256 (32 octets). Ne jamais journaliser ni renvoyer. */
  readonly key: Buffer;
}

export interface ConnectorClientStoreOptions {
  maxClients?: number;
  now?: () => Date;
  /** Journal (aucun secret n'y est jamais écrit). */
  warn?: (message: string) => void;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

function parseStoredClient(raw: unknown): StoredClient | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.clientId !== 'string' || !CONNECTOR_FORMATS.clientId.test(c.clientId)) return null;
  if (typeof c.origin !== 'string' || !isWellFormedOrigin(c.origin)) return null;
  if (typeof c.keyEnc !== 'string' || !ENC_RE.test(c.keyEnc)) return null;
  if (!isIsoDate(c.pairedAt)) return null;
  const browser = typeof c.browser === 'string' && c.browser.length <= MAX_BROWSER_LABEL && !hasControlChars(c.browser) && c.browser.trim()
    ? c.browser.trim()
    : 'Navigateur';
  return {
    clientId: c.clientId,
    origin: c.origin,
    browser,
    pairedAt: new Date(c.pairedAt).toISOString(),
    ...(isIsoDate(c.lastUsedAt) ? { lastUsedAt: new Date(c.lastUsedAt).toISOString() } : {}),
    keyEnc: c.keyEnc,
  };
}

function parseRevokedMark(raw: unknown): RevokedMark | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.clientId !== 'string' || !CONNECTOR_FORMATS.clientId.test(r.clientId)) return null;
  if (typeof r.origin !== 'string' || !isWellFormedOrigin(r.origin)) return null;
  if (typeof r.mark !== 'string' || !CONNECTOR_FORMATS.mac.test(r.mark)) return null;
  if (!isIsoDate(r.revokedAt)) return null;
  return { clientId: r.clientId, origin: r.origin, mark: r.mark, revokedAt: new Date(r.revokedAt).toISOString() };
}

/** Relecture du fichier : forme générale stricte (sinon fichier mis de côté), entrées invalides ignorées une à une. */
function parseStoredFile(raw: unknown, maxClients: number): StoredConnectorFile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const f = raw as Record<string, unknown>;
  if (f.version !== 1 || !Array.isArray(f.clients)) return null;
  const seen = new Set<string>();
  const clients: StoredClient[] = [];
  for (const entry of f.clients.slice(0, 1_000)) {
    const client = parseStoredClient(entry);
    if (!client || seen.has(client.clientId)) continue;
    seen.add(client.clientId);
    clients.push(client);
  }
  // Les plus récents d'abord, dans la limite autorisée.
  clients.sort((a, b) => Date.parse(b.pairedAt) - Date.parse(a.pairedAt));
  const revoked: RevokedMark[] = [];
  const revokedIds = new Set<string>();
  for (const entry of Array.isArray(f.revoked) ? f.revoked.slice(0, 1_000) : []) {
    const mark = parseRevokedMark(entry);
    if (!mark || revokedIds.has(mark.clientId) || seen.has(mark.clientId)) continue;
    revokedIds.add(mark.clientId);
    revoked.push(mark);
  }
  revoked.sort((a, b) => Date.parse(b.revokedAt) - Date.parse(a.revokedAt));
  return { version: 1, enabled: f.enabled !== false, clients: clients.slice(0, maxClients), revoked: revoked.slice(0, MAX_REVOKED_MARKS) };
}

export class ConnectorClientStore {
  readonly file: string;
  private readonly cipher: SecretCipher;
  private readonly maxClients: number;
  private readonly now: () => Date;
  private readonly warn: (message: string) => void;
  private readonly entries = new Map<string, ClientEntry>();
  /** Entrées chiffrées illisibles pendant cette session (chiffrement indisponible) : réécrites telles quelles. */
  private dormant: StoredClient[] = [];
  /** Marques de retrait, par navigateur retiré (ordre d'insertion = du plus ancien au plus récent). */
  private readonly revoked = new Map<string, RevokedMark>();
  private enabledValue = true;
  private readonly listeners = new Set<() => void>();

  constructor(file: string, cipher: SecretCipher, options: ConnectorClientStoreOptions = {}) {
    this.file = file;
    this.cipher = cipher;
    this.maxClients = Math.max(1, options.maxClients ?? CONNECTOR_LIMITS.maxClients);
    this.now = options.now ?? (() => new Date());
    this.warn = options.warn ?? (message => console.warn(`[magistra] ${message}`));
  }

  /** Relit le fichier. Ne lève jamais : fichier absent, illisible ou refusé → réglages par défaut, aucun navigateur. */
  async load(): Promise<void> {
    this.entries.clear();
    this.dormant = [];
    this.revoked.clear();
    this.enabledValue = true;
    let result: Awaited<ReturnType<typeof readJsonFile<StoredConnectorFile>>>;
    try {
      result = await readJsonFile(this.file, raw => parseStoredFile(raw, this.maxClients));
    } catch (err) {
      this.warn(`Réglages du connecteur local impossibles à lire (${(err as NodeJS.ErrnoException).code ?? 'erreur'}) : aucun navigateur autorisé pour cette session.`);
      return;
    }
    if (result.status === 'corrupt') this.warn(`Réglages du connecteur local illisibles, mis de côté : ${result.movedTo ?? this.file}`);
    if (result.status !== 'ok') return;
    this.enabledValue = result.value.enabled;
    for (const mark of [...(result.value.revoked ?? [])].reverse()) this.revoked.set(mark.clientId, mark);
    const available = this.persistent;
    let dropped = 0;
    for (const stored of result.value.clients) {
      if (!available) {
        this.dormant.push(stored);
        continue;
      }
      let key: Buffer | null;
      try {
        key = fromBase64Url(this.cipher.decrypt(stored.keyEnc), KEY_BYTES);
      } catch {
        key = null;
      }
      if (!key) {
        dropped++;
        continue;
      }
      this.entries.set(stored.clientId, {
        clientId: stored.clientId,
        origin: stored.origin,
        browser: stored.browser,
        pairedAt: stored.pairedAt,
        ...(stored.lastUsedAt ? { lastUsedAt: stored.lastUsedAt, persistedLastUsedAt: stored.lastUsedAt } : {}),
        key,
        keyEnc: stored.keyEnc,
      });
    }
    if (dropped) this.warn(`${dropped} autorisation(s) du site Magistra illisible(s) sur cet ordinateur : abandonnée(s).`);
    if (this.dormant.length) {
      this.warn('Chiffrement du système indisponible : les navigateurs autorisés précédemment ne pourront pas utiliser Magistra pendant cette session.');
    }
  }

  /** Vrai si les autorisations peuvent être enregistrées (chiffrées) sur le disque ; faux : mémoire seulement. */
  get persistent(): boolean {
    try {
      return this.cipher.isAvailable();
    } catch {
      return false;
    }
  }

  get enabled(): boolean {
    return this.enabledValue;
  }

  /** Navigateurs autorisés (le plus récent d'abord), sans aucun secret. */
  list(): ConnectorClientInfo[] {
    return [...this.entries.values()]
      .sort((a, b) => Date.parse(b.pairedAt) - Date.parse(a.pairedAt))
      .map(e => ({
        clientId: e.clientId,
        site: originLabel(e.origin),
        browser: e.browser,
        pairedAt: e.pairedAt,
        ...(e.lastUsedAt ? { lastUsedAt: e.lastUsedAt } : {}),
      }));
  }

  get size(): number {
    return this.entries.size;
  }

  /** Autorisation d'un navigateur (vérification d'une requête signée). */
  find(clientId: string): ConnectorClientKey | undefined {
    const e = this.entries.get(clientId);
    return e ? { clientId: e.clientId, origin: e.origin, key: e.key } : undefined;
  }

  /**
   * Marque de retrait d'un navigateur retiré (ou évincé) par cette application, pour le site qui l'avait appairé ;
   * undefined si ce navigateur n'a jamais été retiré ici (inconnu, ou autorisé pour un autre site).
   */
  revokedMark(clientId: string, origin: string): string | undefined {
    const r = this.revoked.get(clientId);
    return r && r.origin === origin ? r.mark : undefined;
  }

  /** Marque de retrait calculée avec la clé de l'entrée, AVANT son effacement. */
  private rememberRevoked(entry: ClientEntry): void {
    this.revoked.delete(entry.clientId);
    this.revoked.set(entry.clientId, {
      clientId: entry.clientId,
      origin: entry.origin,
      mark: revokedMark(entry.key, entry.clientId),
      revokedAt: this.now().toISOString(),
    });
    while (this.revoked.size > MAX_REVOKED_MARKS) {
      const oldest = this.revoked.keys().next().value;
      if (oldest === undefined) break;
      this.revoked.delete(oldest);
    }
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private changed(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (err) {
        this.warn(`Notification du connecteur local impossible : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private snapshot(): StoredConnectorFile {
    const clients: StoredClient[] = [];
    for (const e of this.entries.values()) {
      if (!e.keyEnc) continue; // autorisation en mémoire seulement : jamais sur le disque
      clients.push({
        clientId: e.clientId,
        origin: e.origin,
        browser: e.browser,
        pairedAt: e.pairedAt,
        ...(e.lastUsedAt ? { lastUsedAt: e.lastUsedAt } : {}),
        keyEnc: e.keyEnc,
      });
    }
    // Les plus récentes d'abord (relues dans cet ordre, puis bornées à MAX_REVOKED_MARKS).
    const revoked = [...this.revoked.values()].reverse();
    return { version: 1, enabled: this.enabledValue, clients: [...clients, ...this.dormant], ...(revoked.length ? { revoked } : {}) };
  }

  private async persist(): Promise<void> {
    const snapshot = this.snapshot();
    await writeJsonAtomic(this.file, snapshot);
    for (const e of this.entries.values()) {
      if (e.keyEnc && e.lastUsedAt) e.persistedLastUsedAt = e.lastUsedAt;
    }
  }

  /** Chiffre la clé pour le disque ; null si le chiffrement du système est indisponible ou échoue (mémoire seule). */
  private encryptKey(key: Buffer): string | null {
    if (!this.persistent) return null;
    try {
      const enc = this.cipher.encrypt(toBase64Url(key));
      return ENC_RE.test(enc) ? enc : null;
    } catch {
      this.warn('Chiffrement de l’autorisation impossible : elle restera valable jusqu’à la fermeture de Magistra.');
      return null;
    }
  }

  /**
   * Enregistre un navigateur nouvellement appairé. Au-delà de maxClients, le plus anciennement appairé est retiré
   * (évincé : marque de retrait conservée, comme pour un retrait) ; `evicted` (présent s'il y en a) liste ces
   * navigateurs, dont les générations en cours doivent être arrêtées. Échec d'écriture : rien n'est ajouté ni retiré
   * (STORAGE_ERROR).
   */
  async add(input: { origin: string; browser: string; key: Uint8Array }): Promise<ConnectorClientInfo & { evicted?: string[] }> {
    if (!isWellFormedOrigin(input.origin)) throw new MagistraError('INVALID_REQUEST');
    if (input.key.byteLength !== KEY_BYTES) throw new MagistraError('INTERNAL');
    let clientId = randomToken(16);
    while (this.entries.has(clientId)) clientId = randomToken(16);
    const key = Buffer.from(input.key);
    const keyEnc = this.encryptKey(key);
    const pairedAt = this.now().toISOString();
    const browser = input.browser && input.browser.length <= MAX_BROWSER_LABEL && !hasControlChars(input.browser) ? input.browser : 'Navigateur';
    const entry: ClientEntry = { clientId, origin: input.origin, browser, pairedAt, lastUsedAt: pairedAt, key, ...(keyEnc ? { keyEnc } : {}) };

    const evicted: ClientEntry[] = [];
    this.entries.set(clientId, entry);
    while (this.entries.size > this.maxClients) {
      const oldest = [...this.entries.values()]
        .filter(e => e.clientId !== clientId)
        .sort((a, b) => Date.parse(a.pairedAt) - Date.parse(b.pairedAt))[0];
      if (!oldest) break;
      this.entries.delete(oldest.clientId);
      evicted.push(oldest);
    }
    // Marques calculées AVANT l'écriture (enregistrées avec elle) et avant l'effacement des clés.
    for (const e of evicted) this.rememberRevoked(e);
    if (keyEnc || evicted.some(e => e.keyEnc)) {
      try {
        await this.persist();
      } catch (err) {
        this.entries.delete(clientId);
        for (const e of evicted) {
          this.revoked.delete(e.clientId);
          this.entries.set(e.clientId, e);
        }
        key.fill(0);
        throw new MagistraError('STORAGE_ERROR', "Impossible d'enregistrer l'autorisation de ce navigateur sur cet ordinateur.", { cause: err });
      }
    }
    for (const e of evicted) e.key.fill(0);
    this.changed();
    return {
      clientId,
      site: originLabel(entry.origin),
      browser: entry.browser,
      pairedAt,
      lastUsedAt: pairedAt,
      ...(evicted.length ? { evicted: evicted.map(e => e.clientId) } : {}),
    };
  }

  /**
   * Retire l'autorisation d'un navigateur : effective IMMÉDIATEMENT en mémoire (ses requêtes suivantes sont
   * refusées ; partie synchrone de cet appel), puis enregistrée. Renvoie faux si ce navigateur n'était pas autorisé.
   */
  async revoke(clientId: string): Promise<boolean> {
    const entry = this.entries.get(clientId);
    if (!entry) return false;
    this.entries.delete(clientId);
    this.rememberRevoked(entry);
    entry.key.fill(0);
    this.changed();
    if (entry.keyEnc) {
      try {
        await this.persist();
      } catch (err) {
        throw new MagistraError(
          'STORAGE_ERROR',
          "L'autorisation est retirée pour cette session, mais ce retrait n'a pas pu être enregistré : recommencez après le redémarrage de Magistra.",
          { cause: err },
        );
      }
    }
    return true;
  }

  /**
   * Active ou désactive le connecteur (réglage enregistré). La désactivation prend effet même si l'écriture échoue
   * (STORAGE_ERROR levée ensuite) ; l'activation, elle, n'a lieu que si elle a pu être enregistrée.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    if (this.enabledValue === enabled) return;
    const previous = this.enabledValue;
    this.enabledValue = enabled;
    try {
      await this.persist();
    } catch (err) {
      if (enabled) this.enabledValue = previous;
      else this.changed();
      throw new MagistraError('STORAGE_ERROR', "Impossible d'enregistrer ce réglage sur cet ordinateur.", { cause: err });
    }
    this.changed();
  }

  /** Requête authentifiée de ce navigateur : date de dernière utilisation (réécrite sur le disque au plus toutes les heures). */
  touch(clientId: string): void {
    const entry = this.entries.get(clientId);
    if (!entry) return;
    const now = this.now();
    entry.lastUsedAt = now.toISOString();
    if (!entry.keyEnc) return;
    const persisted = entry.persistedLastUsedAt ? Date.parse(entry.persistedLastUsedAt) : 0;
    if (now.getTime() - persisted < LAST_USED_PERSIST_MS) return;
    entry.persistedLastUsedAt = entry.lastUsedAt;
    this.persist().catch(err => this.warn(`Date d'utilisation du connecteur non enregistrée : ${err instanceof Error ? err.message : String(err)}`));
  }

  /** Enregistre les dates de dernière utilisation en attente (fermeture de l'application). */
  async flush(): Promise<void> {
    const pending = [...this.entries.values()].some(e => e.keyEnc && e.lastUsedAt !== e.persistedLastUsedAt);
    if (pending) await this.persist();
  }
}
