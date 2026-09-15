'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { DirectoryCompany } from '../../lib/directory';
import { Bouton, Champ, Puce, Table, Tiroir } from '../ui';
import { actionRechercherAnnuaire, actionAjouterDepuisAnnuaire } from '../../app/actions/directory';
import { CaseACocher } from './CaseACocher';

export interface TiroirSourceAnnuaireProps {
  campagneId: string;
}

const BUCKETS = ['small', 'mid', 'large', 'xl'] as const;

export interface BlocResultatAnnuaireProps {
  readonly entreprisesRetenues: number;
  readonly dejaConnues: number;
  readonly libelles: {
    readonly produces: string;
    readonly retained: string;
    readonly known: string;
    readonly contactsCreated: string;
    readonly none: string;
    readonly hint: string;
  };
}

/**
 * Bloc « Ce que ça produit » du tiroir annuaire (R42) : les trois lignes ne
 * viennent QUE de la réponse du serveur (`entreprisesRetenues`, `dejaConnues`)
 * — jamais d'un décompte client fait avant l'ajout, qui promettrait un
 * résultat que le serveur peut démentir (SIREN déjà connu entre-temps, etc.).
 * Extrait à part, sans `useRouter`/`useTranslations`, pour rester testable
 * par `renderToStaticMarkup` (convention de `TiroirRelecture.tsx`).
 */
export function BlocResultatAnnuaire({
  entreprisesRetenues,
  dejaConnues,
  libelles,
}: BlocResultatAnnuaireProps) {
  return (
    <div>
      <span className="jr-libelle">{libelles.produces}</span>
      <div className="jr-carte">
        <div className="jr-corps">
          <div className="jr-cle-valeur">
            <span>{libelles.retained}</span>
            <b>{entreprisesRetenues}</b>
          </div>
          <div className="jr-cle-valeur">
            <span>{libelles.known}</span>
            <b>{dejaConnues}</b>
          </div>
          <div className="jr-cle-valeur">
            <span>{libelles.contactsCreated}</span>
            <b>{libelles.none}</b>
          </div>
        </div>
      </div>
      <p className="jr-aide">{libelles.hint}</p>
    </div>
  );
}

/**
 * Tiroir « Annuaire d'entreprises » (maquette `tiroir-source-annuaire.html`,
 * R41) : cherche via l'API publique (`actionRechercherAnnuaire`), coche les
 * entreprises à ajouter, puis les persiste (`actionAjouterDepuisAnnuaire`) —
 * jamais de contact créé, seulement des comptes d'ORGANISATION (R42, tour de
 * correction 1 : aucune table ne porte de lien entreprise ↔ campagne — le
 * texte de cet écran ne le promet jamais). Le bloc « Ce que ça produit »
 * n'apparaît qu'une fois la réponse du serveur connue (`entreprisesRetenues`/
 * `dejaConnues`), jamais avant : avant l'ajout, on ne sait pas encore combien
 * seront neuves.
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
  const [sirensConnus, setSirensConnus] = useState<Set<string>>(new Set());
  const [retenues, setRetenues] = useState<Set<string>>(new Set());
  const [resultat, setResultat] = useState<{ entreprisesRetenues: number; dejaConnues: number } | null>(null);

  function changerQ(v: string) {
    setQ(v);
  }
  function changerNaf(v: string) {
    setNaf(v);
  }
  function changerDepartment(v: string) {
    setDepartment(v);
  }

  function fermer() {
    router.push('?', { scroll: false });
  }

  function rechercher() {
    setErreur(null);
    startTransition(async () => {
      const r = await actionRechercherAnnuaire({ q, naf, department, effectif });
      setResultats(r.results);
      setSirensConnus(new Set(r.sirensConnus));
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
        setResultat({ entreprisesRetenues: res.entreprisesRetenues, dejaConnues: res.dejaConnues });
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
      puces={<Puce>{t('drawer.directoryPublicData')}</Puce>}
      pied={
        resultat ? (
          <>
            <span />
            <Bouton variante="principal" onClick={fermer}>
              {t('drawer.close')}
            </Bouton>
          </>
        ) : (
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
        )
      }
    >
      <div className="jr-formulaire">
        {resultat ? (
          <BlocResultatAnnuaire
            entreprisesRetenues={resultat.entreprisesRetenues}
            dejaConnues={resultat.dejaConnues}
            libelles={{
              produces: t('drawer.directoryProduces'),
              retained: t('drawer.directoryRetained'),
              known: t('drawer.directoryKnown'),
              contactsCreated: t('drawer.directoryContactsCreated'),
              none: t('drawer.directoryNone'),
              hint: t('drawer.directoryHint'),
            }}
          />
        ) : (
          <>
            <div className="ligne">
              <Champ libelle={t('drawer.directoryQuery')}>
                <input value={q} onChange={(e) => changerQ(e.target.value)} placeholder="logiciel" />
              </Champ>
              <Champ libelle={t('drawer.directoryNaf')}>
                <input value={naf} onChange={(e) => changerNaf(e.target.value)} placeholder="62.01Z" />
              </Champ>
            </div>
            <div className="ligne">
              <Champ libelle={t('drawer.directoryDepartment')}>
                <input
                  value={department}
                  onChange={(e) => changerDepartment(e.target.value)}
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
                        {sirensConnus.has(c.siren) && (
                          <>
                            {' '}
                            <Puce>{t('drawer.directoryAlreadyKnown')}</Puce>
                          </>
                        )}
                      </>
                    ),
                    ville: c.city ?? '—',
                    effectif: c.effectifLabel,
                  }))}
                />
              </>
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
