/**
 * P5 : sans rechargement complet, l'état local des composants d'une ligne ne
 * doit pas migrer sur la ligne voisine quand la liste se raccourcit. Une ligne
 * indexée par sa position le ferait ; `cles` donne une identité stable.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Table } from './Table';
import { cleLigneContact, TableContacts, type LigneTableContacts } from '../campagne/TableContacts';

function lignesRendues(noeud: ReactNode, trouves: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(noeud)) noeud.forEach((n) => lignesRendues(n, trouves));
  else if (isValidElement(noeud)) {
    const el = noeud as ReactElement<{ children?: ReactNode }>;
    if (el.type === 'tr') trouves.push(el);
    lignesRendues(el.props.children, trouves);
  }
  return trouves;
}

const COLONNES = [{ cle: 'a', titre: 'A' }];

describe('Table : clé de ligne stable', () => {
  it('avec `cles`, la clé de la ligne suit son identité et non sa position', () => {
    const cles = (r: ReactElement) => lignesRendues(r).map((tr) => tr.key).filter((k) => k !== null);
    expect(cles(Table({ colonnes: COLONNES, lignes: [{ a: 'x' }, { a: 'y' }], cles: ['ct-1', 'ct-2'] }))).toEqual(['ct-1', 'ct-2']);
    // `ct-1` écarté : `ct-2` passe de la position 1 à 0 et garde sa clé, donc son état local.
    expect(cles(Table({ colonnes: COLONNES, lignes: [{ a: 'y' }], cles: ['ct-2'] }))).toEqual(['ct-2']);
  });

  it('sans `cles`, repli sur l’index (aperçus sans état)', () => {
    const lignes = lignesRendues(Table({ colonnes: COLONNES, lignes: [{ a: 'x' }, { a: 'y' }] }));
    expect(lignes.map((l) => l.key).filter((k) => k !== null)).toEqual(['0', '1']);
  });
});

describe('cleLigneContact : identité d’une ligne de TableContacts', () => {
  const base = { nom: 'N' } as unknown as LigneTableContacts;
  it('ne dépend pas de la position tant que la ligne a un identifiant', () => {
    const ligne = { ...base, contactId: 'ct-9', inscriptionId: null, signalId: null } as LigneTableContacts;
    expect(cleLigneContact(ligne, 0)).toBe(cleLigneContact(ligne, 7));
  });
  it('une même personne dans deux campagnes (vue globale) donne deux clés', () => {
    const a = { ...base, contactId: 'ct-9', campagneId: 'c1', inscriptionId: null, signalId: null } as LigneTableContacts;
    const b = { ...a, campagneId: 'c2' } as LigneTableContacts;
    expect(cleLigneContact(a, 0)).not.toBe(cleLigneContact(b, 0));
  });
  it('sans aucun identifiant, repli sur la position (jamais de collision)', () => {
    const ligne = { ...base, contactId: null, inscriptionId: null, signalId: null } as LigneTableContacts;
    expect(cleLigneContact(ligne, 3)).not.toBe(cleLigneContact(ligne, 4));
  });
});

describe('TableContacts : les lignes à boutons à état local sont clés par identité', () => {
  it('passe `cles` à Table, dans l’ordre des lignes, et la suppression d’une ligne ne décale pas les clés des autres', () => {
    const ligne = (id: string) => ({ nom: id, contactId: id, inscriptionId: null, signalId: null, statut: 'a_contacter' }) as unknown as LigneTableContacts;
    const rendre = (lignes: LigneTableContacts[]) =>
      (TableContacts({ lignes, colonnes: 'campagne', organisationId: 'o', campagneId: 'c', libelles: {} as never }) as ReactElement<{ cles: string[] }>).props.cles;
    expect(rendre([ligne('a'), ligne('b'), ligne('c')])).toEqual([':a', ':b', ':c']);
    expect(rendre([ligne('b'), ligne('c')])).toEqual([':b', ':c']);
  });
});
