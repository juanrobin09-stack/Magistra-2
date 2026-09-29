// Connecteur local de l'application : navigateurs autorisés, appairage, serveur HTTP, réglage « activé ».
// Module PUR Node (aucun import d'Electron) : la boîte de consentement est fournie par electron/main.ts (askConsent).
//
// - start() : écoute si le réglage l'autorise (au démarrage de l'application, jamais pendant le test de démarrage) ;
//   aucun port dédié libre : nouvel essai toutes les minutes, cause affichée dans les réglages (sans port).
// - URL magistra:// (ligne de commande, deuxième instance, macOS) : « open » → fenêtre au premier plan ; « pair » →
//   origine hors de la liste autorisée : ignorée (journal seulement, aucune boîte) ; sinon une demande à la fois,
//   au plus 3 boîtes de consentement par minute, puis accord (réactive le connecteur s'il était désactivé) ou refus.
// - Retrait d'un navigateur ou désactivation : effet immédiat, générations du site concernées interrompues.

import { MagistraError } from '../../shared/errors.js';
import {
  CONNECTOR_URL_SCHEME, originLabel, parseAppUrl, type ConnectorAppStatus, type ConnectorStatus, type PairingUrlParams,
} from '../../shared/localConnector.js';
import type { Capabilities } from '../../shared/types.js';
import type { SecretCipher } from '../aiConfig.js';
import { ConnectorClientStore } from './clients.js';
import { PairingRegistry, type PairingTicket } from './pairing.js';
import { ConnectorServer, type ConnectorGenerations, type ConnectorTimeouts } from './server.js';
import { buildConnectorStatus } from './status.js';

/** Cause affichée quand le connecteur est activé mais n'écoute pas (jamais d'adresse ni de port). */
export const NO_PORT_PROBLEM =
  'Le site Magistra ne peut pas joindre cette application pour l’instant : un autre programme de cet ordinateur occupe les accès réservés à Magistra. Fermez-le ou redémarrez l’ordinateur ; Magistra réessaie toute seule.';
export const DEV_DISABLED_PROBLEM = 'Accès du site désactivé pour ce lancement (option de développement).';
const RETRY_MS = 60_000;

/** Demande d'accord montrée à l'enseignant (boîte native de l'application). */
export interface ConsentRequest {
  origin: string;
  /** Site affiché (« magistra-2.vercel.app »). */
  site: string;
  message: string;
  detail: string;
  /** Le connecteur est désactivé : l'accord le réactive. */
  reenables: boolean;
}

/**
 * URL magistra:// passée en argument (premier lancement par le site, ou deuxième instance sous Windows et Linux).
 * Le premier élément (exécutable) est ignoré ; seule la première URL du schéma est retenue, sans autre analyse ici
 * (parseAppUrl la vérifie ensuite strictement).
 */
export function appUrlFromArgv(argv: readonly string[]): string | null {
  const prefix = `${CONNECTOR_URL_SCHEME}:`;
  for (const arg of argv.slice(1)) {
    if (typeof arg === 'string' && arg.slice(0, prefix.length).toLowerCase() === prefix) return arg;
  }
  return null;
}

export function consentMessage(origin: string): string {
  return `Autoriser ${originLabel(origin)} à utiliser l’intelligence locale de cet ordinateur ?`;
}

export function consentDetail(reenables: boolean): string {
  const parts = [
    'Depuis ce navigateur, le site pourra envoyer des demandes de génération à l’intelligence artificielle de cet ordinateur et recevoir les contenus produits.',
    'Il n’aura aucun accès à vos fichiers, à vos autres applications ni aux réglages de Magistra.',
    'Vous pourrez retirer cette autorisation à tout moment dans Magistra → Réglages → « Site web Magistra ».',
  ];
  if (reenables) parts.push('L’accès du site Magistra à cet ordinateur est actuellement désactivé : « Autoriser » le réactivera.');
  return parts.join('\n\n');
}

/** Générations utilisées par le connecteur (GenerationManager). */
export interface ConnectorGenerationHost extends ConnectorGenerations {
  capabilities(): Promise<Capabilities>;
  readonly busy: boolean;
  cancelExternalAll(): void;
}

