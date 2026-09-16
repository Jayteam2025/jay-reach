'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import type { Note } from '@jay-reach/core';
import { Champ } from '../ui';
import { actionAjouterNote } from '../../app/actions/contacts';
import { dateCourte } from '../../lib/dates';

export interface SectionNotesProps {
  notes: Note[];
  contactId: string;
  fuseau: string;
}

export function SectionNotes({ notes, contactId, fuseau }: SectionNotesProps) {
  const t = useTranslations('campagne.fiche');
  const [texte, setTexte] = useState('');
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const idChamp = `fiche-note-${contactId}`;

  function ajouter() {
    const valeur = texte.trim();
    if (valeur === '') return;
    setErreur(null);
    startTransition(async () => {
      const res = await actionAjouterNote(contactId, valeur);
      if (res.ok) {
        setTexte('');
        window.location.reload();
      } else {
        setErreur(res.error);
      }
    });
  }

  return (
    <>
      <h4>{t('sections.notes')}</h4>
      {notes.length === 0 ? (
        <p className="jr-secondaire" style={{ fontSize: 13.5 }}>
          {t('notes.empty')}
        </p>
      ) : (
        notes.map((n) => (
          <div key={n.id} style={{ marginBottom: 8 }}>
            <p style={{ margin: 0, fontSize: 13.5 }}>{n.texte}</p>
            <small className="jr-secondaire">
              {n.auteurNom ? `${n.auteurNom} · ` : ''}
              {dateCourte(n.quand, undefined, fuseau)}
            </small>
          </div>
        ))
      )}
      <Champ id={idChamp} libelle={t('notes.newLabel')}>
        <textarea
          id={idChamp}
          rows={2}
          placeholder={t('notes.placeholder')}
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
        />
      </Champ>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="jr-bouton petit"
          disabled={pending || texte.trim() === ''}
          aria-busy={pending}
          onClick={ajouter}
        >
          {t('notes.add')}
        </button>
        {erreur && <small className="jr-secondaire">{erreur}</small>}
      </div>
    </>
  );
}
