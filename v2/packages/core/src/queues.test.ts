import { describe, expect, it } from 'vitest';
import { QUEUES } from './queues.js';

const file = (nom: string) => QUEUES.find((q) => q.name === nom);

describe('files de fond', () => {
  it('la file d envoi ne rejoue jamais un job', () => {
    // Un envoi rejoue est une seconde invitation a la meme personne : rien ne la rattrape.
    expect(file('linkedin.envoi')?.retry).toEqual({ retryLimit: 0, retryBackoff: false });
  });

  it('la file d envoi n admet qu un job en attente et un job actif par organisation', () => {
    // `stately` : index unique (file, etat, cle) sur created et active. La cle est
    // l organisation, donc deux jobs d envoi d une meme organisation ne tournent jamais ensemble.
    expect(file('linkedin.envoi')?.policy).toBe('stately');
  });

  it('les autres files gardent la politique standard', () => {
    expect(file('linkedin.collecte')?.policy).toBeUndefined();
  });
});
