import { describe, it, expect } from 'vitest';
import { manquesTransportEmail } from './transport-email';

describe('manquesTransportEmail', () => {
  it('signale la clé absente et aucun expéditeur relié quand rien n’est configuré', () => {
    expect(manquesTransportEmail({ cleStatus: null, boites: [] })).toEqual([
      'noSalesBlinkKey',
      'noBoundEmailSender',
    ]);
  });

  it('signale la clé non configurée même avec un statut différent de "configured"', () => {
    expect(manquesTransportEmail({ cleStatus: 'unconfigured', boites: [] })).toEqual([
      'noSalesBlinkKey',
      'noBoundEmailSender',
    ]);
  });

  it('signale l’absence d’expéditeur relié quand la clé est configurée mais aucune boîte n’est reliée', () => {
    const manques = manquesTransportEmail({
      cleStatus: 'configured',
      boites: [
        { provider_ref: null, provider_state: null },
        { provider_ref: null, provider_state: { sending_enabled: true } },
      ],
    });
    expect(manques).toEqual(['noBoundEmailSender']);
  });

  it('signale l’expéditeur relié mais coupé quand aucune boîte reliée n’a l’envoi actif', () => {
    const manques = manquesTransportEmail({
      cleStatus: 'configured',
      boites: [{ provider_ref: 'sblk-1', provider_state: { sending_enabled: false } }],
    });
    expect(manques).toEqual(['emailSenderDisconnected']);
  });

  it('ne signale rien quand tout est prêt', () => {
    const manques = manquesTransportEmail({
      cleStatus: 'configured',
      boites: [
        { provider_ref: 'sblk-1', provider_state: { sending_enabled: false } },
        { provider_ref: 'sblk-2', provider_state: { sending_enabled: true } },
      ],
    });
    expect(manques).toEqual([]);
  });

  it('considère une boîte reliée sans état de santé connu comme prête (sending_enabled absent, jamais relevée)', () => {
    const manques = manquesTransportEmail({
      cleStatus: 'configured',
      boites: [{ provider_ref: 'sblk-1', provider_state: null }],
    });
    expect(manques).toEqual([]);
  });
});
