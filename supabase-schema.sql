-- ============================================================================
-- MAGISTRA — Schéma Supabase (PostgreSQL 15+)
-- ============================================================================
-- À exécuter dans : Supabase > SQL Editor > New query > Run.
--
-- Le script est IDEMPOTENT : il peut être réexécuté sans erreur. Il migre aussi
-- automatiquement l'ancien schéma de Magistra :
--   * suppression du quota quotidien (table « usage », fonction « increment_usage ») ;
--   * suppression de TOUTES les anciennes politiques RLS (dont les « USING (true) ») ;
--   * profils : anciennes colonnes regroupées dans « data » (jsonb) ;
--   * générations : anciens paramètres (durée, objectifs…) regroupés dans « params ».
--
-- Modèle de sécurité
-- ------------------
--   * Le navigateur n'accède JAMAIS directement à la base. Toutes les requêtes passent
--     par le serveur Magistra, qui vérifie le jeton de session Clerk, en déduit
--     l'utilisateur (claim « sub ») puis interroge Supabase avec la clé service_role
--     (stockée côté serveur uniquement) en filtrant CHAQUE requête par cet utilisateur.
--   * RLS activée sur toutes les tables et AUCUN droit pour les rôles « anon » et
--     « authenticated » : même divulguée, la clé publique « anon » ne donne accès à rien.
--   * Fonctions en SECURITY DEFINER avec search_path figé, exécutables par service_role
--     uniquement.
-- ============================================================================

BEGIN;

-- ─── 1. Nettoyage de l'ancien schéma ────────────────────────────────────────

-- 1a. Toutes les politiques RLS existantes sur les tables Magistra sont supprimées
--     (les anciennes politiques « USING (true) » ouvraient toutes les données à tous).
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('profiles', 'generations', 'usage', 'api_requests', 'active_generations')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

-- 1b. Plus aucun quota ni compteur produit : table « usage » et fonction « increment_usage » supprimées.
DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'increment_usage'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', fn.signature);
  END LOOP;
END $$;

DROP TABLE IF EXISTS public.usage;

-- ─── 2. Profils enseignants ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.profiles (
  id         text PRIMARY KEY,                     -- identifiant Clerk (claim « sub »)
  data       jsonb,                                -- TeacherProfile validé par le serveur
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS data jsonb;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Migration : anciennes colonnes (display_name, etablissement, matiere_principale, niveau_principal) → data.
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'profiles'
         AND column_name IN ('display_name', 'etablissement', 'matiere_principale', 'niveau_principal')) = 4 THEN
    EXECUTE $m$
      UPDATE public.profiles
         SET data = jsonb_build_object(
               'displayName', coalesce(display_name, ''),
               'etablissement', coalesce(etablissement, ''),
               'cycle', '',
               'niveaux', CASE WHEN niveau_principal IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(niveau_principal) END,
               'matierePrincipale', coalesce(matiere_principale, 'autre'))
       WHERE data IS NULL
         AND (display_name IS NOT NULL OR etablissement IS NOT NULL
              OR matiere_principale IS NOT NULL OR niveau_principal IS NOT NULL)
    $m$;
  END IF;
END $$;

-- L'adresse électronique n'est pas conservée (elle reste chez Clerk) : minimisation des données.
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS email,
  DROP COLUMN IF EXISTS display_name,
  DROP COLUMN IF EXISTS etablissement,
  DROP COLUMN IF EXISTS matiere_principale,
  DROP COLUMN IF EXISTS niveau_principal;

-- ─── 3. Générations (historique) ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.generations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       text NOT NULL,                     -- identifiant Clerk du propriétaire
  type          text NOT NULL,
  niveau        text,
  matiere       text,
  discipline    text,
  sujet         text,
  contenu       text,
  sources       jsonb NOT NULL DEFAULT '[]'::jsonb, -- sources réellement citées (SourceRef[])
  params        jsonb NOT NULL DEFAULT '{}'::jsonb, -- paramètres de la demande (sans les documents)
  is_favorite   boolean NOT NULL DEFAULT false,
  truncated     boolean NOT NULL DEFAULT false,
  internet_used boolean NOT NULL DEFAULT false,
  model         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.generations ADD COLUMN IF NOT EXISTS discipline text;
