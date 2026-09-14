import { SqueletteListe } from '../../squelette';

/** Un expéditeur par carte : nom affiché, plafonds, mise en service. */
export default function Chargement() {
  return <SqueletteListe active="senders" cartes={3} />;
}
