// Brouillon de l'assistant d'accueil : profil en cours de saisie et étape courante, gardés dans le sessionStorage de
// l'onglet (jamais envoyés nulle part). Dans l'application Windows, lire une page légale quitte l'assistant (pas de
// nouvel onglet) : sans brouillon, le profil saisi serait perdu au retour.
//
// Seuls les champs du profil, l'étape et le propriétaire (compte connecté, null sans compte) sont écrits. Tout ce qui
// est relu est revalidé comme à la saisie : un contenu altéré ou étranger ne donne jamais plus qu'un brouillon vide,
// et le brouillon d'un autre compte n'est jamais restitué (poste partagé).

import { isMatiere, type Matiere } from '@shared/catalog';
import { ALL_NIVEAUX, NIVEAUX, isNiveau, type NiveauScolaire } from '@shared/levels';

export const ONBOARDING_DRAFT_KEY = 'magistra_onboarding_draft';

/** Longueurs maximales des champs texte (celles des champs de saisie). */
export const DRAFT_LIMITS = { displayName: 80, etablissement: 160, discipline: 120 } as const;

/** Un brouillon relu plus gros que ceci n'est pas le nôtre (le plus gros possible fait moins de 4 Ko). */
const MAX_STORED_CHARS = 16_384;

export interface ProfileDraft {
  displayName: string;
  etablissement: string;
  cycle: string;
  niveaux: NiveauScolaire[];
  /** Matière choisie explicitement (null : matière par défaut du niveau). */
  matiereChoisie: Matiere | null;
  matiereSecondaire: Matiere | null;
  discipline: string;
}

export interface SavedOnboarding {
  draft: ProfileDraft;
  step: number;
}

export function cycleOf(niveau: NiveauScolaire | undefined): string {
  if (!niveau) return '';
  return Object.entries(NIVEAUX).find(([, g]) => g.niveaux.some(n => n.value === niveau))?.[0] ?? '';
}

/** Niveaux dans l'ordre officiel (le premier sert de référence pour les matières). */
export function sortNiveaux(niveaux: NiveauScolaire[]): NiveauScolaire[] {
  return [...new Set(niveaux)].sort((a, b) => ALL_NIVEAUX.indexOf(a) - ALL_NIVEAUX.indexOf(b));
}

/** Texte d'un champ : caractères de contrôle neutralisés, longueur bornée (sans couper une paire de substitution). */
function textField(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, max);
  return /[\ud800-\udbff]$/.test(text) ? text.slice(0, -1) : text;
}

function restore(value: unknown, owner: string | null, lastStep: number): SavedOnboarding | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.owner !== owner) return null;
  const cycle = typeof v.cycle === 'string' && Object.keys(NIVEAUX).includes(v.cycle) ? v.cycle : '';
  const niveaux = Array.isArray(v.niveaux) ? sortNiveaux(v.niveaux.filter(isNiveau).filter(n => cycleOf(n) === cycle)) : [];
  const step = typeof v.step === 'number' && Number.isInteger(v.step) ? Math.min(Math.max(v.step, 0), lastStep) : 0;
  return {
    step,
    draft: {
      displayName: textField(v.displayName, DRAFT_LIMITS.displayName),
      etablissement: textField(v.etablissement, DRAFT_LIMITS.etablissement),
      cycle,
      niveaux,
      matiereChoisie: isMatiere(v.matiereChoisie) ? v.matiereChoisie : null,
      matiereSecondaire: isMatiere(v.matiereSecondaire) ? v.matiereSecondaire : null,
      discipline: textField(v.discipline, DRAFT_LIMITS.discipline),
    },
  };
}

function parse(raw: string, owner: string | null, lastStep: number): SavedOnboarding | null {
  if (raw.length > MAX_STORED_CHARS) return null;
  try {
    return restore(JSON.parse(raw), owner, lastStep);
  } catch {
    return null;
  }
}

/**
 * Brouillon enregistré pour ce propriétaire (identifiant du compte connecté, null sans compte), ou null. Un contenu
 * illisible, altéré ou d'un autre compte est effacé. `lastStep` : dernière étape de l'assistant.
 */
export function loadOnboardingDraft(owner: string | null, lastStep: number): SavedOnboarding | null {
  try {
    const raw = sessionStorage.getItem(ONBOARDING_DRAFT_KEY);
    if (raw === null) return null;
    const saved = parse(raw, owner, lastStep);
    if (!saved) clearOnboardingDraft();
    return saved;
  } catch {
    return null;
  }
}

export function saveOnboardingDraft(owner: string | null, draft: ProfileDraft, step: number): void {
  try {
    sessionStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify({
      owner,
      step,
      displayName: draft.displayName,
      etablissement: draft.etablissement,
      cycle: draft.cycle,
      niveaux: draft.niveaux,
      matiereChoisie: draft.matiereChoisie,
      matiereSecondaire: draft.matiereSecondaire,
      discipline: draft.discipline,
    }));
  } catch {
    // Stockage de session indisponible ou plein : l'assistant fonctionne, sans brouillon.
  }
}

export function clearOnboardingDraft(): void {
  try {
    sessionStorage.removeItem(ONBOARDING_DRAFT_KEY);
  } catch {
    // Stockage de session indisponible : rien à effacer.
  }
}