export interface LocalConnectorDeps {
  /** <userData>/local-connector.json */
  file: string;
  cipher: SecretCipher;
  version: string;
  /** Origines autorisées : OFFICIAL_WEB_ORIGINS (+ origines de développement hors application installée). */
  allowedOrigins: readonly string[];
  ports: readonly number[];
  generation: ConnectorGenerationHost;
  /** Boîte de consentement ; `signal` interrompu : demande remplacée ou expirée → fermer la boîte (réponse ignorée). */
  askConsent: (request: ConsentRequest, signal: AbortSignal) => Promise<boolean>;
  /** Nouvel état (réglages de l'application : IPC connectorChanged). */
  onChange?: (status: ConnectorAppStatus) => void;
  /** Option de développement : connecteur éteint pour ce lancement. */
  disabledForSession?: boolean;
  log?: (message: string) => void;
  now?: () => number;
  maxClients?: number;
  timeouts?: Partial<ConnectorTimeouts>;
  retryMs?: number;
}

export class LocalConnector {
  readonly clients: ConnectorClientStore;
  readonly pairing: PairingRegistry;
  private readonly deps: LocalConnectorDeps;
  private readonly server: ConnectorServer;
  private readonly log: (message: string) => void;
  /** start() appelé et stop() pas encore : l'application veut que le connecteur tourne (si le réglage l'autorise). */
  private wanted = false;
  private noPort = false;
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private transition: Promise<unknown> = Promise.resolve();

  constructor(deps: LocalConnectorDeps) {
    this.deps = deps;
    this.log = deps.log ?? (message => console.warn(`[magistra] ${message}`));
    const now = deps.now ?? Date.now;
    this.clients = new ConnectorClientStore(deps.file, deps.cipher, {
      now: () => new Date(now()),
      warn: this.log,
      ...(deps.maxClients ? { maxClients: deps.maxClients } : {}),
    });
    this.pairing = new PairingRegistry({ now });
    this.server = new ConnectorServer({
      version: deps.version,
      allowedOrigins: deps.allowedOrigins,
      ports: deps.ports,
      clients: this.clients,
      pairing: this.pairing,
      generations: deps.generation,
      status: () => this.engineStatus(),
      now,
      log: this.log,
      ...(deps.timeouts ? { timeouts: deps.timeouts } : {}),
    });
    this.clients.onChange(() => this.notify());
  }

  /** Relit les réglages et les navigateurs autorisés (avant start()). */
  async init(): Promise<void> {
    await this.clients.load();
  }

  /** Port d'écoute (tests, journal) ; jamais transmis à la fenêtre ni au site. */
  get port(): number | null {
    return this.server.port;
  }

  status(): ConnectorAppStatus {
    const enabled = this.clients.enabled;
    const listening = this.server.port !== null;
    let problem: string | undefined;
    if (enabled && !listening && this.wanted) {
      if (this.deps.disabledForSession) problem = DEV_DISABLED_PROBLEM;
      else if (this.noPort) problem = NO_PORT_PROBLEM;
    }
    return {
      enabled,
      listening,
      ...(problem ? { problem } : {}),
      persistent: this.clients.persistent,
      clients: this.clients.list(),
    };
  }

