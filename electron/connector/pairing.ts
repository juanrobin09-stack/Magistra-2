// Demandes d'appairage du connecteur local (URL magistra://pair → accord de l'enseignant → POST /v1/pair en deux temps).
// Module PUR Node (aucun import d'Electron) : la boîte de consentement est affichée par electron/main.ts.
//
// Règles :
// - UNE seule demande à la fois : une nouvelle demande remplace l'ancienne (la boîte de l'ancienne se ferme, ses
//   essais de fin d'appairage reçoivent 404) ;
// - au plus MAX_PROMPTS_PER_MINUTE boîtes de consentement par minute (un site ne peut pas harceler l'enseignant) ;
// - durée de vie : CONNECTOR_LIMITS.pairingTtlMs depuis l'ouverture de l'URL (accord compris) ; ensuite 410 ;
// - premier temps (acknowledge, sans secret) : accusé de réception `ack` = SHA-256(canonicalPairAck(pairingId,
//   challenge)), calculé à la réception de l'URL — seule cette application connaît le défi, qui ne circule jamais
//   dans une requête HTTP — avec l'état de la demande ('pending' ou 'consented'). Le requérant n'étant pas
//   authentifié, ce premier temps ne MODIFIE jamais la demande (ni essai compté, ni refus consommé) ;
// - second temps (complete) : SHA-256(octets du vérificateur) doit égaler le défi de l'URL (comparaison à temps
//   constant) ; CONNECTOR_LIMITS.maxVerifierAttempts essais faux au plus, puis la demande est supprimée ;
// - en-tête Origin des deux temps = origine de la demande, sinon 403 FORBIDDEN ;
// - usage unique : la demande acceptée est retirée dès sa première fin d'appairage réussie.
//
// Le défi (challenge) est le SHA-256 des 32 OCTETS du vérificateur (décodés du base64url), encodé en base64url.

import { MagistraError } from '../../shared/errors.js';
import { CONNECTOR_LIMITS, type PairingUrlParams } from '../../shared/localConnector.js';
import { constantTimeEqual, fromBase64Url, pairAck, sha256 } from './crypto.js';

/** Boîtes de consentement affichées au plus par minute. */
export const MAX_PROMPTS_PER_MINUTE = 3;
const MINUTE_MS = 60_000;
const SECRET_BYTES = 32;

export type PairingState = 'awaiting' | 'approved' | 'refused';

/** Demande en attente de l'accord de l'enseignant (transmise à la boîte de consentement). */
export interface PairingTicket {
  readonly pairingId: string;
  readonly origin: string;
  /** Interrompu quand la demande est remplacée, expire ou est annulée : la boîte de consentement doit se fermer. */
  readonly signal: AbortSignal;
}

export type PairingOpenResult =
  /** Nouvelle demande : afficher la boîte de consentement. */
  | { kind: 'prompt'; ticket: PairingTicket }
  /** Même demande déjà reçue (double clic sur « Connecter ») : aucune nouvelle boîte. */
  | { kind: 'duplicate' }
  /** Trop de boîtes de consentement dans la dernière minute : demande ignorée. */
  | { kind: 'rate-limited' };

/** Premier temps de POST /v1/pair : état de la demande et accusé de réception. */
export interface PairingAck {
  /** 'pending' : l'enseignant n'a pas encore répondu ; 'consented' : accord donné, second temps attendu. */
  status: 'pending' | 'consented';
  ack: string;
}

export type PairingCompletion =
  | { status: 'pending'; ack: string }
  /** Accord donné : la demande est consommée (usage unique). */
  | { status: 'approved'; pairingId: string; origin: string; ack: string };

export interface PairingRegistryOptions {
  now?: () => number;
  ttlMs?: number;
  maxAttempts?: number;
  maxPromptsPerMinute?: number;
}

interface PairingEntry {
  pairingId: string;
  challenge: Buffer;
  /** Accusé de réception (calculé une fois, à la réception de l'URL). */
  ack: string;
  origin: string;
  createdAt: number;
  state: PairingState;
  attempts: number;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
}

export class PairingRegistry {
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxAttempts: number;
  private readonly maxPrompts: number;
  private current: PairingEntry | null = null;
  private prompts: number[] = [];

  constructor(options: PairingRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? CONNECTOR_LIMITS.pairingTtlMs;
    this.maxAttempts = options.maxAttempts ?? CONNECTOR_LIMITS.maxVerifierAttempts;
    this.maxPrompts = options.maxPromptsPerMinute ?? MAX_PROMPTS_PER_MINUTE;
  }

  /** État de la demande en cours (réglages, tests) ; null s'il n'y en a pas. */
  get pending(): { pairingId: string; origin: string; state: PairingState; expired: boolean } | null {
    const c = this.current;
    return c ? { pairingId: c.pairingId, origin: c.origin, state: c.state, expired: this.isExpired(c) } : null;
  }

  private isExpired(entry: PairingEntry): boolean {
    return this.now() - entry.createdAt >= this.ttlMs;
  }

  private drop(entry: PairingEntry): void {
    clearTimeout(entry.timer);
    entry.controller.abort();
    if (this.current === entry) this.current = null;
  }

