import { describe, expect, it } from 'vitest';
import { countRejected, type AddLeadsResponse } from './smartlead.js';

/**
 * Reponses relevees sur l'API Smartlead reelle le 2026-08-28, en poussant des
 * leads dans une campagne jetable. Les noms de champs viennent de la, pas de la
 * documentation : le code lisait `added_count`, qui n'existe pas.
 */
describe('countRejected', () => {
  it('ne compte aucun refus sur un import propre', () => {
    const reponse: AddLeadsResponse = {
      ok: true,
      upload_count: 1,
      total_leads: 1,
      duplicate_count: 0,
      invalid_email_count: 0,
      already_added_to_campaign: 0,
      block_count: 0,
      unsubscribed_leads: [],
    };
    expect(countRejected(reponse)).toBe(0);
  });

  it('ne compte pas comme refus un lead deja present dans la campagne', () => {
    // Le cas qui donnait un compte rendu incoherent : deux leads soumis dont un
    // deja la produisaient « 2 pousses, 1 refuse », soit trois issues pour deux
    // entrees. Un lead deja present n'est pas rejete, il est simplement connu.
    const reponse: AddLeadsResponse = {
      ok: true,
      upload_count: 2,
      total_leads: 1,
      already_added_to_campaign: 1,
      duplicate_count: 0,
      invalid_email_count: 0,
      unsubscribed_leads: [],
    };
    expect(countRejected(reponse)).toBe(0);
    // Et c'est bien `total_leads` qui porte le nombre d'ajouts.
    expect(reponse.total_leads).toBe(1);
  });

  it('additionne les vrais motifs de refus', () => {
    const reponse: AddLeadsResponse = {
      duplicate_count: 2,
      invalid_email_count: 1,
      block_count: 1,
      unsubscribed_leads: [{ email: 'x@y.z' }],
      skipped_in_other_campaign_count: 3,
      lead_import_stopped_count: 1,
      already_added_to_campaign: 5,
    };
    expect(countRejected(reponse)).toBe(9);
  });

  it('traite une reponse partielle sans se casser', () => {
    // Smartlead n'envoie pas toujours tous les compteurs.
    expect(countRejected({ ok: true })).toBe(0);
  });
});
