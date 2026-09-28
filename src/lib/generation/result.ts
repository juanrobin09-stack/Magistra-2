// Présentation du résultat : en-tête, document d'export, statut d'enregistrement.
// Tout est calculé à partir de l'INSTANTANÉ de la requête (jamais du formulaire courant).

import { getMatiereEmoji, getMatiereLabel, getToolInfo } from '@shared/catalog';
import { getNiveauLabel } from '@shared/levels';
import type { GenerationRequest } from '@shared/types';
import type { RuntimeMode } from '@/lib/runtime/types';
import type { GenerationWarning, DoneEvent } from './state';

export interface ResultHeading {
  icon: string;
  emoji: string;
  toolLabel: string;
  niveauLabel: string;
  matiereLabel: string;
  subject: string;
  /** Titre utilisé pour les exports (nom de fichier, titre du PDF). */
  title: string;
}

export function resultHeading(req: GenerationRequest): ResultHeading {
  const tool = getToolInfo(req.type, req.niveau);
  const niveauLabel = getNiveauLabel(req.niveau);
  const matiereLabel = req.discipline ? `${getMatiereLabel(req.matiere)} (${req.discipline})` : getMatiereLabel(req.matiere);
  const subject = req.sujet.trim();
  return {
    icon: tool.icon,
    emoji: getMatiereEmoji(req.matiere),
    toolLabel: tool.label,
    niveauLabel,
    matiereLabel,
    subject,
    title: subject ? `${tool.label} — ${subject}` : `${tool.label} — ${getMatiereLabel(req.matiere)}, ${niveauLabel}`,
  };
}

/** Même forme que ExportDoc (@/lib/export). */
export interface ExportDocInput {
  title: string;
  content: string;
  meta?: { type?: string; niveau?: string; matiere?: string; date?: string };
}

export function buildExportDoc(req: GenerationRequest, content: string, date: Date = new Date()): ExportDocInput {
  const h = resultHeading(req);
  return {
    title: h.title,
    content,
    meta: {
      type: h.toolLabel,
      niveau: h.niveauLabel,
      matiere: h.matiereLabel,
      date: date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
    },
  };
}

export interface SaveStatus {
  saved: boolean;
  message: string;
  reason?: string;
}

export const SAVED_MESSAGE = "Enregistré dans l'historique";
export const SAVED_DEMO_MESSAGE = "Enregistré dans l'historique de démonstration (ce navigateur)";
export const NOT_SAVED_MESSAGE = 'Non enregistré';

/** « Enregistré » n'est affiché que si le moteur a réellement confirmé l'enregistrement (done.saved). */
export function saveStatus(result: DoneEvent, warnings: GenerationWarning[], mode: RuntimeMode): SaveStatus {
  if (result.saved) return { saved: true, message: mode === 'demo' ? SAVED_DEMO_MESSAGE : SAVED_MESSAGE };
  const storage = warnings.find(w => w.code === 'STORAGE_ERROR');
  return {
    saved: false,
    message: NOT_SAVED_MESSAGE,
    reason: storage?.message ?? "Ce contenu n'a pas été ajouté à l'historique : copiez-le ou exportez-le pour le conserver.",
  };
}
