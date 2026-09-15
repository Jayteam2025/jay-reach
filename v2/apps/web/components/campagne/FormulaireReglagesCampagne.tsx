'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Bouton, Carte, Champ, Interrupteur, TuileLogo } from '../ui';
import { actionArchiverCampagne, actionModifierReglagesCampagne } from '../../app/actions/campagne-reglages';

// ---------------------------------------------------------------------------
// Corps du formulaire — sans hook (props déjà résolues), seule partie
// testable par `renderToStaticMarkup` (`FormulaireReglagesCampagne`, plus
// bas, dépend de `useRouter`/`useTranslations` — même limite que
// `BoutonLancerPause`/`TiroirRelecture`, brief tâche 13).
// ---------------------------------------------------------------------------

export interface BoiteReglage {
  readonly id: string;
  readonly identite: string;
  readonly marque: 'outlook' | 'gmail' | null;
  readonly active: boolean;
}

export interface PersonaReglage {
  readonly id: string;
  readonly nom: string;
}

export interface CorpsReglagesCampagneLibelles {
  identite: string;
  nom: string;
  /** « Persona ciblé » (R54, tour de correction 1) — lecture seule, jamais modifiable ici. */
  personasTitre: string;
  personasVide: string;
  personasAide: string;
  personasLien: string;
  ciblageEtRythme: string;
  scoreMin: string;
  scoreMinSuffixe: string;
  scoreMinAide: string;
  plafondJour: string;
  plafondJourSuffixe: string;
  plafondJourAide: string;
  relecture: string;
  relectureSuffixe: string;
  relectureAide: string;
  boites: string;
  boitesAide: string;
  boitesNoteAide: string;
  boitesNoteLien: string;
  aucuneBoite: string;
}

export interface CorpsReglagesCampagneProps {
  nom: string;
  onNomChange: (valeur: string) => void;
  /** Personas ciblés (`listerPersonasCampagne`) — affichage seul, aucune action de modification ici. */
  personas: readonly PersonaReglage[];
  scoreMin: string;
  onScoreMinChange: (valeur: string) => void;
  plafondJour: string;
  onPlafondJourChange: (valeur: string) => void;
  relecture: string;
  onRelectureChange: (valeur: string) => void;
  boites: readonly BoiteReglage[];
  onToggleBoite: (id: string, actif: boolean) => void;
  disabled: boolean;
  libelles: CorpsReglagesCampagneLibelles;
}

export function CorpsReglagesCampagne({
  nom,
  onNomChange,
  personas,
  scoreMin,
  onScoreMinChange,
  plafondJour,
  onPlafondJourChange,
  relecture,
  onRelectureChange,
  boites,
  onToggleBoite,
  disabled,
  libelles,
}: CorpsReglagesCampagneProps) {
  return (
    <>
      <Carte titre={libelles.identite}>
        <div className="jr-formulaire">
          <Champ libelle={libelles.nom}>
            <input value={nom} onChange={(e) => onNomChange(e.target.value)} disabled={disabled} />
          </Champ>
          <div>
            <span className="jr-libelle">{libelles.personasTitre}</span>
            {personas.length === 0 ? (
              <p className="jr-aide">{libelles.personasVide}</p>
            ) : (
              <div className="jr-puces">
                {personas.map((persona) => (
                  <span key={persona.id} className="jr-puce">
                    {persona.nom}
                  </span>
                ))}
              </div>
            )}
            <div className="jr-aide">
              {libelles.personasAide} <Link href="/settings/personas">{libelles.personasLien}</Link>
            </div>
          </div>
        </div>
      </Carte>

      <Carte titre={libelles.ciblageEtRythme}>
        <div className="jr-formulaire">
          <div className="ligne">
            <div>
              <Champ libelle={libelles.scoreMin} suffixe={libelles.scoreMinSuffixe}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={scoreMin}
                  onChange={(e) => onScoreMinChange(e.target.value)}
                  disabled={disabled}
                />
              </Champ>
              <div className="jr-aide">{libelles.scoreMinAide}</div>
            </div>
            <div>
              <Champ libelle={libelles.plafondJour} suffixe={libelles.plafondJourSuffixe}>
                <input
                  type="number"
                  min={1}
                  value={plafondJour}
                  onChange={(e) => onPlafondJourChange(e.target.value)}
                  disabled={disabled}
                />
              </Champ>
              <div className="jr-aide">{libelles.plafondJourAide}</div>
            </div>
            <div>
              <Champ libelle={libelles.relecture} suffixe={libelles.relectureSuffixe}>
                <input
                  type="number"
                  min={0}
                  value={relecture}
                  onChange={(e) => onRelectureChange(e.target.value)}
                  disabled={disabled}
                />
              </Champ>
              <div className="jr-aide">{libelles.relectureAide}</div>
            </div>
          </div>
        </div>
      </Carte>

      <Carte
        titre={
          <>
            {libelles.boites} <small>{libelles.boitesAide}</small>
          </>
        }
      >
        {boites.length === 0 ? (
          <p className="jr-aide">{libelles.aucuneBoite}</p>
        ) : (
          boites.map((boite) => (
            <div key={boite.id} className="jr-source">
              {boite.marque && <TuileLogo marque={boite.marque} />}
              <span>
                <b>{boite.identite}</b>
              </span>
              <Interrupteur
                actif={boite.active}
                libelle={boite.identite}
                disabled={disabled}
                onChange={(actif) => onToggleBoite(boite.id, actif)}
              />
            </div>
          ))
        )}
        <p className="jr-aide">
          {libelles.boitesNoteAide} <Link href="/settings/senders">{libelles.boitesNoteLien}</Link>
        </p>
      </Carte>
    </>
  );
}

