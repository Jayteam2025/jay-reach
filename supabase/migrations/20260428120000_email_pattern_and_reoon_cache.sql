-- Email pattern detection + Reoon verification cache
--
-- 4 tables :
--   1. domain_email_patterns      : pattern dominant par domaine (calcule
--      apres chaque enrichment FullEnrich, sert a deduire les emails des
--      contacts non encore enrichis)
--   2. email_verification_cache   : cache des verifications Reoon par email
--      (TTL implicite ~30 jours, on re-verifie quand checked_at est vieux)
--   3. catch_all_domains          : domaines detectes catch-all (les
--      verifications individuelles sont inutiles, on display "ambiguous")
--   4. daily_reoon_usage          : compteur quotidien Reoon (cap 20/jour
--      sur le free tier, fallback "deduced_unverified" quand plein)
--
-- Toutes les tables sont service_role-only (utilisees par les edge functions
-- de prospection, jamais par le client).

-- ─── 1. domain_email_patterns ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.domain_email_patterns (
  domain TEXT PRIMARY KEY,
  pattern TEXT NOT NULL CHECK (pattern IN (
    'first.last', 'first_last', 'firstlast', 'flast', 'f.last',
    'first', 'last', 'last.f', 'first.l'
  )),
  confidence NUMERIC(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  tier TEXT NOT NULL CHECK (tier IN ('high', 'medium', 'skip')),
  sample_count INT NOT NULL CHECK (sample_count >= 0),
  hits INT NOT NULL CHECK (hits >= 0),
  secondary_pattern TEXT,
  secondary_hits INT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_domain_email_patterns_tier
  ON public.domain_email_patterns(tier)
  WHERE tier IN ('high', 'medium');

ALTER TABLE public.domain_email_patterns ENABLE ROW LEVEL SECURITY;
-- Service role only : pas de policy = pas d'acces par les clients.
COMMENT ON TABLE public.domain_email_patterns IS
  'Pattern email dominant par domaine, calcule a partir des emails enrichis FullEnrich. Sert a deduire les emails des contacts non encore enrichis (gain credits).';

-- ─── 2. email_verification_cache ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_verification_cache (
  email TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('valid', 'invalid', 'catch_all', 'unknown')),
  source TEXT NOT NULL CHECK (source IN ('reoon', 'fullenrich', 'pattern_high')),
  reoon_raw JSONB,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_cache_status_checked
  ON public.email_verification_cache(status, checked_at);

ALTER TABLE public.email_verification_cache ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.email_verification_cache IS
  'Cache des verifications email (Reoon principalement). Reduit la conso de credits Reoon en evitant de re-verifier les emails connus. TTL implicite ~30 jours via checked_at.';

-- ─── 3. catch_all_domains ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.catch_all_domains (
  domain TEXT PRIMARY KEY,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reoon_raw JSONB
);

ALTER TABLE public.catch_all_domains ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.catch_all_domains IS
  'Domaines detectes catch-all (acceptent tous les emails). Pour ces domaines, la verification individuelle est inutile : tout email deduit est marque "ambiguous" sans appeler Reoon.';

-- ─── 4. daily_reoon_usage ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.daily_reoon_usage (
  usage_date DATE PRIMARY KEY,
  used_today INT NOT NULL DEFAULT 0 CHECK (used_today >= 0),
  daily_cap INT NOT NULL DEFAULT 20 CHECK (daily_cap > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.daily_reoon_usage ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.daily_reoon_usage IS
  'Compteur quotidien des verifications Reoon. Free tier = 20/jour. Quand le cap est atteint, les emails deduits passent en mode deduced_unverified au lieu d''etre vidages dans la queue.';

-- ─── Helper RPC : incremente le compteur Reoon de maniere atomique ─────────
-- Retourne true si le call a ete autorise (cap pas atteint), false sinon.

CREATE OR REPLACE FUNCTION public.consume_reoon_credit(p_count INT DEFAULT 1)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'UTC')::date;
  v_row public.daily_reoon_usage%ROWTYPE;
BEGIN
  -- Lock + lit la ligne du jour (cree si manque)
  INSERT INTO public.daily_reoon_usage (usage_date, used_today, updated_at)
  VALUES (v_today, 0, now())
  ON CONFLICT (usage_date) DO NOTHING;

  SELECT * INTO v_row
  FROM public.daily_reoon_usage
  WHERE usage_date = v_today
  FOR UPDATE;

  -- Cap atteint -> refus
  IF v_row.used_today + p_count > v_row.daily_cap THEN
    RETURN FALSE;
  END IF;

  -- Incremente
  UPDATE public.daily_reoon_usage
  SET used_today = used_today + p_count,
      updated_at = now()
  WHERE usage_date = v_today;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_reoon_credit(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_reoon_credit(INT) TO service_role;

COMMENT ON FUNCTION public.consume_reoon_credit IS
  'Incremente atomiquement le compteur Reoon du jour si le cap quotidien n''est pas atteint. Retourne true si l''appel peut continuer, false sinon (fallback deduced_unverified). Pas de cleanup auto : les vieilles lignes restent pour l''historique.';

-- ─── Cron : enrich-deduced-emails (DISABLED for OSS Phase 1) ────────────────
-- Drain quotidien des profils sans email dont le domaine a un pattern connu.
-- DISABLED: Requires pg_net extension and pg_cron scheduling
-- Can be re-enabled in edge function or manual cron job

DO $$
BEGIN
  RAISE NOTICE 'Migration: enrich-deduced-emails cron (0 6 * * * = 06:00 UTC quotidien)';
END $$;
