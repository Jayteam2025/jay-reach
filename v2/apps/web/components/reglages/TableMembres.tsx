'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { MembershipRole } from '@jay-reach/core';
import { Avatar, Bouton, Carte, Champ, Table } from '../ui';
import { actionRevoquerInvitation, inviteMember } from '../../app/actions/org';

export interface MembreAffiche {
  id: string;
  nom: string;
  email: string;
  role: MembershipRole;
  /** Déjà formaté (`lib/dates.ts`). */
  depuis: string;
  enAttente: boolean;
  moiMeme: boolean;
}

export interface TableMembresLibelles {
  titre: string;
  /** Gabarit « {count} · un propriétaire au moins » — `{count}` remplacé tel quel. */
  compteGabarit: string;
  inviter: string;
  colonneMembre: string;
  colonneEmail: string;
  colonneRole: string;
  colonneDepuis: string;
  vous: string;
  retirer: string;
  enAttenteSuffixe: string;
  role: Record<MembershipRole, string>;
  aide: string;
}

// Rôles proposables à l'invitation : jamais `owner` (transfert de
// propriété hors périmètre de cette tâche, pas un geste anodin depuis un
// simple formulaire).
const ROLES_INVITABLES: MembershipRole[] = ['admin', 'operator', 'viewer'];

// Corps pur (aucun hook) — testable par `renderToStaticMarkup`.
export interface CorpsTableMembresProps {
  membres: MembreAffiche[];
  libelles: TableMembresLibelles;
  onRetirer: (invitationId: string) => void;
  disabled: boolean;
}

export function CorpsTableMembres({ membres, libelles, onRetirer, disabled }: CorpsTableMembresProps) {
  return (
    <Table
      colonnes={[
        { cle: 'membre', titre: libelles.colonneMembre },
        { cle: 'email', titre: libelles.colonneEmail },
        { cle: 'role', titre: libelles.colonneRole },
        { cle: 'depuis', titre: libelles.colonneDepuis },
        { cle: 'action', titre: '' },
      ]}
      lignes={membres.map((m) => ({
        membre: (
          <div className="jr-qui">
            <Avatar nom={m.nom} />
            <span>
              <b>{m.nom}</b>
            </span>
          </div>
        ),
        email: m.email,
        role: libelles.role[m.role],
        depuis: m.enAttente ? `${m.depuis} · ${libelles.enAttenteSuffixe}` : m.depuis,
        action: m.moiMeme ? (
          <span className="jr-secondaire jr-petit">{libelles.vous}</span>
        ) : m.enAttente ? (
          <Bouton taille="petit" onClick={() => onRetirer(m.id)} disabled={disabled}>
            {libelles.retirer}
          </Bouton>
        ) : null,
      }))}
    />
  );
}

export interface TableMembresProps {
  organizationId: string;
  membres: MembreAffiche[];
  libelles: TableMembresLibelles;
  erreurLibelle: string;
}

export function TableMembres({ organizationId, membres, libelles, erreurLibelle }: TableMembresProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MembershipRole>('viewer');
  const [erreur, setErreur] = useState<string | null>(null);

  function inviter() {
    setErreur(null);
    startTransition(async () => {
      const res = await inviteMember(organizationId, email.trim(), role);
      if (res.ok) {
        setEmail('');
        setFormulaireOuvert(false);
        router.refresh();
      } else {
        setErreur(res.error ?? erreurLibelle);
      }
    });
  }

  function retirer(invitationId: string) {
    setErreur(null);
    startTransition(async () => {
      const res = await actionRevoquerInvitation(invitationId);
      if (res.ok) router.refresh();
      else setErreur(res.error ?? erreurLibelle);
    });
  }

  return (
    <Carte
      titre={
        <>
          {libelles.titre} <small>{libelles.compteGabarit.replace('{count}', String(membres.length))}</small>
        </>
      }
    >
      <div className="jr-actions fin">
        <Bouton taille="petit" onClick={() => setFormulaireOuvert((v) => !v)} disabled={pending}>
          {libelles.inviter}
        </Bouton>
      </div>
      {formulaireOuvert && (
        <div className="jr-actions large">
          <Champ libelle={libelles.colonneEmail} id="invite-email">
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={pending}
            />
          </Champ>
          <Champ libelle={libelles.colonneRole} id="invite-role">
            <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as MembershipRole)} disabled={pending}>
              {ROLES_INVITABLES.map((r) => (
                <option key={r} value={r}>
                  {libelles.role[r]}
                </option>
              ))}
            </select>
          </Champ>
          <Bouton variante="principal" taille="petit" onClick={inviter} disabled={pending || email.trim() === ''} aria-busy={pending}>
            {libelles.inviter}
          </Bouton>
        </div>
      )}
      <CorpsTableMembres membres={membres} libelles={libelles} onRetirer={retirer} disabled={pending} />
      <p className="jr-aide">{libelles.aide}</p>
      {erreur && (
        <div className="jr-notification erreur" role="alert">
          {erreur}
        </div>
      )}
    </Carte>
  );
}
