-- ============================================================
-- MAGISTRA — Schema Postgres (base connectée via Vercel, ex. Neon)
-- À exécuter une seule fois, depuis l'éditeur SQL de ta base
-- (onglet Storage de ton projet Vercel) ou via :
--   psql "$DATABASE_URL" -f vercel-postgres-schema.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. PROFILES (étend les utilisateurs Clerk)
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,                -- Clerk user ID
  email TEXT,
  display_name TEXT,
  etablissement TEXT,
  matiere_principale TEXT,
  niveau_principal TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. GENERATIONS (tout le contenu généré)
CREATE TABLE IF NOT EXISTS generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('cours', 'exercices', 'evaluation', 'sequence', 'fiche_prep', 'appreciations', 'progression', 'differenciation', 'lettre_parents', 'cahier_journal', 'corrige')),
  matiere TEXT NOT NULL,
  niveau TEXT NOT NULL,
  sujet TEXT NOT NULL,
  duree TEXT,
  objectifs TEXT,
  difficulte TEXT,
  consignes TEXT,
  contenu TEXT NOT NULL,
  is_favorite BOOLEAN DEFAULT FALSE,
  tokens_used INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generations_user ON generations(user_id, created_at DESC);

-- 3. USAGE (suivi du quota quotidien par utilisateur)
CREATE TABLE IF NOT EXISTS usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  generation_count INTEGER DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_usage_user_date ON usage(user_id, date DESC);
