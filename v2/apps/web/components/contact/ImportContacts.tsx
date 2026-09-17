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

export interface ImportContactsProps {
  /** Campagnes de l'organisation (id, nom) — l'import est toujours scopé à UNE campagne (`importerCsv`, tâche 11). */
  campagnes: { id: string; nom: string }[];
}

/**
 * Bouton « Importer un CSV » de l'en-tête de la page Contacts globale (tâche
 * 18) : réutilise `importerCsv` (`packages/core/src/fonctions/sources.ts`,
 * tâche 11) via la façade existante `actionImporterCsvDansCampagne`
 * (`apps/web/app/actions/import.ts`) — pas de second parseur CSV, pas de
 * seconde fonction d'import. Seule différence avec `TiroirSourceCsv` (tâche
 * 11, Sources d'une campagne) : la campagne cible est choisie ICI (un menu),
 * puisque cette page n'a pas de campagne de contexte.
 */
export function ImportContacts({ campagnes }: ImportContactsProps) {
  const t = useTranslations('contacts');
  const tChamps = useTranslations('campagne.sources');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const [campagneId, setCampagneId] = useState(campagnes[0]?.id ?? '');
  const [nom, setNom] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedRows | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});

  const rapport = useMemo(() => (parsed ? processImport(parsed, mapping).report : null), [parsed, mapping]);

  function fermer() {
    setOuvert(false);
    setErreur(null);
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
    if (!parsed || !campagneId) return;
    setErreur(null);
    startTransition(async () => {
      const res = await actionImporterCsvDansCampagne(campagneId, { nom, fileName, parsed, mapping });
      if (res.ok) {
        router.refresh();
        fermer();
      } else {
        setErreur(res.issues?.join(' ') ?? res.error);
      }
    });
  }

  return (
    <>
      <Bouton onClick={() => setOuvert(true)}>{t('importDialog.open')}</Bouton>
      {ouvert && (
        <Tiroir
          ouvert
          onFermer={fermer}
          libelleFermer={t('importDialog.close')}
          titre={t('importDialog.title')}
          description={campagnes.length > 0 ? t('importDialog.intro') : t('importDialog.noCampaign')}
          pied={
            <>
              <span />
              <div className="jr-carte-h-actions">
                <Bouton onClick={fermer}>{t('importDialog.cancel')}</Bouton>
                <Bouton
                  variante="principal"
                  onClick={importer}
                  disabled={pending || !parsed || !campagneId || (rapport?.rowsUnique ?? 0) === 0}
                >
                  {t('importDialog.submit', { n: rapport?.rowsUnique ?? 0 })}
                </Bouton>
              </div>
            </>
          }
        >
          <div className="jr-formulaire">
            <Champ libelle={t('importDialog.campaign')} id="import-contacts-campagne">
              <select id="import-contacts-campagne" value={campagneId} onChange={(e) => setCampagneId(e.target.value)}>
                {campagnes.length === 0 && <option value="">{t('importDialog.chooseCampaign')}</option>}
                {campagnes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nom}
                  </option>
                ))}
              </select>
            </Champ>
            <Champ libelle={t('importDialog.listName')} id="import-contacts-nom">
              <input id="import-contacts-nom" value={nom} onChange={(e) => setNom(e.target.value)} />
            </Champ>
            <Champ libelle={t('importDialog.file')} id="import-contacts-fichier">
              <input id="import-contacts-fichier" type="file" accept=".csv,text/csv" onChange={choisirFichier} />
            </Champ>

            {parsed && (
              <>
                <div>
                  <span className="jr-libelle">{t('importDialog.mapping')}</span>
                  <Table
                    colonnes={[
                      { cle: 'colonne', titre: t('importDialog.colColumn') },
                      { cle: 'exemple', titre: t('importDialog.colExample') },
                      { cle: 'champ', titre: t('importDialog.colField') },
                    ]}
                    lignes={parsed.headers.map((header) => ({
                      colonne: header,
                      exemple: parsed.rows[0]?.[header] ?? '',
                      champ: (
                        <select
                          className="jr-champ"
                          name={`mapping-${header}`}
                          value={mapping[header] ?? ''}
                          onChange={(e) => changerMapping(header, e.target.value)}
                        >
                          <option value="">{t('importDialog.colIgnore')}</option>
                          {IMPORT_FIELDS.map((champ) => (
                            <option key={champ} value={champ}>
                              {tChamps(`drawer.csvFields.${champ}`)}
                            </option>
                          ))}
                        </select>
                      ),
                    }))}
                  />
                </div>

                {rapport && (
                  <div>
                    <span className="jr-libelle">{t('importDialog.before')}</span>
                    <div className="jr-carte">
                      <div className="jr-corps">
                        <CleValeur libelle={t('importDialog.rowsRead')} valeur={rapport.rowsTotal} />
                        <CleValeur libelle={t('importDialog.new')} valeur={rapport.rowsUnique} />
                        <CleValeur libelle={t('importDialog.known')} valeur={rapport.rowsMerged} />
                        <CleValeur libelle={t('importDialog.missingEmail')} valeur={rapport.emailsMissing} />
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
      )}
    </>
  );
}
