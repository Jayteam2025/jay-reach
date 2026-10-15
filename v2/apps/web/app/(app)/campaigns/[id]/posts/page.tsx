import { getTranslations, getLocale } from 'next-intl/server';
import {
  compterRetenuesParPost,
  decouperAccroche,
  echeanceDePost,
  fuseauDeLOrganisation,
  hasMinRole,
  listerPostsDeCampagne,
} from '@jay-reach/core';
import { contexteCourant } from '../../../../../lib/contexte';
import { EtatVide } from '../../../../../components/ui';
import { TablePosts, type LignePostEcran } from '../../../../../components/campagne/TablePosts';

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

  const lignes: LignePostEcran[] = posts.map((p) => {
    const echeance = echeanceDePost(p.expireLe, maintenant, fuseau);
    // La phrase du gabarit de la campagne quand elle en a une, sinon la phrase par défaut : dans
    // les deux cas le sujet s'édite à l'intérieur.
    const phrase = decouperAccroche(p.apercuAccroche) ?? {
      avant: t('phrase.avant', { auteur: p.auteur ?? t('ligne.auteurInconnu') }),
      apres: '',
    };
    return {
      id: p.id,
      auteur: p.auteur,
      publie: p.posteLe ? t('ligne.publie', { date: jourMois(p.posteLe) }) : t('ligne.publieInconnu'),
      url: p.url,
      sujet: p.sujet,
      avant: phrase.avant,
      apres: phrase.apres,
      etat: p.etat,
      etatLibelle: t(`etat.${p.etat}`),
      attente: t('ligne.attente', { n: p.personnesEnAttente }),
      echeance: t(`echeance.${echeance.cle}`, { date: jourMois(p.expireLe), jours: echeance.jours }),
      tonEcheance: echeance.ton,
      etiquetteSujet: t('phrase.sujetEtiquette', { auteur: p.auteur ?? t('ligne.auteurInconnu') }),
    };
  });

  const enAttente = lignes.filter((l) => l.etat === 'pending');
  const validablesEnLot = enAttente.filter((l) => (l.sujet ?? '').trim() !== '').length;
  // Ce que la garde retient, dit tel quel : une campagne qui retient du monde sans le dire est le
  // pire défaut de ce produit.
  const retenuesDites = {
    sansSource: retenues.nommeUnPost && !retenues.aUneSourceDePost,
    sansPost: retenues.sansPost,
    inexploitable: retenues.postInexploitable,
  };
  const aDire = retenuesDites.sansSource || retenuesDites.sansPost > 0 || retenuesDites.inexploitable > 0;

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
              {retenuesDites.sansSource && <p>{t('retenues.sansSource')}</p>}
              {retenuesDites.sansPost > 0 && <p>{t('retenues.sansPost', { n: retenuesDites.sansPost })}</p>}
              {retenuesDites.inexploitable > 0 && <p>{t('retenues.inexploitable', { n: retenuesDites.inexploitable })}</p>}
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
              valider: t('actions.valider'),
              rejeter: t('actions.rejeter'),
              rouvrir: t('actions.rouvrir'),
              // Le compte de personnes vient de la garde elle-même : c'est ce chiffre-là qui
              // retient, pas la somme des lignes (un contact peut dépendre de deux posts).
              resume: enAttente.length > 0 ? t('bar.posts', { n: enAttente.length }) : t('bar.rien'),
              personnes: retenues.enAttenteDeValidation > 0 ? t('bar.personnes', { n: retenues.enAttenteDeValidation }) : '',
              toutValider: validablesEnLot > 1 ? t('bar.toutValider', { n: validablesEnLot }) : null,
            }}
          />
        )}
      </div>
    </>
  );
}
