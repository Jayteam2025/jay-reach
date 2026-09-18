import { getTranslations } from 'next-intl/server';
import { lireConsommationDuJour, lireReglages, lireReglagesDetail, type ClePlafond } from '@jay-reach/core';
import { contexteCourant } from '../../../../lib/contexte';
import { FUSEAU_PAR_DEFAUT } from '../../../../lib/dates';
import { libelleModification } from '../../../../lib/libelle-modification';
import { parametresScoringTexte, parametresValeurConsommation } from '../../../../lib/plafonds-affichage';
import { BarreProgression, Carte } from '../../../../components/ui';
import { TablePlafonds, type LignePlafond } from '../../../../components/reglages/TablePlafonds';

export const revalidate = 0;

/** Les cinq lignes éditables de cet écran (spec lot 2 §7) — dans l'ordre de la maquette `reglages-plafonds.html`. `fuseau` (6ᵉ clé de `CLES_REGLAGES`) se règle dans Réglages › Compte (tâche 23), pas ici. */
const ORDRE_LIGNES: readonly ClePlafond[] = [
  'scoring_par_jour',
  'enrichissements_par_jour',
  'score_min_defaut',
  'relecture_premiers_envois_defaut',
  'age_max_offres_jours',
];

function tonJauge(utilise: number, plafond: number): 'normal' | 'attention' | 'erreur' {
  if (plafond <= 0) return utilise > 0 ? 'erreur' : 'normal';
  const pourcentage = (utilise / plafond) * 100;
  return pourcentage >= 100 ? 'erreur' : pourcentage >= 90 ? 'attention' : 'normal';
}

function pourcentageJauge(utilise: number, plafond: number): number {
  return plafond > 0 ? Math.min(100, Math.round((utilise / plafond) * 100)) : 0;
}

