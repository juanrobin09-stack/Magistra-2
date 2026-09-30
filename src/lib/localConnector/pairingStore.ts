// Appairage du connecteur local mémorisé dans CE navigateur : base IndexedDB « magistra-local-connector », un seul
// enregistrement { clientId, key, port, pairedAt }.
//
// La clé HMAC est un CryptoKey NON EXTRACTIBLE conservé tel quel (clone structuré d'IndexedDB) : ni le site, ni une
// extension, ni un script injecté ne peuvent en lire les octets ; ils ne peuvent que l'utiliser depuis cette origine.
// Aucune donnée d'appairage n'est jamais mise dans localStorage, un cookie ou une URL.
//
// IndexedDB indisponible (navigation privée stricte, stockage bloqué, base impossible à ouvrir) : repli en mémoire
// pour cette visite — l'appairage fonctionne jusqu'au rechargement de la page, puis doit être refait.

import { CONNECTOR_FORMATS } from '@shared/localConnector';
import { isNonExtractableHmacKey } from './webCrypto';

export interface StoredPairing {
  /** Identifiant attribué par le connecteur (16 octets, base64url). */
  clientId: string;
  /** Clé HMAC-SHA-256 partagée avec l'application, NON extractible. */
  key: CryptoKey;
  /** Dernier port où l'application a prouvé détenir la clé (essayé en premier). */
  port: number;
  /** Date de l'appairage (ISO 8601). */
  pairedAt: string;
}

export interface PairingStore {
  /** Appairage enregistré, ou null (aucun, ou enregistrement illisible). */
  load(): Promise<StoredPairing | null>;
  /** Remplace l'appairage enregistré. */
  save(pairing: StoredPairing): Promise<void>;
  /** Oublie l'appairage (sans effet s'il n'y en a pas). */
  clear(): Promise<void>;
}

export const PAIRING_DB_NAME = 'magistra-local-connector';
const DB_VERSION = 1;
const OBJECT_STORE = 'pairing';
const RECORD_KEY = 'current';
/** Ouverture de la base : au-delà, repli en mémoire (certains navigateurs ne répondent jamais en mode privé). */
const OPEN_TIMEOUT_MS = 3_000;

/** Enregistrement complet et bien formé (sinon : ignoré, comme s'il n'y avait pas d'appairage). */
export function isStoredPairing(value: unknown): value is StoredPairing {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<StoredPairing>;
  return typeof v.clientId === 'string' && CONNECTOR_FORMATS.clientId.test(v.clientId)
    && typeof v.port === 'number' && Number.isInteger(v.port) && v.port > 0 && v.port <= 65_535
    && typeof v.pairedAt === 'string' && v.pairedAt.length <= 40 && !Number.isNaN(Date.parse(v.pairedAt))
    && isNonExtractableHmacKey(v.key);
}

function copy(pairing: StoredPairing): StoredPairing {
  return { clientId: pairing.clientId, key: pairing.key, port: pairing.port, pairedAt: pairing.pairedAt };
}

// ─── Mémoire ────────────────────────────────────────────────────────────────

/** Magasin en mémoire (repli, tests) : l'appairage dure jusqu'au rechargement de la page. */
export class MemoryPairingStore implements PairingStore {
  private value: StoredPairing | null = null;

  async load(): Promise<StoredPairing | null> {
    return this.value ? copy(this.value) : null;
  }

  async save(pairing: StoredPairing): Promise<void> {
    if (!isStoredPairing(pairing)) throw new TypeError('Appairage invalide.');
    this.value = copy(pairing);
  }

  async clear(): Promise<void> {
    this.value = null;
  }
}

export function createMemoryPairingStore(): PairingStore {
  return new MemoryPairingStore();
}

// ─── IndexedDB ──────────────────────────────────────────────────────────────

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error('IndexedDB ne répond pas.')), OPEN_TIMEOUT_MS);
    function finish(error: unknown, db?: IDBDatabase) {
      if (settled) {
        // Ouverture réussie après le délai : la connexion inutile est refermée.
        db?.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (db) resolve(db);
      else reject(error);
    }
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(PAIRING_DB_NAME, DB_VERSION);
    } catch (err) {
      finish(err);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OBJECT_STORE)) db.createObjectStore(OBJECT_STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      // Autre onglet qui mettrait la base à jour : la connexion est libérée (elle sera rouverte au besoin).
      db.onversionchange = () => db.close();
      finish(null, db);
    };
    request.onerror = () => finish(request.error ?? new Error('IndexedDB inaccessible.'));
  });
}

