/**
 * La requête de la liste de démarrage, isolée et SANS import : le harnais `test/pg-verify/
 * demarrage.sh` la charge telle quelle pour la jouer contre un vrai Postgres. Une copie dans le
 * harnais ne prouverait rien du code qui tourne.
 */
/**
 * Les six vérités, en une seule requête : l'écran d'accueil en fait déjà beaucoup, et six
 * allers-retours de plus pour un bloc d'accueil seraient payés à chaque affichage.
 */
export const SQL_DEMARRAGE = `
  select
    (select count(*)::int from credentials c
      where c.organization_id = $1 and c.status = 'configured') as cles,
    (select count(*)::int from senders s
      where s.organization_id = $1 and s.kind = 'email' and s.is_active) as boites,
    (select count(*)::int from personas p
      where p.organization_id = $1) as personas,
    (select l.status from linkedin_server_sessions l
      where l.organization_id = $1) as linkedin_statut,
    -- Le motif distingue une panne d'une déconnexion voulue : une session révoquée s'écrit
    -- avec le statut bloquee et le motif revoquee (migration 20261005130000).
    (select l.blocked_reason from linkedin_server_sessions l
      where l.organization_id = $1) as linkedin_motif,
    -- Une source ne compte que si une campagne vivante (brouillon ou active) la porte : une source
    -- active reliée à aucune campagne, ou seulement à une campagne en pause ou archivée, ne
    -- collecte rien. Le compte brut d'avant la faisait passer au vert sur des restes de recette.
    (select count(distinct so.id)::int from sources so
      join campaign_sources cs on cs.source_id = so.id
      join campaigns ca on ca.id = cs.campaign_id
      where so.organization_id = $1 and so.is_active
        and ca.organization_id = $1 and ca.status in ('draft', 'active')) as sources,
    -- Une campagne lancée est ACTIVE et a de quoi envoyer : au moins une étape de séquence.
    (select count(*)::int from campaigns ca
      where ca.organization_id = $1 and ca.status = 'active'
        and exists (select 1 from sequence_steps st where st.campaign_id = ca.id)) as campagnes,
    -- Un brouillon est une campagne construite et pas encore lancée : c'est ce qu'il reste à faire.
    (select count(*)::int from campaigns ca
      where ca.organization_id = $1 and ca.status = 'draft') as brouillons
  /* jr:demarrage_six_verites */`;
