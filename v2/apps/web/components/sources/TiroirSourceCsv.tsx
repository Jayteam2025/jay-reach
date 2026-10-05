'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  IMPORT_FIELDS,
  parseCsv,
  processImport,
  suggestMapping,
  type ColumnMapping,
  type ImportField,
  type ParsedRows,
} from '@jay-reach/core';
import { Bouton, Champ, CleValeur, Table, Tiroir } from '../ui';
import { actionImporterCsvDansCampagne } from '../../app/actions/import';

export interface TiroirSourceCsvProps {
  campagneId: string;
}

/**
 * Tiroir « Fichier CSV » (maquette `tiroir-source-csv.html`) : le fichier est
 * lu et découpé dans le navigateur (`parseCsv`/`suggestMapping`/
 * `processImport`, tous purs — `packages/core/src/import`), pour que le
 * compte rendu s'affiche AVANT le bouton d'import, sans aller-retour serveur
 * juste pour prévisualiser. L'import lui-même (`importerCsv`) rejoue le même
 * calcul côté serveur avant d'écrire.
 */
export function TiroirSourceCsv({ campagneId }: TiroirSourceCsvProps) {
  const t = useTranslations('campagne.sources');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  const [nom, setNom] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedRows | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});

  const rapport = useMemo(
    () => (parsed ? processImport(parsed, mapping).report : null),
    [parsed, mapping],
  );

  function fermer() {
    router.push('?', { scroll: false });
  }

  async function choisirFichier(e: React.ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    if (!fichier) return;
    const texte = await fichier.text();
    const p = parseCsv(texte);
    setParsed(p);
    setMapping(suggestMapping(p.headers));
    setFileName(fichier.name);
    if (!nom.trim()) setNom(fichier.name.replace(/\.csv$/i, ''));
  }

  function changerMapping(header: string, champ: string) {
    setMapping((m) => {
      const copie = { ...m };
      if (champ === '') delete copie[header];
      else copie[header] = champ as ImportField;
      return copie;
    });
  }

  function importer() {
    if (!parsed) return;
    setErreur(null);
    startTransition(async () => {
      const res = await actionImporterCsvDansCampagne(campagneId, {
        nom,
        fileName,
        parsed,
        mapping,
      });
      if (res.ok) {
        fermer();
      } else {
        setErreur(res.issues?.join(' ') ?? res.error);
      }
    });
  }

  return (
    <Tiroir
      ouvert
      onFermer={fermer}
      libelleFermer={t('drawer.close')}
      titre={t('menu.csv.title')}
      description={t('drawer.csvIntro')}
      pied={
        <>
          <span />
          <div className="jr-carte-h-actions">
            <Bouton onClick={fermer}>{t('drawer.cancel')}</Bouton>
            <Bouton
              variante="principal"
              onClick={importer}
              disabled={pending || !parsed || (rapport?.rowsUnique ?? 0) === 0}
            >
              {t('drawer.csvImport', { n: rapport?.rowsUnique ?? 0 })}
            </Bouton>
          </div>
        </>
      }
    >
      <div className="jr-formulaire">
        <Champ libelle={t('drawer.listName')}>
          <input value={nom} onChange={(e) => setNom(e.target.value)} />
        </Champ>
        <Champ libelle={t('drawer.csvFile')}>
          <input type="file" accept=".csv,text/csv" onChange={choisirFichier} />
        </Champ>

        {parsed && (
          <>
            <div>
              <span className="jr-libelle">{t('drawer.csvMapping')}</span>
              <Table
                colonnes={[
                  { cle: 'colonne', titre: t('drawer.csvColColumn') },
                  { cle: 'exemple', titre: t('drawer.csvColExample') },
                  { cle: 'champ', titre: t('drawer.csvColField') },
                ]}
                lignes={parsed.headers.map((header) => ({
                  colonne: header,
                  exemple: parsed.rows[0]?.[header] ?? '',
                  champ: (
                    <select
                      value={mapping[header] ?? ''}
                      onChange={(e) => changerMapping(header, e.target.value)}
                    >
                      <option value="">{t('drawer.csvColIgnore')}</option>
                      {IMPORT_FIELDS.map((champ) => (
                        <option key={champ} value={champ}>
                          {t(`drawer.csvFields.${champ}`)}
                        </option>
                      ))}
                    </select>
                  ),
                }))}
              />
            </div>

            {rapport && (
              <div>
                <span className="jr-libelle">{t('drawer.csvBefore')}</span>
                <div className="jr-carte">
                  <div className="jr-corps">
                    <CleValeur libelle={t('drawer.csvRowsRead')} valeur={rapport.rowsTotal} />
                    <CleValeur libelle={t('drawer.csvNew')} valeur={rapport.rowsUnique} />
                    <CleValeur libelle={t('drawer.csvKnown')} valeur={rapport.rowsMerged} />
                    <CleValeur
                      libelle={t('drawer.csvMissingEmail')}
                      valeur={rapport.emailsMissing}
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        {erreur && (
          <div className="jr-notification erreur" role="alert">
            {erreur}
          </div>
        )}
      </div>
    </Tiroir>
  );
}