export default async function PlafondsPage() {
  const t = await getTranslations('reglages.plafonds');
  const ctx = await contexteCourant();

  const reglages = await lireReglages(ctx);
  const [detail, consommation] = await Promise.all([
    lireReglagesDetail(ctx, reglages),
    lireConsommationDuJour(ctx, reglages),
  ]);

  const maintenant = new Date();
  const fuseau = String(reglages.fuseau || FUSEAU_PAR_DEFAUT);
  const parCle = new Map(detail.map((d) => [d.cle, d]));
  const peutModifier = ctx.role === 'admin' || ctx.role === 'owner';

  const libellesLignes: Record<string, { nom: string; description: string; suffixe?: string }> = {
    scoring_par_jour: { nom: t('lignes.scoringParJour.nom'), description: t('lignes.scoringParJour.description') },
    enrichissements_par_jour: {
      nom: t('lignes.enrichissementsParJour.nom'),
      description: t('lignes.enrichissementsParJour.description'),
    },
    score_min_defaut: { nom: t('lignes.scoreMinDefaut.nom'), description: t('lignes.scoreMinDefaut.description') },
    relecture_premiers_envois_defaut: {
      nom: t('lignes.relecturePremiersEnvoisDefaut.nom'),
      description: t('lignes.relecturePremiersEnvoisDefaut.description'),
    },
    age_max_offres_jours: {
      nom: t('lignes.ageMaxOffresJours.nom'),
      description: t('lignes.ageMaxOffresJours.description'),
      suffixe: t('lignes.ageMaxOffresJours.suffixe'),
    },
  };

  const lignes: LignePlafond[] = ORDRE_LIGNES.map((cle) => {
    const d = parCle.get(cle)!;
    const libelle = libellesLignes[cle]!;
    return {
      cle,
      nom: libelle.nom,
      description: libelle.description,
      valeur: d.valeur,
      defaut: d.defaut,
      repli: d.repli,
      modifie: libelleModification(d.modifiePar, d.modifieLe, (cle, valeurs) => t(`table.${cle}`, valeurs), maintenant, fuseau),
      type: 'nombre',
      suffixe: libelle.suffixe,
    };
  });

  return (
    <div style={{ display: 'grid', gap: 16, alignContent: 'start', minWidth: 0 }}>
      <div className="jr-section-entete">
        <div>
          <h2>{t('title')}</h2>
          <p>{t('lead')}</p>
        </div>
      </div>

      <div className="jr-deux-colonnes">
        <Carte titre={t('consommation.title')}>
          <div className="jr-cle-valeur">
            <span>{t('consommation.scoring')}</span>
            <b>{t('consommation.valeur', parametresValeurConsommation(consommation.scoring.utilise, consommation.scoring.plafond))}</b>
          </div>
          <BarreProgression
            valeur={pourcentageJauge(consommation.scoring.utilise, consommation.scoring.plafond)}
            ton={tonJauge(consommation.scoring.utilise, consommation.scoring.plafond)}
          />
          <div className="jr-cle-valeur">
            <span>{t('consommation.enrichissement')}</span>
            <b>
              {t(
                'consommation.valeur',
                parametresValeurConsommation(consommation.enrichissement.utilise, consommation.enrichissement.plafond),
              )}
            </b>
          </div>
          <BarreProgression
            valeur={pourcentageJauge(consommation.enrichissement.utilise, consommation.enrichissement.plafond)}
            ton={tonJauge(consommation.enrichissement.utilise, consommation.enrichissement.plafond)}
          />
          <div className="jr-cle-valeur">
            <span>{t('consommation.envois')}</span>
            <b>{t('consommation.valeur', parametresValeurConsommation(consommation.envois.utilise, consommation.envois.plafond))}</b>
          </div>
          <BarreProgression
            valeur={pourcentageJauge(consommation.envois.utilise, consommation.envois.plafond)}
            ton={tonJauge(consommation.envois.utilise, consommation.envois.plafond)}
          />
          <p className="jr-aide" style={{ marginTop: 8 }}>
            {t('consommation.aide', { fuseau })}
          </p>
        </Carte>

        <Carte titre={t('protection.title')}>
          <div style={{ fontSize: 13.5, display: 'grid', gap: 8 }}>
            <p style={{ margin: 0 }}>
              <b>{t('protection.scoringTitre')}</b> : {t('protection.scoringTexte', parametresScoringTexte(consommation.scoring.plafond))}
            </p>
            <p style={{ margin: 0 }}>
              <b>{t('protection.enrichissementTitre')}</b> : {t('protection.enrichissementTexte')}
            </p>
            <p style={{ margin: 0 }}>
              <b>{t('protection.defautsTitre')}</b> : {t('protection.defautsTexte')}
            </p>
          </div>
        </Carte>
      </div>

      <TablePlafonds
        lignes={lignes}
        peutModifier={peutModifier}
        libelles={{
          colReglage: t('table.colReglage'),
          colValeur: t('table.colValeur'),
          colDefaut: t('table.colDefaut'),
          colRepli: t('table.colRepli'),
          colModifie: t('table.colModifie'),
          modifier: t('table.modifier'),
          enregistrer: t('table.enregistrer'),
          annuler: t('table.annuler'),
          aucunRepli: t('table.aucunRepli'),
          erreurNombre: t('table.erreurNombre'),
        }}
      />

      <div className="jr-section-entete">
        <div>
          <h2>{t('ailleurs.title')}</h2>
          <p>{t('ailleurs.lead')}</p>
        </div>
      </div>
      <div className="jr-carte">
        <table className="jr-table">
          <thead>
            <tr>
              <th>{t('ailleurs.colReglage')}</th>
              <th>{t('ailleurs.colNiveau')}</th>
              <th>{t('ailleurs.colOu')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t('ailleurs.boites.reglage')}</td>
              <td className="jr-secondaire">{t('ailleurs.boites.niveau')}</td>
              <td>
                <a className="jr-lien" href="/settings/senders">
                  {t('ailleurs.boites.lien')}
                </a>
              </td>
            </tr>
            <tr>
              <td>{t('ailleurs.campagnes.reglage')}</td>
              <td className="jr-secondaire">{t('ailleurs.campagnes.niveau')}</td>
              <td>
                <a className="jr-lien" href="/campaigns">
                  {t('ailleurs.campagnes.lien')}
                </a>
              </td>
            </tr>
            <tr>
              <td>{t('ailleurs.sources.reglage')}</td>
              <td className="jr-secondaire">{t('ailleurs.sources.niveau')}</td>
              <td>
                <a className="jr-lien" href="/campaigns">
                  {t('ailleurs.sources.lien')}
                </a>
              </td>
            </tr>
            <tr>
              <td>{t('ailleurs.pause.reglage')}</td>
              <td className="jr-secondaire">{t('ailleurs.pause.niveau')}</td>
              <td>
                <a className="jr-lien" href="/settings/engine">
                  {t('ailleurs.pause.lien')}
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
