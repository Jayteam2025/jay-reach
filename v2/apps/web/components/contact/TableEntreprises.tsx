import type { EntrepriseLigne } from '@jay-reach/core';
import { Table, TuileLogo } from '../ui';

export interface TableEntreprisesLibelles {
  colonneEntreprise: string;
  colonneSecteur: string;
  colonneTaille: string;
  colonneVille: string;
  colonneContacts: string;
  colonneLiens: string;
  site: string;
  inconnu: string;
  vide: string;
}

export interface TableEntreprisesProps {
  lignes: readonly EntrepriseLigne[];
  libelles: TableEntreprisesLibelles;
}

/** Onglet « Entreprises » de la page Contacts globale (tâche 18, spec §6.11). */
export function TableEntreprises({ lignes, libelles }: TableEntreprisesProps) {
  return (
    <Table
      colonnes={[
        { cle: 'entreprise', titre: libelles.colonneEntreprise },
        { cle: 'secteur', titre: libelles.colonneSecteur },
        { cle: 'taille', titre: libelles.colonneTaille, num: true },
        { cle: 'ville', titre: libelles.colonneVille },
        { cle: 'contacts', titre: libelles.colonneContacts, num: true },
        { cle: 'liens', titre: libelles.colonneLiens },
      ]}
      vide={libelles.vide}
      lignes={lignes.map((ligne) => ({
        entreprise: (
          <div className="jr-qui">
            <TuileLogo marque="lettre" lettre={ligne.nom.charAt(0).toUpperCase()} />
            <span>
              <b>{ligne.nom}</b>
              {ligne.domaine && <small>{ligne.domaine}</small>}
            </span>
          </div>
        ),
        secteur: ligne.secteur ?? libelles.inconnu,
        taille: ligne.effectif ?? libelles.inconnu,
        ville: ligne.ville ?? libelles.inconnu,
        contacts: ligne.contactsConnus,
        liens: (
          <>
            {ligne.domaine && (
              <a href={`https://${ligne.domaine}`} target="_blank" rel="noreferrer" className="jr-lien">
                {libelles.site}
              </a>
            )}
            {ligne.domaine && ligne.linkedinUrl && ' · '}
            {ligne.linkedinUrl && (
              <a href={ligne.linkedinUrl} target="_blank" rel="noreferrer" className="jr-lien">
                {'LinkedIn'}
              </a>
            )}
            {!ligne.domaine && !ligne.linkedinUrl && <span className="jr-secondaire">{libelles.inconnu}</span>}
          </>
        ),
      }))}
    />
  );
}