  private notify(): void {
    try {
      this.deps.onChange?.(this.status());
    } catch (err) {
      this.log(`Notification du connecteur local impossible : ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async engineStatus(): Promise<ConnectorStatus> {
    const capabilities = await this.deps.generation.capabilities();
    return buildConnectorStatus({ version: this.deps.version, capabilities, busy: this.deps.generation.busy });
  }

  /** Enchaîne les ouvertures et fermetures du serveur (jamais deux à la fois). */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.transition.then(task, task);
    this.transition = run.catch(() => undefined);
    return run;
  }

  private async listen(): Promise<void> {
    if (!this.wanted || !this.clients.enabled || this.deps.disabledForSession || this.server.port !== null) return;
    const port = await this.server.start();
    const noPort = port === null;
    const changed = noPort !== this.noPort || !noPort;
    this.noPort = noPort;
    if (noPort) {
      this.log('Connecteur local : aucun port dédié disponible, nouvel essai dans une minute.');
      this.scheduleRetry();
    } else {
      this.clearRetry();
      this.log(`Connecteur local actif (127.0.0.1:${port}).`);
    }
    if (changed) this.notify();
  }

  private async close(): Promise<void> {
    this.clearRetry();
    this.noPort = false;
    this.pairing.cancel();
    this.deps.generation.cancelExternalAll();
    const wasListening = this.server.port !== null;
    await this.server.stop();
    if (wasListening) this.notify();
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setInterval(() => {
      void this.serialize(() => this.listen()).catch(err => this.log(`Connecteur local : nouvel essai impossible (${err instanceof Error ? err.name : 'erreur'}).`));
    }, this.deps.retryMs ?? RETRY_MS);
    this.retryTimer.unref?.();
  }

  private clearRetry(): void {
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.retryTimer = null;
  }

  /** Démarrage de l'application : écoute si le réglage l'autorise. Ne lève jamais. */
  async start(): Promise<void> {
    this.wanted = true;
    try {
      await this.serialize(() => this.listen());
    } catch (err) {
      this.log(`Connecteur local : démarrage impossible (${err instanceof Error ? err.name : 'erreur'}).`);
    }
  }

  /** Fermeture de l'application : plus d'écoute, demande d'appairage annulée, générations du site interrompues. */
  async stop(): Promise<void> {
    this.wanted = false;
    await this.serialize(() => this.close());
    await this.clients.flush().catch(() => undefined);
  }

  /** Réglages : retire l'autorisation d'un navigateur (effet immédiat, génération éventuelle interrompue). */
  async revoke(clientId: string): Promise<ConnectorAppStatus> {
    this.deps.generation.cancelOwner(clientId);
    await this.clients.revoke(clientId);
    return this.status();
  }

  /** Réglages : « Permettre au site Magistra d'utiliser l'IA de cet ordinateur ». */
  async setEnabled(enabled: boolean): Promise<ConnectorAppStatus> {
    let failure: unknown = null;
    try {
      await this.clients.setEnabled(enabled);
    } catch (err) {
      failure = err;
    }
    // Désactivation : effective même si elle n'a pas pu être enregistrée.
    if (!this.clients.enabled) await this.serialize(() => this.close());
    else await this.serialize(() => this.listen());
    if (failure) throw failure;
    return this.status();
  }

  /**
   * URL magistra:// reçue par l'application. Ne lève jamais : une URL inattendue est ignorée (journal seulement).
   * `focus` met la fenêtre au premier plan (en la créant si besoin).
   */
  async handleAppUrl(raw: unknown, focus: () => void): Promise<void> {
    const parsed = parseAppUrl(raw);
    if (!parsed) {
      this.log('Adresse magistra:// ignorée : forme inattendue.');
      return;
    }
    if (parsed.kind === 'open') {
      focus();
      return;
    }
    await this.requestPairing(parsed, focus);
  }

  private async requestPairing(params: PairingUrlParams, focus: () => void): Promise<void> {
    if (!this.deps.allowedOrigins.includes(params.origin)) {
      this.log(`Demande de connexion ignorée : site non autorisé (${originLabel(params.origin)}).`);
      return;
    }
    let opened: ReturnType<PairingRegistry['open']>;
    try {
      opened = this.pairing.open(params);
    } catch {
      this.log('Demande de connexion ignorée : paramètres invalides.');
      return;
    }
    if (opened.kind === 'rate-limited') {
      this.log('Demande de connexion ignorée : trop de demandes en une minute.');
      return;
    }
    focus();
    if (opened.kind === 'duplicate') return;
    await this.consent(opened.ticket);
  }

  private async consent(ticket: PairingTicket): Promise<void> {
    const reenables = !this.clients.enabled;
    const request: ConsentRequest = {
      origin: ticket.origin,
      site: originLabel(ticket.origin),
      message: consentMessage(ticket.origin),
      detail: consentDetail(reenables),
      reenables,
    };
    let approved: boolean;
    try {
      approved = await this.deps.askConsent(request, ticket.signal);
    } catch (err) {
      this.log(`Boîte de consentement impossible à afficher (${err instanceof Error ? err.name : 'erreur'}).`);
      this.pairing.withdraw(ticket);
      return;
    }
    if (ticket.signal.aborted) return;
    if (approved && !this.clients.enabled) {
      try {
        await this.setEnabled(true);
      } catch (err) {
        this.log(`Réactivation du connecteur local impossible (${err instanceof MagistraError ? err.code : 'erreur'}).`);
        this.pairing.withdraw(ticket);
        return;
      }
    }
    this.pairing.answer(ticket, approved);
  }
}
