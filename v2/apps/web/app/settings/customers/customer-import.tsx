'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { parseCsv, suggestMapping, type ParsedRows, type ColumnMapping } from '@jay-reach/core';
import { importCustomers } from '../../actions/customers';

export function CustomerImport({ orgId }: { orgId: string }) {
  const t = useTranslations('customers');
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedRows | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [fileName, setFileName] = useState<string | null>(null);
  const [listName, setListName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function ingest(file: File) {
    const p = /\.xlsx?$/i.test(file.name) ? await parseXlsx(file) : parseCsv(await file.text());
    setParsed(p);
    setMapping(suggestMapping(p.headers));
    setFileName(file.name);
    setMsg(null);
    setError(null);
  }

  function submit() {
    if (!parsed) return;
    setMsg(null);
    setError(null);
    startTransition(async () => {
      const res = await importCustomers(orgId, { parsed, mapping, listName });
      if (res.ok) {
        setMsg(t('done', { n: res.count }));
        setParsed(null);
        setFileName(null);
        setListName('');
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="rs-card" style={{ marginTop: 16, display: 'grid', gap: 12 }}>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv,.xlsx,.xls"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void ingest(f);
        }}
      />
      <button type="button" className="rs-btn" onClick={() => inputRef.current?.click()}>
        {fileName ?? t('drop')}
      </button>
      {parsed ? (
        <>
          <p className="rs-row-sub">{t('detected', { n: parsed.rows.length })}</p>
          <input className="rs-input" placeholder={t('listName')} value={listName} onChange={(e) => setListName(e.target.value)} />
          <button type="button" className="rs-btn" data-primary="true" disabled={pending || !listName.trim()} onClick={submit}>
            {pending ? t('importing') : t('import')}
          </button>
        </>
      ) : null}
      {msg ? <p className="rs-lk-msg" data-ok="true">{msg}</p> : null}
      {error ? <p className="rs-lk-msg">{error}</p> : null}
    </div>
  );
}

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
