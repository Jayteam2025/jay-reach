'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { setProviderCredential } from '../../actions/providers';
import { Icon } from '../../icons';

type Field = {
  name: string;
  labelKey: string;
  type: 'text' | 'password';
  secret: boolean;
  required: boolean;
  /** Aide sous le champ, quand le libellé ne suffit pas à expliquer. */
  hintKey?: string;
  placeholderKey?: string;
};

export function ProviderForm(props: {
  orgId: string;
  providerId: string;
  labelKey: string;
  fields: Field[];
  status: string | null;
  last4: string | null;
  /**
   * Réglages non secrets déjà enregistrés — un plafond quotidien, un modèle.
   *
   * Ils n'étaient pas relus : le champ s'affichait vide alors qu'une valeur
   * existait, si bien qu'on ne pouvait ni vérifier son réglage ni le modifier
   * sans le retaper de mémoire. Enregistrer par-dessus l'effaçait.
   * Le secret, lui, n'est jamais renvoyé : seuls ses quatre derniers
   * caractères le sont, pour reconnaître la clé sans la révéler.
   */
  config: Record<string, string> | null;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const configured = props.status === 'configured';

  return (
    <div className="rs-prov-item" data-open={open ? 'true' : undefined}>
      <button type="button" className="rs-prov-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="chevron" width={16} height={16} className="rs-prov-chevron" aria-hidden="true" />
        <span className="rs-prov-name">{t(props.labelKey)}</span>
        {props.last4 ? <span className="rs-row-sub mono">••{props.last4}</span> : null}
        <span className="rs-statuspill" data-ok={configured ? 'true' : undefined}>
          <span className="rs-statusdot" />
          {configured ? t('providers.configured') : t('providers.notConfigured')}
        </span>
      </button>

      {open ? (
        <form
          className="rs-prov-detail"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const fd = new FormData(form);
            const secretField = props.fields.find((f) => f.secret);
            const secret = secretField ? String(fd.get(secretField.name) ?? '') : '';
            const config: Record<string, string> = {};
            for (const f of props.fields) {
              if (!f.secret) {
                config[f.name] = String(fd.get(f.name) ?? '');
              }
            }
            startTransition(async () => {
              const res = await setProviderCredential(props.orgId, props.providerId, secret, config);
              setMessage(res.ok ? t('providers.saved') : res.error);
              if (res.ok) {
                form.reset();
                router.refresh();
              }
            });
          }}
        >
          {props.fields.map((f) => (
            <label key={f.name} className="rs-label">
              {t(f.labelKey)}
              <input
                className="rs-input mono"
                name={f.name}
                type={f.type}
                // Une clé déjà enregistrée n'est plus obligatoire : elle n'est
                // pas relisible, et l'exiger empêchait de modifier le moindre
                // réglage à côté. Laissée vide, elle reste ce qu'elle est.
                required={f.required && !(f.secret && configured)}
                autoComplete="off"
                placeholder={
                  f.secret && configured
                    ? t('providers.secretUnchanged')
                    : f.placeholderKey
                      ? t(f.placeholderKey)
                      : t(f.labelKey)
                }
                // Un secret ne se relit pas ; un réglage, si.
                defaultValue={f.secret ? undefined : (props.config?.[f.name] ?? '')}
              />
              {f.hintKey ? <span className="rs-row-sub">{t(f.hintKey)}</span> : null}
            </label>
          ))}
          <div className="rs-actions">
            <button className="rs-btn" data-primary="true" type="submit" disabled={pending || !props.orgId}>
              {t('providers.save')}
            </button>
            {message ? (
              <span role="status" className="rs-row-sub" style={{ alignSelf: 'center' }}>
                {message}
              </span>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
