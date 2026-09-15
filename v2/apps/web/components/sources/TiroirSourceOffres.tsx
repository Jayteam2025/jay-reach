'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { configFormulaireDepuisStockee } from '@jay-reach/core';
import { Bouton, Champ, Puce, Tiroir, TuileLogo } from '../ui';
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
  /** Tous les fournisseurs réels rattachés, dans l'ordre du principal (R44) : `[providerId]` hors thème hérité multi-fournisseurs. */
  readonly providerIds: ('adzuna' | 'france_travail')[];
  readonly active: boolean;
  /** Offres distinctes trouvées depuis le premier passage — puce d'en-tête, masquée si `premierPassage` est `null`. */
  readonly totalLu: number;
  readonly premierPassage: string | null;
}

const LIBELLE_PROVIDER: Record<'adzuna' | 'france_travail', 'menu.adzuna.title' | 'menu.franceTravail.title'> = {
  adzuna: 'menu.adzuna.title',
  france_travail: 'menu.franceTravail.title',
};

export interface TiroirSourceOffresProps {
  readonly campagneId: string;
  readonly providerId: 'adzuna' | 'france_travail';
  readonly source: SourceOffresExistante | null;
  /** Nom de la campagne (persona), pour le sous-titre D1 — vrai en création comme en modification. */
  readonly persona: string;
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

/** Vue locale unifiée de `ConfigAdzuna | ConfigFranceTravail` (champs propres à chacun en optionnel). */
type ConfigOffresAffichee = {
  motsCles: string[];
  lieux: string[];
  contrat?: 'cdi' | 'tous';
  typeContrat?: 'cdi' | 'tous';
  taille?: string;
  departement?: string;
  exclusions: string[];
  ageMaxJours?: number;
};

/**
 * Tiroir Adzuna/France Travail (maquette `tiroir-source-adzuna.html`) : même
 * formulaire pour les deux fournisseurs, seuls les libellés « Taille
 * d'entreprise »/« Département » changent. Les listes (mots-clés, lieux,
 * exclusions) se saisissent en texte séparé par des virgules — le kit n'a
 * pas de saisie par puces amovibles.
 */
export function TiroirSourceOffres({
  campagneId,
  providerId,
  source,
  persona,
}: TiroirSourceOffresProps) {
  const t = useTranslations('campagne.sources');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  // R43 (tour de correction 2) : une source existante ne porte QUE les clés du
  // WORKER (`keywords`, `location`, `exclude_keywords` — jamais `motsCles`/
  // `lieux`/`exclusions` pour une source migrée avant ce lot). Lire `config`
  // du formulaire directement laissait tous les champs vides à l'ouverture.
  const config: ConfigOffresAffichee | null = source
    ? (configFormulaireDepuisStockee(providerId, source.config) as ConfigOffresAffichee)
    : null;
  const [nom, setNom] = useState(source?.nom ?? '');
  const [motsCles, setMotsCles] = useState(listeVersTexte(config?.motsCles ?? []));
  const [lieux, setLieux] = useState(listeVersTexte(config?.lieux ?? []));
  const [contrat, setContrat] = useState<'cdi' | 'tous'>(
    config?.contrat ?? config?.typeContrat ?? 'tous',
  );
  const [taille, setTaille] = useState(config?.taille ?? '');
  const [departement, setDepartement] = useState(config?.departement ?? '');
  const [exclusions, setExclusions] = useState(listeVersTexte(config?.exclusions ?? []));
  const [ageMaxJours, setAgeMaxJours] = useState(
    typeof config?.ageMaxJours === 'number' ? String(config.ageMaxJours) : '',
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

  // R44 (tour de correction 2) : un thème hérité peut être rattaché à
  // PLUSIEURS fournisseurs réels (ex. « France Travail » à `adzuna` ET
  // `francetravail`) — le tiroir s'ouvre sur le principal, et le dit pour
  // ne rien cacher des autres.
  const autresProviders = (source?.providerIds ?? []).filter((p) => p !== providerId);
  const libelleProvider = t(LIBELLE_PROVIDER[providerId]);

  // D1 (tour de correction 2, maquette `tiroir-source-adzuna.html`) : statut
  // et total lu ne s'affichent qu'une fois la source créée (pas en création,
  // et pas avant son premier passage — une puce à « 0 offre lue » ne dit rien).
  const puces = [
    source && (
      <Puce key="statut" ton={source.active ? 'bon' : undefined} point>
        {source.active ? t('card.active') : t('card.paused')}
      </Puce>
    ),
    source?.premierPassage && (
      <Puce key="lu">
        {t('drawer.readSince', {
          n: source.totalLu,
          date: new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(
            new Date(source.premierPassage),
          ),
        })}
      </Puce>
    ),
    ...autresProviders.map((p) => (
      <Puce key={`aussi-${p}`}>{t('drawer.alsoProvider', { provider: t(LIBELLE_PROVIDER[p]) })}</Puce>
    )),
  ].filter(Boolean);

  return (
    <Tiroir
      ouvert
      onFermer={fermer}
      libelleFermer={t('drawer.close')}
      titre={t('drawer.offresTitle', { provider: libelleProvider })}
      description={t('drawer.offresSubtitle', { persona })}
      icone={
        <TuileLogo marque={providerId === 'adzuna' ? 'adzuna' : 'francetravail'} taille="grande" />
      }
      puces={puces.length > 0 ? puces : undefined}
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
