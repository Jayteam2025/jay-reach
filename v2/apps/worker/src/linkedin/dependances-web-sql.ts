/**
 * Le SQL de `dependances-web.ts`, seul dans un fichier sans import : le harnais
 * `test/pg-verify/linkedin-connexion-web.sh` l'exécute tel quel contre un vrai Postgres.
 * Un test sur pool factice ne prouve rien d'une requête.
 */
const EN_COURS = "('demandee','navigateur_ouvert','code_demande')";

/** $1 = id de la demande ; `ok` vrai si elle est encore en cours et non expirée. */
export const SQL_VERIFIER_EN_COURS = `select (statut in ${EN_COURS} and expires_at > now()) as ok
         from linkedin_connexion_demandes where id = $1`;

/** $1 = id, $2 = étape, $3 = statut, $4 = motif ; null = ne pas toucher. Ne touche qu'une demande en cours. */
export const SQL_ECRIRE_ETAT = `update linkedin_connexion_demandes
          set etape = coalesce($2, etape), statut = coalesce($3, statut), motif = coalesce($4, motif),
              updated_at = now()
        where id = $1 and statut in ${EN_COURS}`;
