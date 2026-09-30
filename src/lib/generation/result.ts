// Présentation du résultat : en-tête, document d'export, statut d'enregistrement.
// Tout est calculé à partir de l'INSTANTANÉ de la requête (jamais du formulaire courant).

import { getMatiereEmoji, getMatiereLabel, getToolInfo } from '@shared/catalog';
import type { DemoExample } from '@shared/demo/content';
import { getNiveauLabel } from '@shared/levels';
import type { GenerationRequest } from '@shared/types';
import type { RuntimeMode } from '@/lib/runtime/types';
import type { GenerationWarning, DoneEvent } from './state';

// ─── Document entier entouré d'un bloc de code ─────────────────────────────

/**
 * Certains modèles (surtout les petits) entourent TOUT le document d'un bloc « ```markdown … ``` » :
 * sans correction, le cours s'afficherait comme du code brut. La règle est celle du cœur (shared/markdownFence.ts),
 * que la pipeline applique aussi avant de vérifier les citations : une seule implémentation pour l'affichage
 * (y compris pendant le flux, avant l'arrivée de la clôture), l'historique et les citations.
 */
export { unwrapDocumentFence } from '@shared/markdownFence';

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

/** Libellé de l'exemple pré-rédigé à la place de la matière (en-tête, ligne de l'export). */
export const EXAMPLE_HEADING_LABEL = 'Exemple pré-rédigé';

/**
 * En-tête d'un EXEMPLE pré-rédigé (application Windows, IA pas encore prête) : le sujet et le niveau de l'exemple
 * lui-même, jamais ceux saisis par l'enseignant — le texte ne tient pas compte de sa demande ; ni le titre à l'écran,
 * ni celui des exports (nom de fichier, titre et en-têtes du PDF) ne doivent l'y rattacher.
 */
export function exampleResultHeading(req: GenerationRequest, example: Pick<DemoExample, 'subject' | 'level'>): ResultHeading {
  const tool = getToolInfo(req.type, req.niveau);
  return {
    icon: tool.icon,
    emoji: getMatiereEmoji('autre'),
    toolLabel: tool.label,
    niveauLabel: example.level,
    matiereLabel: EXAMPLE_HEADING_LABEL,
    subject: example.subject,
    title: `${tool.label} — ${example.subject} (exemple pré-rédigé)`,
  };
}

/** Même forme que ExportDoc (@/lib/export). */
export interface ExportDocInput {
  title: string;
  content: string;
  meta?: { type?: string; niveau?: string; matiere?: string; date?: string };
}

/** `heading` : en-tête déjà calculé (exemple pré-rédigé : exampleResultHeading), sinon celui de la requête. */
export function buildExportDoc(
  req: GenerationRequest, content: string, date: Date = new Date(), heading: ResultHeading = resultHeading(req),
): ExportDocInput {
  const h = heading;
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
