-- ============================================================================
-- `campaigns.activated_at` : l'instant où la campagne est passée `active`.
--
-- L'alerte « rien n'est parti » ne doit pas accuser une campagne qu'on vient de
-- relancer : sa date de création (parfois vieille de six mois) ne dit rien de
-- depuis quand elle tourne. Additive : colonne nullable, aucune contrainte.
-- Les campagnes déjà actives prennent leur date de création faute de mieux ;
-- l'application pose ensuite `now()` à chaque activation.
-- ============================================================================

alter table public.campaigns add column if not exists activated_at timestamptz;

update public.campaigns set activated_at = created_at where status = 'active' and activated_at is null;
