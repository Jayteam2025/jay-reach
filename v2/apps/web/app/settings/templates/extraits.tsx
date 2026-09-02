'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { deleteSnippet, saveSnippet } from '../../actions/snippets';

export interface SnippetRow {
  readonly name: string;
  readonly body: string;
}

/**
 * Textes réutilisables : signature, mentions, tout ce qui se répète d'un
 * message à l'autre.
 *
 * Présentés comme une liste de définitions, et non comme des cartes : un
 * extrait est un nom qui désigne un texte, exactement la relation qu'un
 * glossaire met en page. La colonne de noms d'appel à gauche est ce qu'on vient
 * chercher — c'est elle qu'on recopiera dans un message — donc elle aligne et
 * porte la même graisse mono que dans l'éditeur.
 *
 * L'édition se fait en place, sur la ligne : ouvrir une fenêtre pour trois
 * champs éloignerait le texte de son nom au moment précis où l'on compare les
 * deux.
 */
export function Extraits({
  extraits,
  orgId,
  demo,
}: {
  extraits: readonly SnippetRow[];
  orgId: string;
  demo: boolean;
}) {
  const t = useTranslations('snippets');
  const [edite, setEdite] = useState<string | null>(null);
  const [nom, setNom] = useState('');
  const [corps, setCorps] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const enCreation = edite === '';

  function ouvrirNouveau() {
    setEdite('');
    setNom('');
    setCorps('');
    setErreur(null);
  }

  function ouvrirExistant(e: SnippetRow) {
    setEdite(e.name);
    setNom(e.name);
    setCorps(e.body);
    setErreur(null);
  }

  function enregistrer() {
    setErreur(null);
    startTransition(async () => {
      const res = await saveSnippet(orgId, { name: nom, body: corps });
      if (res.ok) setEdite(null);
      else setErreur(res.error);
    });
  }

  function supprimer(name: string) {
    setErreur(null);
    startTransition(async () => {
      const res = await deleteSnippet(orgId, name);
      if (res.ok) setEdite(null);
      else setErreur(res.error);
    });
  }

  const formulaire = (
    <div className="rs-extrait-form">
      {enCreation ? (
        <label className="rs-label">
          {t('name')}
          <input
            className="rs-input mono"
            value={nom}
            placeholder={t('namePlaceholder')}
            onChange={(e) => setNom(e.target.value)}
            autoFocus
          />
          <span className="rs-row-sub">{t('nameHint', { exemple: nom.trim() || 'signature' })}</span>
        </label>
      ) : null}

      <label className="rs-label">
        {t('body')}
        <textarea
          className="rs-textarea"
          rows={4}
          value={corps}
          placeholder={t('bodyPlaceholder')}
          onChange={(e) => setCorps(e.target.value)}
          autoFocus={!enCreation}
        />
      </label>

      <div className="rs-actions">
        <button
          type="button"
          className="rs-btn"
          data-primary="true"
          onClick={enregistrer}
          disabled={demo || pending || nom.trim() === '' || corps.trim() === ''}
        >
          {t('save')}
        </button>
        <button type="button" className="rs-btn" onClick={() => setEdite(null)} disabled={pending}>
          {t('cancel')}
        </button>
        {!enCreation ? (
          <button
            type="button"
            className="rs-btn rs-extrait-suppr"
            onClick={() => supprimer(nom)}
            disabled={demo || pending}
          >
            {t('delete')}
          </button>
        ) : null}
      </div>

      {erreur ? (
        <span role="alert" className="rs-row-sub" style={{ color: 'var(--flare)' }}>
          {erreur}
        </span>
      ) : null}
    </div>
  );

  return (
    <section className="rs-extraits">
      <div className="rs-extraits-tete">
        <h2>{t('title')}</h2>
        <p className="rs-row-sub">{t('lead')}</p>
      </div>

      {extraits.length === 0 && edite === null ? (
        // Un écran vide est une invitation, pas un constat.
        <p className="rs-extraits-vide">{t('empty')}</p>
      ) : (
        <dl className="rs-extraits-liste">
          {extraits.map((e) => (
            <div key={e.name} className="rs-extrait" data-edite={edite === e.name ? 'true' : undefined}>
              <dt>
                <button type="button" className="rs-extrait-nom mono" onClick={() => ouvrirExistant(e)} disabled={demo}>
                  {`{{${e.name}}}`}
                </button>
              </dt>
              <dd>{edite === e.name ? formulaire : <span className="rs-extrait-apercu">{e.body}</span>}</dd>
            </div>
          ))}

          {enCreation ? (
            <div className="rs-extrait" data-edite="true">
              <dt>
                <span className="rs-extrait-nom mono" aria-hidden="true">
                  {`{{${nom.trim() || '…'}}}`}
                </span>
              </dt>
              <dd>{formulaire}</dd>
            </div>
          ) : null}
        </dl>
      )}

      {edite === null ? (
        <button type="button" className="rs-btn" onClick={ouvrirNouveau} disabled={demo}>
          {t('add')}
        </button>
      ) : null}
    </section>
  );
}
