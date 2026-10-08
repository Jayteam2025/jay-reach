'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Bouton } from '../../ui';
import { actionCreerCampagneComplete } from '../../../app/actions/nouvelle-campagne';
import { EtapeQui, type PersonaOptionAssistant } from './EtapeQui';
import { EtapeSources, type SourceAssistant } from './EtapeSources';
import { EtapeSequence, type EtapeSequenceEtape, type CleModeleSequence, etapesDepuisModele } from './EtapeSequence';
import { EtapeEnvoi, type BoiteEnvoiAssistant } from './EtapeEnvoi';

const MODELE_PAR_DEFAUT: CleModeleSequence = 'question_relances';

type CleEtapeAssistant = 'qui' | 'sources' | 'sequence' | 'envoi';
const ORDRE_ETAPES: readonly CleEtapeAssistant[] = ['qui', 'sources', 'sequence', 'envoi'];

export interface AssistantProps {
  personas: readonly PersonaOptionAssistant[];
  boites: readonly BoiteEnvoiAssistant[];
}

/**
 * Construit l'entrée envoyée à `creerCampagneComplete` (`actionCreerCampagneComplete`)
 * à partir de l'état de l'assistant. Pure — testable indépendamment du rendu
 * (`Assistant.test.ts`) : c'est le point le plus important de ce fichier, la
 * traduction entre l'état écran et le contrat back.
 */
export function construireEntreeAssistant(
  etat: {
    nom: string;
    personaId: string | null;
    scoreMin: string;
    plafondJour: string;
    sources: readonly SourceAssistant[];
    etapes: readonly EtapeSequenceEtape[];
    relecture: string;
    boiteIdsDesactivees: ReadonlySet<string>;
    boites: readonly BoiteEnvoiAssistant[];
  },
  lancer: boolean,
): unknown {
  const toutesActives = etat.boiteIdsDesactivees.size === 0;
  return {
    nom: etat.nom.trim(),
    personaIds: etat.personaId ? [etat.personaId] : [],
    minScore: Number(etat.scoreMin) || 0,
    dailyCap: Math.max(1, Number(etat.plafondJour) || 1),
    sources: etat.sources.map((s) => ({ providerId: s.providerId, nom: s.nom, config: s.config })),
    etapes: etat.etapes.map((e) => ({ canal: e.canal, sujet: e.sujet, corps: e.corps, delaiHeures: e.delaiJours * 24 })),
    relecturePremiersEnvois: Number(etat.relecture) || 0,
    // [] veut dire « toutes les boîtes » (`resoudreBoites`, packages/core) : dès
    // qu'une boîte est décochée on enregistre la liste explicite de celles qui
    // restent cochées, jamais [] pour ce cas-là. Si TOUTES sont décochées, le
    // filtre rend [] aussi — ambigu avec « toutes » — mais l'écran désactive
    // alors « Créer et lancer » (R71, tour de correction 4, voir
    // `nombreBoitesActives`) : ce [] n'atteint le back que via « Enregistrer en
    // brouillon », où l'ambiguïté est sans conséquence tant que la campagne n'est
    // pas lancée.
    boiteIds: toutesActives ? [] : etat.boites.map((b) => b.id).filter((id) => !etat.boiteIdsDesactivees.has(id)),
    lancer,
  };
}

/** Nombre de boîtes cochées — extrait pour être testable indépendamment du rendu (R71). */
export function nombreBoitesActives(
  boites: readonly BoiteEnvoiAssistant[],
  boiteIdsDesactivees: ReadonlySet<string>,
): number {
  return boites.filter((b) => !boiteIdsDesactivees.has(b.id)).length;
}

