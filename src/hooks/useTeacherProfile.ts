import type { NiveauScolaire, Matiere } from '@/types';

export interface TeacherProfile {
  displayName: string;
  etablissement: string;
  cycle: string;
  niveaux: NiveauScolaire[];
  matierePrincipale: Matiere;
  matiereSecondaire?: Matiere;
}

export function getTeacherProfile(): TeacherProfile | null {
  try {
    const raw = localStorage.getItem('magistra_teacher_profile');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function isOnboardingDone(): boolean {
  try {
    return localStorage.getItem('magistra_onboarding_done') === 'true';
  } catch {
    return false;
  }
}

export function resetOnboarding(): void {
  try {
    localStorage.removeItem('magistra_teacher_profile');
    localStorage.removeItem('magistra_onboarding_done');
  } catch {
    // noop
  }
}
