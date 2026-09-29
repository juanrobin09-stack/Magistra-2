// État du moteur transmis au site (GET /v1/status) et textes rendus au navigateur par le connecteur local.
// Module PUR Node (aucun import d'Electron).
//
// Rien de ce qui part vers le site ne contient d'adresse, de port, de chemin de fichier, de nom ni de réglage du
// moteur : le libellé d'un moteur distant (souvent son nom d'hôte) est remplacé par un libellé neutre ; les codes du
// MOTEUR (installé, démarré, à jour, modèle présent) reçoivent toujours un texte neutre pour le site
// (LOCAL_ENGINE_SITE_MESSAGES : les messages de l'application pour ces codes citent le moteur, sa version, son dossier
// d'installation, un extrait de son journal ou des boutons de l'assistant de configuration) ; tout autre message qui
// ressemble à une adresse, à un port, à un chemin ou qui nomme le moteur est remplacé par le message générique de son
// code.

import { defaultMessage, type ErrorCode } from '../../shared/errors.js';
import { LOCAL_ENGINE_SITE_MESSAGES, type ConnectorStatus } from '../../shared/localConnector.js';
import type { AINotice, Capabilities, GenerationEvent } from '../../shared/types.js';

/** Libellé d'un moteur qui n'est pas sur cet ordinateur (son nom d'hôte n'est jamais transmis). */
export const REMOTE_ENGINE_LABEL = 'Serveur d’IA distant';
const MAX_TEXT = 600;
const MAX_LABEL = 120;

/**
 * Motifs qui ne doivent jamais sortir de l'application : URL (tout schéma), boucle locale, adresse IP, port (« :11434 »,
 * « le port 11434 »), chemins Windows (C:\…, \\serveur\…, ~\…), Unix (/home/…, ~/…) ou dossier d'installation,
 * nom du moteur (Ollama, ollama.exe : jamais affiché sur le site).
 */
const LEAK_PATTERNS: readonly RegExp[] = [
  /\b[a-z][a-z0-9+.-]{1,20}:\/\//i,
  /\blocalhost\b/i,
  /\b\d{1,3}(?:\.\d{1,3}){3}\b/,
  /\[?[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\]?(?::\d+)?/i,
  /[A-Za-z0-9\])]:\d{2,5}\b/,
  /\bport\s+\d{2,5}\b/i,
  /\b[A-Za-z]:[\\/]/,
  /\\\\[^\s\\]+\\/,
  /(?:^|[\s("'«])\/(?:[\w.-]+\/)+[\w.-]*/,
  /~[\\/]/,
  /program\s*files/i,
  /ollama/i,
];

/** Dernier recours quand le message générique du code lui-même ne peut pas partir. */
const GENERIC_ENGINE_MESSAGE = "L'intelligence locale de Magistra a rencontré un problème : ouvrez l'application Magistra pour en voir la cause.";

/** Vrai si le texte peut être transmis tel quel au site (aucune adresse, aucun port, aucun chemin). */
export function isShareableText(text: string): boolean {
  return LEAK_PATTERNS.every(re => !re.test(text));
}

/**
 * Message transmis au site pour ce code : texte neutre pour les codes du moteur (toujours), sinon le message d'origine
 * s'il est sûr, sinon le message générique du code (ou, s'il nomme lui-même le moteur, un texte générique).
 */
export function publicMessage(code: ErrorCode, message: string): string {
  const neutral = LOCAL_ENGINE_SITE_MESSAGES[code];
  if (neutral) return neutral;
  const text = typeof message === 'string' ? message.trim() : '';
  if (text && text.length <= MAX_TEXT && isShareableText(text)) return text;
  const fallback = defaultMessage(code);
  return isShareableText(fallback) ? fallback : GENERIC_ENGINE_MESSAGE;
}

export function publicNotice(notice: AINotice | undefined): AINotice | undefined {
  return notice ? { code: notice.code, message: publicMessage(notice.code, notice.message) } : undefined;
}

/** Évènement de génération tel qu'envoyé au site : messages d'erreur et d'avertissement filtrés. */
export function publicEvent(event: GenerationEvent): GenerationEvent {
  if (event.type === 'error') return { ...event, message: publicMessage(event.code, event.message) };
  if (event.type === 'warning') return { ...event, message: publicMessage(event.code, event.message) };
  return event;
}

/**
 * GET /v1/status à partir des capacités de l'application (GenerationManager.capabilities(), qui décrit le moteur
 * actif). Moteur non local (application réglée sur un serveur distant) : jamais prêt pour le site
 * (LOCAL_ENGINE_REMOTE), libellé neutre.
 */
export function buildConnectorStatus(input: { version: string; capabilities: Capabilities; busy: boolean }): ConnectorStatus {
  const caps = input.capabilities;
  const local = caps.privacy.level === 'local';
  const label = local && caps.engineLabel && caps.engineLabel.length <= MAX_LABEL && isShareableText(caps.engineLabel)
    ? caps.engineLabel
    : local ? 'IA locale' : REMOTE_ENGINE_LABEL;
  const notReady = !local
    ? { code: 'LOCAL_ENGINE_REMOTE' as const, message: defaultMessage('LOCAL_ENGINE_REMOTE') }
    : caps.ready ? undefined : publicNotice(caps.notReady ?? { code: 'AI_SERVER_UNAVAILABLE', message: defaultMessage('AI_SERVER_UNAVAILABLE') });
  const warning = local && caps.ready ? publicNotice(caps.aiWarning) : undefined;
  return {
    version: input.version,
    engine: {
      ready: local && caps.ready,
      local,
      label,
      ...(notReady ? { notReady } : {}),
      ...(warning ? { warning } : {}),
    },
    capabilities: {
      maxDocumentChars: caps.maxDocumentChars,
      research: { ...caps.research },
    },
    busy: input.busy,
  };
}
