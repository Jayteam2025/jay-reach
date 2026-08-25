'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { setProviderCredential } from '../../actions/providers';
import { Icon } from '../../icons';

type Field = {
  name: string;
  labelKey: string;
  type: 'text' | 'password';
  secret: boolean;
  required: boolean;
};

export function ProviderForm(props: {
  orgId: string;
  providerId: string;
  labelKey: string;
  fields: Field[];
  status: string | null;
  last4: string | null;
}) {
  const t = useTranslations();
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
            const fd = new FormData(event.currentTarget);
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
                required={f.required}
                autoComplete="off"
                placeholder={t(f.labelKey)}
              />
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
