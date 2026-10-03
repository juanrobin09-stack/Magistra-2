// Récupération sécurisée d'une page web publique (résultats de recherche SearXNG).
//
// Protection SSRF : une adresse proposée par un moteur de recherche ne doit jamais permettre
// d'atteindre le réseau interne (métadonnées cloud, services locaux, intranet).
//  - http/https uniquement, ports 80/443, pas d'identifiants dans l'URL ;
//  - résolution DNS puis refus de toute adresse privée, locale, de lien local, CGNAT, multicast
//    ou réservée (IPv4 et IPv6, y compris ULA, ::1, fe80::, adresses IPv4 encapsulées) ;
//  - connexion à l'adresse VÉRIFIÉE (pas de seconde résolution DNS : pas de « DNS rebinding ») ;
//  - redirections suivies manuellement (3 au plus), chacune revérifiée ;
//  - prédicat facultatif de l'appelant (allowUrl), évalué AVANT la première connexion et AVANT chaque saut de redirection :
//    refusé, aucun hôte n'est résolu ni contacté (la défense ne peut pas agir après coup) ;
//  - 1,5 Mo au plus (lecture en flux interrompue au-delà), text/html ou text/plain, 6 s au total.
//
// Module Node pur (aucune dépendance d'hébergeur) : il est aussi utilisé par l'application Windows.

import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { pipeline, Readable } from 'node:stream';
import zlib from 'node:zlib';
import { stripTags } from '../shared/research/providers.js';
import type { FetchedPage, FetchPageOptions } from '../shared/research/types.js';

export const SAFE_FETCH_LIMITS = {
  maxBytes: 1_500_000,
  timeoutMs: 6_000,
  maxRedirects: 3,
  maxTextChars: 200_000,
} as const;

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** Résolution DNS injectable (tests). */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface TransportInit {
  /** Adresse IP vérifiée à laquelle se connecter (le nom d'hôte reste utilisé pour TLS / Host). */
  address: ResolvedAddress;
  headers: Record<string, string>;
  signal: AbortSignal;
}

/** Transport HTTP injectable (tests). Ne suit jamais les redirections lui-même. */
export type Transport = (url: URL, init: TransportInit) => Promise<Response>;

export interface SafeFetchOptions {
  resolve?: Resolver;
  fetch?: Transport;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

// ─── Classification des adresses IP ─────────────────────────────────────────

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

const IPV4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8], // « ce réseau »
  ['10.0.0.0', 8], // privé
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // boucle locale
  ['169.254.0.0', 16], // lien local (dont 169.254.169.254, métadonnées cloud)
  ['172.16.0.0', 12], // privé
  ['192.0.0.0', 24], // protocoles IETF
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // relais 6to4
  ['192.168.0.0', 16], // privé
  ['198.18.0.0', 15], // tests de performance
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // réservé, diffusion
];

const IPV4_RANGES = IPV4_BLOCKED.map(([base, bits]) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { base: (ipv4ToInt(base)! & mask) >>> 0, mask };
});

function isPublicIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return !IPV4_RANGES.some(r => ((n & r.mask) >>> 0) === r.base);
}

/** Développe une adresse IPv6 en 8 groupes de 16 bits (null si invalide). */
function expandIPv6(ip: string): number[] | null {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf('%');
  if (zone >= 0) addr = addr.slice(0, zone);
  // Queue IPv4 éventuelle (ex. ::ffff:192.168.0.1)
  let tail: number[] = [];
  const lastColon = addr.lastIndexOf(':');
  if (addr.slice(lastColon + 1).includes('.')) {
    const v4 = ipv4ToInt(addr.slice(lastColon + 1));
    if (v4 === null) return null;
    tail = [v4 >>> 16, v4 & 0xffff];
    addr = `${addr.slice(0, lastColon + 1)}0:0`;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const parse = (s: string) => (s ? s.split(':').map(h => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN)) : []);
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...rest].some(Number.isNaN)) return null;
  const missing = 8 - head.length - rest.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...new Array<number>(Math.max(0, missing)).fill(0), ...rest];
  if (tail.length) groups.splice(6, 2, ...tail);
  return groups.length === 8 ? groups : null;
}

