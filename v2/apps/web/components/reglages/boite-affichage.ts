/**
 * Logique d'affichage pure de la carte d'une boîte email (tâche 20) —
 * séparée de `CarteBoite.tsx` pour rester testable sans `useRouter`/contexte
 * App Router (même exemption que `BoutonLancerPause.tsx`, dont le composant
 * lui-même ne s'unit-teste pas).
 */
import type { Boite } from '@jay-reach/core';
import type { PuceTon } from '../ui';

/**
 * Puce d'état d'une carte de boîte : priorité à ce qui empêche vraiment
 * d'envoyer ou de recevoir (non reliée, santé indisponible, déconnectée),
 * puis seulement l'activation choisie par l'opérateur.
 */
export function puceEtatBoite(boite: Pick<Boite, 'active' | 'sante'>): { ton: PuceTon; cle: string } {
  if (boite.sante.etat === 'sans_objet') return { ton: 'gris', cle: 'notLinked' };
  if (boite.sante.etat === 'indisponible') return { ton: 'attention', cle: 'healthUnavailable' };
  if (boite.sante.etat === 'connue' && !boite.sante.connectee) return { ton: 'attention', cle: 'disconnected' };
  return boite.active ? { ton: 'bon', cle: 'active' } : { ton: 'gris', cle: 'inactive' };
}

/**
 * La boîte est active, mais son quota du jour vaut zéro : elle n'enverra rien, et sa puce verte
 * dirait le contraire. C'est le même aveuglement que celui qui a laissé l'app annoncer « moteur en
 * marche » pendant une semaine sans envoi, et le pendant du marqueur « arrêté » de la table des
 * plafonds.
 *
 * Un quota `null` n'est pas zéro : il veut dire « aucune limite réglée », donc la boîte envoie.
 * Une boîte déjà inactive n'a rien à signaler de plus — sa puce le dit déjà.
 */
export function boiteArretee(boite: Pick<Boite, 'active' | 'quotas'>): boolean {
  return boite.active && boite.quotas.jour === 0;
}

/**
 * Le titre d'une carte de boîte : l'ADRESSE COMPLÈTE d'abord, le nom d'affichage ensuite. Trois
 * boîtes d'un même dirigeant (a.declercq@, alex.declercq@, alexandre@) portent le même nom
 * d'affichage chez le fournisseur d'envoi : seul l'email les distingue, il se lit donc en premier.
 * Le nom n'est repris en complément que s'il apporte quelque chose, c'est-à-dire s'il existe et
 * n'est pas déjà l'adresse.
 */
export function titreBoite(boite: Pick<Boite, 'identite' | 'nomAffiche'>): { titre: string; complement: string | null } {
  const nom = boite.nomAffiche?.trim();
  return {
    titre: boite.identite,
    complement: nom && nom.toLowerCase() !== boite.identite.toLowerCase() ? nom : null,
  };
}