ALTER TABLE public.generations ADD COLUMN IF NOT EXISTS sources jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.generations ADD COLUMN IF NOT EXISTS params jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.generations ADD COLUMN IF NOT EXISTS truncated boolean NOT NULL DEFAULT false;
ALTER TABLE public.generations ADD COLUMN IF NOT EXISTS internet_used boolean NOT NULL DEFAULT false;
ALTER TABLE public.generations ADD COLUMN IF NOT EXISTS model text;

-- Extrait calculé par la base : l'historique n'a jamais besoin de transférer les contenus complets.
ALTER TABLE public.generations
  ADD COLUMN IF NOT EXISTS excerpt text GENERATED ALWAYS AS (left(coalesce(contenu, ''), 600)) STORED;

-- Anciennes colonnes nullables : valeurs par défaut explicites.
UPDATE public.generations SET is_favorite = false WHERE is_favorite IS NULL;
UPDATE public.generations SET created_at = now() WHERE created_at IS NULL;
ALTER TABLE public.generations ALTER COLUMN is_favorite SET DEFAULT false;
ALTER TABLE public.generations ALTER COLUMN is_favorite SET NOT NULL;
ALTER TABLE public.generations ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.generations ALTER COLUMN created_at SET NOT NULL;

-- Migration : anciens paramètres en colonnes → params (jsonb), puis suppression des colonnes.
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'generations'
         AND column_name IN ('duree', 'objectifs', 'difficulte', 'consignes')) = 4 THEN
    EXECUTE $m$
      UPDATE public.generations
         SET params = params || jsonb_strip_nulls(jsonb_build_object(
               'duree', duree, 'objectifs', objectifs, 'difficulte', difficulte, 'consignes', consignes))
       WHERE duree IS NOT NULL OR objectifs IS NOT NULL OR difficulte IS NOT NULL OR consignes IS NOT NULL
    $m$;
  END IF;
END $$;

ALTER TABLE public.generations
  DROP COLUMN IF EXISTS duree,
  DROP COLUMN IF EXISTS objectifs,
  DROP COLUMN IF EXISTS difficulte,
  DROP COLUMN IF EXISTS consignes,
  DROP COLUMN IF EXISTS tokens_used;

-- Une génération n'exige plus de ligne « profiles » (l'ancienne clé étrangère est retirée).
ALTER TABLE public.generations DROP CONSTRAINT IF EXISTS generations_user_id_fkey;

-- Les 11 outils de Magistra.
ALTER TABLE public.generations DROP CONSTRAINT IF EXISTS generations_type_check;
ALTER TABLE public.generations ADD CONSTRAINT generations_type_check CHECK (type IN (
  'cours', 'exercices', 'evaluation', 'sequence', 'fiche_prep', 'progression',
  'appreciations', 'differenciation', 'lettre_parents', 'cahier_journal', 'corrige'
));

