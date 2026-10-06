-- ============================================================================
-- Combien de fois on a PAYÉ pour cette personne sans rien obtenir.
--
-- Le crédit FullEnrich est consommé AVANT l'appel : c'est voulu (mieux vaut
-- perdre un crédit sur un appel qui échoue que dépasser le plafond du
-- fournisseur). Mais une panne côté fournisseur laisse le contact candidat —
-- ni email, ni marque — et le producteur le redépose le lendemain. Rien ne
-- comptait ces passages : un contact dont l'enrichissement échoue
-- systématiquement consommait donc un crédit par jour, indéfiniment. Avec un
-- plafond à trente par jour, dix contacts dans cet état mangent le tiers de la
-- journée sans jamais rien produire.
--
-- Une colonne, et pas un compteur dans `contacts.enrichment` (jsonb) : deux
-- écritures concurrentes sur un jsonb se perdent l'une l'autre (lecture,
-- modification, réécriture complète), alors qu'un `set x = x + 1` est atomique.
-- Et une colonne se lit à l'œil nu dans une requête de diagnostic.
--
-- Additive, défaut 0 : les contacts existants sont réputés n'avoir jamais été
-- payés, ce qui leur laisse leurs trois essais.
-- ============================================================================

alter table contacts
  add column if not exists enrichment_attempts int not null default 0
    check (enrichment_attempts >= 0);

comment on column contacts.enrichment_attempts is
  'Nombre de tentatives d''enrichissement RÉELLEMENT PAYÉES (crédit fournisseur consommé) pour ce contact. Au-delà du plafond d''essais, le contact est marqué enriched_at pour ne plus être repris. Remettre à zéro suffit à autoriser un nouvel essai.';

-- ---------------------------------------------------------------------------
-- Contrôle : la migration échoue si la colonne ou sa contrainte manque.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'contacts'
       and column_name = 'enrichment_attempts' and is_nullable = 'NO'
  ) then
    raise exception 'colonne manquante : contacts.enrichment_attempts';
  end if;
  if not exists (
    select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
     where t.relname = 'contacts' and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%enrichment_attempts%'
  ) then
    raise exception 'contrainte manquante : contacts.enrichment_attempts >= 0';
  end if;
end $$;
