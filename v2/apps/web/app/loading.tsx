import { SqueletteEcran } from './squelette';

/** Quatre compteurs en tête, puis l'activité et les signaux sans campagne. */
export default function Chargement() {
  return <SqueletteEcran active="dashboard" stats={4} cartes={2} />;
}
