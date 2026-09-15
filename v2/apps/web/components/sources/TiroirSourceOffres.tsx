'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Bouton, Champ, Tiroir, TuileLogo } from '../ui';
import {
  actionCreerSource,
  actionLancerPassageCampagne,
  actionModifierSourceCampagne,
} from '../../app/actions/sources';

/** Source existante à modifier — `null` en création. */
export interface SourceOffresExistante {
  readonly id: string;
  readonly nom: string;
  readonly config: Record<string, unknown>;
  readonly schedule: string;
}

export interface TiroirSourceOffresProps {
  readonly campagneId: string;
  readonly providerId: 'adzuna' | 'france_travail';
  readonly source: SourceOffresExistante | null;
}

function listeVersTexte(v: unknown): string {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').join(', ') : '';
}
function texteVersListe(t: string): string[] {
  return t
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Tiroir Adzuna/France Travail (maquette `tiroir-source-adzuna.html`) : même
 * formulaire pour les deux fournisseurs, seuls les libellés « Taille
 * d'entreprise »/« Département » changent. Les listes (mots-clés, lieux,
 * exclusions) se saisissent en texte séparé par des virgules — le kit n'a
 * pas de saisie par puces amovibles.
 */
export function TiroirSourceOffres({ campagneId, providerId, source }: TiroirSourceOffresProps) {
  const t = useTranslations('campagne.sources');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  const config = source?.config ?? {};
  const [nom, setNom] = useState(source?.nom ?? '');
  const [motsCles, setMotsCles] = useState(listeVersTexte(config.motsCles));
  const [lieux, setLieux] = useState(listeVersTexte(config.lieux));
  const [contrat, setContrat] = useState<'cdi' | 'tous'>(
    ((config.contrat ?? config.typeContrat) as 'cdi' | 'tous' | undefined) ?? 'tous',
  );
  const [taille, setTaille] = useState(typeof config.taille === 'string' ? config.taille : '');
  const [departement, setDepartement] = useState(
    typeof config.departement === 'string' ? config.departement : '',
  );
  const [exclusions, setExclusions] = useState(listeVersTexte(config.exclusions));
  const [ageMaxJours, setAgeMaxJours] = useState(
    typeof config.ageMaxJours === 'number' ? String(config.ageMaxJours) : '',
  );
  const [schedule, setSchedule] = useState(source?.schedule ?? 'every 6h');

  function fermer() {
    router.push('?', { scroll: false });
  }

  function construireConfig(): Record<string, unknown> {
    const base: Record<string, unknown> = {
      motsCles: texteVersListe(motsCles),
      lieux: texteVersListe(lieux),
      exclusions: texteVersListe(exclusions),
      ...(ageMaxJours.trim() ? { ageMaxJours: Number(ageMaxJours) } : {}),
    };
    if (providerId === 'adzuna') {
      return { ...base, contrat, ...(taille.trim() ? { taille: taille.trim() } : {}) };
    }
    return {
      ...base,
      typeContrat: contrat,
      ...(departement.trim() ? { departement: departement.trim() } : {}),
    };
  }

  function enregistrer() {
    setErreur(null);
    startTransition(async () => {
      const res = source
        ? await actionModifierSourceCampagne(campagneId, {
            sourceId: source.id,
            nom,
            config: construireConfig(),
            schedule,
          })
        : await actionCreerSource(campagneId, {
            providerId,
            nom,
            config: construireConfig(),
            schedule,
          });
      if (res.ok) {
        router.refresh();
        fermer();
      } else {
        setErreur(res.issues?.join(' ') ?? res.error);
      }
    });
  }

  function lancerPassage() {
    if (!source) return;
    setErreur(null);
    startTransition(async () => {
      const res = await actionLancerPassageCampagne(campagneId, source.id);
      if (res.ok) router.refresh();
      else setErreur(res.error);
    });
  }

  return (
    <Tiroir
      ouvert
      onFermer={fermer}
      libelleFermer={t('drawer.close')}
      titre={providerId === 'adzuna' ? t('menu.adzuna.title') : t('menu.franceTravail.title')}
      icone={
        <TuileLogo marque={providerId === 'adzuna' ? 'adzuna' : 'francetravail'} taille="grande" />
      }
      pied={
        <>
          <span />
          <div className="jr-carte-h-actions">
            <Bouton onClick={lancerPassage} disabled={pending || !source}>
              {t('drawer.runNow')}
            </Bouton>
            <Bouton variante="principal" onClick={enregistrer} disabled={pending}>
              {source ? t('drawer.save') : t('drawer.create')}
            </Bouton>
          </div>
        </>
      }
    >
      <div className="jr-formulaire">
        <Champ libelle={t('drawer.name')}>
          <input value={nom} onChange={(e) => setNom(e.target.value)} />
        </Champ>
        <Champ libelle={t('drawer.keywords')} suffixe={t('drawer.keywordsHint')}>
          <input
            value={motsCles}
            onChange={(e) => setMotsCles(e.target.value)}
            placeholder="directeur commercial, head of sales"
          />
        </Champ>
        <Champ libelle={t('drawer.locations')}>
          <input
            value={lieux}
            onChange={(e) => setLieux(e.target.value)}
            placeholder="Île-de-France, Lyon"
          />
        </Champ>
        <div className="ligne">
          <Champ libelle={t('drawer.contract')}>
            <select value={contrat} onChange={(e) => setContrat(e.target.value as 'cdi' | 'tous')}>
              <option value="tous">{t('drawer.contractAll')}</option>
              <option value="cdi">{t('drawer.contractCdi')}</option>
            </select>
          </Champ>
          {providerId === 'adzuna' ? (
            <Champ libelle={t('drawer.companySize')}>
              <input
                value={taille}
                onChange={(e) => setTaille(e.target.value)}
                placeholder="10 à 250 salariés"
              />
            </Champ>
          ) : (
            <Champ libelle={t('drawer.department')}>
              <input
                value={departement}
                onChange={(e) => setDepartement(e.target.value)}
                placeholder="69"
              />
            </Champ>
          )}
        </div>
        <Champ libelle={t('drawer.exclusions')}>
          <input
            value={exclusions}
            onChange={(e) => setExclusions(e.target.value)}
            placeholder="cabinet de recrutement, intérim"
          />
        </Champ>
        <div className="ligne">
          <Champ libelle={t('drawer.maxAgeDays')} suffixe={t('drawer.maxAgeDaysHint')}>
            <input
              value={ageMaxJours}
              onChange={(e) => setAgeMaxJours(e.target.value)}
              placeholder="14"
            />
          </Champ>
          <Champ libelle={t('drawer.schedule')}>
            <select value={schedule} onChange={(e) => setSchedule(e.target.value)}>
              <option value="every 3h">{t('card.everyNHours', { n: 3 })}</option>
              <option value="every 6h">{t('card.everyNHours', { n: 6 })}</option>
              <option value="every 12h">{t('card.everyNHours', { n: 12 })}</option>
              <option value="every 24h">{t('card.everyNHours', { n: 24 })}</option>
              {/* Valeur historique (R30) : une source créée avant ce lot peut encore la porter. */}
              {schedule === 'daily' && <option value="daily">{t('card.dailySchedule')}</option>}
            </select>
          </Champ>
        </div>
        {erreur && (
          <div className="jr-notification erreur" role="alert">
            {erreur}
          </div>
        )}
      </div>
    </Tiroir>
  );
}
