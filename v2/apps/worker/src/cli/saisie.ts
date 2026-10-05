/**
 * Saisie au terminal. Séparée du CLI pour être testable avec des flux factices.
 *
 * Une saisie interrompue (Ctrl+C, flux fermé) REJETTE sa promesse : sans cela le
 * processus reste suspendu, le second Ctrl+C le tue sans passer par le `finally`
 * de la commande, et le verrou de la session reste pris jusqu'à son expiration.
 */
import { Writable, type Readable } from 'node:stream';
import { createInterface } from 'node:readline';

export interface Flux {
  input: Readable;
  output: NodeJS.WritableStream;
}

const STANDARD = (): Flux => ({ input: process.stdin, output: process.stdout });

export class SaisieInterrompue extends Error {
  constructor() {
    super('Saisie interrompue');
    this.name = 'SaisieInterrompue';
  }
}

function poser(
  invite: string,
  { input, output }: Flux,
  masquer: boolean,
  terminal: boolean,
): Promise<string> {
  let muet = false;
  const sortie = new Writable({
    write(morceau, encodage, suite) {
      if (!muet) output.write(morceau, encodage);
      suite();
    },
  });
  const rl = createInterface({ input, output: masquer ? sortie : output, terminal });
  return new Promise((resolve, reject) => {
    let repondu = false;
    rl.on('SIGINT', () => rl.close());
    rl.on('close', () => {
      muet = false;
      if (!repondu) {
        output.write('\n');
        reject(new SaisieInterrompue());
      }
    });
    if (masquer) {
      output.write(invite);
      muet = true;
    }
    rl.question(masquer ? '' : invite, (reponse) => {
      repondu = true;
      muet = false;
      rl.close();
      if (masquer) output.write('\n');
      resolve(masquer ? reponse : reponse.trim());
    });
  });
}

/** Saisie visible (identifiant). */
export function demander(
  invite: string,
  flux: Flux = STANDARD(),
  terminal = false,
): Promise<string> {
  return poser(invite, flux, false, terminal);
}

/** Saisie masquée : rien n'est écho sur le terminal. Exige un terminal interactif. */
export function demanderMasque(invite: string, flux?: Flux, terminal = true): Promise<string> {
  if (!flux && !process.stdin.isTTY) {
    return Promise.reject(new Error('Terminal interactif requis (lancer avec -it)'));
  }
  return poser(invite, flux ?? STANDARD(), true, terminal);
}