/** Une transaction sur l'unique magasin d'objets ; résout avec le résultat de la requête une fois la transaction validée. */
function transact<T>(db: IDBDatabase, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    let request: IDBRequest<T>;
    try {
      tx = db.transaction(OBJECT_STORE, mode);
      request = operation(tx.objectStore(OBJECT_STORE));
    } catch (err) {
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? request.error ?? new Error('Transaction IndexedDB en échec.'));
    tx.onabort = () => reject(tx.error ?? new Error('Transaction IndexedDB annulée.'));
  });
}

/**
 * Magasin IndexedDB avec repli en mémoire. Une copie en mémoire suit chaque écriture : si IndexedDB devient
 * inutilisable en cours de visite, l'appairage connu reste utilisable jusqu'au rechargement.
 */
class IndexedDbPairingStore implements PairingStore {
  private readonly factory: IDBFactory | null;
  private readonly memory = new MemoryPairingStore();
  private database: Promise<IDBDatabase | null> | null = null;
  /** IndexedDB inutilisable : mémoire seule jusqu'au rechargement. */
  private degraded = false;

  constructor(factory: IDBFactory | null) {
    this.factory = factory;
  }

  private open(): Promise<IDBDatabase | null> {
    if (this.degraded || !this.factory) return Promise.resolve(null);
    this.database ??= openDatabase(this.factory).catch(() => null);
    return this.database;
  }

  private degrade(): void {
    this.degraded = true;
    this.database = null;
  }

  async load(): Promise<StoredPairing | null> {
    const db = await this.open();
    if (!db) {
      this.degrade();
      return this.memory.load();
    }
    let value: unknown;
    try {
      value = await transact(db, 'readonly', store => store.get(RECORD_KEY));
    } catch {
      this.degrade();
      return this.memory.load();
    }
    if (value === undefined || value === null) {
      await this.memory.clear();
      return null;
    }
    if (!isStoredPairing(value)) {
      // Enregistrement illisible (version antérieure, altération) : oublié, un nouvel appairage sera demandé.
      await this.clear();
      return null;
    }
    // Copie en mémoire à jour (un autre onglet a pu appairer ou retirer entre-temps).
    await this.memory.save(value);
    return copy(value);
  }

  async save(pairing: StoredPairing): Promise<void> {
    await this.memory.save(pairing);
    const db = await this.open();
    if (!db) {
      this.degrade();
      return;
    }
    try {
      await transact(db, 'readwrite', store => store.put(copy(pairing), RECORD_KEY));
    } catch {
      // Quota, clé impossible à cloner… : l'appairage reste en mémoire pour cette visite.
      this.degrade();
    }
  }

  async clear(): Promise<void> {
    await this.memory.clear();
    const db = await this.open();
    if (!db) {
      this.degrade();
      return;
    }
    try {
      await transact(db, 'readwrite', store => store.delete(RECORD_KEY));
    } catch {
      // Effacement impossible : oublié au moins pour cette visite. Si l'enregistrement réapparaît au prochain
      // chargement, le connecteur le refusera (401) s'il a été retiré, et il sera alors oublié.
      this.degrade();
    }
  }
}

/** Magasin IndexedDB (fabrique injectable pour les tests) ; `null` : mémoire seule. */
export function createIndexedDbPairingStore(factory: IDBFactory | null): PairingStore {
  return new IndexedDbPairingStore(factory);
}

/** Magasin par défaut : IndexedDB du navigateur, sinon mémoire. */
export function defaultPairingStore(): PairingStore {
  return createIndexedDbPairingStore(browserIndexedDb());
}

function browserIndexedDb(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    // Accès refusé (cadre isolé, stockage bloqué) : mémoire seule.
    return null;
  }
}
