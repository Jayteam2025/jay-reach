import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { CampagneResume } from '@jay-reach/core';
import { contexteCourant } from '../../lib/contexte';
import { lireAujourdhuiCourant } from '../../lib/aujourdhui';
import { marqueSource } from '../../lib/marque-source';
import { FUSEAU_PAR_DEFAUT, cleJourDansFuseau } from '../../lib/dates';
import { Avatar, BarreProgression, Bouton, Carte, CleValeur, EnTetePage, Puce, Table, TuileLogo } from '../../components/ui';
import type { PuceTon } from '../../components/ui';

export const revalidate = 60;

const nf = new Intl.NumberFormat('fr-FR');

function capitaliser(texte: string): string {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

function formatHeure(iso: string | null): string {
  return iso
    ? new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: FUSEAU_PAR_DEFAUT }).format(new Date(iso))
    : '—';
}

/**
 * HH:MM pour aujourd'hui, « hier » pour la veille, sinon « il y a N j » —
 * même logique que la Réception. `timeZone` posé sur l'heure affichée (R67) ;
 * la classification aujourd'hui/hier compare désormais des clés de jour
 * calendaire DANS `fuseau` (`cleJourDansFuseau`, `lib/dates.ts`), pas les
 * accesseurs locaux (`toDateString`) qui suivent le fuseau du PROCESS qui
 * exécute le rendu (I5, revue finale — même correctif que `heureAvecJour`).
 * `maintenant` en paramètre : testable sans horloge (`page.test.ts`).
 */
export function quandRelatif(iso: string | null, maintenant: Date = new Date()): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (cleJourDansFuseau(date, FUSEAU_PAR_DEFAUT) === cleJourDansFuseau(maintenant, FUSEAU_PAR_DEFAUT)) {
    return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: FUSEAU_PAR_DEFAUT }).format(date);
  }
  // Absolu (pas un `setDate` local) : même raison que « demain » dans `heureAvecJour`.
  const hier = new Date(maintenant.getTime() - 86_400_000);
  if (cleJourDansFuseau(date, FUSEAU_PAR_DEFAUT) === cleJourDansFuseau(hier, FUSEAU_PAR_DEFAUT)) return 'hier';
  const jours = Math.max(1, Math.round((maintenant.getTime() - date.getTime()) / 86_400_000));
  return `il y a ${jours} j`;
}

function tonJauge(utilise: number, plafond: number): 'normal' | 'attention' | 'erreur' {
  if (plafond <= 0) return utilise > 0 ? 'erreur' : 'normal';
  const pourcentage = (utilise / plafond) * 100;
  return pourcentage >= 100 ? 'erreur' : pourcentage >= 90 ? 'attention' : 'normal';
}

function pourcentageJauge(utilise: number, plafond: number): number {
  return plafond > 0 ? Math.min(100, Math.round((utilise / plafond) * 100)) : 0;
}

/**
 * Logo de la boîte d'envoi, déduit du domaine de son adresse — `senders` ne
 * porte aucune colonne « type de boîte » (son seul `provider_id` désigne le
 * transport, SalesBlink, pas la messagerie). Une adresse sur un domaine
 * personnalisé (le cas réel de production) ne matche aucun des deux motifs :
 * pas de logo, comme le prévoit le kit.
 */
function logoBoiteEnvoi(identite: string | null): 'outlook' | 'gmail' | null {
  const domaine = identite?.split('@')[1]?.toLowerCase();
  if (!domaine) return null;
  if (['outlook.com', 'hotmail.com', 'live.com', 'office365.com'].some((d) => domaine.endsWith(d)) || domaine.includes('microsoft')) return 'outlook';
  if (domaine.endsWith('gmail.com') || domaine.endsWith('googlemail.com')) return 'gmail';
  return null;
}

const TON_STATUT_CAMPAGNE: Record<CampagneResume['statut'], PuceTon> = {
  draft: 'gris',
  active: 'bon',
  paused: 'attention',
  archived: 'gris',
};