-- Index : historique (tri et pagination par clé), favoris.
DROP INDEX IF EXISTS public.idx_generations_user;
DROP INDEX IF EXISTS public.idx_generations_favorite;
CREATE INDEX IF NOT EXISTS generations_user_created_idx
  ON public.generations (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS generations_user_favorite_idx
  ON public.generations (user_id, created_at DESC, id DESC) WHERE is_favorite;

-- ─── 4. Anti-abus technique (aucun quota produit) ───────────────────────────
-- Horodatage des dernières demandes de génération, conservé quelques minutes seulement,
-- pour limiter les rafales (RATE_LIMIT_PER_MINUTE et RATE_LIMIT_GLOBAL_PER_MINUTE côté serveur).

CREATE TABLE IF NOT EXISTS public.api_requests (
  user_id    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  kind       text NOT NULL DEFAULT 'generate'
);

-- Nature de la demande : « generate » (génération par le serveur d'IA) ou « save » (enregistrement d'une génération
-- faite par Magistra locale, POST /api/generation). Les deux comptent pour le débit de l'utilisateur ; seules les
-- générations comptent dans la limite globale, qui protège le serveur d'IA. Lignes antérieures : générations.
ALTER TABLE public.api_requests ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'generate';
ALTER TABLE public.api_requests DROP CONSTRAINT IF EXISTS api_requests_kind_check;
ALTER TABLE public.api_requests ADD CONSTRAINT api_requests_kind_check CHECK (kind IN ('generate', 'save'));

CREATE INDEX IF NOT EXISTS api_requests_user_created_idx ON public.api_requests (user_id, created_at);
CREATE INDEX IF NOT EXISTS api_requests_created_idx ON public.api_requests (created_at);

-- Générations en cours (MAX_CONCURRENT_GENERATIONS_PER_USER côté serveur) : une ligne par génération
-- acceptée, supprimée à la fin du flux (succès, erreur, annulation, déconnexion du client).
-- Une ligne que le serveur n'a pas pu supprimer (instance arrêtée brutalement) cesse de compter
-- après le délai transmis par le serveur (durée maximale d'une génération + marge).
CREATE TABLE IF NOT EXISTS public.active_generations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS active_generations_user_started_idx ON public.active_generations (user_id, started_at);
CREATE INDEX IF NOT EXISTS active_generations_started_idx ON public.active_generations (started_at);

-- ─── 5. Mise à jour automatique de profiles.updated_at ──────────────────────

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;

-- Ancienne fonction générique : supprimée seulement si plus aucun déclencheur ne l'utilise.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'update_updated_at' AND p.pronargs = 0)
     AND NOT EXISTS (SELECT 1 FROM pg_trigger t
                       JOIN pg_proc p ON p.oid = t.tgfoid
                       JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname = 'public' AND p.proname = 'update_updated_at' AND NOT t.tgisinternal) THEN
    DROP FUNCTION public.update_updated_at();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.magistra_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.magistra_touch_updated_at();

-- ─── 6. Fonctions appelées par le serveur ───────────────────────────────────

-- Enregistre une demande de génération et indique si elle est acceptée
-- (false = plus de p_max demandes sur les p_window_seconds dernières secondes).
-- Atomique : un verrou transactionnel par utilisateur sérialise les demandes simultanées.
-- Remplacée par magistra_begin_generation ; conservée pour les versions précédentes du serveur.
CREATE OR REPLACE FUNCTION public.magistra_register_request(p_user_id text, p_window_seconds integer, p_max integer)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_user_id IS NULL OR char_length(p_user_id) = 0 OR char_length(p_user_id) > 200 THEN
    RAISE EXCEPTION 'magistra_register_request : identifiant invalide' USING ERRCODE = '22023';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 86400
     OR p_max IS NULL OR p_max < 1 OR p_max > 100000 THEN
    RAISE EXCEPTION 'magistra_register_request : paramètres invalides' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('magistra_rate:' || p_user_id, 0));

  DELETE FROM public.api_requests
   WHERE user_id = p_user_id
     AND created_at < now() - make_interval(secs => p_window_seconds);

  SELECT count(*) INTO v_count FROM public.api_requests WHERE user_id = p_user_id;
  IF v_count >= p_max THEN
    RETURN false;
  END IF;

  INSERT INTO public.api_requests (user_id, created_at) VALUES (p_user_id, now());

  -- Ménage occasionnel des traces anciennes des autres utilisateurs.
  IF random() < 0.02 THEN
    DELETE FROM public.api_requests WHERE created_at < now() - interval '2 days';
  END IF;
  RETURN true;
END;
$$;

-- Début d'une génération : contrôles de concurrence et de débit en une seule transaction.
--   p_max_active          : générations en cours au plus pour l'utilisateur (0 = pas de limite) ;
--   p_max_requests        : demandes acceptées au plus pour l'utilisateur sur p_window_seconds s (0 = pas de contrôle) ;
--   p_max_global_requests : GÉNÉRATIONS (kind « generate ») acceptées au plus pour TOUT le déploiement sur la même
--                           fenêtre (0 = pas de contrôle) ; les enregistrements (« save ») n'y comptent jamais ;
--   p_active_ttl_seconds  : au-delà, une génération jamais marquée terminée ne compte plus ;
--   p_kind                : nature de la demande enregistrée (« generate » par défaut, « save »).
-- Résultat : {"status": "ok", "id": <uuid à transmettre à magistra_end_generation, ou null>}
--          | {"status": "busy"} | {"status": "rate_limited"} | {"status": "saturated"}.
-- Une demande refusée n'est pas comptée.
-- Atomique entre plusieurs instances du serveur : le même verrou transactionnel par utilisateur que
-- magistra_register_request sérialise les demandes d'un utilisateur (compte puis insertion) ; le
-- contrôle global prend en plus un verrou commun, toujours APRÈS celui de l'utilisateur (ordre fixe :
-- pas d'interblocage).
-- Version précédente (sans p_kind) supprimée : un appel sans p_kind ne doit jamais être ambigu.
DROP FUNCTION IF EXISTS public.magistra_begin_generation(text, integer, integer, integer, integer, integer);
CREATE OR REPLACE FUNCTION public.magistra_begin_generation(
  p_user_id text,
  p_window_seconds integer,
  p_max_requests integer,
  p_max_global_requests integer,
  p_max_active integer,
  p_active_ttl_seconds integer,
  p_kind text DEFAULT 'generate')
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_id    uuid;
BEGIN
  IF p_user_id IS NULL OR char_length(p_user_id) = 0 OR char_length(p_user_id) > 200 THEN
    RAISE EXCEPTION 'magistra_begin_generation : identifiant invalide' USING ERRCODE = '22023';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 86400
     OR p_max_requests IS NULL OR p_max_requests < 0 OR p_max_requests > 100000
     OR p_max_global_requests IS NULL OR p_max_global_requests < 0 OR p_max_global_requests > 1000000
     OR p_max_active IS NULL OR p_max_active < 0 OR p_max_active > 1000
     OR p_active_ttl_seconds IS NULL OR p_active_ttl_seconds < 1 OR p_active_ttl_seconds > 86400
     OR p_kind IS NULL OR p_kind NOT IN ('generate', 'save') THEN
    RAISE EXCEPTION 'magistra_begin_generation : paramètres invalides' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('magistra_rate:' || p_user_id, 0));

  -- 1. Générations en cours (les lignes expirées ne comptent plus et sont supprimées).
  IF p_max_active > 0 THEN
    DELETE FROM public.active_generations
     WHERE user_id = p_user_id
       AND started_at < now() - make_interval(secs => p_active_ttl_seconds);
    SELECT count(*) INTO v_count FROM public.active_generations WHERE user_id = p_user_id;
    IF v_count >= p_max_active THEN
      RETURN jsonb_build_object('status', 'busy');
    END IF;
  END IF;

  IF p_max_requests > 0 OR p_max_global_requests > 0 THEN
    DELETE FROM public.api_requests
     WHERE user_id = p_user_id
       AND created_at < now() - make_interval(secs => p_window_seconds);

    -- 2. Débit de l'utilisateur : même règle que magistra_register_request.
    IF p_max_requests > 0 THEN
      SELECT count(*) INTO v_count FROM public.api_requests WHERE user_id = p_user_id;
      IF v_count >= p_max_requests THEN
        RETURN jsonb_build_object('status', 'rate_limited');
      END IF;
    END IF;

    -- 3. Débit de tout le déploiement (générations par le serveur d'IA seulement).
    IF p_max_global_requests > 0 THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('magistra_rate_global', 0));
      SELECT count(*) INTO v_count
        FROM public.api_requests
       WHERE created_at >= now() - make_interval(secs => p_window_seconds)
         AND kind = 'generate';
      IF v_count >= p_max_global_requests THEN
        RETURN jsonb_build_object('status', 'saturated');
      END IF;
    END IF;

    INSERT INTO public.api_requests (user_id, created_at, kind) VALUES (p_user_id, now(), p_kind);
  END IF;

  IF p_max_active > 0 THEN
    INSERT INTO public.active_generations (user_id, started_at) VALUES (p_user_id, now()) RETURNING id INTO v_id;
  END IF;

  -- Ménage occasionnel des traces anciennes des autres utilisateurs (un seul nettoyage à la fois). Places de
  -- génération : seulement par un appel qui les gère (p_max_active > 0), donc avec leur vraie durée de vie — jamais
  -- avec celle d'une autre sorte de demande, qui libérerait trop tôt les générations en cours des autres enseignants.
  IF random() < 0.02 THEN
    IF pg_try_advisory_xact_lock(hashtextextended('magistra_cleanup', 0)) THEN
      DELETE FROM public.api_requests WHERE created_at < now() - interval '2 days';
      IF p_max_active > 0 THEN
        DELETE FROM public.active_generations WHERE started_at < now() - make_interval(secs => p_active_ttl_seconds);
      END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('status', 'ok', 'id', v_id);
