import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MembershipRole } from '@jay-reach/core';
import { CorpsTableMembres, type MembreAffiche, type TableMembresLibelles } from './TableMembres';

const LIBELLES: TableMembresLibelles = {
  titre: 'Membres',
  compteGabarit: '{count} · un propriétaire au moins',
  inviter: '+ Inviter par email',
  colonneMembre: 'Membre',
  colonneEmail: 'Email',
  colonneRole: 'Rôle',
  colonneDepuis: 'Depuis',
  vous: 'vous',
  retirer: 'Retirer',
  enAttenteSuffixe: 'en attente',
  role: { owner: 'Propriétaire', admin: 'Administrateur', operator: 'Opérateur', viewer: 'Lecture seule' } as Record<
    MembershipRole,
    string
  >,
  aide: 'Propriétaire et administrateur règlent tout.',
};

const MEMBRES: MembreAffiche[] = [
  { id: 'user-1', nom: 'Claire Moreau', email: 'claire@example.com', role: 'owner', depuis: '17 août', enAttente: false, moiMeme: true },
  { id: 'user-2', nom: 'Marc Lefèvre', email: 'marc@example.com', role: 'admin', depuis: '10 sept.', enAttente: false, moiMeme: false },
  { id: 'inv-1', nom: 'marion@example.com', email: 'marion@example.com', role: 'viewer', depuis: '13 sept.', enAttente: true, moiMeme: false },
];

describe('CorpsTableMembres', () => {
  it('affiche « vous » pour l’utilisateur courant, aucun bouton pour un membre accepté, « Retirer » pour une invitation en attente', () => {
    const html = renderToStaticMarkup(
      <CorpsTableMembres membres={MEMBRES} libelles={LIBELLES} onRetirer={() => {}} disabled={false} />,
    );
    expect(html).toContain('vous');
    expect(html).toContain('Propriétaire');
    expect(html).toContain('Administrateur');
    expect(html).toContain('Lecture seule');
    expect(html).toContain('en attente');
    // Un seul bouton Retirer (l'invitation Marion) : Claire Moreau = « vous », Marc Lefèvre = aucune action.
    expect((html.match(/Retirer/g) ?? []).length).toBe(1);
  });
});
