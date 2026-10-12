import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chiffrer, ErreurChiffrement } from '../chiffrement.js';
import type { Contexte } from './contexte.js';
import { CANAL_CONNEXION_LINKEDIN, emettreMessageConnexion, lireMessageConnexion, type MessageConnexion } from './linkedin-canal.js';

const CLE = 'a'.repeat(64);
const AUTRE_CLE = 'b'.repeat(64);

let ancienne: string | undefined;
beforeEach(() => {
  ancienne = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = CLE;
});
afterEach(() => {
  if (ancienne === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ancienne;
});

/** Contexte factice qui capture ce qui part en base. */
function ctxCapture(): { ctx: Contexte; appels: { texte: string; valeurs: unknown[] }[] } {
  const appels: { texte: string; valeurs: unknown[] }[] = [];
  const ctx: Contexte = {
    ex: {
      query: async <T>(texte: string, valeurs: unknown[] = []) => {
        appels.push({ texte, valeurs });
        return { rows: [] as T[], rowCount: 0 };
      },
    },
    organisationId: 'o1',
    utilisateurId: 'u1',
    role: 'admin',
  };
  return { ctx, appels };
}

async function allerRetour(message: MessageConnexion): Promise<{ recu: MessageConnexion; charge: string }> {
  const { ctx, appels } = ctxCapture();
  await emettreMessageConnexion(ctx, message);
  expect(appels).toHaveLength(1);
  expect(appels[0]!.valeurs[0]).toBe(CANAL_CONNEXION_LINKEDIN);
  const charge = String(appels[0]!.valeurs[1]);
  return { recu: await lireMessageConnexion(charge), charge };
}

describe('canal chiffré de connexion LinkedIn', () => {
  it('test_un_message_chiffre_revient_identique', async () => {
    const messages: MessageConnexion[] = [
      { demandeId: 'd1', organizationId: 'o1', type: 'secrets', identifiant: 'alex@exemple.fr', motDePasse: 'motdepasse' },
      { demandeId: 'd1', organizationId: 'o1', type: 'code', code: '123456' },
      { demandeId: 'd1', organizationId: 'o1', type: 'deconnexion' },
    ];
    for (const m of messages) {
      const { recu, charge } = await allerRetour(m);
      expect(recu).toEqual(m);
      expect(charge).not.toContain('motdepasse');
    }
  });

  it('test_un_mot_de_passe_accentue_traverse_sans_alteration', async () => {
    const motDePasse = 'Mot dé passé "çà" & €';
    const { recu, charge } = await allerRetour({
      demandeId: 'd1', organizationId: 'o1', type: 'secrets', identifiant: 'a@b.fr', motDePasse,
    });
    expect(recu).toMatchObject({ type: 'secrets', motDePasse });
    expect(charge).not.toContain('passé');
  });

  it('test_une_charge_indechiffrable_leve_une_erreur_sans_citer_la_charge', async () => {
    const charge = await chiffrer(JSON.stringify({ type: 'code', demandeId: 'd', organizationId: 'o', code: '654321' }));
    process.env.ENCRYPTION_KEY = AUTRE_CLE;
    const erreur = await lireMessageConnexion(charge).catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(ErreurChiffrement);
    const texte = `${(erreur as Error).message} ${(erreur as Error).stack ?? ''}`;
    expect(texte).not.toContain(charge);
    expect(texte).not.toContain(CLE);
    expect(texte).not.toContain(AUTRE_CLE);
    expect(texte).not.toContain('654321');
  });

  it('une charge déchiffrée de forme inattendue est refusée comme illisible', async () => {
    const charge = await chiffrer(JSON.stringify({ type: 'inconnu' }));
    await expect(lireMessageConnexion(charge)).rejects.toMatchObject({ code: 'charge_illisible' });
    await expect(lireMessageConnexion('pas-du-base64!')).rejects.toMatchObject({ code: 'charge_illisible' });
  });

  it('une entrée invalide n\'émet rien', async () => {
    const { ctx, appels } = ctxCapture();
    const faux = { demandeId: 'd', organizationId: 'o', type: 'secrets', identifiant: '', motDePasse: 'x' } as MessageConnexion;
    await expect(emettreMessageConnexion(ctx, faux)).rejects.toThrow();
    expect(appels).toHaveLength(0);
  });
});
