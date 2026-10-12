'use client';

/**
 * Table éditable de l'écran Réglages › Plafonds (tâche 21, maquette
 * `reglages-plafonds.html`) : une ligne par réglage, valeur / défaut / repli /
 * modifié — édition ligne par ligne (« Modifier » → champ + Enregistrer/Annuler),
 * comme la maquette. Colonnes secondaires masquées sous 1180 px (`masquable`,
 * déjà posé par `composants.css`).
 */
import { useState, useTransition } from 'react';
import { BarreProgression, Bouton, Champ } from '../ui';
import { actionEcrireReglage } from '../../app/actions/plafonds';

/**
 * Ce qui a été consommé aujourd'hui sur ce plafond. Composé côté serveur, comme `modifie` :
 * ce composant ne compte rien et ne formate rien. `null` pour un réglage qui n'est pas un
 * volume — un score minimum ou un âge d'offre ne se consomment pas.
 */
export interface ConsommationLigne {
  /** Déjà composé (« 12 sur 300 », « sans limite »). */
  texte: string;
  pourcentage: number;
  ton: 'normal' | 'attention' | 'erreur';
}

export interface LignePlafond {
  cle: string;
  nom: string;
  description: string;
  valeur: number | string;
  defaut: number | string;
  /** Nom de la variable d'environnement de repli, `null` → « aucun ». */
  repli: string | null;
  /** Déjà composé côté serveur (auteur + date dans le fuseau de l'organisation), ou « jamais ». */
  modifie: string;
  type: 'nombre' | 'texte';
  suffixe?: string;
  /** `null` quand le réglage n'est pas un volume consommable. */
  consommation?: ConsommationLigne | null;
  /**
   * Ce plafond vaut zéro et arrête donc la production. Distingué à l'œil parce que c'est le
   * réglage qui a coupé l'enrichissement pendant des jours sans que l'écran le dise — c'est aussi
   * ce que l'alerte `plafond_a_zero` du tableau de bord signale.
   */
  arrete?: boolean;
}

export interface TablePlafondsProps {
  lignes: LignePlafond[];
  peutModifier: boolean;
  libelles: {
    colReglage: string;
    colConsomme: string;
    colValeur: string;
    colDefaut: string;
    colRepli: string;
    colModifie: string;
    modifier: string;
    enregistrer: string;
    annuler: string;
    aucunRepli: string;
    erreurNombre: string;
    sansObjet: string;
    arrete: string;
  };
}

export function TablePlafonds({ lignes, peutModifier, libelles }: TablePlafondsProps) {
  const [cleEnEdition, setCleEnEdition] = useState<string | null>(null);
  const [saisie, setSaisie] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function ouvrirEdition(ligne: LignePlafond) {
    setCleEnEdition(ligne.cle);
    setSaisie(String(ligne.valeur));
    setErreur(null);
  }

  function annuler() {
    setCleEnEdition(null);
    setErreur(null);
  }

  function enregistrer(ligne: LignePlafond) {
    setErreur(null);
    if (ligne.type === 'nombre' && (saisie.trim() === '' || Number.isNaN(Number(saisie)))) {
      setErreur(libelles.erreurNombre);
      return;
    }
    const valeur = ligne.type === 'nombre' ? Math.trunc(Number(saisie)) : saisie;
    startTransition(async () => {
      const res = await actionEcrireReglage(ligne.cle, valeur);
      if (res.ok) {
        setCleEnEdition(null);
      } else {
        setErreur(res.error);
      }
    });
  }

  return (
    <div className="jr-carte">
      <table className="jr-table">
        <thead>
          <tr>
            <th>{libelles.colReglage}</th>
            {/* La consommation passe devant le réglage : c'est elle qu'on vient lire, et un
                plafond seul ne dit jamais s'il est sur le point de bloquer. */}
            <th>{libelles.colConsomme}</th>
            <th>{libelles.colValeur}</th>
            <th className="masquable">{libelles.colDefaut}</th>
            <th className="masquable">{libelles.colRepli}</th>
            <th className="masquable">{libelles.colModifie}</th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((ligne) => {
            const enEdition = cleEnEdition === ligne.cle;
            return (
              <tr key={ligne.cle}>
                <td>
                  <b style={{ fontWeight: 600 }}>{ligne.nom}</b>
                  <small className="jr-secondaire" style={{ display: 'block', fontSize: 12 }}>
                    {ligne.description}
                  </small>
                </td>
                <td>
                  {ligne.consommation ? (
                    <>
                      <b style={{ fontSize: 15 }}>{ligne.consommation.texte}</b>
                      <BarreProgression valeur={ligne.consommation.pourcentage} ton={ligne.consommation.ton} />
                    </>
                  ) : (
                    <span className="jr-secondaire" style={{ fontSize: 12.5 }}>
                      {libelles.sansObjet}
                    </span>
                  )}
                </td>
                <td>
                  {!enEdition ? (
                    <>
                      <b style={{ fontSize: 15 }} className={ligne.arrete ? 'jr-valeur-arretee' : undefined}>
                        {ligne.valeur}
                        {ligne.suffixe ? ` ${ligne.suffixe}` : ''}
                      </b>
                      {peutModifier && (
                        <button
                          type="button"
                          className="jr-lien"
                          style={{ fontSize: 12.5, marginLeft: 8, background: 'none', border: 0, padding: 0 }}
                          onClick={() => ouvrirEdition(ligne)}
                        >
                          {libelles.modifier}
                        </button>
                      )}
                      {/* Après « Modifier », pas avant : `jr-etat-detail` est un bloc, et le
                          placer plus haut rejetait le lien d'édition sur une ligne à lui. */}
                      {ligne.arrete && (
                        <small className="jr-valeur-arretee jr-etat-detail">{libelles.arrete}</small>
                      )}
                    </>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div>
                        <Champ id={`plafond-${ligne.cle}`} erreur={erreur} suffixe={ligne.suffixe}>
                          <input
                            id={`plafond-${ligne.cle}`}
                            style={{ width: 120 }}
                            inputMode={ligne.type === 'nombre' ? 'numeric' : 'text'}
                            value={saisie}
                            onChange={(e) => setSaisie(e.target.value)}
                            disabled={pending}
                            autoFocus
                          />
                        </Champ>
                      </div>
                      <Bouton variante="principal" taille="petit" onClick={() => enregistrer(ligne)} disabled={pending} aria-busy={pending}>
                        {libelles.enregistrer}
                      </Bouton>
                      <Bouton taille="petit" onClick={annuler} disabled={pending}>
                        {libelles.annuler}
                      </Bouton>
                    </div>
                  )}
                </td>
                <td className="jr-secondaire masquable">{ligne.defaut}</td>
                <td className="jr-secondaire masquable" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                  {ligne.repli ?? libelles.aucunRepli}
                </td>
                <td className="jr-secondaire masquable" style={{ fontSize: 12.5 }}>
                  {ligne.modifie}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
