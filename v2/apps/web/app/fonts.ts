import { Instrument_Sans, Geist_Mono } from 'next/font/google';

// Chargées via next/font : self-hébergées, aucun appel externe à l'exécution.
// `display` reste un alias de `body` (Instrument Sans porte tout le kit, y
// compris les titres) le temps que globals.css et layout.tsx soient repris (tâche 5).
export const body = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600', '700'],
});
export const display = body;
export const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' });
