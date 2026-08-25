import { Archivo, Geist, Geist_Mono } from 'next/font/google';

// Chargées via next/font : self-hébergées, aucun appel externe à l'exécution.
export const display = Archivo({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-display',
});
export const body = Geist({ subsets: ['latin'], variable: '--font-body' });
export const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-mono' });