// ---------------------------------------------------------------------------
// Formulaire complet — état local, actions serveur, archivage.
// ---------------------------------------------------------------------------

export interface FormulaireReglagesCampagneProps {
  campagneId: string;
  initial: {
    nom: string;
    scoreMin: number;
    dailyCap: number | null;
    relecturePremiersEnvois: number;
  };
  /** Personas ciblés par la campagne (`listerPersonasCampagne`) — lecture seule (R54, tour de correction 1). */
  personas: readonly PersonaReglage[];
  /** Toutes les boîtes email actives de l'organisation (`listerBoitesPourCampagne`, tâche 20 plus tard). */
  boites: readonly { id: string; identite: string; marque: 'outlook' | 'gmail' | null }[];
  /** Boîtes actuellement retenues par la campagne (`CampagneEnTete.boites` — le pool entier si `entry_rules.boiteIds` est absent). */
  boiteIdsSelectionnees: readonly string[];
  /** Contacts actuellement en séquence (`Entonnoir.enSequence`) — sert au texte d'avertissement de la zone d'archivage. */
  enSequence: number;
  /** `ctx.role` au moins `admin` : seul ce rôle peut archiver (`archiver`, tâche 7). */
  peutArchiver: boolean;
}

function versChamp(valeur: number | null): string {
  return valeur === null ? '' : String(valeur);
}

/** `null` un champ vidé (« suit le défaut »), `NaN` une saisie non numérique (le serveur la refuse via son schéma Zod et renvoie un message clair). */
function versEntier(valeur: string): number | null {
  const nettoye = valeur.trim();
  if (nettoye === '') return null;
  return Math.trunc(Number(nettoye));
}

