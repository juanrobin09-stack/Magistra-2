// Couche d'accès abstraite : la même interface sert le web, l'application Windows et la démo.
// Les pages ne savent jamais où sont stockées les données ni quel moteur d'IA est utilisé.

import type { MagistraError } from '@shared/errors';
import type {
  Capabilities, GenerationEvent, GenerationRecord, GenerationRequest, HistoryPage, TeacherProfile, UsageStats,
} from '@shared/types';

/**
 * - 'web'      : site en ligne avec comptes (Clerk) ;
 * - 'personal' : serveur Magistra démarré sur le poste de l'enseignant (npm run dev / npm start), sans compte,
 *                protégé par un code d'accès ; mêmes données et même IA que le site web ;
 * - 'local'    : application Windows (pont Electron) ;
 * - 'demo'     : démonstration (exemples pré-rédigés, stockage du navigateur).
 */
export type RuntimeMode = 'web' | 'personal' | 'local' | 'demo';

/** Modes où les données et l'IA passent par l'API du serveur Magistra. */
export function usesServerApi(mode: RuntimeMode): mode is 'web' | 'personal' {
  return mode === 'web' || mode === 'personal';
}

export interface DataStore {
  readonly kind: RuntimeMode;
  listGenerations(query?: { favoritesOnly?: boolean; cursor?: string; limit?: number }): Promise<HistoryPage>;
  getGeneration(id: string): Promise<GenerationRecord>;
  setFavorite(id: string, value: boolean): Promise<void>;
  deleteGeneration(id: string): Promise<void>;
  getStats(): Promise<UsageStats>;
  getProfile(): Promise<TeacherProfile | null>;
  saveProfile(profile: TeacherProfile | null): Promise<void>;
  /** Supprime toutes les données de l'utilisateur (historique, favoris, profil). */
  clearAllData(): Promise<void>;
}

export interface GenerationClient {
  readonly kind: RuntimeMode;
  capabilities(): Promise<Capabilities>;
  /**
   * Lance une génération en flux. Les évènements arrivent dans l'ordre ;
   * la promesse se résout après l'évènement final (« done » ou « error »).
   */
  generate(request: GenerationRequest, onEvent: (event: GenerationEvent) => void, signal: AbortSignal): Promise<void>;
}

export interface RuntimeUser {
  id: string;
  firstName?: string | null;
  email?: string | null;
}

export type ProfileStatus = 'loading' | 'ready' | 'error';

export interface RuntimeValue {
  mode: RuntimeMode;
  store: DataStore;
  client: GenerationClient;
  user: RuntimeUser | null;
  profile: TeacherProfile | null;
  profileStatus: ProfileStatus;
  /** Cause précise quand le profil n'a pas pu être chargé (profileStatus = 'error'). */
  profileError: MagistraError | null;
  saveProfile(profile: TeacherProfile | null): Promise<void>;
  reloadProfile(): Promise<void>;
}
