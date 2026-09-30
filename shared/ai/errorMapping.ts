// Traduction des erreurs des serveurs d'IA en messages clairs, grammaticaux et adaptés au destinataire.
//
// Deux destinataires (HttpErrorContext.recipient) :
//  - 'poste'          : l'application Windows. L'enseignant règle lui-même son IA : on renvoie vers les réglages.
//  - 'administrateur' : le site web. L'enseignant n'a aucun réglage : on dit ce que l'ADMINISTRATEUR du site doit
//                       vérifier (AI_BASE_URL, AI_API_KEY, AI_MODEL…), sans jamais citer de valeur secrète.
//
// Le détail technique renvoyé par le serveur (HttpErrorDetail) sert uniquement à choisir le message :
// il n'est jamais recopié dans le message montré.

import { defaultMessage, MagistraError, type ErrorCode } from '../errors.js';
import type { AddressKind } from './presets.js';
import { lowerFirst, networkFailureKind, type HttpErrorDetail } from './streams.js';

/** Destinataire des conseils : 'poste' (application Windows) ou 'administrateur' (site web). */
export type ErrorRecipient = 'poste' | 'administrateur';

/** Libellé par défaut d'un serveur d'IA ; dans les phrases, il devient « le serveur d'IA ». */
export const DEFAULT_AI_SERVER_LABEL = "Serveur d'IA";
/** Libellé du moteur Ollama de l'ordinateur de l'enseignant (application Windows). */
export const LOCAL_ENGINE_LABEL = 'Le moteur IA local';

/**
 * Au-delà de cette attente conseillée par le fournisseur (Retry-After…), un 429 n'est plus une surcharge
 * passagère (AI_BUSY, nouvel essai automatique) mais une limite de quota (AI_QUOTA_EXCEEDED, sans nouvel essai).
 */
export const SHORT_RETRY_AFTER_MS = 15_000;

export interface HttpErrorContext {
  /** Libellé du service (« Serveur universitaire », « OVHcloud AI Endpoints », « Le moteur IA local »…). */
  label: string;
  /** Nom technique du modèle. */
  model: string;
  /** Vrai si le moteur tourne sur l'ordinateur de l'utilisateur (avec recipient 'poste' : messages du moteur local). */
  local: boolean;
  /** Nom lisible du modèle (« Magistra Standard ») utilisé quand il n'est pas installé localement. */
  modelLabel?: string;
  /** Destinataire des conseils ('poste' par défaut). */
  recipient?: ErrorRecipient;
  /** API du serveur : 'openai' (/v1, par défaut) ou 'ollama' (API native, adresse sans /v1). */
  api?: 'openai' | 'ollama';
  /** Nature de l'adresse du serveur (conseil « adresse locale injoignable depuis Vercel »). Jamais affichée. */
  addressKind?: AddressKind | null;
  /** Fuseau horaire de l'heure de reprise d'un quota (défaut Europe/Paris). */
  timeZone?: string;
  /** Horloge (tests). */
  now?: () => number;
}

