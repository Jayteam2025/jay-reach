import { SqueletteListe } from '../../squelette';

/** Fiche de campagne : en-tête chiffré, onglets, séquence. */
export default function Chargement() {
  return <SqueletteListe active="campaigns" cartes={3} />;
}
