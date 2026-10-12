/**
 * La liste de démarrage, en haut de l'écran Aujourd'hui (lot 5).
 *
 * Elle ne garde aucun état : elle affiche six vérités lues en base. Elle disparaît quand tout est
 * branché, et revient si quelque chose se débranche — c'est ce qui en fait un diagnostic et non un
 * tutoriel qu'on coche une fois.
 *
 * Composant serveur : chaque ligne non faite porte un lien vers l'écran qui la règle, rien d'autre.
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
    avancement: string;
    lignes: Record<CleDemarrage, { titre: string; aide: string; bouton: string; mesure: string }>;
  };
}

function Marque({ ligne }: { ligne: LigneDemarrage }) {
  const etat = ligne.faite ? 'faite' : ligne.casse ? 'cassee' : 'avenir';
  return <span className={`jr-demarrage-marque jr-demarrage-marque--${etat}`} aria-hidden="true" />;
}

export function ListeDemarrage({ demarrage, libelles }: ListeDemarrageProps) {
  // Rien à dire quand tout tient : le bloc ne survit pas à sa raison d'être.
  if (demarrage.terminee) return null;

  const casse = demarrage.lignes.some((l) => l.casse);

  return (
    <section className="jr-carte jr-demarrage" aria-labelledby="jr-demarrage-titre">
      <div className="jr-demarrage-entete">
        <div>
          <h2 id="jr-demarrage-titre">{casse ? libelles.titreCasse : libelles.titre}</h2>
          <p>{casse ? libelles.sousTitreCasse : libelles.sousTitre}</p>
        </div>
        <span className="jr-demarrage-avancement mono">
          {libelles.avancement
            .replace('{faites}', String(demarrage.faites))
            .replace('{total}', String(demarrage.total))}
        </span>
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
              {ligne.faite && ligne.compte !== null ? (
                <span className="jr-demarrage-mesure mono">
                  {l.mesure.replace('{n}', String(ligne.compte))}
                </span>
              ) : ligne.faite ? (
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
    </section>
  );
}