const CONTEXT_RE = /context length|maximum context|context size|context window|too many tokens|prompt is too long|input is too long|exceeds? (the )?(max|available|model)|reduce the length/;
// Formats d'Ollama (llama-server, v0.34, liste outOfMemorySubstrings de llm/status.go) compris : « out-of-memory »,
// « out of device memory », « vk_error_out_of_device_memory », « ErrorOutOfMemory », « allocation failed »,
// « failed to reserve graph », « hipMalloc failed », et « unable to load full model on GPU » (ordonnanceur).
const MEMORY_RE = /out[ _-]?of[ _-]?(device[ _-]?)?memory|\boom\b|requires more system memory|insufficient memory|not enough memory|cudamalloc|hipmalloc|allocation failed|failed to reserve graph|unable to load full model|unable to allocate|failed to allocate|memory allocation/;
const MODEL_RE = /model\b.*\bnot found|model\b.*does not exist|unknown model|no such model|model .*not (available|loaded)|try pulling it|invalid model|not a valid model|invalid_model|model_not_found|model[^.]{0,60}not supported/;
const MODEL_CODES = ['invalid_model', 'model_not_found', 'model_not_available'];
const OUTDATED_RE = /requires a newer version of ollama|newer version of ollama|unknown model architecture|unsupported model architecture/;
// Quota « dur » : il ne se rétablit pas en quelques secondes (quota du jour, crédits, facturation, Cloudflare 4006).
const HARD_QUOTA_RE = /per[ _-]?day|daily|credits?\b|free-models-per|\brpd\b|\btpd\b|insufficient_quota|exceeded your (monthly|current|daily)|billing|payment required|neurons/;
const HARD_QUOTA_CODES = ['4006', 'insufficient_quota'];
// Mention générique d'un quota : bloquante seulement si le serveur ne promet pas une reprise rapide.
const QUOTA_WORD_RE = /quota|resource[ _]?exhausted/;
const TPM_RE = /tokens per minute|\(tpm\)|tokens_per_minute/;

/**
 * Sujet grammatical d'une phrase à partir d'un libellé :
 * « Serveur d'IA » → « Le serveur d'IA » ; « Serveur universitaire » → « Le serveur universitaire » ;
 * « Le moteur IA local » → inchangé ; « OVHcloud AI Endpoints » → « Le serveur d'IA (OVHcloud AI Endpoints) ».
 */
export function aiSubject(label: string | undefined): string {
  const l = (label ?? '').trim();
  if (!l) return "Le serveur d'IA";
  if (/^(le|la|les|un|une|votre|notre|mon|ma|ce|cet|cette)\s/i.test(l) || /^l['’]/i.test(l)) return l[0].toUpperCase() + l.slice(1);
  if (/^(serveur|service|moteur)\b/i.test(l)) return `Le ${lowerFirst(l)}`;
  return l.includes('(') ? `Le serveur d'IA « ${l} »` : `Le serveur d'IA (${l})`;
}

/** Complément introduit par « de » : « du serveur d'IA », « de la plateforme », « de l'IA »… */
function ofSubject(subject: string): string {
  const s = lowerFirst(subject);
  if (s.startsWith('le ')) return `du ${s.slice(3)}`;
  if (s.startsWith('les ')) return `des ${s.slice(4)}`;
  return `de ${s}`;
}

function recipientOf(ctx: HttpErrorContext): ErrorRecipient {
  return ctx.recipient ?? 'poste';
}

function onThisComputer(ctx: HttpErrorContext): boolean {
  return ctx.local && recipientOf(ctx) === 'poste';
}

const ADMIN = "L'administrateur du site doit";

function hasCode(detail: HttpErrorDetail, codes: readonly string[]): boolean {
  return detail.codes.some(c => codes.includes(c));
}

function toDetail(detail: string | HttpErrorDetail): HttpErrorDetail {
  return typeof detail === 'string' ? { message: detail, codes: [] } : detail;
}

function safeTimeZone(tz: string | undefined): string {
  const zone = tz || 'Europe/Paris';
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: zone });
    return zone;
  } catch {
    return 'UTC';
  }
}

/**
 * « dans 40 s », « dans environ une minute », « dans environ 12 minutes », « vers 14 h 05 », « demain vers 2 h 00 »
 * (heure de Paris par défaut). undefined si l'attente est inconnue.
 */
