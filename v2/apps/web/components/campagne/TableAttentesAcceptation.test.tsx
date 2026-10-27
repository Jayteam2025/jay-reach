import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TableAttentesAcceptation, type LigneAttenteAcceptation, type TableAttentesAcceptationLibelles } from './TableAttentesAcceptation';

const libelles: TableAttentesAcceptationLibelles = {
  titre: 'TITRE',
  explication: 'EXPLICATION',
  colonneContact: 'Contact',
  colonneEtape: 'Étape',
  colonneInvitation: 'Invitation',
  colonneLimite: 'Limite',
  ecarter: 'ECARTER',
};

function ligne(overrides: Partial<LigneAttenteAcceptation> = {}): LigneAttenteAcceptation {
  return {
    actionId: 'act-1',
    queueId: 'q-1',
    inscriptionId: 'ins-1',
    campagneId: 'camp-1',
    campagneNom: 'Directeur commercial',
    contactId: 'ct-1',
    contactNom: 'Camille Martin',
    etape: 2,
    invitationEnvoyeeLe: '2026-10-20T08:00:00.000Z',
    depuisLe: '2026-10-20T08:00:00.000Z',
    jours: 7,
    limiteLe: '2026-10-27T08:00:00.000Z',
    prochaineVerificationLe: '2026-10-27T22:00:00.000Z',
    etapeTexte: 'Étape 2',
    invitationTexte: '20 octobre',
    limiteTexte: '27 octobre',
    ...overrides,
  };
}

describe('TableAttentesAcceptation (#183)', () => {
  it('aucune attente -> rien (la File du jour ne gagne pas une carte vide)', () => {
    expect(renderToStaticMarkup(<TableAttentesAcceptation attentes={[]} campagneId="camp-1" libelles={libelles} />)).toBe('');
  });

  it('une attente -> contact, étape, date d’invitation, date limite et le seul geste Écarter', () => {
    const html = renderToStaticMarkup(<TableAttentesAcceptation attentes={[ligne()]} campagneId="camp-1" libelles={libelles} />);
    expect(html).toContain('TITRE');
    expect(html).toContain('EXPLICATION');
    expect(html).toContain('Camille Martin');
    expect(html).toContain('Étape 2');
    expect(html).toContain('20 octobre');
    expect(html).toContain('27 octobre');
    expect(html).toContain('ECARTER');
  });

  it('contact inconnu -> pas de bouton Écarter (il lui faut un contactId)', () => {
    const html = renderToStaticMarkup(
      <TableAttentesAcceptation attentes={[ligne({ contactId: null, contactNom: '—' })]} campagneId="camp-1" libelles={libelles} />,
    );
    expect(html).not.toContain('ECARTER');
  });
});
