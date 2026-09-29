// Contrat de l'API web (serveur Vercel / Node) — partagé par le client et le serveur.
//
// Toutes les routes exigent « Authorization: Bearer <jeton de session> » (Clerk, ou jeton du mode
// personnel), SAUF GET /api/mode et GET /api/windows-release, publiques et sans aucun secret.
// L'identité de l'utilisateur est TOUJOURS déduite du jeton vérifié côté serveur ;
// aucun identifiant envoyé par le navigateur n'est pris en compte.
//
//   GET    /api/mode                      → ModeInfo (public : mode d'authentification découvert à l'exécution)
//   GET    /api/status                    → ServerStatus
//   POST   /api/generate                  → flux NDJSON de GenerationEvent (corps : GenerationRequest)
//   GET    /api/history?favorites=1&cursor=…&limit=… → HistoryPage
//   GET    /api/windows-release           → WindowsReleaseResponse (public : dernière version STABLE publiée)
//   GET    /api/generation?id=…           → GenerationRecord
//   POST   /api/generation                → { id }              (corps : SaveGenerationBody — génération faite par
//                                                                  Magistra locale via le connecteur, enregistrée ici)
//   PATCH  /api/generation?id=…           → { ok: true }        (corps : { isFavorite: boolean })
//   DELETE /api/generation?id=…           → { ok: true }
//   GET    /api/stats?tz=Europe/Paris     → UsageStats (« aujourd'hui » et « 7 derniers jours » dans ce fuseau)
//   GET    /api/profile                   → { profile: TeacherProfile | null }
//   PUT    /api/profile                   → { ok: true }        (corps : { profile: TeacherProfile | null } ; null = effacer)
//   DELETE /api/account                   → { ok: true }        (supprime toutes les données de l'utilisateur)
//
// Erreurs : statut HTTP + { error: { code: ErrorCode, message: string, retryable: boolean } }

import type { ErrorCode } from './errors.js';
import type { AINotice, GenerationRecordDraft, ProviderInfo } from './types.js';

export interface ServerStatus {
  ai: {
    /** Vrai si une génération peut être tentée (y compris « état non vérifié » : voir `warning`). */
    ok: boolean;
    /** Libellé affiché (AI_SERVER_LABEL ou nom déduit du prestataire). */
    label: string;
    /** Nom technique du modèle (AI_MODEL). */
    model?: string;
    /** Cause précise quand `ok` est faux (message en français, sans secret ni adresse). */
    message?: string;
    code?: ErrorCode;
    /** Avertissement non bloquant quand `ok` est vrai (AI_STATUS_UNKNOWN, MODEL_NOT_INSTALLED « alias possible »…). */
    warning?: AINotice;
    /** Prestataire qui reçoit les textes : nom, tiers ou non, pays, conservation, entraînement. Jamais d'URL ni de clé. */
    providerInfo?: ProviderInfo;
  };
  research: { academic: boolean; web: boolean; institutional: boolean; wikipedia: boolean };
  maxDocumentChars: number;
}

/**
 * Mode d'authentification du serveur, découvert À L'EXÉCUTION par l'interface (GET /api/mode, public).
 *  - 'clerk'    : comptes Clerk (site public) ; `clerkPublishableKey` est la clé PUBLIABLE (pk_…), jamais la clé secrète ;
 *  - 'personal' : serveur personnel limité à la boucle locale (npm run dev / npm start sur le poste de l'enseignant) ;
 *  - 'none'     : aucune authentification configurée : l'interface reste en démonstration.
 * Une réponse 404 ou non JSON (ancien serveur, hébergement statique) équivaut à 'none'.
 */
export type AuthMode = 'clerk' | 'personal' | 'none';

export interface ModeInfo {
  auth: AuthMode;
  /** Clé publiable Clerk (pk_test_… / pk_live_…), présente seulement si auth = 'clerk'. */
  clerkPublishableKey?: string;
  /** Contact de l'administrateur du site (MAGISTRA_ADMIN_CONTACT : adresse électronique ou texte court), facultatif. */
  adminContact?: string;
  /**
   * Prestataire d'IA de la configuration (fiche statique : nom, pays, conservation, entraînement, page publique ;
   * jamais d'URL d'API ni de clé). Lu avant le premier rendu : la page Générer peut ainsi nommer le destinataire des
   * textes même si GET /api/status n'a pas encore répondu (ou a échoué). Absent pour une IA détectée automatiquement.
   */
  providerInfo?: ProviderInfo;
}

/** Corps de POST /api/generation : génération produite par Magistra locale (connecteur), à enregistrer. */
export interface SaveGenerationBody {
  record: GenerationRecordDraft;
}

/** Installateur Windows de la dernière version STABLE publiée (jamais un brouillon ni une préversion). */
export interface WindowsReleaseInfo {
  available: true;
  /** « 1.2.3 » */
  version: string;
  /** « Magistra-Setup-1.2.3.exe » */
  fileName: string;
  /** Téléchargement direct sur github.com (dépôt officiel), vérifié par le serveur. */
  downloadUrl: string;
  sizeBytes: number;
  /** Empreinte SHA-256 (64 caractères hexadécimaux), si la version la publie. */
  sha256?: string;
  /** Date de publication (ISO 8601). */
  publishedAt: string;
  /** Page de la version (notes, fichiers) sur github.com. */
  releaseUrl: string;
  /** Systèmes pris en charge, tels qu'affichés. */
  requirements: string;
}

export type WindowsReleaseResponse =
  | WindowsReleaseInfo
  | {
      available: false;
      /** 'none' : aucune version stable publiée ; 'unavailable' : GitHub injoignable ou réponse inattendue. */
      reason: 'none' | 'unavailable';
      /** Page officielle des versions (repli). */
      releasesUrl: string;
    };

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; retryable: boolean };
}

export const API_ROUTES = {
  mode: '/api/mode',
  status: '/api/status',
  generate: '/api/generate',
  history: '/api/history',
  generation: '/api/generation',
  windowsRelease: '/api/windows-release',
  stats: '/api/stats',
  profile: '/api/profile',
  account: '/api/account',
} as const;