export function formatRetryWhen(waitMs: number | undefined, now: number = Date.now(), timeZone?: string): string | undefined {
  if (waitMs === undefined || !Number.isFinite(waitMs) || waitMs < 0) return undefined;
  const seconds = Math.max(1, Math.ceil(waitMs / 1_000));
  if (seconds < 60) return `dans ${seconds} s`;
  if (seconds <= 90) return 'dans environ une minute';
  if (seconds < 3_600) return `dans environ ${Math.ceil(seconds / 60)} minutes`;
  const zone = safeTimeZone(timeZone);
  const target = new Date(now + waitMs);
  const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(target);
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
  const minute = parts.find(p => p.type === 'minute')?.value ?? '00';
  const day = (d: Date) => new Intl.DateTimeFormat('fr-FR', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const today = day(new Date(now));
  const tomorrow = day(new Date(now + 86_400_000));
  const targetDay = day(target);
  const dayText = targetDay === today ? '' : targetDay === tomorrow ? 'demain ' : `le ${targetDay.slice(0, 5)} `;
  const zoneText = zone === 'Europe/Paris' ? 'heure de Paris' : zone === 'UTC' ? 'heure UTC' : `heure ${zone}`;
  return `${dayText}vers ${hour} h ${minute} (${zoneText})`;
}

function quotaError(message: string, retryAfterMs?: number): MagistraError {
  return new MagistraError('AI_QUOTA_EXCEEDED', message, retryAfterMs !== undefined ? { retryAfterMs } : undefined);
}

/**
 * Traduit une erreur HTTP d'un serveur d'IA en message compréhensible.
 * `detail` : message brut (chaîne) ou détail complet (codes, Retry-After) lu par readErrorDetail.
 * Le détail technique sert uniquement au diagnostic : il n'est jamais montré.
 */
export function mapHttpError(status: number, detail: string | HttpErrorDetail, ctx: HttpErrorContext): MagistraError {
  const info = toDetail(detail);
  const d = `${info.message} ${info.codes.join(' ')}`.toLowerCase();
  const S = aiSubject(ctx.label);
  const s = lowerFirst(S);
  const admin = recipientOf(ctx) === 'administrateur';
  const here = onThisComputer(ctx);
  const now = ctx.now?.() ?? Date.now();

  if (status === 401 || status === 403) {
    return new MagistraError('AI_AUTH_FAILED', here
      ? `${S} a refusé l'accès : vérifiez la clé d'accès dans les réglages.`
      : admin
        ? `${S} a refusé l'accès (clé d'accès refusée). ${ADMIN} vérifier AI_API_KEY.`
        : `${S} a refusé l'accès (clé d'accès refusée). Vérifiez la clé dans les réglages ou contactez l'administrateur de ce serveur.`);
  }

  if (status === 402) {
    return quotaError(`Les crédits ${ofSubject(S)} sont épuisés. ${admin
      ? `${ADMIN} les recharger ou choisir un autre service d'IA.`
      : 'Rechargez-les auprès du fournisseur ou choisissez un autre serveur dans les réglages.'}`);
  }

  if (status === 429) {
    const wait = info.retryAfterMs;
    const when = formatRetryWhen(wait, now, ctx.timeZone);
    const shortWait = wait !== undefined && wait <= SHORT_RETRY_AFTER_MS;
    if (HARD_QUOTA_RE.test(d) || hasCode(info, HARD_QUOTA_CODES) || (QUOTA_WORD_RE.test(d) && !shortWait)) {
      return quotaError(`Le quota d'utilisation ${ofSubject(S)} est atteint : réessayez ${when ?? 'plus tard'}.`, wait);
    }
    if (wait !== undefined && wait > SHORT_RETRY_AFTER_MS) {
      return quotaError(`${S} limite le nombre de demandes (offre gratuite ou quota) : réessayez ${when}.`, wait);
    }
    return new MagistraError('AI_BUSY', `${S} est surchargé (trop de demandes en même temps). Réessayez dans quelques instants.`,
      wait !== undefined ? { retryAfterMs: wait } : undefined);
  }

  if (status === 413 && (TPM_RE.test(d) || hasCode(info, ['rate_limit_exceeded']))) {
    return quotaError(`La demande dépasse la limite de tokens par minute ${ofSubject(S)} (offre gratuite). ${admin
      ? `${ADMIN} réduire AI_MAX_OUTPUT_TOKENS et AI_CONTEXT_TOKENS.`
      : 'Raccourcissez la demande ou retirez des documents.'}`);
  }
  if (status === 413 || CONTEXT_RE.test(d)) return new MagistraError('CONTEXT_TOO_LARGE');
  if (MEMORY_RE.test(d)) return new MagistraError('OUT_OF_MEMORY');

  if (OUTDATED_RE.test(d) || (status === 412 && ctx.api === 'ollama')) {
    return new MagistraError('ENGINE_OUTDATED', here
      ? defaultMessage('ENGINE_OUTDATED')
      : admin
        ? `Le moteur Ollama ${ofSubject(S)} est trop ancien pour ce modèle. ${ADMIN} mettre à jour Ollama.`
        : `${S} utilise une version d'Ollama trop ancienne pour ce modèle : demandez sa mise à jour à son administrateur.`);
  }

  if (MODEL_RE.test(d) || hasCode(info, MODEL_CODES) || (status === 404 && /\bmodel\b/.test(d))) {
    return new MagistraError('MODEL_NOT_INSTALLED', here
      ? `Le modèle ${ctx.modelLabel ?? ctx.model} n'est pas encore installé.`
      : admin
        ? `Le modèle « ${ctx.model} » n'est pas disponible sur ${s}. ${ADMIN} vérifier AI_MODEL${ctx.api === 'ollama' ? ` (ou installer le modèle : ollama pull ${ctx.model})` : ''}.`
        : `Le modèle « ${ctx.model} » n'est pas disponible sur ${s} : vérifiez son nom dans les réglages.`);
  }

  if (status === 404) {
    const hint = ctx.api === 'ollama'
      ? "pour Ollama (API native), l'adresse ne se termine pas par /v1"
      : "elle se termine généralement par /v1";
    return new MagistraError('AI_BAD_RESPONSE', admin
      ? `${S} ne répond pas à cette adresse (service introuvable). ${ADMIN} vérifier AI_BASE_URL : ${hint}.`
      : `${S} ne répond pas à cette adresse (service introuvable). Vérifiez l'adresse du serveur dans les réglages : ${hint}.`);
  }
  if (status === 504 || status === 408) {
    return new MagistraError('AI_TIMEOUT', `${S} n'a pas répondu à temps. Réessayez dans quelques instants.`);
  }
  if (status >= 500) {
    return new MagistraError('AI_SERVER_UNAVAILABLE', here
      ? `${S} a rencontré une erreur. Réessayez dans quelques instants.`
      : `${S} est momentanément indisponible. Réessayez dans quelques instants.`);
  }
  return new MagistraError('AI_BAD_RESPONSE');
}

