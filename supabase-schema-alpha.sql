-- ============================================================
-- MAGISTRA ALPHA — Migration additive pour la version Alpha privée
-- À exécuter APRÈS supabase-schema.sql, une seule fois :
-- Supabase Dashboard > SQL Editor > New Query > Run
--
-- Note : la limite de 10 générations/compte de la phase Alpha réutilise
-- la table `usage` déjà existante (aucune migration nécessaire pour ça).
-- Cette migration ajoute uniquement la table de retours testeurs (feedback).
-- ============================================================

CREATE TABLE IF NOT EXISTS feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('bug', 'idee', 'suggestion')),
  message TEXT NOT NULL,
  page TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service can insert feedback" ON feedback FOR INSERT WITH CHECK (true);
CREATE POLICY "Service can read feedback" ON feedback FOR SELECT USING (true);
