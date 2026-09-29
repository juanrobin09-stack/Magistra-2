// Demandes d'appairage du connecteur local : une seule à la fois, 3 boîtes de consentement par minute au plus,
// durée de vie, preuve de réception (accusé, sans effet sur la demande), vérificateur (5 essais), origine, usage
// unique, liaison de l'accusé au port d'écoute (hôte). Horloge simulée.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalPairAck, CONNECTOR_FORMATS, CONNECTOR_LIMITS, type PairingUrlParams } from '../../shared/localConnector.js';
import { pairAck, randomToken, sha256Base64Url, fromBase64Url } from '../../electron/connector/crypto.js';
import { MAX_PROMPTS_PER_MINUTE, PairingRegistry, type PairingTicket } from '../../electron/connector/pairing.js';

const ORIGIN = 'https://magistra-2.vercel.app';
/** Hôte du port d'écoute de l'application (fourni par le serveur à chaque réponse). */
const HOST = '127.0.0.1:47831';

/** Ce que fait le site : vérificateur de 32 octets, défi = SHA-256 de ces octets. */
function sitePairing(origin = ORIGIN): PairingUrlParams & { verifier: string } {
  const verifier = randomToken(32);
  return { pairingId: randomToken(16), challenge: sha256Base64Url(fromBase64Url(verifier, 32)!), origin, verifier };
}

function setup() {
  let clock = 1_750_000_000_000;
  const registry = new PairingRegistry({ now: () => clock });
  return { registry, advance: (ms: number) => { clock += ms; } };
}

function prompt(registry: PairingRegistry, p: PairingUrlParams): PairingTicket {
  const opened = registry.open(p);
  if (opened.kind !== 'prompt') throw new Error(`boîte attendue, reçu ${opened.kind}`);
  return opened.ticket;
}

const complete = (registry: PairingRegistry, p: { pairingId: string; verifier: string }, origin = ORIGIN, host = HOST) =>
  registry.complete({ pairingId: p.pairingId, verifier: p.verifier, origin, host });
const acknowledge = (registry: PairingRegistry, p: { pairingId: string }, origin = ORIGIN, host = HOST) =>
  registry.acknowledge({ pairingId: p.pairingId, origin, host });
/** Accusé attendu par le site : SHA-256 de la chaîne canonique (défi de l'URL, hôte du port visé). */
const ackOf = (p: { pairingId: string; challenge: string }, host = HOST) => sha256Base64Url(canonicalPairAck(p.pairingId, p.challenge, host));

afterEach(() => vi.useRealTimers());