/** Serveur momentanément indisponible (panne passagère : nouvel essai automatique possible). */
export function unavailableError(ctx: HttpErrorContext, cause?: unknown): MagistraError {
  if (onThisComputer(ctx)) return new MagistraError('ENGINE_NOT_RUNNING', undefined, { cause });
  return new MagistraError('AI_SERVER_UNAVAILABLE', `${aiSubject(ctx.label)} est momentanément indisponible. Réessayez dans quelques instants.`, { cause });
}

/**
 * Traduit une panne réseau (fetch rejeté) :
 *  - moteur de CET ordinateur (poste + local) : ENGINE_NOT_RUNNING (« Moteur IA non démarré. ») ;
 *  - connexion refusée, nom introuvable, réseau inaccessible, port interdit, certificat refusé : AI_SERVER_UNREACHABLE,
 *    qui n'est PAS réessayé automatiquement (l'adresse ou le serveur est en cause, pas une surcharge) ;
 *  - autre (coupure, réinitialisation, délai de connexion) : AI_SERVER_UNAVAILABLE (passager).
 */
export function mapNetworkError(err: unknown, ctx: HttpErrorContext): MagistraError {
  if (onThisComputer(ctx)) return new MagistraError('ENGINE_NOT_RUNNING', undefined, { cause: err });
  const kind = networkFailureKind(err);
  const S = aiSubject(ctx.label);
  const admin = recipientOf(ctx) === 'administrateur';
  if (kind === 'tls') {
    return new MagistraError('AI_SERVER_UNREACHABLE', `Connexion sécurisée impossible avec ${lowerFirst(S)} (certificat HTTPS refusé). ${admin
      ? `${ADMIN} vérifier AI_BASE_URL et le certificat du serveur d'IA.`
      : "Vérifiez l'adresse du serveur dans les réglages."}`, { cause: err });
  }
  if (kind === 'refused' || kind === 'dns' || kind === 'unreachable' || kind === 'bad_port') {
    const reason = kind === 'refused' ? 'connexion refusée'
      : kind === 'dns' ? 'nom introuvable'
        : kind === 'bad_port' ? 'port réservé, interdit par sécurité : choisissez un autre port' : 'réseau inaccessible';
    const localHint = admin && (ctx.addressKind === 'loopback' || ctx.addressKind === 'private')
      ? " Une adresse locale ou privée (127.0.0.1, 192.168.…, .local) n'est pas joignable depuis un hébergement en ligne comme Vercel."
      : '';
    return new MagistraError('AI_SERVER_UNREACHABLE', admin
      ? `${S} est injoignable à l'adresse configurée (${reason}). ${ADMIN} vérifier AI_BASE_URL : l'adresse doit être joignable depuis le serveur Magistra.${localHint}`
      : `${S} est injoignable à l'adresse configurée (${reason}) : vérifiez l'adresse dans les réglages et que ce serveur est allumé.`, { cause: err });
  }
  return unavailableError(ctx, err);
}

/** Délai dépassé sur l'ordinateur : ce n'est pas « le serveur d'IA » qui est en cause, mais le moteur local. */
export const LOCAL_TIMEOUT_MESSAGE =
  'Le moteur IA local met trop de temps à répondre. Réessayez, choisissez un modèle plus léger (Magistra Léger) ou retirez des documents.';
export const LOCAL_BAD_RESPONSE_MESSAGE =
  'Réponse inattendue du moteur IA local. Réessayez ; si le problème persiste, redémarrez Magistra.';

/** Remplace les messages génériques « serveur d'IA » par des messages propres au moteur local. */
export function localizeEngineError(err: MagistraError, local: boolean): MagistraError {
  if (!local || err.message !== defaultMessage(err.code)) return err;
  if (err.code === 'AI_TIMEOUT') return new MagistraError('AI_TIMEOUT', LOCAL_TIMEOUT_MESSAGE, { cause: err });
  if (err.code === 'AI_BAD_RESPONSE') return new MagistraError('AI_BAD_RESPONSE', LOCAL_BAD_RESPONSE_MESSAGE, { cause: err });
  return err;
}

/** Délai dépassé (générique AI_TIMEOUT) avec le sujet du bon serveur. */
export function timeoutError(ctx: HttpErrorContext): MagistraError {
  if (onThisComputer(ctx)) return new MagistraError('AI_TIMEOUT', LOCAL_TIMEOUT_MESSAGE);
  return new MagistraError('AI_TIMEOUT', `${aiSubject(ctx.label)} n'a pas répondu à temps. Réessayez dans quelques instants.`);
}

/** Avertissement « état non vérifié » (AI_STATUS_UNKNOWN), non bloquant. */
export function statusUnknown(ctx: HttpErrorContext, why: 'timeout' | 'no-list' | 'empty-list'): { code: ErrorCode; message: string } {
  const S = aiSubject(ctx.label);
  const cause = why === 'timeout'
    ? `${S} a mis trop de temps à répondre à la vérification`
    : why === 'no-list' ? `${S} ne fournit pas la liste de ses modèles` : `${S} ne liste aucun modèle`;
  return { code: 'AI_STATUS_UNKNOWN', message: `${cause} : son état n'a pas pu être vérifié. La génération reste possible.` };
}
