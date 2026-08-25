'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  parseCsv,
  suggestMapping,
  processImport,
  IMPORT_FIELDS,
  type ParsedRows,
  type ImportField,
  type ColumnMapping,
} from '@jay-reach/core';
import { runImport } from '../actions/import';

type MappingState = Record<string, ImportField | ''>;
type Destination = 'list' | 'existing' | 'campaign';

/** Lecture d'un fichier Excel (.xlsx/.xls) → même forme que le CSV (ParsedRows). */
async function parseXlsx(file: File): Promise<ParsedRows> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const first = wb.SheetNames[0];
  const sheet = first ? wb.Sheets[first] : undefined;
  if (!sheet) return { headers: [], rows: [] };
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' }) as unknown[][];
  const headers = (aoa[0] ?? []).map((h) => String(h).trim());
  const rows = aoa.slice(1).map((arr) => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = String(arr[i] ?? '').trim();
    });
    return row;
  });
  return { headers, rows };
}

export function ImportWizard({
  orgId,
  campaigns,
  lists,
}: {
  orgId: string;
  campaigns: { id: string; name: string }[];
  lists: { id: string; name: string }[];
}) {
  const t = useTranslations('import');
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedRows | null>(null);
  const [mapping, setMapping] = useState<MappingState>({});
  const [destination, setDestination] = useState<Destination>('list');
  const [ready, setReady] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [listName, setListName] = useState('');
  const [contextNote, setContextNote] = useState('');
  const [existingListId, setExistingListId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [saving, startSave] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function submit(): void {
    if (!parsed) return;
    setErrorMsg(null);
    setReady(null);
    const clean: ColumnMapping = {};
    for (const [header, field] of Object.entries(mapping)) {
      if (field) clean[header] = field;
    }
    startSave(async () => {
      const res = await runImport(orgId, {
        parsed,
        mapping: clean,
        fileName,
        destination,
        listName,
        contextNote,
        existingListId: existingListId || null,
        campaignId: campaignId || null,
      });
      if (res.ok) {
        setReady(t('imported', { n: res.imported }));
        router.refresh();
      } else {
        setErrorMsg(res.error);
      }
    });
  }

  async function ingest(file: File): Promise<void> {
    const result = /\.xlsx?$/i.test(file.name) ? await parseXlsx(file) : parseCsv(await file.text());
    const suggested = suggestMapping(result.headers);
    const initial: MappingState = {};
    for (const header of result.headers) {
      initial[header] = suggested[header] ?? '';
    }
    setFileName(file.name);
    setParsed(result);
    setMapping(initial);
    setReady(null);
  }

  // Le compte rendu est recalculé à chaque changement de mapping — AFFICHÉ AVANT
  // toute validation (compte rendu + coût, jamais découverts après). docs/09.
  const outcome = useMemo(() => {
    if (!parsed) {
      return null;
    }
    const clean: ColumnMapping = {};
    for (const [header, field] of Object.entries(mapping)) {
      if (field) {
        clean[header] = field;
      }
    }
    return processImport(parsed, clean);
  }, [parsed, mapping]);

  const report = outcome?.report;

  function reset(): void {
    setParsed(null);
    setFileName(null);
    setMapping({});
    setReady(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
      {/* Zone de dépôt */}
      <div
        className="rs-card"
        data-drag={dragOver ? 'true' : undefined}
        style={{
          borderStyle: 'dashed',
          borderColor: dragOver ? 'var(--lime)' : 'var(--slate3)',
          textAlign: 'center',
          padding: '28px 16px',
          cursor: 'pointer',
        }}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) {
            void ingest(file);
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void ingest(file);
            }
          }}
        />
        {fileName ? (
          <>
            <div className="mono" style={{ color: 'var(--lime2)', fontSize: 14 }}>
              {fileName}
            </div>
            <button
              className="rs-btn"
              style={{ marginTop: 10 }}
              onClick={(e) => {
                e.stopPropagation();
                reset();
              }}
            >
              {t('change')}
            </button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 15 }}>{t('drop')}</div>
            <div className="rs-row-sub" style={{ marginTop: 6 }}>
              {t('dropHint')}
            </div>
          </>
        )}
      </div>

      {!parsed ? <p className="rs-empty">{t('empty')}</p> : null}

      {parsed ? (
        <div className="rs-grid2">
          {/* Correspondance des colonnes */}
          <section className="rs-card">
            <h3 className="rs-section-title">{t('mapping')}</h3>
            <p className="rs-row-sub" style={{ margin: '0 0 12px' }}>
              {t('mappingHint')}
            </p>
            <div style={{ display: 'grid', gap: 10 }}>
              {parsed.headers.map((header) => {
                const sample = parsed.rows[0]?.[header] ?? '';
                return (
                  <div
                    key={header}
                    style={{ display: 'grid', gridTemplateColumns: '1fr 150px', gap: 10, alignItems: 'center' }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="mono" style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {header}
                      </div>
                      {sample ? (
                        <div className="rs-row-sub" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {t('sampleValue')} : {sample}
                        </div>
                      ) : null}
                    </div>
                    <select
                      className="rs-input"
                      value={mapping[header] ?? ''}
                      onChange={(e) => {
                        setMapping((m) => ({ ...m, [header]: e.target.value as ImportField | '' }));
                        setReady(null);
                      }}
                    >
                      <option value="">{t('ignore')}</option>
                      {IMPORT_FIELDS.map((field) => (
                        <option key={field} value={field}>
                          {t(`field.${field}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Compte rendu + coût + destination */}
          <section style={{ display: 'grid', gap: 16, alignSelf: 'start' }}>
            <div className="rs-card">
              <h3 className="rs-section-title">{t('report')}</h3>
              {report ? (
                <>
                  <div className="rs-figs" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                    <Fig n={report.rowsTotal} label={t('rowsTotal')} />
                    <Fig n={report.rowsUnique} label={t('rowsUnique')} live />
                    <Fig n={report.rowsMerged} label={t('rowsMerged')} />
                    <Fig n={report.rowsRejected} label={t('rowsRejected')} />
                  </div>
                  <div className="rs-row-sub" style={{ borderTop: '1px solid var(--slate2)', paddingTop: 10 }}>
                    {t('emailsMissing')} : <span className="mono">{report.emailsMissing}</span>
                  </div>
                </>
              ) : null}
            </div>

            <div className="rs-card">
              <h3 className="rs-section-title">{t('cost')}</h3>
              <div className="rs-fig-n" data-live="true">
                {t('costValue', { n: report?.emailsMissing ?? 0 })}
              </div>
              <p className="rs-row-sub" style={{ marginTop: 6 }}>
                {t('costHint')}
              </p>
            </div>

            <div className="rs-card">
              <h3 className="rs-section-title">{t('destination')}</h3>
              <select
                className="rs-input"
                value={destination}
                onChange={(e) => {
                  setDestination(e.target.value as Destination);
                  setReady(null);
                }}
              >
                <option value="list">{t('dest.list')}</option>
                <option value="existing" disabled={lists.length === 0}>
                  {t('dest.existing')}
                </option>
                <option value="campaign">{t('dest.campaign')}</option>
              </select>

              {/* Liste existante (destination « existante »). */}
              {destination === 'existing' ? (
                <select
                  className="rs-input"
                  style={{ marginTop: 10 }}
                  value={existingListId}
                  onChange={(e) => setExistingListId(e.target.value)}
                >
                  <option value="">{t('pickList')}</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    className="rs-input"
                    style={{ marginTop: 10 }}
                    placeholder={t('listName')}
                    value={listName}
                    onChange={(e) => setListName(e.target.value)}
                  />
                  <input
                    className="rs-input"
                    style={{ marginTop: 8 }}
                    placeholder={t('contextNote')}
                    value={contextNote}
                    onChange={(e) => setContextNote(e.target.value)}
                  />
                </>
              )}

              {/* Campagne (destination « campagne »). */}
              {destination === 'campaign' ? (
                <select
                  className="rs-input"
                  style={{ marginTop: 8 }}
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                >
                  <option value="">{t('pickCampaign')}</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : null}

              <button
                className="rs-btn rs-btn-block"
                data-primary="true"
                style={{ marginTop: 12 }}
                disabled={
                  saving ||
                  !report ||
                  report.rowsUnique === 0 ||
                  (destination === 'existing' && !existingListId) ||
                  (destination === 'campaign' && !campaignId) ||
                  (destination !== 'existing' && (!listName.trim() || !contextNote.trim()))
                }
                onClick={submit}
              >
                {saving ? t('importing') : t('validate', { n: report?.rowsUnique ?? 0 })}
              </button>
              {ready ? (
                <p role="status" className="rs-row-sub" style={{ marginTop: 10, color: 'var(--lime2)' }}>
                  {ready}
                </p>
              ) : null}
              {errorMsg ? (
                <p role="alert" className="rs-row-sub" style={{ marginTop: 10, color: 'var(--flare)' }}>
                  {errorMsg}
                </p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function Fig({ n, label, live }: { n: number; label: string; live?: boolean }) {
  return (
    <div>
      <div className="rs-fig-n" data-live={live ? 'true' : undefined}>
        {n}
      </div>
      <div className="rs-fig-l">{label}</div>
    </div>
  );
}
