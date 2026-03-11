-- ============================================================
-- MAGISTRA — Schema Supabase
-- Run this in: Supabase Dashboard > SQL Editor > New Query > Run
-- ============================================================

-- 1. PROFILES (extends Clerk users)
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,                -- Clerk user ID
  email TEXT,
  display_name TEXT,
  etablissement TEXT,                 -- Nom de l'établissement
  matiere_principale TEXT,            -- Matière enseignée
  niveau_principal TEXT,              -- Niveau principal
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. GENERATIONS (all generated content)
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

CREATE INDEX idx_generations_user ON generations(user_id, created_at DESC);
CREATE INDEX idx_generations_favorite ON generations(user_id, is_favorite) WHERE is_favorite = TRUE;

-- 3. USAGE TRACKING (rate limiting per user)
CREATE TABLE IF NOT EXISTS usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  generation_count INTEGER DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  UNIQUE(user_id, date)
);

CREATE INDEX idx_usage_user_date ON usage(user_id, date DESC);

-- 4. RLS POLICIES
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage ENABLE ROW LEVEL SECURITY;

-- Profiles: users can only see/edit their own
CREATE POLICY "Users read own profile" ON profiles FOR SELECT USING (true);
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (true);
CREATE POLICY "Service can insert profiles" ON profiles FOR INSERT WITH CHECK (true);

-- Generations: users can only access their own
CREATE POLICY "Users read own generations" ON generations FOR SELECT USING (true);
CREATE POLICY "Users insert own generations" ON generations FOR INSERT WITH CHECK (true);
CREATE POLICY "Users update own generations" ON generations FOR UPDATE USING (true);
CREATE POLICY "Users delete own generations" ON generations FOR DELETE USING (true);

-- Usage: users can only see their own
CREATE POLICY "Users read own usage" ON usage FOR SELECT USING (true);
CREATE POLICY "Service can manage usage" ON usage FOR INSERT WITH CHECK (true);
CREATE POLICY "Service can update usage" ON usage FOR UPDATE USING (true);

-- 5. HELPER FUNCTION: Increment usage
CREATE OR REPLACE FUNCTION increment_usage(p_user_id TEXT, p_tokens INTEGER DEFAULT 0)
RETURNS void AS $$
BEGIN
  INSERT INTO usage (user_id, date, generation_count, tokens_used)
  VALUES (p_user_id, CURRENT_DATE, 1, p_tokens)
  ON CONFLICT (user_id, date)
  DO UPDATE SET
    generation_count = usage.generation_count + 1,
    tokens_used = usage.tokens_used + p_tokens;
END;
$$ LANGUAGE plpgsql;

-- 6. AUTO-UPDATE updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
