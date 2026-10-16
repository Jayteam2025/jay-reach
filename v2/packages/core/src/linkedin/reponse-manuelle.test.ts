import { describe, expect, it } from 'vitest';
import type { Executeur } from '../executeur.js';
import { ErreurReponseImpossible } from '../inbox/erreur-reponse.js';
import { enfilerReponseLinkedIn, marquerReponseEnvoyee, signalerEchecReponse } from './reponse-manuelle.js';

type Appel = { text: string; values: unknown[] };

function fabrique(fil: Record<string, unknown> | null, rowCountMaj = 1) {
  const appels: Appel[] = [];
  const ex: Executeur = {
    async query<T>(text: string, values: unknown[] = []) {
      appels.push({ text, values });
      const t = text.trim();
      if (t.startsWith('select t.channel')) return { rows: (fil ? [fil] : []) as T[], rowCount: fil ? 1 : 0 };
      if (t.startsWith('insert into linkedin_action_queue')) return { rows: [{ id: 'ligne-1' }] as T[], rowCount: 1 };
      if (t.startsWith('select id from threads')) return { rows: [{ id: 'fil-1' }] as T[], rowCount: 1 };
      if (t.startsWith('update thread_messages')) return { rows: [] as T[], rowCount: rowCountMaj };
      return { rows: [] as T[], rowCount: 1 };
    },
  };
  return { ex, appels };
}

const FIL = { channel: 'linkedin_message', contact_id: 'c-1', linkedin_url: 'https://www.linkedin.com/in/jeanne' };

describe('enfilerReponseLinkedIn', () => {
  it("enfile une ligne origine 'reponse' de type message, due maintenant, vers l'adresse du contact", async () => {
    const { ex, appels } = fabrique(FIL);
    await expect(enfilerReponseLinkedIn(ex, 'org-1', { threadId: 'fil-1', corps: '  Bonjour  ' })).resolves.toEqual({
      ligneId: 'ligne-1',
    });
    const ins = appels.find((a) => a.text.trim().startsWith('insert into linkedin_action_queue'))!;
    expect(ins.text).toContain("'message'");
    expect(ins.text).toContain("'reponse'");
    expect(ins.text).toContain('now()');
    expect(ins.values).toEqual(['org-1', 'c-1', 'https://www.linkedin.com/in/jeanne', 'Bonjour']);
  });

  it('écrit le sortant dans le fil marqué en cours, relié à la ligne', async () => {
    const { ex, appels } = fabrique(FIL);
    await enfilerReponseLinkedIn(ex, 'org-1', { threadId: 'fil-1', corps: 'Bonjour' });
    const m = appels.find((a) => a.text.includes('insert into thread_messages'))!;
    expect(JSON.parse(String(m.values[2]))).toMatchObject({ etat: 'en_cours', queue_id: 'ligne-1' });
  });

  it("sans adresse, déduit celle du contact de son identifiant de membre reconnu ; un identifiant quelconque refuse", async () => {
    const { ex, appels } = fabrique({ ...FIL, linkedin_url: null, linkedin_provider_id: 'ACoAAdeduit' });
    await enfilerReponseLinkedIn(ex, 'org-1', { threadId: 'fil-1', corps: 'Bonjour' });
    const ins = appels.find((x) => x.text.trim().startsWith('insert into linkedin_action_queue'))!;
    expect(ins.values[2]).toBe('https://www.linkedin.com/in/ACoAAdeduit');
    const mauvais = fabrique({ ...FIL, linkedin_url: null, linkedin_provider_id: 'pas un membre' });
    await expect(enfilerReponseLinkedIn(mauvais.ex, 'org-1', { threadId: 'fil-1', corps: 'Bonjour' })).rejects.toBeInstanceOf(
      ErreurReponseImpossible,
    );
  });

  it.each([
    ['fil introuvable', null, 'Bonjour'],
    ['fil email', { ...FIL, channel: 'email' }, 'Bonjour'],
    ['contact sans adresse', { ...FIL, linkedin_url: null }, 'Bonjour'],
    ['corps vide', FIL, '   '],
  ])('refuse sans rien enfiler : %s', async (_nom, fil, corps) => {
    const { ex, appels } = fabrique(fil);
    await expect(enfilerReponseLinkedIn(ex, 'org-1', { threadId: 'fil-1', corps })).rejects.toBeInstanceOf(
      ErreurReponseImpossible,
    );
    expect(appels.some((a) => a.text.includes('insert into'))).toBe(false);
  });
});

describe('marquerReponseEnvoyee', () => {
  it('rend true quand le message en cours est daté, false sinon', async () => {
    await expect(marquerReponseEnvoyee(fabrique(FIL, 1).ex, 'org-1', 'ligne-1')).resolves.toBe(true);
    await expect(marquerReponseEnvoyee(fabrique(FIL, 0).ex, 'org-1', 'ligne-1')).resolves.toBe(false);
  });
});

describe('signalerEchecReponse', () => {
  it("notifie quand un message en cours bascule, et ne notifie pas une ligne qui n'en est pas une", async () => {
    const a = fabrique(FIL, 1);
    await expect(signalerEchecReponse(a.ex, 'org-1', 'ligne-1', 'x', 'refus')).resolves.toBe(true);
    expect(a.appels.some((c) => c.text.includes('insert into notifications'))).toBe(true);
    expect(a.appels.find((c) => c.text.includes('insert into notifications'))!.values[2]).toBe('linkedin.reponse_echouee');

    const b = fabrique(FIL, 0);
    await expect(signalerEchecReponse(b.ex, 'org-1', 'ligne-2', 'x', 'refus')).resolves.toBe(false);
    expect(b.appels.some((c) => c.text.includes('insert into notifications'))).toBe(false);
  });
});
