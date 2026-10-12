/**
 * Le SQL de `traiter-connexion.ts`, seul dans un fichier sans import : le harnais
 * `test/pg-verify/linkedin-connexion-actions.sh` l'exécute tel quel contre un vrai Postgres.
 */
const EN_COURS = "('demandee','navigateur_ouvert','code_demande')";

/** $1 = demande. Ce que le worker vérifie avant de toucher au navigateur : la demande existe, est en cours, de quelle organisation et de qui. */
export const SQL_LIRE_DEMANDE_A_TRAITER = `select organization_id, demandee_par, (statut in ${EN_COURS} and expires_at > now()) as en_cours
         from linkedin_connexion_demandes where id = $1`;

/** $1 = demande. Accusé de réception (étape `recue`, le navigateur n'est PAS encore ouvert) : le worker a pris la demande (sans lui, la lecture de l'écran la juge sans worker après 15 s). */
export const SQL_ACCUSER_RECEPTION = `update linkedin_connexion_demandes
          set etape = 'recue', updated_at = now()
        where id = $1 and statut = 'demandee' and etape is null`;

/**
 * $1 = demande, $2 = motif. Clôt une demande restée en cours alors que la connexion est finie ou a levé :
 * l'écran dit quelque chose tout de suite, au lieu de rester figé jusqu'à l'expiration. Ne touche pas
 * une demande déjà terminée (réussite, ou motif précis posé par la mécanique, ou annulation).
 */
export const SQL_CLORE_SI_EN_COURS = `update linkedin_connexion_demandes
          set statut = 'echec', motif = $2, etape = null, updated_at = now()
        where id = $1 and statut in ${EN_COURS}`;

/** $1 = demande. Issue finale, pour le journal d'audit. */
export const SQL_LIRE_ISSUE = `select statut, motif from linkedin_connexion_demandes where id = $1`;

/**
 * Au démarrage du worker : aucune demande ne survit à un redémarrage (un navigateur par processus, état en
 * mémoire). Toute demande encore en cours est donc orpheline ; elle se clôt tout de suite en `worker_absent`.
 */
export const SQL_CLORE_ORPHELINES = `update linkedin_connexion_demandes
          set statut = 'echec', motif = 'worker_absent', etape = null, updated_at = now()
        where statut in ${EN_COURS}`;

/** Purge des demandes abandonnées (fonction `service_role`, migration 20261012130000). */
export const SQL_PURGER = 'select public.purger_linkedin_connexion_demandes() as supprimees';

/**
 * $1 = organisation. Le worker pose lui aussi l'intention de déconnexion dès qu'il reçoit le message : elle est
 * durable avant d'être jouée (le cœur la pose déjà côté écran ; ceci couvre un message arrivé d'ailleurs).
 */
export const SQL_POSER_DECONNEXION = `insert into linkedin_server_sessions (organization_id, deconnexion_demandee_at)
       values ($1, now())
       on conflict (organization_id) do update
          set deconnexion_demandee_at = now()`;

/** $1 = organisation. L'intention de déconnexion en attente, ou aucune ligne. */
export const SQL_LIRE_DECONNEXION = `select deconnexion_demandee_at::text as demandee_at
         from linkedin_server_sessions where organization_id = $1 and deconnexion_demandee_at is not null`;

/** Au démarrage : les organisations dont une déconnexion n'a pas abouti. */
export const SQL_DECONNEXIONS_EN_ATTENTE = `select organization_id from linkedin_server_sessions where deconnexion_demandee_at is not null`;

/**
 * $1 = organisation, $2 = l'intention telle qu'elle a été LUE au départ (en TEXTE : un `Date` JS perd les
 * microsecondes et l'égalité ne tiendrait jamais). Solde l'intention seulement si c'est
 * encore la même : une nouvelle demande arrivée pendant l'exécution reste en attente.
 */
export const SQL_SOLDER_DECONNEXION = `update linkedin_server_sessions set deconnexion_demandee_at = null
        where organization_id = $1 and deconnexion_demandee_at = $2::timestamptz`;

/**
 * $1 = organisation. Une nouvelle connexion remplace une intention de déconnexion plus ancienne : sans cela, le
 * démarrage suivant déconnecterait un compte que l'utilisateur vient de reconnecter. Posée au début de la
 * connexion : une déconnexion demandée PENDANT elle (plus récente) survit.
 */
export const SQL_EFFACER_DECONNEXION_A_LA_CONNEXION = `update linkedin_server_sessions set deconnexion_demandee_at = null
        where organization_id = $1 and deconnexion_demandee_at is not null`;
