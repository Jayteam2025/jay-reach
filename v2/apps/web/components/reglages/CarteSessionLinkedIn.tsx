/**
 * Le canal LinkedIn vu depuis Réglages › Expéditeurs (lot 5).
 *
 * Cette section listait les jetons de l'EXTENSION navigateur, gelée depuis le lot 4a : elle
 * montrait des comptes qui n'envoient plus rien, et affichait « aucun envoi ne partira :
 * expéditeur non activé » alors que l'expéditeur du serveur était actif en base. Elle montre
 * désormais la seule chose qui envoie vraiment : la session ouverte sur le serveur.
 *
 * Composant serveur : aucune interaction ici, les réglages vivent sur l'écran LinkedIn.
 */
import { Carte, TuileLogo } from '../ui';

export interface CarteSessionLinkedInProps {
  /** L'état de la session du serveur, `null` quand aucun compte n'est branché. */
  session: {
    compteIdentifiant: string | null;
    ipVue: string | null;
    derniereCollecte: Date | null;
  } | null;
  /** La phrase d'état déjà traduite, et son ton, tels que l'écran LinkedIn les compose. */
  etat: { ton: string; phrase: string };
  /**
   * Les envois de la semaine, DÉJÀ composés par l'appelant avec `parametresValeurConsommation` :
   * aucun écran ne fabrique un « utilisé / plafond » à la main, un plafond nul ou absent ne se dit
   * pas comme un nombre (garde `plafond-affiche.test.ts`).
   */
  envoisTexte: string | null;
  libelles: {
    titre: string;
    sousTitre: string;
    compte: string;
    comptePasEncore: string;
    sortie: string;
    envoisSemaine: string;
    derniereCollecte: string;
    jamais: string;
    inconnu: string;
    regler: string;
    connecter: string;
  };
  /** Rendu de la date de dernière collecte, dans le fuseau de l'organisation. */
  formaterCollecte: (quand: Date) => string;
}

export function CarteSessionLinkedIn({
  session,
  etat,
  envoisTexte,
  libelles,
  formaterCollecte,
}: CarteSessionLinkedInProps) {
  return (
    <Carte
      entete={
        <div className="jr-qui">
          <TuileLogo marque="linkedin" taille="grande" />
          <span>
            <b>{libelles.titre}</b>
            <small>{libelles.sousTitre}</small>
          </span>
        </div>
      }
    >
      <div className="jr-session-etat">
        <span className={`jr-session-pastille ${etat.ton}`} aria-hidden="true" />
        <div>
          <p className="jr-session-phrase">{etat.phrase}</p>
        </div>
      </div>

      <dl className="jr-session-faits">
        <div>
          <dt>{libelles.compte}</dt>
          <dd>
            {session?.compteIdentifiant ? (
              <a
                className="jr-lien mono"
                href={`https://www.linkedin.com/in/${session.compteIdentifiant}`}
                target="_blank"
                rel="noreferrer"
              >
                {session.compteIdentifiant}
              </a>
            ) : (
              libelles.comptePasEncore
            )}
          </dd>
        </div>
        <div>
          <dt>{libelles.sortie}</dt>
          <dd className="mono">{session?.ipVue ?? libelles.inconnu}</dd>
        </div>
        {/* Le chiffre qui dit si le canal travaille. Affiché seulement s'il est mesuré :
            un « 0 sur 0 » inventé vaudrait moins que rien. */}
        {envoisTexte !== null && (
          <div>
            <dt>{libelles.envoisSemaine}</dt>
            <dd className="mono">{envoisTexte}</dd>
          </div>
        )}
        <div>
          <dt>{libelles.derniereCollecte}</dt>
          <dd className="mono">
            {session?.derniereCollecte ? formaterCollecte(session.derniereCollecte) : libelles.jamais}
          </dd>
        </div>
      </dl>

      <p className="jr-session-action">
        <a className="jr-lien" href="/settings/linkedin">
          {session ? libelles.regler : libelles.connecter}
        </a>
      </p>
    </Carte>
  );
}