export function FormulaireReglagesCampagne({
  campagneId,
  initial,
  personas,
  boites,
  boiteIdsSelectionnees,
  enSequence,
  peutArchiver,
}: FormulaireReglagesCampagneProps) {
  const t = useTranslations('campagne.reglages');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[] | undefined>(undefined);

  const [nom, setNom] = useState(initial.nom);
  const [scoreMin, setScoreMin] = useState(String(initial.scoreMin));
  const [plafondJour, setPlafondJour] = useState(versChamp(initial.dailyCap));
  const [relecture, setRelecture] = useState(String(initial.relecturePremiersEnvois));
  const [actives, setActives] = useState<ReadonlySet<string>>(() => new Set(boiteIdsSelectionnees));
  const [demandeArchivage, setDemandeArchivage] = useState(false);

  function annuler() {
    setNom(initial.nom);
    setScoreMin(String(initial.scoreMin));
    setPlafondJour(versChamp(initial.dailyCap));
    setRelecture(String(initial.relecturePremiersEnvois));
    setActives(new Set(boiteIdsSelectionnees));
    setErreur(null);
    setIssues(undefined);
  }

  function toggleBoite(id: string, actif: boolean) {
    setActives((precedent) => {
      const suivant = new Set(precedent);
      if (actif) suivant.add(id);
      else suivant.delete(id);
      return suivant;
    });
  }

  function enregistrer() {
    setErreur(null);
    setIssues(undefined);
    // Toutes les boîtes cochées : on envoie `[]` (« pool entier », le
    // comportement par défaut), pas la liste explicite — sinon une boîte
    // ajoutée plus tard à l'organisation resterait exclue de cette campagne
    // sans que personne n'ait choisi de la restreindre (brief : `boiteIds`
    // absent/vide → tout le pool).
    const toutesActives = actives.size >= boites.length;
    startTransition(async () => {
      const res = await actionModifierReglagesCampagne(campagneId, {
        name: nom.trim(),
        minScore: versEntier(scoreMin),
        dailyCap: versEntier(plafondJour),
        relecturePremiersEnvois: versEntier(relecture),
        boiteIds: toutesActives ? [] : [...actives],
      });
      if (res.ok) {
        router.refresh();
      } else {
        setErreur(res.error);
        setIssues(res.issues);
      }
    });
  }

  function confirmerArchivage() {
    setErreur(null);
    startTransition(async () => {
      const res = await actionArchiverCampagne(campagneId);
      if (res.ok) router.push('/campaigns');
      else setErreur(res.error);
    });
  }

  const boitesAffichees: BoiteReglage[] = boites.map((boite) => ({ ...boite, active: actives.has(boite.id) }));

  return (
    <>
      <CorpsReglagesCampagne
        nom={nom}
        onNomChange={setNom}
        personas={personas}
        scoreMin={scoreMin}
        onScoreMinChange={setScoreMin}
        plafondJour={plafondJour}
        onPlafondJourChange={setPlafondJour}
        relecture={relecture}
        onRelectureChange={setRelecture}
        boites={boitesAffichees}
        onToggleBoite={toggleBoite}
        disabled={pending}
        libelles={{
          identite: t('identity.title'),
          nom: t('identity.name'),
          personasTitre: t('identity.personasTitle'),
          personasVide: t('identity.personasEmpty'),
          personasAide: t('identity.personasHint'),
          personasLien: t('identity.personasLink'),
          ciblageEtRythme: t('targeting.title'),
          scoreMin: t('targeting.minScore'),
          scoreMinSuffixe: t('targeting.minScoreSuffix'),
          scoreMinAide: t('targeting.minScoreHint'),
          plafondJour: t('targeting.dailyCap'),
          plafondJourSuffixe: t('targeting.dailyCapSuffix'),
          plafondJourAide: t('targeting.dailyCapHint'),
          relecture: t('targeting.review'),
          relectureSuffixe: t('targeting.reviewSuffix'),
          relectureAide: t('targeting.reviewHint'),
          boites: t('senders.title'),
          boitesAide: t('senders.hint'),
          boitesNoteAide: t('senders.noteHint'),
          boitesNoteLien: t('senders.noteLink'),
          aucuneBoite: t('senders.empty'),
        }}
      />

      {issues && issues.length > 0 && (
        <div className="jr-notification erreur" role="alert">
          {issues.join(' ')}
        </div>
      )}
      {erreur && (!issues || issues.length === 0) && (
        <div className="jr-notification erreur" role="alert">
          {erreur}
        </div>
      )}

      <div className="jr-actions fin">
        <Bouton onClick={annuler} disabled={pending}>
          {t('cancel')}
        </Bouton>
        <Bouton variante="principal" onClick={enregistrer} disabled={pending} aria-busy={pending}>
          {t('save')}
        </Bouton>
      </div>

      {peutArchiver && (
        <Carte titre={t('archive.title')} className="danger">
          <div className="jr-formulaire">
            <p>{t('archive.warning', { count: enSequence })}</p>

            {!demandeArchivage && (
              <div className="jr-actions">
                <Bouton variante="danger" onClick={() => setDemandeArchivage(true)} disabled={pending}>
                  {t('archive.button')}
                </Bouton>
              </div>
            )}

            {demandeArchivage && (
              <>
                <div className="jr-bandeau attention">
                  <span>{t('archive.confirmText')}</span>
                </div>
                <div className="jr-actions">
                  <Bouton onClick={() => setDemandeArchivage(false)} disabled={pending}>
                    {t('archive.cancel')}
                  </Bouton>
                  <Bouton variante="danger" onClick={confirmerArchivage} disabled={pending} aria-busy={pending}>
                    {t('archive.confirmButton')}
                  </Bouton>
                </div>
              </>
            )}
          </div>
        </Carte>
      )}
    </>
  );
}
