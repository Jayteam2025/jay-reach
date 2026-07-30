-- Statut 'validated' pour les signaux.
-- Le triage Signaux (bouton « Valider ») faisait raw -> matched. Or 'matched' est
-- posé par enrich-company À LA FIN de l'enrichissement (= devenu entreprise) et fait
-- sortir le signal du backlog « Scorées ». Valider un signal le sortait donc de la
-- file d'enrichissement sans que rien ne soit enrichi.
-- On ajoute un statut dédié : validé = approuvé par l'utilisateur mais TOUJOURS
-- dans la file d'enrichissement (cf. scoredSignals dans useProspectionView).

ALTER TABLE public.prospect_signals
  DROP CONSTRAINT IF EXISTS prospect_signals_status_check;

ALTER TABLE public.prospect_signals
  ADD CONSTRAINT prospect_signals_status_check
  CHECK (status = ANY (ARRAY['raw'::text, 'validated'::text, 'matched'::text, 'dismissed'::text, 'archived'::text]));
