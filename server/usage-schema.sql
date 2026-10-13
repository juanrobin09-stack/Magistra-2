-- Statistiques facultatives Windows, base Neon dédiée (production et staging séparés).
-- Migration réexécutable, à appliquer avec le rôle serveur propriétaire AVANT le déploiement HTTP.
-- Aucun jeton brut, identifiant permanent, IP, agent utilisateur ou document.
-- Empreintes HMAC distinctes par jour/mois, expiration fixe fin de période + 45 jours.
-- Agrégats conservés pour les 400 derniers jours, nettoyage quotidien sur une transaction active.
BEGIN;

CREATE TABLE IF NOT EXISTS public.magistra_usage_daily (
  period date PRIMARY KEY,
  active bigint NOT NULL DEFAULT 0 CHECK (active >= 0),
  openings bigint NOT NULL DEFAULT 0 CHECK (openings >= 0)
);
CREATE TABLE IF NOT EXISTS public.magistra_usage_monthly (
  period date PRIMARY KEY CHECK (extract(day FROM period) = 1),
  active bigint NOT NULL DEFAULT 0 CHECK (active >= 0)
);
CREATE TABLE IF NOT EXISTS public.magistra_usage_cohorts (
  period date PRIMARY KEY,
  first_uses bigint NOT NULL DEFAULT 0 CHECK (first_uses >= 0),
  returned7 bigint NOT NULL DEFAULT 0 CHECK (returned7 >= 0),
  returned30 bigint NOT NULL DEFAULT 0 CHECK (returned30 >= 0)
);
CREATE TABLE IF NOT EXISTS public.magistra_usage_dedup (
  kind text NOT NULL CHECK (kind IN ('day', 'month')),
  period date NOT NULL,
  token_hash text NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  openings integer NOT NULL DEFAULT 0 CHECK (openings BETWEEN 0 AND 10000),
  first_use boolean NOT NULL DEFAULT false,
  cohort date,
  returned7 boolean NOT NULL DEFAULT false,
  returned30 boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (kind, period, token_hash)
);
CREATE INDEX IF NOT EXISTS magistra_usage_dedup_expiry ON public.magistra_usage_dedup (expires_at);
CREATE TABLE IF NOT EXISTS public.magistra_usage_maintenance (
  singleton boolean PRIMARY KEY CHECK (singleton),
  purged_on date NOT NULL
);
INSERT INTO public.magistra_usage_maintenance VALUES (true, DATE '1970-01-01') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.magistra_usage_purge()
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_today date := (current_timestamp AT TIME ZONE 'UTC')::date;
  v_last date;