describe('demande d’appairage', () => {
  it('en attente (202) tant que l’enseignant n’a pas répondu, puis acceptée une seule fois (usage unique)', () => {
    const { registry } = setup();
    const p = sitePairing();
    const ticket = prompt(registry, p);
    expect(ticket.origin).toBe(ORIGIN);
    const ack = ackOf(p);
    expect(complete(registry, p)).toEqual({ status: 'pending', ack });
    expect(complete(registry, p)).toEqual({ status: 'pending', ack });
    expect(registry.answer(ticket, true)).toBe(true);
    // Une réponse ne s'applique qu'une fois.
    expect(registry.answer(ticket, false)).toBe(false);
    expect(complete(registry, p)).toEqual({ status: 'approved', pairingId: p.pairingId, origin: ORIGIN, ack });
    expect(ticket.signal.aborted).toBe(true);
    expect(() => complete(registry, p)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(registry.pending).toBeNull();
  });

  it('preuve de réception (premier temps, sans secret) : accusé du défi de l’URL, « pending » puis « consented »', () => {
    const { registry } = setup();
    const p = sitePairing();
    const ticket = prompt(registry, p);
    const ack = acknowledge(registry, p);
    expect(ack).toEqual({ status: 'pending', ack: ackOf(p) });
    expect(ack.ack).toMatch(CONNECTOR_FORMATS.ack);
    expect(pairAck(p.pairingId, p.challenge, HOST)).toBe(ack.ack);
    // L'accusé ne révèle ni le défi ni le vérificateur.
    expect(ack.ack).not.toBe(p.challenge);
    registry.answer(ticket, true);
    // Autant d'essais que voulu : la demande n'est jamais modifiée (ni consommée, ni décomptée).
    for (let i = 0; i < CONNECTOR_LIMITS.maxVerifierAttempts + 3; i++) expect(acknowledge(registry, p)).toEqual({ status: 'consented', ack: ackOf(p) });
    expect(registry.pending).toMatchObject({ pairingId: p.pairingId, state: 'approved' });
    expect(complete(registry, p)).toMatchObject({ status: 'approved', ack: ackOf(p) });
    expect(() => acknowledge(registry, p)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('accusé : vecteur fixe (identique côté site, tests/localConnector/webCrypto.test.ts)', () => {
    expect(canonicalPairAck('AAECAwQFBgcICQoLDA0ODw', 'ctu3M2x2eAAj-D2kw1Xy7uqFczsT00d2l5F3kMEikIQ', HOST))
      .toBe('MAGISTRA-CONNECTOR-2-PAIR-ACK\n127.0.0.1:47831\nAAECAwQFBgcICQoLDA0ODw\nctu3M2x2eAAj-D2kw1Xy7uqFczsT00d2l5F3kMEikIQ');
    expect(pairAck('AAECAwQFBgcICQoLDA0ODw', 'ctu3M2x2eAAj-D2kw1Xy7uqFczsT00d2l5F3kMEikIQ', HOST)).toBe('FWJesznvhJom9M3AmmF_LgZOj3jjb8aI2tJHW6xP1BM');
    // Le défi du vecteur est bien le SHA-256 des 32 octets du vérificateur.
    expect(sha256Base64Url(fromBase64Url('ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8', 32)!)).toBe('ctu3M2x2eAAj-D2kw1Xy7uqFczsT00d2l5F3kMEikIQ');
  });

  it('accusé lié au port d’écoute : celui d’un autre port (relais) ne vaut pas pour le port visé', () => {
    const { registry } = setup();
    const p = sitePairing();
    const ticket = prompt(registry, p);
    const here = acknowledge(registry, p, ORIGIN, '127.0.0.1:47832');
    // L'application écoute sur 47832 : son accusé, relayé par un programme sur 47831, n'est pas celui qu'attend le site.
    expect(here.ack).toBe(ackOf(p, '127.0.0.1:47832'));
    expect(here.ack).not.toBe(ackOf(p, '127.0.0.1:47831'));
    registry.answer(ticket, true);
    expect(complete(registry, p, ORIGIN, '127.0.0.1:47832')).toMatchObject({ status: 'approved', ack: ackOf(p, '127.0.0.1:47832') });
  });

  it('premier temps : demande inconnue (404), expirée (410), autre origine (403) ; refus lisible mais jamais consommé', () => {
    const { registry, advance } = setup();
    const p = sitePairing();
    expect(() => acknowledge(registry, p)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    const ticket = prompt(registry, p);
    expect(() => acknowledge(registry, p, 'https://evil.example')).toThrow(expect.objectContaining({ code: 'FORBIDDEN', status: 403 }));
    expect(() => acknowledge(registry, { pairingId: randomToken(16) })).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    registry.answer(ticket, false);
    // Un tiers qui interroge avec l'identifiant ne fait pas disparaître le refus : le site le lit à son tour.
    for (let i = 0; i < 3; i++) expect(() => acknowledge(registry, p)).toThrow(expect.objectContaining({ code: 'CONNECTOR_PAIRING_REFUSED', status: 403 }));
    expect(() => complete(registry, p)).toThrow(expect.objectContaining({ code: 'CONNECTOR_PAIRING_REFUSED' }));
    expect(() => acknowledge(registry, p)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));

    const q = sitePairing();
    advance(60_001);
    prompt(registry, q);
    advance(CONNECTOR_LIMITS.pairingTtlMs);
    expect(() => acknowledge(registry, q)).toThrow(expect.objectContaining({ code: 'CONNECTOR_PAIRING_EXPIRED', status: 410 }));
    expect(() => acknowledge(registry, q)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('refus de l’enseignant : CONNECTOR_PAIRING_REFUSED, puis demande oubliée', () => {
    const { registry } = setup();
    const p = sitePairing();
    registry.answer(prompt(registry, p), false);
    expect(() => complete(registry, p)).toThrow(expect.objectContaining({ code: 'CONNECTOR_PAIRING_REFUSED', status: 403 }));
    expect(() => complete(registry, p)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('expiration : 410 même après accord, réponse tardive sans effet', () => {
    const { registry, advance } = setup();
    const p = sitePairing();
    const ticket = prompt(registry, p);
    registry.answer(ticket, true);
    advance(CONNECTOR_LIMITS.pairingTtlMs);
    expect(() => complete(registry, p)).toThrow(expect.objectContaining({ code: 'CONNECTOR_PAIRING_EXPIRED', status: 410 }));
    expect(() => complete(registry, p)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));

    const q = sitePairing();
    const late = prompt(registry, q);
    advance(CONNECTOR_LIMITS.pairingTtlMs + 1);
    expect(registry.answer(late, true)).toBe(false);
    expect(registry.pending).toMatchObject({ state: 'awaiting', expired: true });
  });

  it('la boîte de consentement se ferme à l’expiration (signal interrompu)', () => {
    vi.useFakeTimers();
    const registry = new PairingRegistry();
    const ticket = prompt(registry, sitePairing());
    vi.advanceTimersByTime(CONNECTOR_LIMITS.pairingTtlMs - 1);
    expect(ticket.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(ticket.signal.aborted).toBe(true);
  });

  it('vérificateur faux : 401 à chaque essai, demande supprimée au 5e ; le bon vérificateur passe avant', () => {
    const { registry } = setup();
    const p = sitePairing();
    const ticket = prompt(registry, p);
    registry.answer(ticket, true);
    for (let i = 1; i < CONNECTOR_LIMITS.maxVerifierAttempts; i++) {
      expect(() => complete(registry, { pairingId: p.pairingId, verifier: randomToken(32) })).toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
    }
    expect(complete(registry, p)).toMatchObject({ status: 'approved' });

    const q = sitePairing();
    prompt(registry, q);
    for (let i = 0; i < CONNECTOR_LIMITS.maxVerifierAttempts; i++) {
      // Vérificateur mal formé ou simplement faux : même réponse, même décompte.
      const wrong = i % 2 ? randomToken(32) : 'mal-forme';
      expect(() => complete(registry, { pairingId: q.pairingId, verifier: wrong })).toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
    }
    expect(() => complete(registry, q)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });

  it('le défi est le SHA-256 des OCTETS du vérificateur (pas de son texte base64url)', () => {
    const { registry } = setup();
    const verifier = randomToken(32);
    const p = { pairingId: randomToken(16), challenge: sha256Base64Url(verifier), origin: ORIGIN };
    prompt(registry, p);
    expect(() => complete(registry, { pairingId: p.pairingId, verifier })).toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
  });

  it('origine différente de celle de la demande : 403 FORBIDDEN, sans consommer d’essai', () => {
    const { registry } = setup();
    const p = sitePairing();
    registry.answer(prompt(registry, p), true);
    for (let i = 0; i < CONNECTOR_LIMITS.maxVerifierAttempts + 2; i++) {
      expect(() => complete(registry, p, 'https://evil.example')).toThrow(expect.objectContaining({ code: 'FORBIDDEN', status: 403 }));
    }
    expect(complete(registry, p)).toMatchObject({ status: 'approved' });
  });

  it('une nouvelle demande remplace l’ancienne (boîte fermée, 404 pour l’ancienne) ; même demande : aucune nouvelle boîte', () => {
    const { registry } = setup();
    const first = sitePairing();
    const firstTicket = prompt(registry, first);
    expect(registry.open(first)).toEqual({ kind: 'duplicate' });
    const second = sitePairing();
    const secondTicket = prompt(registry, second);
    expect(firstTicket.signal.aborted).toBe(true);
    expect(secondTicket.signal.aborted).toBe(false);
    // La réponse à l'ancienne boîte ne s'applique jamais à la nouvelle demande.
    expect(registry.answer(firstTicket, true)).toBe(false);
    expect(registry.pending).toMatchObject({ pairingId: second.pairingId, state: 'awaiting' });
    expect(() => complete(registry, first)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    // Même identifiant mais autre défi : c'est une autre demande (nouvelle boîte).
    expect(registry.open({ ...second, challenge: sitePairing().challenge }).kind).toBe('prompt');
  });

  it(`au plus ${MAX_PROMPTS_PER_MINUTE} boîtes de consentement par minute`, () => {
    const { registry, advance } = setup();
    for (let i = 0; i < MAX_PROMPTS_PER_MINUTE; i++) expect(registry.open(sitePairing()).kind).toBe('prompt');
    const blocked = sitePairing();
    expect(registry.open(blocked)).toEqual({ kind: 'rate-limited' });
    // La demande refusée ne remplace pas la demande en cours.
    expect(registry.pending?.pairingId).not.toBe(blocked.pairingId);
    advance(30_000);
    expect(registry.open(sitePairing()).kind).toBe('rate-limited');
    advance(30_001);
    expect(registry.open(sitePairing()).kind).toBe('prompt');
  });

  it('paramètres invalides refusés ; retrait et annulation', () => {
    const { registry } = setup();
    expect(() => registry.open({ pairingId: 'court', challenge: sitePairing().challenge, origin: ORIGIN })).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    const p = sitePairing();
    const ticket = prompt(registry, p);
    registry.withdraw({ ...ticket, signal: new AbortController().signal });
    expect(registry.pending).not.toBeNull();
    registry.withdraw(ticket);
    expect(ticket.signal.aborted).toBe(true);
    expect(() => complete(registry, p)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    const q = sitePairing();
    const other = prompt(registry, q);
    registry.cancel();
    expect(other.signal.aborted).toBe(true);
    expect(registry.pending).toBeNull();
  });
});
