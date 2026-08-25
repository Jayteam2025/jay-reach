'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { signIn, type SignInState } from '../actions/auth';

export default function LoginPage() {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState<SignInState, FormData>(signIn, null);

  return (
    <div className="rs-auth">
      <div className="rs-auth-card">
        <div className="rs-auth-brand">
          <span className="rs-mark" aria-hidden="true">
            <i />
            <i />
          </span>
          <span className="rs-brand">{t('app.name')}</span>
        </div>
        <h1 style={{ fontSize: 22, marginBottom: 16 }}>{t('login.title')}</h1>
        <form action={formAction}>
          <label className="rs-label">
            {t('login.email')}
            <input className="rs-input" name="email" type="email" required autoComplete="email" />
          </label>
          <label className="rs-label">
            {t('login.password')}
            <input
              className="rs-input"
              name="password"
              type="password"
              required
              autoComplete="current-password"
            />
          </label>
          <button className="rs-btn rs-btn-block" data-primary="true" type="submit" disabled={pending}>
            {pending ? t('login.pending') : t('login.submit')}
          </button>
          {state?.error ? (
            <p role="alert" style={{ color: 'var(--flare)', fontSize: 13, marginTop: 12 }}>
              {state.error}
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
