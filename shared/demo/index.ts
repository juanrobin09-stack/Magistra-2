// Mode démonstration : exemples pré-rédigés (aucune IA), présentés comme tels.
// Les contenus sont définis dans ./content.ts ; ce module les restitue en flux, comme une vraie génération.

import { getToolLabel } from '../catalog.js';
import { MagistraError } from '../errors.js';
import { isSuperieur } from '../levels.js';
import type { GenerationEvent, GenerationRequest } from '../types.js';
import { DEMO_CONTENT, type DemoExample } from './content.js';

export const DEMO_NOTICE =
  "Mode démonstration : ceci est un exemple pré-rédigé, identique quels que soient le sujet et les paramètres saisis (nombre d'appréciations, durée…). Il n'a pas été généré par une IA et n'utilise pas vos documents.";

export function getDemoExample(req: Pick<GenerationRequest, 'type' | 'niveau'>): DemoExample {
  const entry = DEMO_CONTENT[req.type];
  return isSuperieur(req.niveau) && entry.superieur ? entry.superieur : entry.scolaire;
}

/**
 * Application Windows, IA pas encore prête (« Voir un exemple pré-rédigé ») : même exemple, sans parler d'un « mode
 * démonstration » qui n'existe pas dans l'application.
 */
export const EXAMPLE_NOTICE =
  "Exemple pré-rédigé : ce texte est identique quels que soient le sujet et les paramètres saisis (nombre d'appréciations, durée…). Il n'a pas été généré par une IA et n'utilise pas vos documents.";

export async function* runDemoGeneration(
  req: GenerationRequest,
  options: { signal?: AbortSignal; delayMs?: number; notice?: string } = {},
): AsyncGenerator<GenerationEvent> {
  const example = getDemoExample(req);
  const content = `> ${options.notice ?? DEMO_NOTICE}\n> Exemple : « ${example.subject} » (${example.level}).\n\n${example.markdown.trim()}\n`;
  yield { type: 'sources', sources: [], internetUsed: false };
  yield { type: 'status', stage: 'generating', message: `Affichage de l'exemple « ${getToolLabel(req.type, req.niveau)} »…` };
  const delay = options.delayMs ?? 12;
  const parts = content.match(/[\s\S]{1,48}/g) ?? [content];
  for (const part of parts) {
    if (options.signal?.aborted) {
      const e = new MagistraError('GENERATION_ABORTED');
      yield { type: 'error', code: e.code, message: e.message, retryable: true };
      return;
    }
    if (delay > 0) await new Promise(r => setTimeout(r, delay));
    yield { type: 'delta', text: part };
  }
  yield { type: 'done', content, sources: [], truncated: false, internetUsed: false, saved: false, model: 'démonstration' };
}
