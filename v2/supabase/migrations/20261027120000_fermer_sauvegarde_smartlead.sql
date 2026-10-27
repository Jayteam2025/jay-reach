-- Ferme la sauvegarde laissee par la migration differee 20260910190000_retrait_smartlead.
-- Un `create table ... as` nait sans RLS et herite des droits par defaut du schema :
-- anon lisait, modifiait et vidait la table avec la cle publique du front
-- (alerte Supabase rls_disabled_in_public du 25/10/2026). La migration differee est
-- corrigee pour les instances neuves ; celle-ci repare les instances qui l'ont deja jouee.
-- Sans effet si la table n'existe pas (migration differee jamais appliquee).
do $$
begin
  if to_regclass('public.smartlead_campaign_mappings_sauvegarde_20260910') is null then
    return;
  end if;

  alter table public.smartlead_campaign_mappings_sauvegarde_20260910 enable row level security;
  revoke all on public.smartlead_campaign_mappings_sauvegarde_20260910 from public, anon, authenticated;

  -- La migration se verifie elle-meme : un droit restant echoue ici, pas en production.
  if not (select relrowsecurity from pg_class
          where oid = 'public.smartlead_campaign_mappings_sauvegarde_20260910'::regclass) then
    raise exception 'RLS toujours inactive sur smartlead_campaign_mappings_sauvegarde_20260910';
  end if;
  if has_table_privilege('anon', 'public.smartlead_campaign_mappings_sauvegarde_20260910', 'select, insert, update, delete, truncate')
     or has_table_privilege('authenticated', 'public.smartlead_campaign_mappings_sauvegarde_20260910', 'select, insert, update, delete, truncate') then
    raise exception 'anon ou authenticated garde un droit sur smartlead_campaign_mappings_sauvegarde_20260910';
  end if;
end $$;