END;
$$;

-- Fin d'une génération (succès, erreur, annulation) : libère sa place.
-- Renvoie false si elle n'existait plus (déjà libérée, expirée ou appartenant à un autre utilisateur).
CREATE OR REPLACE FUNCTION public.magistra_end_generation(p_user_id text, p_generation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL OR char_length(p_user_id) = 0 OR char_length(p_user_id) > 200 OR p_generation_id IS NULL THEN
    RAISE EXCEPTION 'magistra_end_generation : paramètres invalides' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.active_generations WHERE id = p_generation_id AND user_id = p_user_id;
  RETURN FOUND;
END;
$$;

-- Statistiques exactes d'un utilisateur :
--   today = depuis minuit dans le fuseau p_tz (UTC si fuseau inconnu) ;
--   week  = sur les 7 derniers jours glissants (même règle que l'interface).
CREATE OR REPLACE FUNCTION public.magistra_stats(p_user_id text, p_tz text DEFAULT 'Europe/Paris')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz        text := coalesce(nullif(p_tz, ''), 'UTC');
  v_today     timestamptz;
  v_week      timestamptz := now() - interval '7 days';
  v_result    jsonb;
  v_top       text;
  v_top_count bigint;
BEGIN
  BEGIN
    v_today := date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  EXCEPTION WHEN others THEN
    v_today := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  END;

  SELECT jsonb_build_object(
           'total',     count(*),
           'favorites', count(*) FILTER (WHERE is_favorite),
           'today',     count(*) FILTER (WHERE created_at >= v_today),
           'week',      count(*) FILTER (WHERE created_at >= v_week))
    INTO v_result
    FROM public.generations
   WHERE user_id = p_user_id;

  SELECT matiere, count(*)
    INTO v_top, v_top_count
    FROM public.generations
   WHERE user_id = p_user_id AND matiere IS NOT NULL AND matiere <> ''
   GROUP BY matiere
   ORDER BY count(*) DESC, matiere ASC
   LIMIT 1;

  IF v_top IS NOT NULL THEN
    v_result := v_result || jsonb_build_object('top_matiere', v_top, 'top_count', v_top_count);
  END IF;

  -- Comptes par valeur stockée (50 au plus) : le serveur regroupe les anciens libellés
  -- (« Mathématiques ») avec les clés actuelles (« mathematiques ») sans modifier les données.
  v_result := v_result || jsonb_build_object('matiere_counts', coalesce((
    SELECT jsonb_object_agg(matiere, n)
      FROM (SELECT matiere, count(*) AS n
              FROM public.generations
             WHERE user_id = p_user_id AND matiere IS NOT NULL AND matiere <> ''
             GROUP BY matiere
             ORDER BY count(*) DESC, matiere ASC
             LIMIT 50) AS c), '{}'::jsonb));
  RETURN v_result;
END;
$$;

-- ─── 7. Droits : aucun accès direct pour anon / authenticated ───────────────

ALTER TABLE public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_requests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_generations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.profiles, public.generations, public.api_requests, public.active_generations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles, public.generations, public.api_requests, public.active_generations TO service_role;

REVOKE ALL ON FUNCTION public.magistra_register_request(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.magistra_begin_generation(text, integer, integer, integer, integer, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.magistra_end_generation(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.magistra_stats(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.magistra_touch_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.magistra_register_request(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.magistra_begin_generation(text, integer, integer, integer, integer, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.magistra_end_generation(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.magistra_stats(text, text) TO service_role;

-- Aucune politique permissive n'est créée : sans politique, RLS refuse tout accès aux rôles
-- anon et authenticated (service_role contourne RLS et n'est utilisé que par le serveur).

-- ─── 8. (Facultatif) Intégration Clerk ↔ Supabase ───────────────────────────
-- Uniquement si vous configurez Clerk comme fournisseur d'authentification tiers de Supabase
-- et souhaitez un accès direct depuis le navigateur. Magistra n'en a PAS besoin : laissez
-- ces lignes commentées. Chaque utilisateur ne verrait alors que ses propres lignes.
--
-- GRANT SELECT, INSERT, UPDATE, DELETE ON public.generations TO authenticated;
-- CREATE POLICY magistra_generations_owner ON public.generations
--   FOR ALL TO authenticated
--   USING ((auth.jwt() ->> 'sub') = user_id)
--   WITH CHECK ((auth.jwt() ->> 'sub') = user_id);
--
-- GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
-- CREATE POLICY magistra_profiles_owner ON public.profiles
--   FOR ALL TO authenticated
--   USING ((auth.jwt() ->> 'sub') = id)
--   WITH CHECK ((auth.jwt() ->> 'sub') = id);

COMMIT;

-- Rechargement du cache de schéma de l'API REST de Supabase (PostgREST).
NOTIFY pgrst, 'reload schema';