export default async function AujourdhuiPage() {
  const ctx = await contexteCourant();
  const [t, a] = await Promise.all([getTranslations('aujourdhui'), lireAujourdhuiCourant(ctx)]);

  const jour = capitaliser(
    new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: FUSEAU_PAR_DEFAUT }).format(
      new Date(),
    ),
  );
  const campagnesActives = a.campagnes.filter((c) => c.statut === 'active').length;
  const nbAutresEnvois = a.fileDuJour.total - a.fileDuJour.envois.length;

  return (
    <>
      {a.alertes.map((alerte, index) => (
        // Index inclus dans la clé : plusieurs boîtes déconnectées partagent le même `type`.
        <div key={`${alerte.type}-${index}`} className={`jr-bandeau ${alerte.type === 'moteur_silencieux' ? 'erreur' : 'attention'}`} style={{ marginBottom: 8 }}>
          <span>{alerte.texte}</span>
          <Link href={alerte.lien} className="jr-lien">
            {t('alerts.action')}
          </Link>
        </div>
      ))}

      <EnTetePage
        titre={jour}
        description={t('resume', { aTraiter: a.aTraiter.total, envois: a.fileDuJour.total, campagnes: campagnesActives })}
        action={<Bouton variante="principal">{t('newCampaign')}</Bouton>}
      />

      <section className="jr-aujourdhui">
        <Carte
          titre={t('toProcess.title')}
          action={
            <>
              <small>{t('toProcess.count', { n: a.aTraiter.total })}</small>
              <Link href="/inbox" className="jr-lien" style={{ fontSize: 13 }}>
                {t('toProcess.open')}
              </Link>
            </>
          }
        >
          {a.aTraiter.fils.length === 0 ? (
            <p className="jr-secondaire">{t('toProcess.empty')}</p>
          ) : (
            <ul className="jr-conversations" style={{ margin: '0 -18px' }}>
              {a.aTraiter.fils.map((fil) => (
                <li key={fil.id}>
                  <Avatar nom={fil.contactNom} canal={fil.canal} />
                  <span>
                    <b>{fil.contactNom}</b>
                    <p>{fil.extrait}</p>
                  </span>
                  <time>{quandRelatif(fil.quand)}</time>
                  <span className="etiquettes">
                    <Puce ton="gris">{t(`classification.${fil.classification}`)}</Puce>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Carte>

        <Carte
          titre={t('queue.title')}
          action={
            <>
              <small>{t('queue.count', { envois: a.fileDuJour.total, partis: a.fileDuJour.dejaPartis })}</small>
              <Link href="/campaigns" className="jr-lien" style={{ fontSize: 13 }}>
                {t('queue.seeAll')}
              </Link>
            </>
          }
        >
          {/* Pas de Table (kit) ici : la maquette ne pose aucun en-tête sur cette table, un `<thead>`
              même vide y ajouterait une ligne bordée que la maquette n'a pas. */}
          {a.fileDuJour.envois.length === 0 ? (
            <div className="jr-vide">{t('queue.empty')}</div>
          ) : (
            <table className="jr-table">
              <tbody>
                {a.fileDuJour.envois.map((envoi) => {
                  const logo = logoBoiteEnvoi(envoi.expediteur);
                  return (
                    <tr key={envoi.id}>
                      <td style={{ paddingLeft: 0 }}>{envoi.heure ?? '—'}</td>
                      <td>
                        <div className="jr-qui">
                          <Avatar nom={envoi.contactNom} canal={envoi.canal} />
                          <span>
                            <b>{envoi.contactNom}</b>
                            <small>
                              {envoi.etape !== null ? t('queue.step', { n: envoi.etape }) : ''}
                              {envoi.campagneNom ? ` · ${envoi.campagneNom}` : ''}
                            </small>
                          </span>
                        </div>
                      </td>
                      <td className="num jr-secondaire" style={{ paddingRight: 0 }}>
                        {logo && <i className={`jr-logo-inline jr-logo-${logo}`} />} {envoi.expediteur ?? '—'}
                      </td>
                    </tr>
                  );
                })}
                {nbAutresEnvois > 0 && (
                  <tr>
                    <td colSpan={3} className="jr-secondaire" style={{ paddingLeft: 0 }}>
                      {t('queue.andMore', { n: nbAutresEnvois })}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </Carte>

        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <Carte titre={t('engine.title')} action={<Puce ton={a.moteur.enMarche ? 'bon' : 'erreur'} point>{a.moteur.enMarche ? t('engine.running') : t('engine.stopped')}</Puce>}>
            <CleValeur libelle={t('engine.last')} valeur={formatHeure(a.moteur.dernierPassage)} />
            <CleValeur libelle={t('engine.next')} valeur={formatHeure(a.moteur.prochainPassage)} />
            <CleValeur libelle={t('engine.errors')} valeur={nf.format(a.moteur.erreursDepuisMinuit)} />
            <CleValeur libelle={t('engine.version')} valeur={a.moteur.version ?? '—'} />
          </Carte>

          <Carte
            titre={t('caps.title')}
            action={
              <Link href="/settings" className="jr-lien" style={{ fontSize: 13 }}>
                {t('caps.settings')}
              </Link>
            }
          >
            <CleValeur libelle={t('caps.scoring')} valeur={`${nf.format(a.plafonds.scoring.utilise)} / ${nf.format(a.plafonds.scoring.plafond)}`} />
            <BarreProgression valeur={pourcentageJauge(a.plafonds.scoring.utilise, a.plafonds.scoring.plafond)} ton={tonJauge(a.plafonds.scoring.utilise, a.plafonds.scoring.plafond)} />
            <CleValeur libelle={t('caps.enrichment')} valeur={`${nf.format(a.plafonds.enrichissement.utilise)} / ${nf.format(a.plafonds.enrichissement.plafond)}`} />
            <BarreProgression
              valeur={pourcentageJauge(a.plafonds.enrichissement.utilise, a.plafonds.enrichissement.plafond)}
              ton={tonJauge(a.plafonds.enrichissement.utilise, a.plafonds.enrichissement.plafond)}
            />
            <CleValeur libelle={t('caps.sending')} valeur={`${nf.format(a.plafonds.envois.utilise)} / ${nf.format(a.plafonds.envois.plafond)}`} />
            <BarreProgression valeur={pourcentageJauge(a.plafonds.envois.utilise, a.plafonds.envois.plafond)} ton={tonJauge(a.plafonds.envois.utilise, a.plafonds.envois.plafond)} />
          </Carte>
        </div>

        <Carte
          className="pleine"
          titre={t('campaigns.title')}
          action={
            <>
              <small>{t('campaigns.count', { n: campagnesActives })}</small>
              <Link href="/campaigns" className="jr-lien" style={{ fontSize: 13 }}>
                {t('campaigns.seeAll')}
              </Link>
            </>
          }
        >
          <Table
            colonnes={[
              { cle: 'campagne', titre: t('campaigns.columns.campaign') },
              { cle: 'sources', titre: t('campaigns.columns.sources') },
              { cle: 'qualifies', titre: t('campaigns.columns.qualified'), num: true },
              { cle: 'sequence', titre: t('campaigns.columns.sequence'), num: true },
              { cle: 'reponses', titre: t('campaigns.columns.replies'), num: true },
              { cle: 'semaine', titre: t('campaigns.columns.week') },
              { cle: 'statut', titre: '' },
            ]}
            lignes={a.campagnes.map((campagne) => ({
              campagne: (
                <div className="jr-qui">
                  <TuileLogo marque="lettre" lettre={campagne.nom.charAt(0).toUpperCase()} />
                  <span>
                    <b>{campagne.nom}</b>
                    <small>{t('campaigns.steps', { n: campagne.etapes, boites: campagne.boites })}</small>
                  </span>
                </div>
              ),
              sources:
                campagne.sources.length === 0 ? (
                  <span className="jr-secondaire">{t('campaigns.noSource')}</span>
                ) : (
                  <span style={{ display: 'inline-flex', gap: 4 }}>
                    {campagne.sources.map((source, index) => (
                      <TuileLogo
                        key={source ?? `inconnu-${index}`}
                        marque={marqueSource(source)}
                        lettre={(source ?? '?').charAt(0).toUpperCase()}
                      />
                    ))}
                  </span>
                ),
              qualifies: nf.format(campagne.qualifies),
              sequence: nf.format(campagne.enSequence),
              reponses: (
                <>
                  {nf.format(campagne.reponses)} <em className="jr-secondaire" style={{ fontStyle: 'normal', fontSize: 12 }}>{campagne.tauxReponse.toLocaleString('fr-FR')} %</em>
                </>
              ),
              // Tendance 7 jours non calculée (demanderait une requête groupée par jour, hors
              // périmètre de cette tâche) : un tiret plutôt qu'une jauge vide qui suggérerait une
              // vraie mesure à zéro.
              semaine: <span className="jr-secondaire">—</span>,
              statut: <Puce ton={TON_STATUT_CAMPAGNE[campagne.statut]} point>{t(`campaigns.status.${campagne.statut}`)}</Puce>,
            }))}
            vide={<div className="jr-vide">{t('campaigns.empty')}</div>}
          />
        </Carte>
      </section>
    </>
  );
}
