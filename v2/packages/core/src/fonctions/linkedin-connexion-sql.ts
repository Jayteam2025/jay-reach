/**
 * Le SQL de `linkedin-connexion.ts`, seul dans un fichier sans import : le harnais
 * `test/pg-verify/linkedin-connexion-actions.sh` l'exécute tel quel contre un vrai Postgres.
 * Un test sur pool factice ne prouve rien d'une requête.
 */
const EN_COURS = "('demandee','navigateur_ouvert','code_demande','approbation_demandee')";

/** Quinze minutes : la fermeture du formulaire, comme le verrou. */
export const FERMETURE_FORMULAIRE_MINUTES = 15;
/** Trois échecs d'affilée ferment le formulaire. */
export const ECHECS_AVANT_FERMETURE = 3;
/** Au-delà, une demande restée `demandee` sans accusé du worker est jugée sans worker. */
export const DELAI_WORKER_ABSENT_SECONDES = 15;
/** Une demande terminée reste lisible deux minutes : le temps que l'écran qui sonde voit finir. */
export const VISIBILITE_RESULTAT_SECONDES = 120;

/** $1 = organisation. Fait expirer ses demandes abandonnées : sans cela l'index unique bloquerait le geste suivant. */
export const SQL_EXPIRER_DE_L_ORGANISATION = `update linkedin_connexion_demandes
          set statut = 'echec', motif = 'delai', etape = null, updated_at = now()
        where organization_id = $1 and statut in ${EN_COURS} and expires_at < now()`;

/**
 * $1 = organisation. `ferme` vrai si les trois derniers résultats « qui comptent » sont des échecs et que le
 * dernier date de moins d'un quart d'heure. Ne comptent pas : ce qui n'a jamais atteint LinkedIn (worker absent,
 * verrou pris, sortie réseau refusée) et l'annulation par l'opérateur. Un succès rompt la série.
 */
export const SQL_FORMULAIRE_FERME = `with recentes as (
         select statut, updated_at from linkedin_connexion_demandes
          where organization_id = $1 and statut in ('reussi', 'echec')
            and not (statut = 'echec' and motif in
                     ('annulee', 'worker_absent', 'verrou_occupe', 'sortie_inattendue', 'sortie_serveur', 'erreur_interne'))
          order by updated_at desc limit ${ECHECS_AVANT_FERMETURE})
       select (count(*) filter (where statut = 'echec') = ${ECHECS_AVANT_FERMETURE}
               and max(updated_at) > now() - interval '${FERMETURE_FORMULAIRE_MINUTES} minutes') as ferme,
              max(updated_at) + interval '${FERMETURE_FORMULAIRE_MINUTES} minutes' as rouvre_a
         from recentes`;

/** $1 = organisation, $2 = utilisateur. Refusée par l'index unique (23505) s'il y a déjà une demande en cours. */
export const SQL_CREER_DEMANDE = `insert into linkedin_connexion_demandes (organization_id, demandee_par, statut)
       values ($1, $2, 'demandee') returning id`;

/**
 * $1 = organisation. Une demande sans accusé du worker (statut `demandee`, aucune étape) après
 * quinze secondes : personne d'autre que cette requête ne peut dire que le worker est absent.
 */
export const SQL_POSER_WORKER_ABSENT = `update linkedin_connexion_demandes
          set statut = 'echec', motif = 'worker_absent', etape = null, updated_at = now()
        where organization_id = $1 and statut = 'demandee' and etape is null
          and created_at < now() - interval '${DELAI_WORKER_ABSENT_SECONDES} seconds'`;

/** $1 = organisation. La demande en cours, sinon la dernière terminée depuis moins de deux minutes. */
export const SQL_LIRE_DEMANDE = `select id, statut, motif, etape, created_at, expires_at
         from linkedin_connexion_demandes
        where organization_id = $1
          and (statut in ${EN_COURS} or updated_at > now() - interval '${VISIBILITE_RESULTAT_SECONDES} seconds')
        order by created_at desc limit 1`;

/** $1 = demande, $2 = organisation. Ne touche qu'une demande encore en cours de CETTE organisation. */
export const SQL_ANNULER = `update linkedin_connexion_demandes
          set statut = 'echec', motif = 'annulee', etape = null, updated_at = now()
        where id = $1 and organization_id = $2 and statut in ${EN_COURS}
        returning id`;

/** $1 = demande, $2 = organisation. Vraie ligne seulement si la demande attend bien un code. */
export const SQL_ATTEND_UN_CODE = `select id from linkedin_connexion_demandes
        where id = $1 and organization_id = $2 and statut = 'code_demande' and expires_at > now()`;

/** $1 = demande. Le message n'a pas pu partir : la demande se ferme tout de suite. */
export const SQL_ECHEC_TRANSMISSION = `update linkedin_connexion_demandes
          set statut = 'echec', motif = 'worker_absent', etape = null, updated_at = now()
        where id = $1 and statut in ${EN_COURS}`;

/**
 * $1 = organisation. Persiste l'intention de déconnexion (crée la ligne de session au besoin) : le worker la
 * reprend au démarrage et à la fin d'une connexion, le message `pg_notify` n'étant pas rejoué. Chaque demande
 * RENOUVELLE l'horodatage : un solde « tel que lu » ne peut donc jamais effacer une demande plus récente.
 */
export const SQL_POSER_DECONNEXION = `insert into linkedin_server_sessions (organization_id, deconnexion_demandee_at)
       values ($1, now())
       on conflict (organization_id) do update
          set deconnexion_demandee_at = now()`;
