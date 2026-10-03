// Identité visuelle des outils (icône et couleur), commune au tableau de bord, à la barre latérale (« Outils
// pédagogiques »), à l'en-tête de la page Générer et au site vitrine.

import {
  BookOpen, CalendarRange, ClipboardCheck, FileText, Layers, Mail, MessageSquare, NotebookPen, PenLine, SpellCheck2, Users,
  type LucideIcon,
} from 'lucide-react';
import type { TypeContenu } from '@shared/catalog';

export const TOOL_ICONS: Record<TypeContenu, LucideIcon> = {
  cours: BookOpen,
  exercices: PenLine,
  evaluation: ClipboardCheck,
  sequence: Layers,
  fiche_prep: FileText,
  appreciations: MessageSquare,
  progression: CalendarRange,
  differenciation: Users,
  lettre_parents: Mail,
  cahier_journal: NotebookPen,
  corrige: SpellCheck2,
};

export const TOOL_STYLE: Record<TypeContenu, { iconBg: string; iconColor: string }> = {
  cours: { iconBg: 'bg-violet-500/10', iconColor: 'text-violet-300' },
  exercices: { iconBg: 'bg-emerald-500/10', iconColor: 'text-emerald-300' },
  evaluation: { iconBg: 'bg-amber-500/10', iconColor: 'text-amber-300' },
  sequence: { iconBg: 'bg-pink-500/10', iconColor: 'text-pink-300' },
  fiche_prep: { iconBg: 'bg-sky-500/10', iconColor: 'text-sky-300' },
  appreciations: { iconBg: 'bg-blue-500/10', iconColor: 'text-blue-300' },
  progression: { iconBg: 'bg-indigo-500/10', iconColor: 'text-indigo-300' },
  differenciation: { iconBg: 'bg-teal-500/10', iconColor: 'text-teal-300' },
  lettre_parents: { iconBg: 'bg-rose-500/10', iconColor: 'text-rose-300' },
  cahier_journal: { iconBg: 'bg-orange-500/10', iconColor: 'text-orange-300' },
  corrige: { iconBg: 'bg-cyan-500/10', iconColor: 'text-cyan-300' },
};
