// Validation du profil enseignant stocké côté serveur.
// Mêmes règles que la validation du profil dans shared/validation.ts (champs connus, tailles
// bornées, listes blanches de niveaux et de matières) ; tout champ inconnu est ignoré.

import { isMatiere } from '../shared/catalog.js';
import { MagistraError } from '../shared/errors.js';
import { isNiveau } from '../shared/levels.js';
import type { TeacherProfile } from '../shared/types.js';
import { REQUEST_LIMITS } from '../shared/validation.js';

const LIMITS = { displayName: 120, etablissement: 200, cycle: 40, niveaux: 40, discipline: REQUEST_LIMITS.discipline };

function text(value: unknown, max: number, field: string, strict: boolean): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    if (strict) throw new MagistraError('INVALID_REQUEST', `Champ « ${field} » du profil invalide.`);
    return undefined;
  }
  // Caractères de contrôle retirés (hors tabulation et retours à la ligne).
  const trimmed = [...value].filter(ch => {
    const code = ch.charCodeAt(0);
    return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
  }).join('').trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) {
    if (strict) throw new MagistraError('INVALID_REQUEST', `Le champ « ${field} » du profil est trop long (${max} caractères maximum).`);
    return trimmed.slice(0, max);
  }
  return trimmed;
}

/**
 * Valide un profil reçu du navigateur (strict = true : lève INVALID_REQUEST)
 * ou relu depuis la base (strict = false : nettoie sans jamais échouer).
 */
export function sanitizeProfile(value: unknown, strict: boolean): TeacherProfile | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    if (strict) throw new MagistraError('INVALID_REQUEST', 'Profil invalide.');
    return null;
  }
  const p = value as Record<string, unknown>;
  if (strict && p.niveaux !== undefined && !Array.isArray(p.niveaux)) {
    throw new MagistraError('INVALID_REQUEST', 'Champ « niveaux » du profil invalide.');
  }
  const niveaux = Array.isArray(p.niveaux) ? [...new Set(p.niveaux.filter(isNiveau))].slice(0, LIMITS.niveaux) : [];
  const profile: TeacherProfile = {
    displayName: text(p.displayName, LIMITS.displayName, 'nom', strict) ?? '',
    etablissement: text(p.etablissement, LIMITS.etablissement, 'établissement', strict) ?? '',
    cycle: text(p.cycle, LIMITS.cycle, 'cycle', strict) ?? '',
    niveaux,
    matierePrincipale: isMatiere(p.matierePrincipale) ? p.matierePrincipale : 'autre',
  };
  if (isMatiere(p.matiereSecondaire)) profile.matiereSecondaire = p.matiereSecondaire;
  const discipline = text(p.discipline, LIMITS.discipline, 'spécialité', strict);
  if (discipline) profile.discipline = discipline;
  return profile;
}
