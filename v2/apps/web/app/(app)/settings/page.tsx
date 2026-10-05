import { redirect } from 'next/navigation';

/** `/settings` n'a pas d'écran propre : la première page de la sous-navigation fait l'accueil. */
export default function ReglagesIndex() {
  redirect('/settings/senders');
}
