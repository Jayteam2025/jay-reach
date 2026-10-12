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
    (select count(*)::int from sources so
      where so.organization_id = $1 and so.is_active) as sources,
    (select count(*)::int from campaigns ca
      where ca.organization_id = $1 and ca.status = 'active') as campagnes
  /* jr:demarrage_six_verites */`;
