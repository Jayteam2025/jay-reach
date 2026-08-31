import { SqueletteListe } from '../../squelette';

/** Les fournisseurs, groupés par catégorie. */
export default function Chargement() {
  return <SqueletteListe active="providers" cartes={4} />;
}