  /**
   * URL magistra://pair déjà analysée (parseAppUrl) et d'origine AUTORISÉE (vérifiée par l'appelant).
   * Remplace la demande précédente, sauf s'il s'agit exactement de la même.
   */
  open(params: PairingUrlParams): PairingOpenResult {
    const challenge = fromBase64Url(params.challenge, SECRET_BYTES);
    if (!challenge || !fromBase64Url(params.pairingId, 16)) throw new MagistraError('INVALID_REQUEST');
    const c = this.current;
    if (c && c.pairingId === params.pairingId && c.origin === params.origin && constantTimeEqual(c.challenge, challenge) && !this.isExpired(c)) {
      return { kind: 'duplicate' };
    }
    const now = this.now();
    this.prompts = this.prompts.filter(t => now - t < MINUTE_MS);
    if (this.prompts.length >= this.maxPrompts) return { kind: 'rate-limited' };
    this.prompts.push(now);
    if (c) this.drop(c);
    const controller = new AbortController();
    const entry: PairingEntry = {
      pairingId: params.pairingId,
      challenge,
      ack: pairAck(params.pairingId, params.challenge),
      origin: params.origin,
      createdAt: now,
      state: 'awaiting',
      attempts: 0,
      controller,
      // À l'expiration, la boîte de consentement éventuellement encore ouverte se ferme (réponse sans effet).
      timer: setTimeout(() => controller.abort(), this.ttlMs),
    };
    entry.timer.unref?.();
    this.current = entry;
    return { kind: 'prompt', ticket: { pairingId: entry.pairingId, origin: entry.origin, signal: controller.signal } };
  }

  /**
   * Réponse de l'enseignant. Sans effet (faux) si la demande a été remplacée, annulée ou a expiré entre-temps :
   * une réponse ne s'applique jamais à une autre demande que celle qui a été montrée.
   */
  answer(ticket: PairingTicket, approved: boolean): boolean {
    const c = this.current;
    if (!c || ticket.signal !== c.controller.signal || c.state !== 'awaiting' || this.isExpired(c)) return false;
    c.state = approved ? 'approved' : 'refused';
    return true;
  }

  /** Demande en cours visée par une requête : connue (404), non expirée (410), même origine (403 FORBIDDEN). */
  private target(pairingId: string, origin: string): PairingEntry {
    const c = this.current;
    if (!c || c.pairingId !== pairingId) throw new MagistraError('NOT_FOUND', 'Demande de connexion inconnue : recommencez depuis le site.');
    if (this.isExpired(c)) {
      this.drop(c);
      throw new MagistraError('CONNECTOR_PAIRING_EXPIRED');
    }
    if (origin !== c.origin) throw new MagistraError('FORBIDDEN');
    return c;
  }

  /**
   * Premier temps de POST /v1/pair (preuve de réception, sans secret), arguments déjà au bon format. Ordre des
   * contrôles : demande connue (404) → délai (410) → origine (403 FORBIDDEN) → réponse de l'enseignant : en attente
   * ('pending'), accord ('consented' : la demande attend le second temps), refus (403 CONNECTOR_PAIRING_REFUSED).
   * Ne modifie jamais la demande : un refus reste lisible jusqu'à l'expiration ou au remplacement de la demande.
   */
  acknowledge(input: { pairingId: string; origin: string }): PairingAck {
    const c = this.target(input.pairingId, input.origin);
    if (c.state === 'refused') throw new MagistraError('CONNECTOR_PAIRING_REFUSED');
    return { status: c.state === 'approved' ? 'consented' : 'pending', ack: c.ack };
  }

  /**
   * Second temps de POST /v1/pair (fin d'appairage), arguments déjà au bon format. Ordre des contrôles : demande
   * connue (404) → délai (410) → origine de la requête (403 FORBIDDEN) → vérificateur (401, demande supprimée au
   * dernier essai) → réponse de l'enseignant (202 en attente, 403 refus, accord : demande consommée).
   */
  complete(input: { pairingId: string; verifier: string; origin: string }): PairingCompletion {
    const c = this.target(input.pairingId, input.origin);
    const verifier = fromBase64Url(input.verifier, SECRET_BYTES);
    if (!verifier || !constantTimeEqual(sha256(verifier), c.challenge)) {
      c.attempts++;
      if (c.attempts >= this.maxAttempts) this.drop(c);
      throw new MagistraError('UNAUTHENTICATED', 'Demande de connexion invalide.');
    }
    if (c.state === 'awaiting') return { status: 'pending', ack: c.ack };
    this.drop(c);
    if (c.state === 'refused') throw new MagistraError('CONNECTOR_PAIRING_REFUSED');
    return { status: 'approved', pairingId: c.pairingId, origin: c.origin, ack: c.ack };
  }

  /**
   * Retire la demande montrée si elle est toujours la demande en cours (boîte de consentement impossible à afficher,
   * connecteur impossible à réactiver) : les essais de fin d'appairage reçoivent ensuite 404.
   */
  withdraw(ticket: PairingTicket): void {
    const c = this.current;
    if (c && ticket.signal === c.controller.signal) this.drop(c);
  }

  /** Annule la demande en cours (connecteur désactivé, fermeture de l'application). */
  cancel(): void {
    if (this.current) this.drop(this.current);
  }
}
