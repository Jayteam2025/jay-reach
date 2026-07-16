-- Dashboard "résultats" (Écran 1 spec UX/UI) : colonnes + RPCs d'agrégat + setter panier moyen.
-- Panier moyen rangé dans workspaces.settings->>'average_deal_value' (pas de colonne dédiée).

-- 1. Classification des réponses (remplie plus tard par un classifieur ; NULL par défaut)
ALTER TABLE public.prospect_messages
  ADD COLUMN IF NOT EXISTS reply_classification text
  CHECK (reply_classification IN ('interested','to_recontact','not_interested','neutral'));

-- 2. Date de prise de RDV (renseignée quand le statut passe à meeting_booked)
ALTER TABLE public.prospect_profiles
  ADD COLUMN IF NOT EXISTS meeting_booked_at timestamptz;

UPDATE public.prospect_profiles
  SET meeting_booked_at = COALESCE(updated_at, created_at)
  WHERE status IN ('meeting_booked','converted') AND meeting_booked_at IS NULL;

-- ============================================================
-- RPC 1 : KPIs de résultat (réponses, positives, réunions, pipeline)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_dashboard_kpis(p_period text DEFAULT '30d')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid; v_ws uuid; v_days int;
  v_start timestamptz; v_prev_start timestamptz; v_prev_end timestamptz;
  v_deal numeric;
  v_replies int; v_replies_prev int; v_pos int;
  v_meet int; v_meet_prev int;
  v_pipeline numeric := NULL; v_pipeline_prev numeric := NULL;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT workspace_id INTO v_ws FROM public.workspace_members WHERE user_id = v_uid LIMIT 1;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'no workspace for user %', v_uid; END IF;

  v_days := CASE p_period WHEN '7d' THEN 7 WHEN '3m' THEN 90 ELSE 30 END;
  v_start := now() - make_interval(days => v_days);
  v_prev_end := v_start;
  v_prev_start := v_start - make_interval(days => v_days);

  SELECT NULLIF(settings->>'average_deal_value','')::numeric INTO v_deal
  FROM public.workspaces WHERE id = v_ws;

  SELECT count(*) INTO v_replies FROM public.prospect_messages
    WHERE workspace_id = v_ws AND replied_at >= v_start;
  SELECT count(*) INTO v_replies_prev FROM public.prospect_messages
    WHERE workspace_id = v_ws AND replied_at >= v_prev_start AND replied_at < v_prev_end;
  SELECT count(*) INTO v_pos FROM public.prospect_messages
    WHERE workspace_id = v_ws AND replied_at >= v_start
      AND reply_classification IN ('interested','to_recontact');

  SELECT count(*) INTO v_meet FROM public.prospect_profiles
    WHERE workspace_id = v_ws AND deleted_at IS NULL AND meeting_booked_at >= v_start;
  SELECT count(*) INTO v_meet_prev FROM public.prospect_profiles
    WHERE workspace_id = v_ws AND deleted_at IS NULL
      AND meeting_booked_at >= v_prev_start AND meeting_booked_at < v_prev_end;

  IF v_deal IS NOT NULL THEN
    v_pipeline := v_meet * v_deal;
    v_pipeline_prev := v_meet_prev * v_deal;
  END IF;

  RETURN jsonb_build_object(
    'period', p_period,
    'replies', v_replies, 'replies_prev', v_replies_prev,
    'positive_replies', v_pos,
    'positive_pct', CASE WHEN v_replies > 0 THEN round(100.0 * v_pos / v_replies)::int ELSE 0 END,
    'meetings', v_meet, 'meetings_prev', v_meet_prev,
    'deal_size', v_deal, 'pipeline', v_pipeline, 'pipeline_prev', v_pipeline_prev
  );
END; $$;

