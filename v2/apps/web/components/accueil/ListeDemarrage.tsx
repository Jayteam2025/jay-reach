/**
 * La liste de démarrage, en haut de l'écran Aujourd'hui (lot 5).
 *
 * Elle ne garde aucun état : elle affiche six vérités lues en base. Elle ne se masque pas d'elle-même
 * quand tout est vert : c'est l'écran qui décide de l'afficher (tant que l'opérateur ne l'a pas
 * fermée, et toujours quand un branchement a lâché) — c'est ce qui en fait un diagnostic et non un
 * tutoriel qu'on coche une fois.
 *
 * Composant serveur : chaque ligne non faite porte un lien vers l'écran qui la règle ; la fermeture
 * est un simple formulaire sur une action serveur, sans JavaScript côté navigateur.
 *
 * Il n'interpole aucun libellé. Les textes arrivent résolus depuis l'écran, qui seul connaît les
 * comptes : c'est ce qui permet au français d'accorder ses mesures (« 1 posée », « 7 posées »).
 */
import type { CleDemarrage, Demarrage, LigneDemarrage } from '@jay-reach/core';

export interface ListeDemarrageProps {
  demarrage: Demarrage;
  libelles: {
    /** Titre de la mise en route, et celui du retour quand un branchement a lâché. */
    titre: string;
    titreCasse: string;
    sousTitre: string;
    sousTitreCasse: string;
    /** Tout est branché : l'opérateur peut fermer le guide. */
    titreTerminee: string;
    sousTitreTerminee: string;
    avancement: string;
    lignes: Record<CleDemarrage, { titre: string; aide: string; bouton: string; mesure: string }>;
    fermer: string;
  };
  /** Ferme le guide pour l'utilisateur courant ; sans elle, aucun bouton de fermeture. */
  actionFermer?: () => Promise<void>;
}

function Marque({ ligne }: { ligne: LigneDemarrage }) {
  const etat = ligne.faite ? 'faite' : ligne.casse ? 'cassee' : 'avenir';
  return <span className={`jr-demarrage-marque jr-demarrage-marque--${etat}`} aria-hidden="true" />;
}

export function ListeDemarrage({ demarrage, libelles, actionFermer }: ListeDemarrageProps) {
  const casse = demarrage.lignes.some((l) => l.casse);
  const titre = casse ? libelles.titreCasse : demarrage.terminee ? libelles.titreTerminee : libelles.titre;
  const sousTitre = casse ? libelles.sousTitreCasse : demarrage.terminee ? libelles.sousTitreTerminee : libelles.sousTitre;

  return (
    <section className="jr-carte jr-demarrage" aria-labelledby="jr-demarrage-titre">
      <div className="jr-demarrage-entete">
        <div>
          <h2 id="jr-demarrage-titre">{titre}</h2>
          <p>{sousTitre}</p>
        </div>
        <span className="jr-demarrage-avancement mono">{libelles.avancement}</span>
      </div>

      <ul className="jr-demarrage-liste">
        {demarrage.lignes.map((ligne) => {
          const l = libelles.lignes[ligne.cle];
          const etat = ligne.faite ? 'faite' : ligne.casse ? 'cassee' : 'avenir';
          return (
            <li key={ligne.cle} className={`jr-demarrage-ligne jr-demarrage-ligne--${etat}`}>
              <Marque ligne={ligne} />
              <div className="jr-demarrage-quoi">
                <b>{l.titre}</b>
                {/* L'aide n'apparaît que tant qu'elle sert : une ligne faite n'a plus rien à expliquer. */}
                {!ligne.faite && <small>{l.aide}</small>}
              </div>
              {ligne.faite ? (
                <span className="jr-demarrage-mesure mono">{l.mesure}</span>
              ) : (
                <a className="jr-bouton petit" href={ligne.lien}>
                  {l.bouton}
                </a>
              )}
            </li>
          );
        })}
      </ul>

      {/* Un branchement qui a lâché garde le guide à l'écran quoi qu'on fasse : proposer de le
          fermer promettrait une chose que l'écran ne ferait pas. */}
      {actionFermer && !casse && (
        <form action={actionFermer} className="jr-demarrage-pied">
          <button type="submit" className="jr-lien">
            {libelles.fermer}
          </button>
        </form>
      )}
    </section>
  );
}
