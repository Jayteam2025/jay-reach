'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  startBulkImport,
  cancelBulkImport,
  getBulkImport,
  type BulkImportParams,
  type BulkStatus,
} from '../actions/directory';

/**
 * Au-delà de ce nombre, on demande confirmation.
 *
 * Ajouter dix mille entreprises à sa base n'est pas un geste qu'on rattrape
 * d'un clic : on le fait dire à voix haute avant de le lancer.
 */
const SEUIL_CONFIRMATION = 500;

/** Cadence de relecture de l'avancement. */
const INTERVALLE_MS = 1500;

export function BulkAdd({
  orgId,
  params,
  total,
  truncated,
  pageCount,
}: {
  orgId: string;
  params: Omit<BulkImportParams, 'scope'>;
  /** Ce que l'API annonce, plafonné par elle à 10 000. */
  total: number;
  truncated: boolean;
  /** Nombre d'entreprises sur la page affichée. */
  pageCount: number;
}) {
  const t = useTranslations('directory');
  const [pending, startTransition] = useTransition();
  const [importId, setImportId] = useState<string | null>(null);
  const [etat, setEtat] = useState<BulkStatus | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const arreterLeSuivi = useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => {
    if (!importId) return;
    timer.current = window.setInterval(async () => {
      const s = await getBulkImport(orgId, importId);
      if (!s) return;
      setEtat(s);
      if (s.status === 'done' || s.status === 'error' || s.status === 'cancelled') {
        arreterLeSuivi();
      }
    }, INTERVALLE_MS);
    return arreterLeSuivi;
  }, [importId, orgId, arreterLeSuivi]);

  function lancer(scope: 'page' | 'all') {
    const combien = scope === 'page' ? pageCount : total;
    if (combien > SEUIL_CONFIRMATION && !window.confirm(t('bulk.confirm', { count: combien }))) {
      return;
    }
    setErreur(null);
    setEtat(null);
    startTransition(async () => {
      const res = await startBulkImport(orgId, { ...params, scope });
      if (res.ok) setImportId(res.id);
      else setErreur(res.error);
    });
  }

  function annuler() {
    if (!importId) return;
    startTransition(async () => {
      await cancelBulkImport(orgId, importId);
    });
  }

  const enCours = etat?.status === 'running' || etat?.status === 'pending' || (importId !== null && etat === null);
  const termine = etat?.status === 'done' || etat?.status === 'cancelled';
  // Tant que le worker n'a pas relevé la demande, `total` vaut 0 : une barre à
  // 100 % serait un mensonge, on n'en montre pas.
  const progression = etat && etat.total > 0 ? Math.min(100, Math.round((etat.processed / etat.total) * 100)) : null;

  return (
    <div className="rs-dir-bulk">
      {enCours ? (
        <>
          <div className="rs-dir-progress" role="progressbar" aria-valuenow={progression ?? undefined} aria-valuemin={0} aria-valuemax={100}>
            <div className="rs-dir-progress-bar" style={{ width: `${progression ?? 0}%` }} />
          </div>
          <span className="rs-row-sub mono">
            {etat ? t('bulk.progress', { done: etat.processed, total: etat.total }) : t('bulk.starting')}
          </span>
          <button type="button" className="rs-btn" onClick={annuler} disabled={pending}>
            {t('bulk.cancel')}
          </button>
        </>
      ) : termine ? (
        <span role="status" className="rs-row-sub">
          {etat?.status === 'cancelled'
            ? t('bulk.cancelled', { added: etat.added })
            : t('bulk.done', { added: etat?.added ?? 0, existing: etat?.existing ?? 0 })}
        </span>
      ) : (
        <>
          <button type="button" className="rs-btn" onClick={() => lancer('page')} disabled={pending || pageCount === 0}>
            {t('bulk.addPage', { count: pageCount })}
          </button>
          <button type="button" className="rs-btn" onClick={() => lancer('all')} disabled={pending || total === 0}>
            {truncated ? t('bulk.addAllTruncated', { count: total }) : t('bulk.addAll', { count: total })}
          </button>
        </>
      )}
      {etat?.status === 'error' ? (
        <span role="alert" className="rs-row-sub" style={{ color: 'var(--flare)' }}>
          {etat.error}
        </span>
      ) : null}
      {erreur ? (
        <span role="alert" className="rs-row-sub" style={{ color: 'var(--flare)' }}>
          {erreur}
        </span>
      ) : null}
    </div>
  );
}
