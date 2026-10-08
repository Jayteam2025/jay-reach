import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { runLinkedInDispatch, type DispatchJob } from './dispatch.js';

function poolFactice() {
  const query = vi.fn(async () => ({ rows: [{ id: 'q-1' }], rowCount: 1 }));
  return { pool: { query } as unknown as Pool, query };
}

describe('runLinkedInDispatch', () => {
  it('enfile une action executee par le serveur', async () => {
    const { pool, query } = poolFactice();
    await runLinkedInDispatch(pool, {
      organizationId: 'org-1',
      channel: 'linkedin_invite',
      actionId: 'a-1',
      linkedin: { linkedinUrl: 'https://www.linkedin.com/in/x' },
    });
    const valeurs = (query.mock.calls[0] as unknown as [string, unknown[]])[1];
    // Colonne `method` : septieme parametre de l insertion.
    expect(valeurs[6]).toBe('serveur');
  });

  it('ignore la methode portee par un job deja en file avant le deploiement', async () => {
    const { pool, query } = poolFactice();
    // Les jobs `actions.dispatch` deposes par l ancien sequenceur portent encore
    // `method: 'extension_auto'` : ils ne doivent pas rabattre l action sur l extension.
    const ancienne = { linkedinUrl: 'https://www.linkedin.com/in/x', messageBody: 'Bonjour', method: 'extension_auto' };
    await runLinkedInDispatch(pool, {
      organizationId: 'org-1',
      channel: 'linkedin_message',
      linkedin: ancienne as DispatchJob['linkedin'],
    });
    const valeurs = (query.mock.calls[0] as unknown as [string, unknown[]])[1];
    expect(valeurs[6]).toBe('serveur');
  });
});
