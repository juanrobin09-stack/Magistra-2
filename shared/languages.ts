// Matières de langue : langues vivantes étrangères et langues anciennes (LCA).
// Le contenu destiné aux élèves s'y écrit dans la langue étudiée, pas en français : les consignes du modèle doivent
// le dire explicitement (un petit modèle suit sinon l'exemple en français d'un format ou le sujet saisi en français).

import type { Matiere } from './catalog.js';

/** Langues vivantes étrangères. */
export const LANGUES_VIVANTES: readonly Matiere[] = ['anglais', 'espagnol', 'allemand', 'italien', 'portugais', 'chinois', 'arabe'];

/** Langues et cultures de l'Antiquité. */
export const LANGUES_ANCIENNES: readonly Matiere[] = ['latin', 'grec'];

/** Nom de la langue en toutes lettres, quand il diffère de l'identifiant (le libellé du grec porte « (LCA) »). */
const LANGUAGE_NAMES: Partial<Record<Matiere, string>> = { grec: 'grec ancien' };

export interface TargetLanguage {
  kind: 'vivante' | 'ancienne';
  /** Nom de la langue, en minuscules (« anglais », « grec ancien »). */
  name: string;
}

/** Langue étudiée dans cette matière ; null pour une matière qui ne porte pas sur une langue étrangère ou ancienne. */
export function targetLanguage(matiere: Matiere): TargetLanguage | null {
  const kind = LANGUES_VIVANTES.includes(matiere) ? 'vivante' : LANGUES_ANCIENNES.includes(matiere) ? 'ancienne' : null;
  return kind ? { kind, name: LANGUAGE_NAMES[matiere] ?? matiere } : null;
}

export function isLangueVivante(matiere: Matiere): boolean {
  return LANGUES_VIVANTES.includes(matiere);
}

export function isLangueAncienne(matiere: Matiere): boolean {
  return LANGUES_ANCIENNES.includes(matiere);
}