export function Assistant({ personas, boites }: AssistantProps) {
  const t = useTranslations('campagne.nouvelle');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [etapeIndex, setEtapeIndex] = useState(0);

  const [nom, setNom] = useState('');
  const [personaId, setPersonaId] = useState<string | null>(personas[0]?.id ?? null);
  const [scoreMin, setScoreMin] = useState('70');
  const [plafondJour, setPlafondJour] = useState('30');

  const [sources, setSources] = useState<readonly SourceAssistant[]>([]);
  const [etapes, setEtapes] = useState<readonly EtapeSequenceEtape[]>(() => etapesDepuisModele(MODELE_PAR_DEFAUT));

  const [relecture, setRelecture] = useState('5');
  const [boiteIdsDesactivees, setBoiteIdsDesactivees] = useState<ReadonlySet<string>>(new Set());

  const [erreur, setErreur] = useState<string | null>(null);
  const [manques, setManques] = useState<readonly string[]>([]);
  const [campagneCreeeId, setCampagneCreeeId] = useState<string | null>(null);

  const etapeCourante = ORDRE_ETAPES[etapeIndex]!;

  function ajouterSource(source: SourceAssistant) {
    setSources((precedent) => [...precedent, source]);
  }
  function retirerSource(cle: string) {
    setSources((precedent) => precedent.filter((s) => s.cle !== cle));
  }

  function choisirModele(cle: CleModeleSequence) {
    setEtapes(etapesDepuisModele(cle));
  }
  function ajouterEtape() {
    setEtapes((precedent) => [
      ...precedent,
      { cle: `manuel-${Date.now()}`, canal: 'email', sujet: '', corps: '', delaiJours: 2 },
    ]);
  }
  function modifierEtape(cle: string, patch: Partial<Omit<EtapeSequenceEtape, 'cle'>>) {
    setEtapes((precedent) => precedent.map((e) => (e.cle === cle ? { ...e, ...patch } : e)));
  }
  function supprimerEtape(cle: string) {
    setEtapes((precedent) => precedent.filter((e) => e.cle !== cle));
  }

  function toggleBoite(id: string, actif: boolean) {
    setBoiteIdsDesactivees((precedent) => {
      const suivant = new Set(precedent);
      if (actif) suivant.delete(id);
      else suivant.add(id);
      return suivant;
    });
  }

  function allerA(index: number) {
    setErreur(null);
    setEtapeIndex(Math.max(0, Math.min(index, ORDRE_ETAPES.length - 1)));
  }

  function continuer() {
    if (etapeCourante === 'qui' && !nom.trim()) {
      setErreur(t('who.errorName'));
      return;
    }
    if (etapeCourante === 'sequence' && etapes.length === 0) {
      setErreur(t('sequence.errorEmpty'));
      return;
    }
    allerA(etapeIndex + 1);
  }

  function soumettre(lancer: boolean) {
    setErreur(null);
    setManques([]);
    const entree = construireEntreeAssistant(
      { nom, personaId, scoreMin, plafondJour, sources, etapes, relecture, boiteIdsDesactivees, boites },
      lancer,
    );
    startTransition(async () => {
      const res = await actionCreerCampagneComplete(entree);
      if (!res.ok) {
        setErreur(res.issues && res.issues.length > 0 ? res.issues.join(' ') : res.error);
        return;
      }
      if (!lancer || res.lancee) {
        router.push(`/campaigns/${res.campagneId}`);
        return;
      }
      setCampagneCreeeId(res.campagneId);
      setManques(res.manques);
    });
  }

  const personaNom = personas.find((p) => p.id === personaId)?.nom ?? '—';
  const totalJours = etapes.reduce((somme, e) => somme + e.delaiJours, 0);
  const nbBoitesActives = nombreBoitesActives(boites, boiteIdsDesactivees);
  // R71 : aucune boîte cochée alors qu'il y en a au moins une de connectée —
  // « Créer et lancer » se désactive, « Enregistrer en brouillon » reste possible.
  const aucuneBoiteActive = boites.length > 0 && nbBoitesActives === 0;

  return (
    <section className="jr-assistant">
      <div className="jr-etapes">
        {ORDRE_ETAPES.map((cle, index) => (
          <span key={cle}>
            {index > 0 && <span className="sep" />}
            <span
              className={['etape', index < etapeIndex ? 'faite' : index === etapeIndex ? 'en-cours' : undefined]
                .filter(Boolean)
                .join(' ')}
            >
              <i>{index < etapeIndex ? '✓' : index + 1}</i>
              {t(`steps.${cle}`)}
            </span>
          </span>
        ))}
      </div>

      {etapeCourante === 'qui' && (
        <EtapeQui
          nom={nom}
          onNomChange={setNom}
          personas={personas}
          personaId={personaId}
          onPersonaIdChange={setPersonaId}
          scoreMin={scoreMin}
          onScoreMinChange={setScoreMin}
          plafondJour={plafondJour}
          onPlafondJourChange={setPlafondJour}
          disabled={pending}
          libelles={{
            nom: t('who.name'),
            nomPlaceholder: t('who.namePlaceholder'),
            personaTitre: t('who.personaTitle'),
            personaVide: t('who.personaEmpty'),
            personaNouveau: t('who.personaNew'),
            personaNouveauAide: t('who.personaNewHint'),
            scoreMin: t('who.minScore'),
            scoreMinSuffixe: t('who.minScoreSuffix'),
            scoreMinAide: t('who.minScoreHint'),
            plafondJour: t('who.dailyCap'),
            plafondJourSuffixe: t('who.dailyCapSuffix'),
            plafondJourAide: t('who.dailyCapHint'),
          }}
        />
      )}

      {etapeCourante === 'sources' && (
        <EtapeSources
          sources={sources}
          onAjouter={ajouterSource}
          onRetirer={retirerSource}
          disabled={pending}
          libelles={{
            titre: t('sources.title'),
            description: t('sources.description'),
            ajouter: t('sources.add'),
            vide: t('sources.emptyTitle'),
            aide: t('sources.hint'),
            retirer: t('sources.remove'),
            menuOffres: t('sources.menuGroupJobs'),
            menuAdzunaTitre: t('sources.menuAdzunaTitle'),
            menuAdzunaDescription: t('sources.menuAdzunaDescription'),
            menuFranceTravailTitre: t('sources.menuFranceTravailTitle'),
            menuFranceTravailDescription: t('sources.menuFranceTravailDescription'),
            menuLinkedin: t('sources.menuGroupLinkedin'),
            menuLinkedinBadge: t('sources.menuLinkedinBadge'),
            menuLinkedinPostEngagersTitre: t('sources.menuLinkedinPostEngagersTitle'),
            menuLinkedinPostEngagersDescription: t('sources.menuLinkedinPostEngagersDescription'),
            menuLinkedinCompetitorFollowersTitre: t('sources.menuLinkedinCompetitorFollowersTitle'),
            menuLinkedinCompetitorFollowersDescription: t('sources.menuLinkedinCompetitorFollowersDescription'),
            menuLinkedinKeywordsTitre: t('sources.menuLinkedinKeywordsTitle'),
            menuLinkedinKeywordsDescription: t('sources.menuLinkedinKeywordsDescription'),
            menuLinkedinJobChangeTitre: t('sources.menuLinkedinJobChangeTitle'),
            menuLinkedinJobChangeDescription: t('sources.menuLinkedinJobChangeDescription'),
            menuManuel: t('sources.menuGroupManual'),
            menuCsvTitre: t('sources.menuCsvTitle'),
            menuCsvNote: t('sources.menuCsvDisabledNote'),
            formNom: t('sources.formName'),
            formMotsCles: t('sources.formKeywords'),
            formMotsClesAide: t('sources.formKeywordsHint'),
            formLieux: t('sources.formLocations'),
            formContrat: t('sources.formContract'),
            formContratTous: t('sources.formContractAll'),
            formContratCdi: t('sources.formContractPermanent'),
            formLinkedinPostUrl: t('sources.formLinkedinPostUrl'),
            formLinkedinKeepPeople: t('sources.formLinkedinKeepPeople'),
            formLinkedinCommented: t('sources.formLinkedinCommented'),
            formLinkedinReacted: t('sources.formLinkedinReacted'),
            formLinkedinPostOneCampaign: t('sources.formLinkedinPostOneCampaign'),
            formLinkedinCompetitorPages: t('sources.formLinkedinCompetitorPages'),
            formLinkedinTopics: t('sources.formLinkedinTopics'),
            formLinkedinSinceDays: t('sources.formLinkedinSinceDays'),
            formLinkedinAccountId: t('sources.formLinkedinAccountId'),
            formLinkedinProfilesPerDay: t('sources.formLinkedinProfilesPerDay'),
            formLinkedinErreur: t('sources.formLinkedinError'),
            formLinkedinBrouillon: t('sources.formLinkedinBrouillon'),
            resumeLinkedin: (n: number) => t('sources.summaryLinkedin', { n }),
            formAjouter: t('sources.formSubmit'),
            formAnnuler: t('sources.formCancel'),
            formErreur: t('sources.formError'),
          }}
        />
      )}

      {etapeCourante === 'sequence' && (
        <EtapeSequence
          etapes={etapes}
          onChoisirModele={choisirModele}
          onAjouterEtape={ajouterEtape}
          onModifierEtape={modifierEtape}
          onSupprimerEtape={supprimerEtape}
          disabled={pending}
          libelles={{
            partirDe: t('sequence.startFrom'),
            modeleVideNom: t('sequence.emptyModelName'),
            modeleVideDescription: t('sequence.emptyModelDescription'),
            apercu: t('sequence.preview'),
            ajouterEtape: t('sequence.addStep'),
            etape: t('sequence.step'),
            canal: t('sequence.channel'),
            canalEmail: t('sequence.channelEmail'),
            canalLinkedinInvite: t('sequence.channelLinkedinInvite'),
            canalLinkedinMessage: t('sequence.channelLinkedinMessage'),
            inviteSansNote: t('sequence.inviteSansNote'),
            objet: t('sequence.subject'),
            corps: t('sequence.body'),
            delai: t('sequence.delay'),
            delaiSuffixe: t('sequence.delaySuffix'),
            delaiPilule: (n: number) => t('sequence.delaiPilule', { n }),
            envoiImmediat: t('sequence.sentAtLaunch'),
            supprimer: t('sequence.remove'),
            variablesAide: t('sequence.variablesHint'),
            vide: t('sequence.empty'),
          }}
        />
      )}

      {etapeCourante === 'envoi' && (
        <EtapeEnvoi
          boites={boites}
          boiteIdsDesactivees={boiteIdsDesactivees}
          onToggleBoite={toggleBoite}
          aucuneBoiteActive={aucuneBoiteActive}
          relecture={relecture}
          onRelectureChange={setRelecture}
          disabled={pending}
          recapitulatif={{
            persona: t('send.recapPersonaValue', { persona: personaNom, score: Number(scoreMin) || 0 }),
            sources: sources.length === 0 ? t('send.recapSourcesEmpty') : sources.map((s) => s.nom).join(' · '),
            sequence: t('send.recapSequenceValue', { n: etapes.length, jours: totalJours }),
            envoi: t('send.recapEnvoiValue', { n: nbBoitesActives, plafond: Number(plafondJour) || 0 }),
          }}
          manques={manques}
          libelles={{
            boitesTitre: t('send.boxesTitle'),
            boitesVide: t('send.boxesEmpty'),
            boitesAucuneActive: t('send.boxesNoneActive'),
            relecture: t('send.review'),
            relectureSuffixe: t('send.reviewSuffix'),
            relectureAide: t('send.reviewHint'),
            recapTitre: t('send.summaryTitle'),
            recapPersona: t('send.summaryPersona'),
            recapSources: t('send.summarySources'),
            recapSequence: t('send.summarySequence'),
            recapEnvoi: t('send.summarySend'),
            recapPremierPassage: t('send.summaryFirstPass'),
            recapPremierPassageValeur: t('send.summaryFirstPassValue'),
            erreurLancement: t('send.launchError'),
          }}
        />
      )}

      {erreur && (
        <div className="jr-notification erreur" role="alert">
          {erreur}
        </div>
      )}

      {campagneCreeeId && manques.length > 0 && (
        <div className="jr-actions fin">
          <Link href={`/campaigns/${campagneCreeeId}`} className="jr-bouton">
            {t('actions.viewCampaign')}
          </Link>
        </div>
      )}

      <div className="jr-actions entre">
        <div>
          {etapeIndex === 0 ? (
            <Link href="/campaigns" className="jr-bouton">
              {t('actions.cancel')}
            </Link>
          ) : (
            <Bouton onClick={() => allerA(etapeIndex - 1)} disabled={pending}>
              {t('actions.back')}
            </Bouton>
          )}
        </div>
        <div className="jr-actions">
          {etapeCourante === 'envoi' ? (
            <>
              <Bouton onClick={() => soumettre(false)} disabled={pending} aria-busy={pending}>
                {t('actions.saveDraft')}
              </Bouton>
              <Bouton
                variante="principal"
                onClick={() => soumettre(true)}
                disabled={pending || aucuneBoiteActive}
                aria-busy={pending}
              >
                {t('actions.createAndLaunch')}
              </Bouton>
            </>
          ) : (
            <Bouton variante="principal" onClick={continuer} disabled={pending}>
              {t('actions.continue')}
            </Bouton>
          )}
        </div>
      </div>
    </section>
  );
}
