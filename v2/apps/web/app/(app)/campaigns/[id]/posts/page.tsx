import { getTranslations, getLocale } from 'next-intl/server';
import {
  compterRetenuesParPost,
  decouperAccroche,
  echeanceDePost,
  fuseauDeLOrganisation,
  hasMinRole,
  listerPostsDeCampagne,
  retenuesAAfficher,
  type MorceauAccroche,
} from '@jay-reach/core';
import { contexteCourant } from '../../../../../lib/contexte';
import { EtatVide } from '../../../../../components/ui';
import { TablePosts, ligneValidable, type LignePostEcran } from '../../../../../components/campagne/TablePosts';

export const revalidate = 0;

export default async function CampagnePostsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await contexteCourant();
  const [t, locale, fuseau, posts, retenues] = await Promise.all([
    getTranslations('campagne.posts'),
    getLocale(),
    fuseauDeLOrganisation(ctx.ex, ctx.organisationId),
    listerPostsDeCampagne(ctx, { campagneId: id }),
    compterRetenuesParPost(ctx.ex, ctx.organisationId, id),
  ]);
  const peutModifier = ctx.role !== null && hasMinRole(ctx.role, 'operator');
  const maintenant = new Date();
  const jourMois = (d: Date) => d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', timeZone: fuseau });

  // Ce que cet écran a le droit d'AFFIRMER : la règle vit à côté du quantificateur qu'elle
  // recopie (`retenuesAAfficher`, packages/core), elle n'est pas rejouée ici.
  const dit = retenuesAAfficher(retenues);

  const lignes: LignePostEcran[] = posts.map((p) => {
    const echeance = echeanceDePost(p.expireLe, maintenant, fuseau);
    // La phrase du gabarit de la campagne quand elle en a une, sinon la phrase par défaut : dans
    // les deux cas l'auteur et le sujet s'éditent à l'intérieur.
    const morceaux: MorceauAccroche[] = decouperAccroche(p.apercuAccroche) ?? [
      { texte: t('phrase.avantAuteur') },
      { champ: 'auteur' },
      { texte: t('phrase.apresAuteur') },
      { champ: 'sujet' },
    ];
    return {
      id: p.id,
      auteur: p.auteur,
      publie: p.posteLe ? t('ligne.publie', { date: jourMois(p.posteLe) }) : t('ligne.publieInconnu'),
      url: p.url,
      sujet: p.sujet,
      morceaux,
      etat: p.etat,
      etatLibelle: t(`etat.${p.etat}`),
      // Ni l'attente ni l'échéance ne valent sans accroche : sans elle personne n'est retenu, et
      // la purge d'ancienneté efface ces personnes bien avant la date de la fenêtre.
      attente: dit.echeances ? t('ligne.attente', { n: p.personnesEnAttente }) : null,
      echeance: dit.echeances ? t(`echeance.${echeance.cle}`, { date: jourMois(p.expireLe), jours: echeance.jours }) : null,
      tonEcheance: echeance.ton,
      etiquetteSujet: t('phrase.sujetEtiquette', { auteur: p.auteur ?? t('ligne.auteurInconnu') }),
      etiquetteAuteur: t('phrase.auteurEtiquette'),
    };
  });

  const enAttente = lignes.filter((l) => l.etat === 'pending');
  const validablesEnLot = enAttente.filter(ligneValidable).length;
  // Ce que la garde retient, dit tel quel : une campagne qui retient du monde sans le dire est le
  // pire défaut de ce produit. Mais une campagne qui ANNONCE une rétention qui n'a pas lieu est le
  // défaut d'en face, et ce dépôt l'a déjà payé (« une alerte fausse en éteint une vraie »).
  const aDire = dit.sansSource || dit.sansPost > 0 || dit.postInexploitable > 0;

  return (
    <>
      <div className="jr-flux-entete">
        <div className="jr-section-entete">
          <div>
            <h2>{t('title')}</h2>
            <p>{t('description')}</p>
          </div>
        </div>
      </div>
      <div className="jr-posts-corps">
        {aDire && (
          <div className="jr-carte">
            <div className="jr-posts-retenues">
              <h3>{t('retenues.titre')}</h3>
              {dit.sansSource && <p>{t('retenues.sansSource')}</p>}
              {dit.sansPost > 0 && <p>{t('retenues.sansPost', { n: dit.sansPost })}</p>}
              {dit.postInexploitable > 0 && <p>{t('retenues.inexploitable', { n: dit.postInexploitable })}</p>}
            </div>
          </div>
        )}
        {lignes.length === 0 ? (
          <EtatVide titre={t('vide.titre')} texte={t('vide.texte')} />
        ) : (
          <TablePosts
            campagneId={id}
            lignes={lignes}
            peutModifier={peutModifier}
            libelles={{
              auteurInconnu: t('ligne.auteurInconnu'),
              voir: t('ligne.voir'),
              sujetInvite: t('phrase.sujetInvite'),
              auteurInvite: t('phrase.auteurInvite'),
              valider: t('actions.valider'),
              rejeter: t('actions.rejeter'),
              rouvrir: t('actions.rouvrir'),
              // Le compte de personnes vient de la garde elle-même : c'est ce chiffre-là qui
              // retient, pas la somme des lignes (un contact peut dépendre de deux posts).
              resume: enAttente.length > 0 ? t('bar.posts', { n: enAttente.length }) : t('bar.rien'),
              personnes: dit.enAttenteDeValidation > 0 ? t('bar.personnes', { n: dit.enAttenteDeValidation }) : '',
              lotBloque: t('bar.lotBloque'),
              toutValider: validablesEnLot > 1 ? t('bar.toutValider', { n: validablesEnLot }) : null,
            }}
          />
        )}
      </div>
    </>
  );
}
