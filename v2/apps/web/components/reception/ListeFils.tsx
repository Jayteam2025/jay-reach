import Link from 'next/link';
import type { getTranslations } from 'next-intl/server';
import type { FiltreReception, InteretFil } from '@jay-reach/core';
import { Avatar, EtatVide, Filtres, Puce } from '../ui';
import { SelecteurCampagne } from './SelecteurCampagne';

export interface LigneFilAffichage {
  readonly id: string;
  readonly nom: string;
  readonly canal: 'email' | 'linkedin';
  readonly classification: string;
  readonly apercu: string;
  readonly quandAffiche: string;
  readonly interet: InteretFil;
  readonly relanceLeAffiche: string | null;
}

export interface ListeFilsProps {
  /** Résolu une fois par `page.tsx` — voir le commentaire équivalent dans `Fil.tsx`. */
  readonly t: Awaited<ReturnType<typeof getTranslations>>;
  readonly fils: LigneFilAffichage[];
  readonly compteurs: Record<FiltreReception, number>;
  readonly filtreActif: FiltreReception;
  readonly campagneId: string | null;
  readonly campagnes: { id: string; nom: string }[];
  readonly filSelectionneId: string | null;
}

const FILTRES: FiltreReception[] = ['a_traiter', 'interesses', 'absences', 'traites', 'tous'];

function classePuce(actif: boolean): string {
  return ['jr-puce', actif ? 'accent' : undefined].filter(Boolean).join(' ');
}

function lienFiltre(filtre: FiltreReception, campagneId: string | null): string {
  const params = new URLSearchParams();
  if (filtre !== 'a_traiter') params.set('filtre', filtre);
  if (campagneId) params.set('campagneId', campagneId);
  const qs = params.toString();
  return qs ? `/inbox?${qs}` : '/inbox';
}

function lienFil(filId: string, filtre: FiltreReception, campagneId: string | null): string {
  const params = new URLSearchParams();
  if (filtre !== 'a_traiter') params.set('filtre', filtre);
  if (campagneId) params.set('campagneId', campagneId);
  params.set('fil', filId);
  return `/inbox?${params.toString()}`;
}

/**
 * Volet gauche : puces de filtre + sélecteur de campagne, liste des fils.
 * Chaque ligne est un lien (`?fil=<id>`, filtre/campagne préservés) — la
 * sélection se fait par navigation serveur, même motif que
 * `FiltresStatuts`/la liste des campagnes (tâche 9), pas d'état client.
 */
export function ListeFils({ t, fils, compteurs, filtreActif, campagneId, campagnes, filSelectionneId }: ListeFilsProps) {
  return (
    <div className="jr-liste">
      <h2>{t('title')}</h2>
      <Filtres>
        {FILTRES.map((filtre) => (
          <Link key={filtre} href={lienFiltre(filtre, campagneId)} className={classePuce(filtreActif === filtre)}>
            {t(`filtres.${filtre}`)} {compteurs[filtre]}
          </Link>
        ))}
        <SelecteurCampagne campagnes={campagnes} valeur={campagneId} filtre={filtreActif} toutesLabel={t('toutesLesCampagnes')} />
      </Filtres>
      {fils.length === 0 ? (
        <EtatVide titre={t('liste.videTitre')} texte={t('liste.videTexte')} />
      ) : (
        <ul className="jr-conversations">
          {fils.map((fil) => (
            <li key={fil.id} className={fil.id === filSelectionneId ? 'actif' : undefined}>
              <Link href={lienFil(fil.id, filtreActif, campagneId)} aria-current={fil.id === filSelectionneId ? 'true' : undefined}>
                <Avatar nom={fil.nom} canal={fil.canal} />
                <span>
                  <b>{fil.nom}</b>
                  <p>{fil.apercu}</p>
                </span>
                <time>{fil.quandAffiche}</time>
                {(fil.interet || fil.classification === 'auto_absence' || fil.canal === 'linkedin') && (
                  <span className="etiquettes">
                    {fil.interet === 'interested' && (
                      <Puce ton="bon" point>
                        {t('filtres.puceInteresse')}
                      </Puce>
                    )}
                    {fil.interet === 'not_interested' && <Puce ton="gris">{t('filtres.puceNonInteresse')}</Puce>}
                    {fil.classification === 'auto_absence' && (
                      <Puce ton="attention" point>
                        {fil.relanceLeAffiche ? t('filtres.puceAbsenceAvecDate', { date: fil.relanceLeAffiche }) : t('filtres.puceAbsence')}
                      </Puce>
                    )}
                    {fil.canal === 'linkedin' && <Puce ton="li">{t('filtres.puceLinkedin')}</Puce>}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