BEGIN
  SELECT purged_on INTO v_last FROM public.magistra_usage_maintenance WHERE singleton;
  IF v_last < v_today THEN
    -- Compare-and-set : un seul nettoyage du jour, même avec plusieurs instances HTTP.
    UPDATE public.magistra_usage_maintenance SET purged_on = v_today
      WHERE singleton AND purged_on < v_today RETURNING purged_on INTO v_last;
    IF FOUND THEN
      DELETE FROM public.magistra_usage_dedup WHERE expires_at <= current_timestamp;
      DELETE FROM public.magistra_usage_daily WHERE period < v_today - 399;
      DELETE FROM public.magistra_usage_monthly
        WHERE (period + INTERVAL '1 month' - INTERVAL '1 day')::date < v_today - 399;
      DELETE FROM public.magistra_usage_cohorts WHERE period < v_today - 399;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.magistra_record_usage(
  p_kind text, p_period text, p_token_hash text, p_openings integer,
  p_first_use boolean, p_cohort date, p_returned7 boolean, p_returned30 boolean
)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public
AS $$
DECLARE
  v_today date := (current_timestamp AT TIME ZONE 'UTC')::date;
  v_start date;
  v_end date;
  v_old public.magistra_usage_dedup%ROWTYPE;
  v_inserted integer;
  v_openings integer;
  v_first integer;
  v_return7 integer;
  v_return30 integer;
  v_cohort date;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('day', 'month') OR p_period IS NULL
     OR p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$'
     OR p_openings IS NULL OR p_openings NOT BETWEEN 0 AND 10000
     OR p_first_use IS NULL OR p_returned7 IS NULL OR p_returned30 IS NULL THEN
    RAISE EXCEPTION 'Invalid usage report' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'day' THEN
    IF p_period !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'Invalid usage period' USING ERRCODE = '22023';
    END IF;
    v_start := p_period::date;
    v_end := v_start;
    IF to_char(v_start, 'YYYY-MM-DD') <> p_period OR v_start > v_today OR v_start < v_today - 35 THEN
      RAISE EXCEPTION 'Expired or future usage period' USING ERRCODE = '22023';
    END IF;
    IF p_first_use THEN
      IF p_cohort IS DISTINCT FROM v_start OR p_returned7 OR p_returned30 THEN
        RAISE EXCEPTION 'Invalid first usage' USING ERRCODE = '22023';
      END IF;
    ELSIF p_returned7 OR p_returned30 THEN
      IF p_cohort IS NULL OR p_cohort >= v_start
         OR (p_returned7 AND (v_start - p_cohort > 7 OR NOT p_returned30))
         OR (p_returned30 AND v_start - p_cohort > 30) THEN
        RAISE EXCEPTION 'Invalid usage cohort' USING ERRCODE = '22023';
      END IF;
    ELSIF p_cohort IS NOT NULL THEN
      RAISE EXCEPTION 'Unexpected usage cohort' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF p_period !~ '^[0-9]{4}-[0-9]{2}$' OR p_openings <> 0 OR p_first_use
       OR p_cohort IS NOT NULL OR p_returned7 OR p_returned30 THEN
      RAISE EXCEPTION 'Invalid monthly usage' USING ERRCODE = '22023';
    END IF;
    v_start := (p_period || '-01')::date;
    v_end := (v_start + INTERVAL '1 month' - INTERVAL '1 day')::date;
    IF to_char(v_start, 'YYYY-MM') <> p_period OR v_start > v_today OR v_end < v_today - 35 THEN
      RAISE EXCEPTION 'Expired or future usage period' USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM public.magistra_usage_purge();
  INSERT INTO public.magistra_usage_dedup (kind, period, token_hash, expires_at)
    VALUES (p_kind, v_start, p_token_hash,
      ((v_end + 1)::timestamp AT TIME ZONE 'UTC') + INTERVAL '45 days')
    ON CONFLICT (kind, period, token_hash) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  -- L'insertion conflictuelle attend la transaction concurrente ; ce verrou lit ensuite sa valeur validée.
  SELECT * INTO STRICT v_old FROM public.magistra_usage_dedup
    WHERE kind = p_kind AND period = v_start AND token_hash = p_token_hash FOR UPDATE;

  IF p_kind = 'month' THEN
    IF v_inserted = 1 THEN
      INSERT INTO public.magistra_usage_monthly (period, active) VALUES (v_start, 1)
        ON CONFLICT (period) DO UPDATE SET active = magistra_usage_monthly.active + EXCLUDED.active;
    END IF;
    RETURN;
  END IF;
  IF v_old.cohort IS NOT NULL AND p_cohort IS NOT NULL AND v_old.cohort <> p_cohort THEN
    RAISE EXCEPTION 'Conflicting usage cohort' USING ERRCODE = '22023';
  END IF;
  v_cohort := coalesce(v_old.cohort, p_cohort);
  v_openings := greatest(v_old.openings, p_openings) - v_old.openings;
  v_first := CASE WHEN p_first_use AND NOT v_old.first_use THEN 1 ELSE 0 END;
  v_return7 := CASE WHEN p_returned7 AND NOT v_old.returned7 THEN 1 ELSE 0 END;
  v_return30 := CASE WHEN p_returned30 AND NOT v_old.returned30 THEN 1 ELSE 0 END;
  UPDATE public.magistra_usage_dedup SET
    openings = greatest(v_old.openings, p_openings), first_use = v_old.first_use OR p_first_use,
    cohort = v_cohort, returned7 = v_old.returned7 OR p_returned7, returned30 = v_old.returned30 OR p_returned30
    WHERE kind = p_kind AND period = v_start AND token_hash = p_token_hash;
  IF v_inserted > 0 OR v_openings > 0 THEN
    INSERT INTO public.magistra_usage_daily (period, active, openings) VALUES (v_start, v_inserted, v_openings)
      ON CONFLICT (period) DO UPDATE SET
        active = magistra_usage_daily.active + EXCLUDED.active,
        openings = magistra_usage_daily.openings + EXCLUDED.openings;
  END IF;
  IF v_first > 0 OR v_return7 > 0 OR v_return30 > 0 THEN
    INSERT INTO public.magistra_usage_cohorts (period, first_uses, returned7, returned30)
      VALUES (v_cohort, v_first, v_return7, v_return30)
      ON CONFLICT (period) DO UPDATE SET
        first_uses = magistra_usage_cohorts.first_uses + EXCLUDED.first_uses,
        returned7 = magistra_usage_cohorts.returned7 + EXCLUDED.returned7,
        returned30 = magistra_usage_cohorts.returned30 + EXCLUDED.returned30;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.magistra_usage_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public
AS $$
  -- Lecture seule, y compris en transaction READ ONLY. La purge appartient aux rapports et au cron privé.
  SELECT jsonb_build_object(
    'days', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'period', to_char(period, 'YYYY-MM-DD'), 'active', active, 'openings', openings) ORDER BY period)
      FROM public.magistra_usage_daily
      WHERE period >= (current_timestamp AT TIME ZONE 'UTC')::date - 399), '[]'::jsonb),
    'months', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'period', to_char(period, 'YYYY-MM'), 'active', active) ORDER BY period)
      FROM public.magistra_usage_monthly
      WHERE (period + INTERVAL '1 month' - INTERVAL '1 day')::date
        >= (current_timestamp AT TIME ZONE 'UTC')::date - 399), '[]'::jsonb),
    'cohorts', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'period', to_char(period, 'YYYY-MM-DD'), 'firstUses', first_uses,
      'returned7', returned7, 'returned30', returned30) ORDER BY period)
      FROM public.magistra_usage_cohorts
      WHERE period >= (current_timestamp AT TIME ZONE 'UTC')::date - 399), '[]'::jsonb)
  );
$$;

-- Le rôle propriétaire du serveur conserve ses droits ; aucune lecture/écriture directe publique.
ALTER TABLE public.magistra_usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.magistra_usage_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.magistra_usage_cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.magistra_usage_dedup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.magistra_usage_maintenance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.magistra_usage_daily, public.magistra_usage_monthly,
  public.magistra_usage_cohorts, public.magistra_usage_dedup, public.magistra_usage_maintenance FROM PUBLIC;
REVOKE ALL ON FUNCTION public.magistra_usage_purge() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.magistra_record_usage(text, text, text, integer, boolean, date, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.magistra_usage_snapshot() FROM PUBLIC;

COMMIT;
