-- Lot 4a, tâche 7 (round 2) : distinguer un passage qui a VRAIMENT parlé au monde
-- extérieur d'une ligne purement administrative.
--
-- Le disjoncteur ne doit compter que les seconds. `linkedin_requetes` suffit pour
-- les passages qui ont émis un appel Voyager, mais pas pour celui qui échoue AVANT,
-- sur la relève de l'IP de sortie : il a bien ouvert le navigateur et traversé le
-- proxy, il n'a simplement laissé aucune trace de requête LinkedIn. Sans ce drapeau,
-- un proxy mort ferait échouer tous les passages sans jamais faire disjoncter —
-- exactement ce que la règle « les échecs de relève comptent » veut éviter.
--
-- Faux pour tout refus local (canal désactivé, session, campagne, persona, verrou) :
-- ces situations ne disent rien de l'état de LinkedIn ni du proxy.
alter table source_runs add column if not exists echec_navigateur boolean not null default false;

-- Contrôle : la migration échoue si la colonne attendue est absente.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'source_runs' and column_name = 'echec_navigateur'
  ) then
    raise exception 'colonne manquante : source_runs.echec_navigateur';
  end if;
end $$;