-- ============================================================
-- RPC 2 : Activité (effort par canal + réponses) par bucket temporel
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_dashboard_activity(p_period text DEFAULT '30d')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid; v_ws uuid; v_days int; v_trunc text;
  v_start timestamptz; v_step interval; v_result jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT workspace_id INTO v_ws FROM public.workspace_members WHERE user_id = v_uid LIMIT 1;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'no workspace for user %', v_uid; END IF;

  v_days := CASE p_period WHEN '7d' THEN 7 WHEN '3m' THEN 90 ELSE 30 END;
  v_trunc := CASE p_period WHEN '7d' THEN 'day' ELSE 'week' END;
  v_step := CASE p_period WHEN '7d' THEN interval '1 day' ELSE interval '1 week' END;
  v_start := date_trunc(v_trunc, now() - make_interval(days => v_days));

  WITH buckets AS (
    SELECT generate_series(v_start, date_trunc(v_trunc, now()), v_step) AS b
  ),
  events AS (
    SELECT date_trunc(v_trunc, sent_at) AS b, 'email'::text AS ch
      FROM public.prospect_messages
      WHERE workspace_id = v_ws AND channel = 'email' AND status IN ('sent','replied') AND sent_at >= v_start
    UNION ALL
    SELECT date_trunc(v_trunc, created_at), 'email'
      FROM public.prospect_actions
      WHERE workspace_id = v_ws AND channel = 'email' AND action_type = 'sent' AND created_at >= v_start
    UNION ALL
    SELECT date_trunc(v_trunc, sent_at), 'li_msg'
      FROM public.prospect_messages
      WHERE workspace_id = v_ws AND channel = 'linkedin' AND status IN ('sent','replied') AND sent_at >= v_start
    UNION ALL
    SELECT date_trunc(v_trunc, created_at), 'li_msg'
      FROM public.prospect_actions
      WHERE workspace_id = v_ws AND channel = 'linkedin' AND action_type = 'sent' AND created_at >= v_start
    UNION ALL
    SELECT date_trunc(v_trunc, created_at), 'li_inv'
      FROM public.prospect_actions
      WHERE workspace_id = v_ws AND channel = 'linkedin' AND action_type IN ('open','copy') AND created_at >= v_start
  ),
  replies AS (
    SELECT date_trunc(v_trunc, replied_at) AS b, count(*)::int AS n
      FROM public.prospect_messages
      WHERE workspace_id = v_ws AND replied_at >= v_start
      GROUP BY 1
  ),
  per_bucket AS (
    SELECT bk.b AS b,
      jsonb_build_object(
        'bucket', to_char(bk.b, 'YYYY-MM-DD'),
        'linkedin_invites', COALESCE(count(*) FILTER (WHERE e.ch = 'li_inv'), 0),
        'emails', COALESCE(count(*) FILTER (WHERE e.ch = 'email'), 0),
        'linkedin_messages', COALESCE(count(*) FILTER (WHERE e.ch = 'li_msg'), 0),
        'replies', COALESCE(max(r.n), 0)
      ) AS obj
    FROM buckets bk
    LEFT JOIN events e ON e.b = bk.b
    LEFT JOIN replies r ON r.b = bk.b
    GROUP BY bk.b
  )
  SELECT jsonb_agg(obj ORDER BY b) INTO v_result FROM per_bucket;

  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;

-- ============================================================
-- RPC 3 : Alertes / insights (règles serveur)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_dashboard_alerts(p_period text DEFAULT '30d')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid; v_ws uuid; v_today_replies int; v_alerts jsonb := '[]'::jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT workspace_id INTO v_ws FROM public.workspace_members WHERE user_id = v_uid LIMIT 1;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'no workspace for user %', v_uid; END IF;

  SELECT count(*) INTO v_today_replies FROM public.prospect_messages
    WHERE workspace_id = v_ws AND replied_at >= date_trunc('day', now());
  IF v_today_replies > 0 THEN
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'severity', 'info', 'icon', 'flame',
      'text', v_today_replies || ' prospect' || CASE WHEN v_today_replies > 1 THEN 's ont' ELSE ' a' END || ' répondu aujourd''hui',
      'action_label', 'Voir l''inbox', 'action_target', 'inbox'
    ));
  END IF;

  RETURN v_alerts;
END; $$;

-- ============================================================
-- Setter du panier moyen (rangé dans workspaces.settings)
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_workspace_deal_size(p_value numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid; v_ws uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT workspace_id INTO v_ws FROM public.workspace_members WHERE user_id = v_uid LIMIT 1;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'no workspace for user %', v_uid; END IF;

  IF p_value IS NULL OR p_value <= 0 THEN
    UPDATE public.workspaces SET settings = (COALESCE(settings, '{}'::jsonb) - 'average_deal_value') WHERE id = v_ws;
  ELSE
    UPDATE public.workspaces SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{average_deal_value}', to_jsonb(p_value)) WHERE id = v_ws;
  END IF;

  RETURN jsonb_build_object('deal_size', p_value);
END; $$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_kpis(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_activity(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_alerts(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_workspace_deal_size(numeric) TO authenticated;
