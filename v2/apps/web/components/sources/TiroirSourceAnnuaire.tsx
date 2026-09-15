'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { DirectoryCompany } from '../../lib/directory';
import { Bouton, Champ, Table, Tiroir } from '../ui';
import { actionRechercherAnnuaire, actionAjouterDepuisAnnuaire } from '../../app/actions/directory';
import { CaseACocher } from './CaseACocher';

export interface TiroirSourceAnnuaireProps {
  campagneId: string;
}

const BUCKETS = ['small', 'mid', 'large', 'xl'] as const;

/**
 * Tiroir « Annuaire d'entreprises » (maquette `tiroir-source-annuaire.html`,
 * R41) : cherche via l'API publique (`actionRechercherAnnuaire`), coche les
 * entreprises à retenir, puis les persiste (`actionAjouterDepuisAnnuaire`) —
 * jamais de contact créé, seulement des comptes.
 */
export function TiroirSourceAnnuaire({ campagneId }: TiroirSourceAnnuaireProps) {
  const t = useTranslations('campagne.sources');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [naf, setNaf] = useState('');
  const [department, setDepartment] = useState('');
  const [effectif, setEffectif] = useState('');
  const [resultats, setResultats] = useState<DirectoryCompany[] | null>(null);
  const [retenues, setRetenues] = useState<Set<string>>(new Set());

  function fermer() {
    router.push('?', { scroll: false });
  }

  function rechercher() {
    setErreur(null);
    startTransition(async () => {
      const r = await actionRechercherAnnuaire({ q, naf, department, effectif });
      setResultats(r.results);
      setRetenues(new Set(r.results.map((c) => c.siren)));
    });
  }

  function basculer(siren: string) {
    setRetenues((prev) => {
      const copie = new Set(prev);
      if (copie.has(siren)) copie.delete(siren);
      else copie.add(siren);
      return copie;
    });
  }

  function retenir() {
    if (!resultats) return;
    const entreprises = resultats
      .filter((c) => retenues.has(c.siren))
      .map((c) => ({
        siren: c.siren,
        name: c.name,
        naf: c.naf,
        city: c.city,
        postalCode: c.postalCode,
      }));
    if (entreprises.length === 0) return;
    setErreur(null);
    startTransition(async () => {
      const res = await actionAjouterDepuisAnnuaire(campagneId, entreprises);
      if (res.ok) {
        router.refresh();
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
      titre={t('menu.directory.title')}
      description={t('drawer.directoryIntro')}
      pied={
        <>
          <span />
          <div className="jr-carte-h-actions">
            <Bouton onClick={fermer}>{t('drawer.cancel')}</Bouton>
            <Bouton
              variante="principal"
              onClick={retenir}
              disabled={pending || retenues.size === 0}
            >
              {t('drawer.directoryRetain', { n: retenues.size })}
            </Bouton>
          </div>
        </>
      }
    >
      <div className="jr-formulaire">
        <div className="ligne">
          <Champ libelle={t('drawer.directoryQuery')}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="logiciel" />
          </Champ>
          <Champ libelle={t('drawer.directoryNaf')}>
            <input value={naf} onChange={(e) => setNaf(e.target.value)} placeholder="62.01Z" />
          </Champ>
        </div>
        <div className="ligne">
          <Champ libelle={t('drawer.directoryDepartment')}>
            <input
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="69"
              maxLength={3}
            />
          </Champ>
          <Champ libelle={t('drawer.directoryEffectif')}>
            <select value={effectif} onChange={(e) => setEffectif(e.target.value)}>
              <option value="">—</option>
              {BUCKETS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </Champ>
        </div>
        <Bouton onClick={rechercher} disabled={pending}>
          {t('drawer.directorySearch')}
        </Bouton>

        {resultats && (
          <>
            <span className="jr-libelle">
              {t('drawer.directoryFound', { n: resultats.length })}
            </span>
            <Table
              colonnes={[
                { cle: 'coche', titre: '' },
                { cle: 'entreprise', titre: t('drawer.directoryColCompany') },
                { cle: 'ville', titre: t('drawer.directoryColCity') },
                { cle: 'effectif', titre: t('drawer.directoryColHeadcount') },
              ]}
              lignes={resultats.map((c) => ({
                coche: (
                  <CaseACocher coche={retenues.has(c.siren)} onChange={() => basculer(c.siren)}>
                    {''}
                  </CaseACocher>
                ),
                entreprise: (
                  <>
                    <b>{c.name}</b>
                    <br />
                    <span className="jr-secondaire">{c.naf}</span>
                  </>
                ),
                ville: c.city ?? '—',
                effectif: c.effectifLabel,
              }))}
            />
            <div>
              <span className="jr-libelle">{t('drawer.directoryProduces')}</span>
              <div className="jr-carte">
                <div className="jr-corps">
                  <div className="jr-cle-valeur">
                    <span>{t('drawer.directoryRetained')}</span>
                    <b>{retenues.size}</b>
                  </div>
                  <div className="jr-cle-valeur">
                    <span>{t('drawer.directoryContactsCreated')}</span>
                    <b>{t('drawer.directoryNone')}</b>
                  </div>
                </div>
              </div>
              <p className="jr-aide">{t('drawer.directoryHint')}</p>
            </div>
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
