import { describe, it, expect } from 'vitest';
import { ErreurEntree } from '@jay-reach/core';
import { ErreurGraph } from '@jay-reach/providers/mail';
import { ErreurSalesBlink } from '@jay-reach/providers/outreach';
import { messageErreurReponse } from './erreur-reponse';

describe('messageErreurReponse', () => {
  it("une erreur d'entrée est déjà écrite pour l'opérateur : son message passe tel quel", () => {
    expect(messageErreurReponse(new ErreurEntree("la réponse depuis Jay Reach n'existe que pour les fils email"))).toBe(
      "la réponse depuis Jay Reach n'existe que pour les fils email",
    );
  });

  it('un refus de la boîte Microsoft se distingue d’une panne quelconque', () => {
    const microsoft = messageErreurReponse(new ErreurGraph('graph_http', 403, "Application non autorisée sur ce tenant"));
    const quelconque = messageErreurReponse(new Error('connexion perdue'));

    expect(microsoft).not.toBe(quelconque);
    expect(microsoft).toBe("La boîte Microsoft a refusé l'envoi de la réponse.");
  });

  it('aucun détail du fournisseur ne remonte à l’écran', () => {
    const messages = [
      messageErreurReponse(new ErreurGraph('graph_http', 403, "Application non autorisée sur ce tenant zzz-detail")),
      messageErreurReponse(new ErreurSalesBlink('serveur', 500, 'corps de reponse zzz-detail')),
      messageErreurReponse(new Error('connexion perdue zzz-detail')),
    ];
    for (const message of messages) {
      expect(message).not.toContain('zzz-detail');
    }
  });

  it('une erreur du service d’envoi retombe sur le message générique, sans branche jumelle', () => {
    expect(messageErreurReponse(new ErreurSalesBlink('serveur', 500, 'corps'))).toBe(
      messageErreurReponse(new Error('autre chose')),
    );
  });
});