function embeddedIPv4(g: number[]): string {
  return `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
}

function isPublicIPv6(ip: string): boolean {
  const g = expandIPv6(ip);
  if (!g) return false;
  // IPv4 encapsulée (::ffff:a.b.c.d) ou traduite NAT64 (64:ff9b::a.b.c.d) : on juge l'adresse IPv4.
  if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) return isPublicIPv4(embeddedIPv4(g));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) return isPublicIPv4(embeddedIPv4(g));
  // Seul l'espace unicast global 2000::/3 est accepté…
  if ((g[0] & 0xe000) !== 0x2000) return false; // ::, ::1, ::/96, fc00::/7, fe80::/10, fec0::/10, ff00::/8…
  // … à l'exception de ses sous-plages spéciales.
  if (g[0] === 0x2001 && g[1] < 0x0200) return false; // 2001::/23 (Teredo, protocoles IETF)
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x2002) return false; // 6to4 (IPv4 encapsulée)
  if (g[0] === 0x3fff && g[1] < 0x1000) return false; // documentation (3fff::/20)
  return true;
}

/** Vrai si l'adresse IP est routable publiquement (ni privée, ni locale, ni réservée). */
export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip.split('%')[0]);
  if (v === 4) return isPublicIPv4(ip);
  if (v === 6) return isPublicIPv6(ip);
  return false;
}

// ─── Vérification des URL ───────────────────────────────────────────────────

class Refused extends Error {}

/** Vérifie la forme de l'URL (schéma, port, identifiants). Lève Refused sinon. */
export function checkUrlShape(raw: string | URL): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Refused('URL invalide');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Refused('schéma refusé');
  if (url.username || url.password) throw new Refused('identifiants refusés');
  if (url.port && url.port !== '80' && url.port !== '443') throw new Refused('port refusé');
  if (!url.hostname) throw new Refused('hôte manquant');
  url.hash = '';
  return url;
}

function bareHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '');
}

const defaultResolver: Resolver = async hostname => {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results
    .filter(r => r.family === 4 || r.family === 6)
    .map(r => ({ address: r.address, family: r.family as 4 | 6 }));
};

/** Résout l'hôte et exige que TOUTES ses adresses soient publiques. */
async function resolvePublic(url: URL, resolve: Resolver): Promise<ResolvedAddress> {
  const host = bareHost(url);
  const literal = isIP(host);
  if (literal) {
    if (!isPublicAddress(host)) throw new Refused('adresse non publique');
    return { address: host, family: literal as 4 | 6 };
  }
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Refused('hôte local');
  const addresses = await resolve(host);
  if (!addresses.length) throw new Refused('hôte introuvable');
  if (addresses.some(a => !isPublicAddress(a.address))) throw new Refused('adresse non publique');
  return addresses[0];
}

// ─── Transport Node (connexion à l'adresse vérifiée) ────────────────────────

function pinnedLookup(address: ResolvedAddress): LookupFunction {
  return ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
    if (options?.all) callback(null, [{ address: address.address, family: address.family }]);
    else callback(null, address.address, address.family);
  }) as unknown as LookupFunction;
}

export const nodeTransport: Transport = (url, init) =>
  new Promise<Response>((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const req = client.request(
      url,
      {
        method: 'GET',
        headers: init.headers,
        signal: init.signal,
        lookup: pinnedLookup(init.address),
        agent: false,
      },
      res => {
        const status = res.statusCode ?? 0;
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value === undefined || key === 'content-encoding' || key === 'content-length' || key === 'transfer-encoding') continue;
          headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        }
        if (status < 200 || status > 599) {
          res.destroy();
          reject(new Refused('statut HTTP invalide'));
          return;
        }
        const noBody = status === 204 || status === 205 || status === 304 || (status >= 300 && status < 400);
        if (noBody) {
          res.resume();
          resolve(new Response(null, { status, headers }));
          return;
        }
        let body: Readable = res;
        const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase().trim();
        // stream.pipeline (et non .pipe) : une coupure, une annulation ou un délai dépassé détruisent
        // AUSSI le flux de décompression, sinon la lecture resterait en attente indéfiniment.
        const decompress = (d: zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress) => pipeline(res, d, () => {});
        if (encoding === 'gzip' || encoding === 'x-gzip') body = decompress(zlib.createGunzip());
        else if (encoding === 'deflate') body = decompress(zlib.createInflate());
        else if (encoding === 'br') body = decompress(zlib.createBrotliDecompress());
        else if (encoding && encoding !== 'identity') {
          res.destroy();
          reject(new Refused('encodage non pris en charge'));
          return;
        }
        body.on('error', () => res.destroy());
        resolve(new Response(Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>, { status, headers }));
      },
    );
    req.on('error', reject);
    req.end();
  });

// ─── Lecture et extraction ──────────────────────────────────────────────────

/** reader.read(), interrompu par le signal (défense en profondeur : aucune lecture ne peut rester bloquée). */
function readOrAbort(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<Uint8Array>["read"]>>> {
  if (signal.aborted) return Promise.reject(new Refused('lecture interrompue'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Refused('lecture interrompue'));
    signal.addEventListener('abort', onAbort, { once: true });
    reader.read().then(
      result => {
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      },
      err => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

async function readLimited(res: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await readOrAbort(reader, signal);
      if (done) break;
      const room = maxBytes - total;
      const chunk = value.byteLength > room ? value.subarray(0, room) : value;
      chunks.push(chunk);
      total += chunk.byteLength;
    }
  } finally {
    // Au-delà de la limite (ou en fin de lecture) : le flux est interrompu.
    reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function charsetOf(contentType: string, head: Uint8Array): string {
  const fromHeader = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const sniff = new TextDecoder('latin1').decode(head.subarray(0, 2_048));
  return (/<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(sniff)?.[1] ?? 'utf-8').toLowerCase();
}

function decodeText(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/**
 * Titre de la page, par recherche LINÉAIRE et bornée (jamais de regex non bornée sur une page distante :
 * « <title> » répété sans fermeture rendait l'ancienne expression quadratique — déni de service).
 */
export function extractTitle(html: string): string | undefined {
  const head = html.slice(0, 65_536);
  const lower = head.toLowerCase();
  const open = lower.indexOf('<title');
  if (open < 0) return undefined;
  const gt = head.indexOf('>', open);
  if (gt < 0) return undefined;
  const close = lower.indexOf('</title', gt + 1);
  if (close < 0) return undefined;
  const raw = head.slice(gt + 1, Math.min(close, gt + 1 + 2_000));
  const title = stripTags(raw).replace(/\s+/g, ' ').trim();
  return title ? title.slice(0, 300) : undefined;
}

const DROPPED_BLOCKS = ['script', 'style', 'noscript', 'svg'];
const STRUCTURAL_BLOCKS = ['nav', 'footer', 'header', 'aside', 'form'];

/**
 * Neutralise les balises de bloc jamais refermées (page tronquée à la taille maximale, ou page
 * hostile) : stripTags reste ainsi linéaire, et aucun code JavaScript ne passe pour du texte.
 */
export function neutralizeUnclosedBlocks(html: string): string {
  let out = html;
  for (const tag of [...DROPPED_BLOCKS, ...STRUCTURAL_BLOCKS]) {
    const lower = out.toLowerCase();
    const lastClose = lower.lastIndexOf(`</${tag}>`);
    const from = lastClose < 0 ? 0 : lastClose + tag.length + 3;
    const firstOpen = lower.indexOf(`<${tag}`, from);
    if (firstOpen < 0) continue;
    if (DROPPED_BLOCKS.includes(tag)) {
      out = out.slice(0, firstOpen);
    } else {
      // « <nav … » → « < nav … » : la balise reste supprimée comme une balise ordinaire.
      out = out.slice(0, from) + out.slice(from).replace(new RegExp(`<(${tag})`, 'gi'), '< $1');
    }
  }
  return out;
}

// ─── API publique ───────────────────────────────────────────────────────────

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Vrai si l'appelant admet cette adresse ; un prédicat qui lève une exception refuse (jamais de connexion dans le doute). */
function isAllowed(allowUrl: FetchPageOptions['allowUrl'], url: URL): boolean {
  if (!allowUrl) return true;
  try {
    // Copie : le prédicat ne peut pas modifier l'adresse qui sera contactée.
    return allowUrl(new URL(url.href)) === true;
  } catch {
    return false;
  }
}

/** Crée une fonction de récupération sécurisée (dépendances injectables pour les tests). */
export function createSafePageFetcher(
  options: SafeFetchOptions = {},
): (url: string, signal?: AbortSignal, fetchOptions?: FetchPageOptions) => Promise<FetchedPage | null> {
  const resolve = options.resolve ?? defaultResolver;
  const transport = options.fetch ?? nodeTransport;
  const maxBytes = options.maxBytes ?? SAFE_FETCH_LIMITS.maxBytes;
  const timeoutMs = options.timeoutMs ?? SAFE_FETCH_LIMITS.timeoutMs;
  const maxRedirects = options.maxRedirects ?? SAFE_FETCH_LIMITS.maxRedirects;

  return async (rawUrl, signal, fetchOptions) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      let url = checkUrlShape(rawUrl);
      for (let hop = 0; hop <= maxRedirects; hop++) {
        // Avant toute résolution DNS et toute connexion : l'adresse de départ comme chaque destination d'une redirection.
        if (!isAllowed(fetchOptions?.allowUrl, url)) return null;
        const address = await resolvePublic(url, resolve);
        if (combined.aborted) return null;
        const res = await transport(url, {
          address,
          signal: combined,
          headers: {
            'User-Agent': 'Magistra/2.0 (outil pedagogique open source)',
            Accept: 'text/html, text/plain;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'fr, en;q=0.5',
          },
        });
        if (REDIRECT_STATUSES.has(res.status)) {
          await res.body?.cancel().catch(() => {});
          const location = res.headers.get('location');
          if (!location) return null;
          url = checkUrlShape(new URL(location, url));
          continue;
        }
        if (!res.ok) {
          await res.body?.cancel().catch(() => {});
          return null;
        }
        const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
        const isHtml = contentType.startsWith('text/html');
        if (!isHtml && !contentType.startsWith('text/plain')) {
          await res.body?.cancel().catch(() => {});
          return null;
        }
        const bytes = await readLimited(res, maxBytes, combined);
        const raw = decodeText(bytes, charsetOf(contentType, bytes));
        const text = (isHtml ? stripTags(neutralizeUnclosedBlocks(raw)) : raw.replace(/\r\n?/g, '\n').trim()).slice(0, SAFE_FETCH_LIMITS.maxTextChars);
        if (!text) return null;
        const title = isHtml ? extractTitle(raw) : undefined;
        return { url: url.href, ...(title ? { title } : {}), text };
      }
      return null; // trop de redirections
    } catch {
      return null;
    }
  };
}

const defaultFetcher = createSafePageFetcher();

/** Récupère une page web publique en toute sécurité ; null si elle est refusée ou illisible. */
export async function fetchPublicPage(url: string, signal?: AbortSignal, options?: FetchPageOptions): Promise<FetchedPage | null> {
  return defaultFetcher(url, signal, options);
}
