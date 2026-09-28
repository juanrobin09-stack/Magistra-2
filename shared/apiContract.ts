// Contrat de l'API web (serveur Vercel / Node) — partagé par le client et le serveur.
//
// Toutes les routes exigent « Authorization: Bearer <jeton de session Clerk> ».
// L'identité de l'utilisateur est TOUJOURS déduite du jeton vérifié côté serveur ;
// aucun identifiant envoyé par le navigateur n'est pris en compte.
//
//   GET    /api/status                    → ServerStatus
//   POST   /api/generate                  → flux NDJSON de GenerationEvent (corps : GenerationRequest)
//   GET    /api/history?favorites=1&cursor=…&limit=… → HistoryPage
//   GET    /api/generation?id=…           → GenerationRecord
//   PATCH  /api/generation?id=…           → { ok: true }        (corps : { isFavorite: boolean })
//   DELETE /api/generation?id=…           → { ok: true }
//   GET    /api/stats?tz=Europe/Paris     → UsageStats (« aujourd'hui » et « 7 derniers jours » dans ce fuseau)
//   GET    /api/profile                   → { profile: TeacherProfile | null }
//   PUT    /api/profile                   → { ok: true }        (corps : { profile: TeacherProfile | null } ; null = effacer)
//   DELETE /api/account                   → { ok: true }        (supprime toutes les données de l'utilisateur)
//
// Erreurs : statut HTTP + { error: { code: ErrorCode, message: string, retryable: boolean } }

import type { ErrorCode } from './errors.js';

export interface ServerStatus {
  ai: { ok: boolean; label: string; model?: string; message?: string; code?: ErrorCode };
  research: { academic: boolean; web: boolean; institutional: boolean; wikipedia: boolean };
  maxDocumentChars: number;
}

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; retryable: boolean };
}

export const API_ROUTES = {
  status: '/api/status',
  generate: '/api/generate',
  history: '/api/history',
  generation: '/api/generation',
  stats: '/api/stats',
  profile: '/api/profile',
  account: '/api/account',
} as const;
