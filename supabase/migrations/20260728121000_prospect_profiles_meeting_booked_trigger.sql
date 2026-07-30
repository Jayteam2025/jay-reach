-- get_dashboard_kpis compte les réunions via prospect_profiles.meeting_booked_at,
-- mais aucune écriture ne renseignait cette colonne (uniquement un backfill ponctuel
-- dans 20260716120000). Résultat : "Réunions obtenues" figé sur le backfill et
-- "Pipeline généré" (= réunions × panier) à 0.
-- Trigger : renseigne meeting_booked_at au passage en meeting_booked/converted.
-- Set-once : une réunion prise reste un fait même si le deal est ensuite perdu.

CREATE OR REPLACE FUNCTION public.set_meeting_booked_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('meeting_booked', 'converted') AND NEW.meeting_booked_at IS NULL THEN
    NEW.meeting_booked_at := now();
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_prospect_profiles_meeting_booked ON public.prospect_profiles;
CREATE TRIGGER trg_prospect_profiles_meeting_booked
  BEFORE INSERT OR UPDATE OF status ON public.prospect_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_meeting_booked_at();
