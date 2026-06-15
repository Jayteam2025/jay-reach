-- Cycle de vie des signaux : statut 'archived' + horodatage d'archivage.
-- Le CHECK d'origine (raw/matched/dismissed) refuse 'archived' -> on le recree.

ALTER TABLE public.prospect_signals
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;

ALTER TABLE public.prospect_signals
  DROP CONSTRAINT IF EXISTS prospect_signals_status_check;

ALTER TABLE public.prospect_signals
  ADD CONSTRAINT prospect_signals_status_check
  CHECK (status = ANY (ARRAY['raw'::text, 'matched'::text, 'dismissed'::text, 'archived'::text]));

COMMENT ON COLUMN public.prospect_signals.archived_at IS
  'Date d''archivage (statut archived). Base de la purge 60j dans cleanup_prospect_retention().';
