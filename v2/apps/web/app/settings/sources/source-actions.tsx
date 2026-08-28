'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { requestSourceRun, toggleSource } from '../../actions/sources';
import { SourceForm, type SourceFormValues } from './source-form';

/**
 * Commandes d'une source : lancer une collecte, mettre en pause, modifier.
 *
 * Aucune n'est primaire — l'unique action primaire de l'écran est « Ajouter une
 * source ». Ces boutons agissent sur ce qui existe déjà ; les mettre en lime
 * plein les ferait passer pour le geste principal, et rendrait la page illisible
 * dès qu'il y a trois sources.
 *
 * Séparé de la page pour qu'elle reste un composant serveur qui lit la base.
 */
export function SourceActions(props: { orgId: string; source: SourceFormValues & { id: string } }) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [edition, setEdition] = useState(false);

  const lancer = () =>
    startTransition(async () => {
      const res = await requestSourceRun(props.orgId, props.source.id);
      // La collecte ne part pas dans la seconde : le worker relève la demande.
      // Le dire évite de cliquer trois fois en croyant qu'il ne se passe rien.
      setMessage(res.ok ? t('sources.runRequested') : res.error);
      router.refresh();
    });

  const basculer = () =>
    startTransition(async () => {
      const res = await toggleSource(props.orgId, props.source.id, !props.source.isActive);
      if (!res.ok) setMessage(res.error);
      router.refresh();
    });

  return (
    <div>
      <div className="rs-actions" style={{ marginTop: 12 }}>
        <button className="rs-btn" type="button" onClick={lancer} disabled={pending || !props.source.isActive}>
          {t('sources.runNow')}
        </button>
        <button className="rs-btn" type="button" onClick={basculer} disabled={pending}>
          {props.source.isActive ? t('sources.pause') : t('sources.resume')}
        </button>
        <button className="rs-btn" type="button" onClick={() => setEdition((e) => !e)} disabled={pending}>
          {edition ? t('sources.form.cancel') : t('sources.form.edit')}
        </button>
        {message ? (
          <span role="status" className="rs-row-sub" style={{ alignSelf: 'center' }}>
            {message}
          </span>
        ) : null}
      </div>
      {edition ? (
        <SourceForm orgId={props.orgId} initial={props.source} onDone={() => setEdition(false)} />
      ) : null}
    </div>
  );
}

/**
 * Ajout d'une source, replié par défaut : c'est un geste ponctuel, et déplié il
 * repousserait sous la ligne de flottaison les sources déjà configurées, qui
 * sont ce qu'on vient regarder tous les jours.
 */
export function AddSource(props: { orgId: string }) {
  const t = useTranslations();
  const [ouvert, setOuvert] = useState(false);

  return (
    <>
      <div className="rs-head-actions">
        {/* Primaire seulement quand il ouvre : une fois le formulaire visible,
            l'action principale est « Créer la source », et « Annuler » en lime
            ferait deux actions primaires sur la même vue. */}
        <button
          className="rs-btn"
          {...(ouvert ? {} : { 'data-primary': 'true' })}
          type="button"
          onClick={() => setOuvert((o) => !o)}
        >
          {ouvert ? t('sources.form.cancel') : t('sources.form.add')}
        </button>
      </div>
      {/* Pas de carte autour : `rs-prov-detail` porte déjà son fond et sa
          bordure, l'envelopper produisait un double encadrement. */}
      {ouvert ? (
        <div style={{ width: '100%', marginBottom: 16 }}>
          <SourceForm orgId={props.orgId} onDone={() => setOuvert(false)} />
        </div>
      ) : null}
    </>
  );
}
