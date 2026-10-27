import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AttenteAcceptation } from '@jay-reach/core';
import type { LigneAttenteAcceptation, TableAttentesAcceptationLibelles } from './TableAttentesAcceptation';

// Le rendu statique d'un composant client ne montre que son libellé : on capture ses props pour
// prouver le câblage (quelle personne, quelle campagne), pas seulement la présence du bouton.
const ecarter = vi.hoisted(() => ({ props: [] as { contactId: string; campagneId: string }[] }));
vi.mock('./BoutonEcarterContact', () => ({
  BoutonEcarterContact: (p: { contactId: string; campagneId: string; libelle: string }) => {
    ecarter.props.push({ contactId: p.contactId, campagneId: p.campagneId });
    return <button type="button">{p.libelle}</button>;
  },
}));

const { lignesAttentesAcceptation, TableAttentesAcceptation } = await import('./TableAttentesAcceptation');

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
    ecarter.props.length = 0;
    const html = renderToStaticMarkup(<TableAttentesAcceptation attentes={[ligne()]} campagneId="camp-1" libelles={libelles} />);
    expect(html).toContain('TITRE');
    expect(html).toContain('EXPLICATION');
    expect(html).toContain('Camille Martin');
    expect(html).toContain('Étape 2');
    expect(html).toContain('20 octobre');
    expect(html).toContain('27 octobre');
    expect(html).toContain('ECARTER');
    expect(ecarter.props).toEqual([{ contactId: 'ct-1', campagneId: 'camp-1' }]);
  });

  it('contact inconnu -> pas de bouton Écarter (il lui faut un contactId)', () => {
    const html = renderToStaticMarkup(
      <TableAttentesAcceptation attentes={[ligne({ contactId: null, contactNom: '—' })]} campagneId="camp-1" libelles={libelles} />,
    );
    expect(html).not.toContain('ECARTER');
  });
});

function attente(overrides: Partial<AttenteAcceptation> = {}): AttenteAcceptation {
  const { etapeTexte: _e, invitationTexte: _i, limiteTexte: _l, ...base } = ligne();
  return { ...base, ...overrides };
}

describe('lignesAttentesAcceptation (#183)', () => {
  const textes = { etape: (n: number) => `Étape ${n}`, sansInvitation: 'SANS INVITATION' };

  // Trois dates qui tombent trois jours différents à Paris : la date affichée ne peut être que
  // `limiteLe`, et seulement si elle est formatée dans le fuseau (23 h 30 UTC = le lendemain à Paris).
  it('affiche limiteLe dans le fuseau de l’organisation, pas la prochaine vérification ni le départ', () => {
    const [l] = lignesAttentesAcceptation(
      [
        attente({
          depuisLe: '2026-10-21T08:00:00.000Z',
          invitationEnvoyeeLe: '2026-10-21T08:00:00.000Z',
          prochaineVerificationLe: '2026-10-25T22:00:00.000Z',
          limiteLe: '2026-10-27T23:30:00.000Z',
        }),
      ],
      textes,
      'fr-FR',
      'Europe/Paris',
    );
    expect(l?.limiteTexte).toBe('28 octobre');
    expect(l?.invitationTexte).toBe('21 octobre');
    expect(l?.etapeTexte).toBe('Étape 2');
  });

  it('même instant en UTC -> 27 octobre : le fuseau est bien appliqué', () => {
    const [l] = lignesAttentesAcceptation([attente({ limiteLe: '2026-10-27T23:30:00.000Z' })], textes, 'fr-FR', 'UTC');
    expect(l?.limiteTexte).toBe('27 octobre');
  });

  it('sans invitation envoyée -> texte dédié, et pas d’étape connue -> null', () => {
    const [l] = lignesAttentesAcceptation([attente({ invitationEnvoyeeLe: null, etape: null })], textes, 'fr-FR', 'Europe/Paris');
    expect(l?.invitationTexte).toBe('SANS INVITATION');
    expect(l?.etapeTexte).toBeNull();
  });
});
