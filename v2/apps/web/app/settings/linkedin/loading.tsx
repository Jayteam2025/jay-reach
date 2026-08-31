import { SqueletteEcran } from '../../squelette';

/** Trois compteurs d'activité, puis l'extension et les réglages d'envoi. */
export default function Chargement() {
  return <SqueletteEcran active="linkedin" stats={3} cartes={2} etroit />;
}
